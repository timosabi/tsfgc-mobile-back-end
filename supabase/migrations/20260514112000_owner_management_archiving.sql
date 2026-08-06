alter table public.friends_groups
  drop constraint if exists friends_groups_status_check;

alter table public.friends_groups
  add constraint friends_groups_status_check
  check (status in ('pending', 'approved', 'rejected', 'archived'));

drop index if exists friends_groups_one_owned_group_per_user;

update public.friends_group_users fgu
set role = 'member'
from public.friends_groups fg
where fgu.friends_group_id = fg.id
  and fgu.user_id <> fg.created_by
  and fgu.role = 'owner';

update public.friends_group_users fgu
set role = 'owner'
from public.friends_groups fg
where fgu.friends_group_id = fg.id
  and fgu.user_id = fg.created_by
  and fg.status in ('pending', 'approved');

update public.friends_groups fg
set status = 'archived',
    updated_at = now()
where fg.status in ('pending', 'approved')
  and not exists (
    select 1
    from public.friends_group_users fgu
    where fgu.friends_group_id = fg.id
      and fgu.user_id = fg.created_by
      and fgu.role = 'owner'
  );

create unique index friends_groups_one_active_owned_group_per_user
  on public.friends_groups (created_by)
  where status in ('pending', 'approved');

create unique index if not exists friends_group_users_one_owner_per_group
  on public.friends_group_users (friends_group_id)
  where role = 'owner';

create or replace function public.transfer_friends_group_ownership(
  p_friends_group_id uuid,
  p_current_owner_id uuid,
  p_new_owner_id uuid
)
returns void
language plpgsql
as $$
begin
  if p_current_owner_id = p_new_owner_id then
    raise exception 'new owner must be different from current owner';
  end if;

  perform 1
  from public.friends_groups
  where id = p_friends_group_id
    and created_by = p_current_owner_id
    and status = 'approved'
  for update;

  if not found then
    raise exception 'current user does not own this active friends group';
  end if;

  perform 1
  from public.friends_group_users
  where friends_group_id = p_friends_group_id
    and user_id = p_current_owner_id
    and role = 'owner'
  for update;

  if not found then
    raise exception 'current owner membership not found';
  end if;

  perform 1
  from public.friends_group_users
  where friends_group_id = p_friends_group_id
    and user_id = p_new_owner_id
  for update;

  if not found then
    raise exception 'new owner is not a member of this friends group';
  end if;

  perform 1
  from public.friends_groups
  where created_by = p_new_owner_id
    and status in ('pending', 'approved')
    and id <> p_friends_group_id;

  if found then
    raise exception 'new owner already owns an active friends group';
  end if;

  update public.friends_group_users
  set role = 'member'
  where friends_group_id = p_friends_group_id
    and user_id = p_current_owner_id;

  update public.friends_group_users
  set role = 'owner'
  where friends_group_id = p_friends_group_id
    and user_id = p_new_owner_id;

  update public.friends_groups
  set created_by = p_new_owner_id,
      updated_at = now()
  where id = p_friends_group_id;
end;
$$;
