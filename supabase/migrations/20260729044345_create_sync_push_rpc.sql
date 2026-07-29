-- Optimistic-concurrency write. The client passes the revision it believes the
-- server is on. If that still holds, the write lands and `rev` advances. If the
-- server has moved on (the laptop wrote while the phone was asleep), the write
-- is refused and the newer document comes back so the client can reconcile
-- instead of overwriting work it never saw.
create or replace function sync.push(p_doc jsonb, p_rev bigint, p_device text default '')
returns jsonb
language plpgsql
security invoker
set search_path = sync, public, pg_temp
as $$
declare
  cur sync.state;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select * into cur from sync.state where user_id = uid;

  if cur.user_id is null then
    insert into sync.state (user_id, doc, rev, device)
    values (uid, p_doc, 1, coalesce(p_device, ''))
    returning * into cur;
    return jsonb_build_object('accepted', true, 'rev', cur.rev, 'updated_at', cur.updated_at);
  end if;

  if p_rev is null or p_rev <> cur.rev then
    return jsonb_build_object(
      'accepted', false, 'rev', cur.rev, 'doc', cur.doc,
      'device', cur.device, 'updated_at', cur.updated_at
    );
  end if;

  update sync.state
     set doc = p_doc,
         rev = cur.rev + 1,
         device = coalesce(p_device, ''),
         updated_at = now()
   where user_id = uid
  returning * into cur;

  return jsonb_build_object('accepted', true, 'rev', cur.rev, 'updated_at', cur.updated_at);
end;
$$;

grant execute on function sync.push(jsonb, bigint, text) to authenticated;
