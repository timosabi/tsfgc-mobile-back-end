-- Persists DeadlineReminderService's "already sent" dedup keys, which were
-- previously held only in an in-process Set -- wiped on every backend
-- restart, causing lock/finish reminder notifications to resend on deploy.
create table if not exists public.deadline_reminder_log (
  id uuid primary key default gen_random_uuid(),
  reminder_key text not null unique,
  created_at timestamptz not null default now()
);
