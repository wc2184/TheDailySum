# Daily Summary Cloudflare Worker

This worker runs once per day, pulls each user's latest interests from Supabase, asks OpenAI for a short digest, and stores the text in a `daily_summaries` table that the React app can read.

## Setup

1. Install dependencies:
   ```bash
   cd worker
   npm install
   ```
2. Create the destination table in Supabase (SQL editor):
   ```sql
   create extension if not exists "pgcrypto";

   create table if not exists public.daily_summaries (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null references auth.users (id) on delete cascade,
     email text not null,
     summary_text text not null,
     generated_at timestamptz default now()
   );

   create index if not exists daily_summaries_email_generated_idx
     on public.daily_summaries (email, generated_at desc);
   ```
   Each summary run now inserts a new row, so make sure there's no unique constraint on `user_id`.
3. If you previously constrained `interests.user_id` to be unique, drop that constraint so every save becomes a historical row. The worker still chooses the most recent topics per user when generating summaries.

4. Configure secrets (stores safely in Cloudflare):
   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   npx wrangler secret put OPENAI_API_KEY
   ```
   The `SUPABASE_URL` should be the base URL (e.g. `https://project.supabase.co`). The service role key allows the worker to read/write tables server-side; keep it private.
5. Adjust the schedule in `wrangler.toml` if you prefer a different run time.

## Deploy

```bash
npm run deploy
```

### Manual test

While developing you can run `npm run dev` and hit `http://127.0.0.1:8787` to trigger a single run and inspect the JSON response.

#### Force a single user refresh

Send a POST request with the target email to re-run the summary immediately (useful for debugging):

```bash
curl -X POST https://<your-worker>.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

The worker fetch handler will process just that user, generate a new summary, and return a JSON status payload.
