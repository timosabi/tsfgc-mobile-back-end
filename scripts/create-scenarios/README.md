# Create Scenarios

Small local seed scripts for FE/dev testing.

These scripts create persistent local Supabase data. They do not clean up after themselves, because devs usually need the users/groups to keep testing after the command finishes. Every run uses unique `dev-seed-*` emails and group slugs, so reruns should not collide.

Safety guard:

- scripts refuse non-local `LOVABLE_SUPABASE_URL`
- scripts check local Supabase is reachable before prompting
- override only when intentional with `SEED_ALLOW_NON_LOCAL_DB=true`
- all generated users use password `Password123!`

If a script says it cannot reach Supabase at `127.0.0.1:54321`, start Docker
Desktop first, then run:

```bash
npm run supabase:start
```

If migrations are missing or ownership transfer fails because an RPC function is
missing, reset/apply local migrations:

```bash
npm run db:reset
```

## Create User

Creates one user quickly.

Command:

```bash
npm run seed:scenario:create-user
```

Interactive choices use the arrow-key select:

- `standalone`: brand new user with no friends group
- `owner`: brand new user owning a new private group
- `member`: brand new user added to an existing group

No-prompt examples:

```bash
npm run seed:scenario:create-user -- --role=standalone
npm run seed:scenario:create-user -- --role=owner
npm run seed:scenario:create-user -- --role=member --friendsGroupId=<friends-group-id>
npm run seed:scenario:create-user -- --role=member --inviteToken=<invite-token>
```

Useful for:

- onboarding empty-state testing
- fast login user creation
- creating an owner group for FE checks
- adding quick test members to an existing group

## Create Test Group

Interactive builder for realistic FE/client testing. It can create a group,
owner, accepted members, pending join requests, isolated fixtures, submitted
prediction slips, and optional scored history.

Command:

```bash
npm run seed:scenario:create-test-group
```

Prompts:

- group name
- access type: `open` or `private` using the arrow-key select
- accepted member count, excluding owner
- pending join request count for private groups
- matchweek label, default `Matchweek 2`
- seed all previous finished matchweeks: `yes` or `no`, skipped for `Matchweek 1`
- mode: `editable`, `locked`, or `finished` using the arrow-key select
- prediction setup: `none`, `owner`, or `all` using the arrow-key select
- fixture count, default `2`

No-prompt examples:

```bash
npm run seed:scenario:create-test-group -- \
  --name="Client Demo Group" \
  --access=private \
  --members=6 \
  --pending=2 \
  --matchweek="Matchweek 14" \
  --seedPrevious=yes \
  --mode=finished \
  --predictions=all \
  --fixtures=2

npm run seed:scenario:create-test-group -- \
  --name="Editable QA Group" \
  --access=open \
  --members=3 \
  --matchweek="Matchweek 14" \
  --seedPrevious=yes \
  --mode=editable \
  --predictions=owner
```

`seedPrevious=yes` creates completed/scored history for every matchweek before
the selected matchweek. For example, `--matchweek="Matchweek 14"
--seedPrevious=yes` creates `Matchweek 1` through `Matchweek 13` as finished
weeks with fixtures, submitted predictions for all accepted users, results,
red-card picks, and weekly scores. The selected matchweek still uses the chosen
`mode` and `predictions` settings. For `Matchweek 1`, the script skips this
question because there are no previous weeks.

Modes:

- `editable`: the first fixture starts about 30 minutes after generation, so
  users can test the countdown and still edit/submit predictions.
- `locked`: first fixture kickoff is in the past; submitted predictions are
  revealed, but there are no final scores.
- `finished`: fixtures have results and red-card data; weekly scores and
  leaderboard/history are generated.

The script uses an isolated generated dev-seed league/season and fixture IDs
for every run. This means changing generated fixtures to locked/finished will
not affect other test groups.

## Private Group Pending Join

Creates a full private-group invite scenario:

- User 1: private group owner
- User 2: existing member
- User 3: pending member with join request
- private friends group
- active Premier League subscription
- mock fixtures hydrated

Command:

```bash
npm run seed:scenario:private-group-pending-join
```

Useful for:

- private group owner dashboard
- member dashboard
- pending join request UI
- owner approving a pending user from FE
- invite link testing

## Cleanup

Deletes local data created by `scripts/create-scenarios`.

Command:

```bash
npm run seed:cleanup
```

No-prompt command:

```bash
npm run seed:cleanup -- --yes=true
```

The cleanup script has the same local DB safety guard as the seed scripts. It
refuses non-local `LOVABLE_SUPABASE_URL` unless
`SEED_ALLOW_NON_LOCAL_DB=true`.

It deletes only safe dev seed data:

- auth users where email starts with `dev-seed-`
- profiles for those users
- groups where slug starts with `dev-seed-`
- related memberships, join requests, subscriptions, predictions, scores,
  notifications, and live feed rows
- fixtures where `provider = "dev-seed"`
- generated Dev Seed competition/season catalog rows

It does not delete normal SportMonks fixtures created by hydration, because
those can be shared across non-seed groups.
