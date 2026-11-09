# Daily AI Bible Trivia and Question — one-time setup

The website's Daily Devotion page reads one shared daily record from Supabase. The Edge Function generates the Bible trivia, four-choice quiz, and matching illustration once per Philippine calendar day, then stores them centrally.

## 1. Add the OpenAI secret

In the Supabase project for `sbrnofctchqotcjteqxr`, open **Edge Functions → Secrets** and add:

- `OPENAI_API_KEY` — an OpenAI API key from your API account
- `DAILY_BIBLE_CRON_SECRET` — a long random secret used only by the scheduled job (do not reuse your OpenAI key)

Do not put either value in `index.html`, GitHub, or a public repository.

## 2. Deploy the Edge Function

From the repository root, with the Supabase CLI linked to the existing project:

```sh
supabase link --project-ref sbrnofctchqotcjteqxr
supabase functions deploy generate-daily-bible --no-verify-jwt
```

The function uses the existing public `church-media` Storage bucket to save each generated image under `daily-bible/YYYY-MM-DD.jpg`.

## 3. Enable extensions, add Vault values, and run the migration

In **Supabase Dashboard → Database → Extensions**, enable `pg_cron`, `pg_net`, and `supabase_vault`.

Then open **SQL Editor** and run these two statements. Replace the placeholder with the exact value saved as `DAILY_BIBLE_CRON_SECRET` in Edge Function Secrets:

```sql
select vault.create_secret('https://sbrnofctchqotcjteqxr.supabase.co', 'daily_bible_project_url');
select vault.create_secret('REPLACE_WITH_THE_SAME_LONG_RANDOM_CRON_SECRET', 'daily_bible_cron_secret');
```

Now run the complete contents of `supabase/migrations/20261109000000_daily_bible_content.sql` in SQL Editor.

The schedule is `0 0 * * *` UTC, which is exactly **8:00 AM Asia/Manila**. Supabase Cron runs the job; the website itself does not need to stay open.

## 4. Generate the first day's content

After deploying the function and running the migration, invoke the function once from the Supabase Edge Function tester using POST and this header:

- `x-cron-secret: (the same DAILY_BIBLE_CRON_SECRET)`

Use this JSON body (use today's Philippine date):

```json
{ "day_key": "YYYY-MM-DD" }
```

Once the first record exists, the website will display it for every visitor. Future daily content and images are generated automatically at 8:00 AM Philippine time.

## Biblical accuracy

The function first retrieves the selected passage text from the World English Bible API, then asks the text model to write both learning items using only that passage. It avoids direct Bible quotations and includes the passage reference so readers can verify the source. AI-generated material should still be reviewed by church leadership before being treated as official teaching.
