-- UGC moderation: lets a member report another member's display name (goes
-- into an admin queue, mirroring profiles.membership_status's review shape)
-- and lets a member personally block another member's display name from
-- rendering to them, without affecting anyone else.
create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references public.profiles (id),
  reported_user_id uuid not null references public.profiles (id),
  friends_group_id uuid not null references public.friends_groups (id),
  reported_display_name text not null,
  status text not null default 'pending'
    check (status in ('pending', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id),
  review_note text
);

create index if not exists content_reports_status_idx
  on public.content_reports (status);

create table if not exists public.member_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  blocked_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (user_id, blocked_user_id)
);
