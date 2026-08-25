alter table public.profiles
  add column membership_status text not null default 'approved'
    check (membership_status in ('pending', 'approved', 'rejected')),
  add column membership_reviewed_at timestamptz,
  add column membership_reviewed_by uuid,
  add column membership_review_note text;
