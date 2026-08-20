drop index if exists friends_groups_one_active_owned_group_per_user;

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
