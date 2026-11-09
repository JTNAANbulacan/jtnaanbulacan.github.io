-- Shared daily Bible content. Public visitors can read; only the Edge Function writes.
create table if not exists public.daily_bible_content (
  day_key date primary key,
  content jsonb not null,
  image_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.daily_bible_content enable row level security;

drop policy if exists "Daily Bible content is readable by everyone" on public.daily_bible_content;
create policy "Daily Bible content is readable by everyone"
  on public.daily_bible_content for select
  to anon, authenticated
  using (true);

grant select on public.daily_bible_content to anon, authenticated;

-- Extensions used by the scheduled job. If your project restricts extension creation,
-- enable pg_cron, pg_net, and supabase_vault in Database > Extensions first.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

-- Store these secrets in Vault before running this block:
--   vault.create_secret('https://sbrnofctchqotcjteqxr.supabase.co', 'daily_bible_project_url');
--   vault.create_secret('<YOUR_LONG_RANDOM_CRON_SECRET>', 'daily_bible_cron_secret');
--
-- Runs at 00:00 UTC = 08:00 Asia/Manila every day.
select cron.unschedule('generate-daily-bible-0800-ph')
where exists (
  select 1 from cron.job where jobname = 'generate-daily-bible-0800-ph'
);

select cron.schedule(
  'generate-daily-bible-0800-ph',
  '0 0 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'daily_bible_project_url')
      || '/functions/v1/generate-daily-bible',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'daily_bible_cron_secret')
    ),
    body := jsonb_build_object(
      'day_key', to_char((now() at time zone 'Asia/Manila')::date, 'YYYY-MM-DD')
    ),
    timeout_milliseconds := 120000
  );
  $$
);
