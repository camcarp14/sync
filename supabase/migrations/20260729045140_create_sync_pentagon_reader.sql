-- One read surface over the org-wide business data. `p_source` selects a fixed
-- branch — there is no dynamic SQL here, so a model choosing the argument can
-- never compose a query of its own. Read-only by construction: every branch is
-- a SELECT, and the function is STABLE.
create or replace function sync.pentagon(
  p_source text,
  p_limit  int  default 25,
  p_from   date default null,
  p_to     date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = sync, boardroom, public, pg_temp
as $$
declare
  n   int := least(greatest(coalesce(p_limit, 25), 1), 200);
  out jsonb;
begin
  if not sync.is_owner() then
    raise exception 'not authorised for Pentagon data' using errcode = '42501';
  end if;

  if p_source = 'prospects' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into out from (
      select p.id, p.business_name, p.city, p.category, p.website, p.phone,
             p.ads_detected, p.prospected_at, p.brief_callouts, p.created_at
        from public.prospects p
       order by p.created_at desc nulls last
       limit n
    ) x;

  elsif p_source = 'outreach' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into out from (
      select o.id, p.business_name, o.status, o.draft_subject, o.sent_at,
             o.replied_at, o.reply_snippet, o.reply_classification,
             o.meeting_at, o.meeting_outcome, o.follow_up_count, o.next_follow_up_at
        from public.outreach o
        left join public.prospects p on p.id = o.prospect_id
       order by coalesce(o.updated_at, o.created_at) desc nulls last
       limit n
    ) x;

  elsif p_source = 'leads' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into out from (
      select l.id, l.created_at, l.name, l.business, l.website, l.email,
             l.monthly_spend, l.service, l.status, l.source
        from public.inbound_leads l
       order by l.created_at desc nulls last
       limit n
    ) x;

  elsif p_source = 'clients' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into out from (
      select c.id, c.name, c.industry, c.status, c.monthly_budget,
             c.cpa_target, c.roas_target, c.primary_conversion, c.notes
        from public.clients c
       where c.user_id = auth.uid()
       order by c.created_at desc nulls last
       limit n
    ) x;

  elsif p_source = 'findings' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into out from (
      select f.id, c.name as client, f.created_at, f.type, f.severity, f.title,
             f.diagnosis, f.recommendation, f.status
        from public.findings f
        join public.clients c on c.id = f.client_id and c.user_id = auth.uid()
       order by f.created_at desc nulls last
       limit n
    ) x;

  elsif p_source = 'store' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into out from (
      select d.day, d.orders_real, d.orders_total, d.orders_unfulfilled,
             d.real_revenue_usd, d.gross_usd, d.active_products, d.blocked_products
        from public.zts_store_daily d
       where (p_from is null or d.day >= p_from)
         and (p_to   is null or d.day <= p_to)
       order by d.day desc
       limit n
    ) x;

  elsif p_source = 'ops' then
    select jsonb_build_object(
      'control', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'key', k.key, 'enabled', k.enabled, 'dry_run', k.dry_run,
                 'paused_reason', k.paused_reason, 'updated_at', k.updated_at))
          from public.ops_control k), '[]'::jsonb),
      'recent_runs', coalesce((
        select jsonb_agg(r) from (
          select subsystem, started_at, finished_at, ok, actions, blocked, errors, cost_usd, note
            from public.ops_runs order by started_at desc nulls last limit 8) r), '[]'::jsonb)
    ) into out;

  -- The one a voice question actually wants: the whole pipeline in a breath.
  elsif p_source = 'pipeline' then
    select jsonb_build_object(
      'prospects',      (select count(*) from public.prospects),
      'new_leads',      (select count(*) from public.inbound_leads where coalesce(status,'new') = 'new'),
      'outreach_by_status', coalesce((
        select jsonb_object_agg(s.status, s.n) from (
          select coalesce(status,'unknown') as status, count(*) as n
            from public.outreach group by 1) s), '{}'::jsonb),
      'replies_7d',     (select count(*) from public.outreach where replied_at > now() - interval '7 days'),
      'meetings_ahead', (select count(*) from public.outreach where meeting_at > now()),
      'due_followups',  (select count(*) from public.outreach where next_follow_up_at <= now())
    ) into out;

  else
    raise exception 'unknown source %', p_source using errcode = '22023';
  end if;

  return coalesce(out, '[]'::jsonb);
end;
$$;

revoke all on function sync.pentagon(text, int, date, date) from public, anon;
grant execute on function sync.pentagon(text, int, date, date) to authenticated;
