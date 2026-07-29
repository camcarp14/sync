-- Append `sync` to the exposed schema list. The existing entries are preserved
-- verbatim and `public` stays first (it is PostgREST's default profile), so
-- Board Room, ZTS, Runway and Clarify are unaffected.
--
-- Mirrored by Settings → API → Exposed schemas in the Supabase dashboard. If
-- that list is ever edited there, it overwrites this — re-add `sync` if the app
-- starts reporting PGRST106.
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, zts, runway, boardroom, sync';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
