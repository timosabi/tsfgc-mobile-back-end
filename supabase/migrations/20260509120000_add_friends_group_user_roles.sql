alter table public.friends_group_users
  add column if not exists role text not null default 'member';

alter table public.friends_group_users
  drop constraint if exists friends_group_users_role_check;

alter table public.friends_group_users
  add constraint friends_group_users_role_check
  check (role in ('owner', 'member'));

update public.friends_group_users fgu
set role = 'owner'
from public.friends_groups fg
where fgu.friends_group_id = fg.id
  and fgu.user_id = fg.created_by;
