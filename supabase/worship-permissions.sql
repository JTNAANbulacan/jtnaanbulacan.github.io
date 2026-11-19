-- JTNAAN Worship Team Hub granular permissions
-- Review and apply this script only after taking a database backup.
-- Existing active accounts with no assigned sections are granted the existing
-- operational access once, preserving current member workflows. New accounts
-- remain dashboard/tutorial-only because their sections default to an empty array.

create or replace function public.worship_has_permission(permission_key text)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    coalesce((select auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', false)
    or coalesce((select (auth.jwt() -> 'app_metadata' -> 'permissions') ? permission_key), false);
$$;

do $$
declare
  legacy_permissions text[] := array[
    'hub_live_session','hub_song_library','hub_lyrics_display','hub_setlist',
    'hub_chords_view','hub_instrument_tuner','hub_countdown_timer',
    'hub_background_layout','hub_settings_customization',
    'presenter_song_presentation','presenter_presentation_controls',
    'presenter_background_layout','presenter_settings_customization'
  ];
begin
  update public.worship_accounts
     set sections = legacy_permissions
   where role <> 'super_admin'
     and coalesce(cardinality(sections), 0) = 0;

  update auth.users u
     set raw_app_meta_data =
       coalesce(u.raw_app_meta_data, '{}'::jsonb)
       || jsonb_build_object('permissions', to_jsonb(a.sections))
    from public.worship_accounts a
   where a.user_id = u.id
     and a.role <> 'super_admin'
     and coalesce(cardinality(a.sections), 0) > 0;
end $$;

drop policy if exists "worship signed in members read songs" on public.worship_songs;
create policy "worship signed in members read songs"
on public.worship_songs for select to authenticated
using (
  coalesce((select auth.jwt() -> 'app_metadata' ->> 'status'), 'active') = 'active'
  and (
    public.worship_has_permission('hub_song_library')
    or public.worship_has_permission('hub_live_session')
    or public.worship_has_permission('hub_lyrics_display')
    or public.worship_has_permission('hub_chords_view')
    or public.worship_has_permission('presenter_song_presentation')
  )
);

drop policy if exists "worship signed in members read playlists" on public.worship_playlists;
create policy "worship signed in members read playlists"
on public.worship_playlists for select to authenticated
using (
  coalesce((select auth.jwt() -> 'app_metadata' ->> 'status'), 'active') = 'active'
  and (
    public.worship_has_permission('hub_setlist')
    or public.worship_has_permission('hub_live_session')
    or public.worship_has_permission('hub_song_library')
    or public.worship_has_permission('presenter_song_presentation')
  )
);

drop policy if exists "worship signed in members read playlist songs" on public.worship_playlist_songs;
create policy "worship signed in members read playlist songs"
on public.worship_playlist_songs for select to authenticated
using (
  coalesce((select auth.jwt() -> 'app_metadata' ->> 'status'), 'active') = 'active'
  and (
    public.worship_has_permission('hub_setlist')
    or public.worship_has_permission('hub_live_session')
    or public.worship_has_permission('hub_song_library')
    or public.worship_has_permission('presenter_song_presentation')
  )
);

drop policy if exists "active members read worship sessions" on public.worship_live_sessions;
create policy "active members read worship sessions"
on public.worship_live_sessions for select to authenticated
using (
  coalesce((select auth.jwt() -> 'app_metadata' ->> 'status'), 'active') = 'active'
  and (
    public.worship_has_permission('hub_live_session')
    or public.worship_has_permission('hub_lyrics_display')
    or public.worship_has_permission('hub_chords_view')
    or public.worship_has_permission('presenter_song_presentation')
    or public.worship_has_permission('presenter_presentation_controls')
  )
);

drop policy if exists "members create own worship sessions" on public.worship_live_sessions;
create policy "members create own worship sessions"
on public.worship_live_sessions for insert to authenticated
with check (
  coalesce((select auth.jwt() -> 'app_metadata' ->> 'status'), 'active') = 'active'
  and controller_user_id = (select auth.uid())
  and (
    public.worship_has_permission('hub_live_session')
    or (public.worship_has_permission('presenter_song_presentation') and public.worship_has_permission('presenter_presentation_controls'))
  )
);

drop policy if exists "controllers update own worship sessions" on public.worship_live_sessions;
create policy "controllers update own worship sessions"
on public.worship_live_sessions for update to authenticated
using (
  coalesce((select auth.jwt() -> 'app_metadata' ->> 'status'), 'active') = 'active'
  and (
    controller_user_id = (select auth.uid())
    or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','super_admin'), false)
  )
  and (
    public.worship_has_permission('hub_live_session')
    or public.worship_has_permission('presenter_presentation_controls')
  )
)
with check (
  coalesce((select auth.jwt() -> 'app_metadata' ->> 'status'), 'active') = 'active'
  and (
    controller_user_id is null
    or controller_user_id = (select auth.uid())
    or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','super_admin'), false)
  )
  and (
    public.worship_has_permission('hub_live_session')
    or public.worship_has_permission('presenter_presentation_controls')
  )
);

drop policy if exists "Active members view presentation assets" on public.worship_presentation_assets;
create policy "Active members view presentation assets"
on public.worship_presentation_assets for select to authenticated
using (
  coalesce((select auth.jwt() -> 'app_metadata' ->> 'status'), 'active') = 'active'
  and (
    public.worship_has_permission('hub_background_layout')
    or public.worship_has_permission('presenter_background_layout')
  )
);

-- No auth users, songs, playlists, sessions, storage objects or settings are deleted.
-- Super Admin retains full access through the trusted app_metadata role claim.
