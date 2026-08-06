# Fixtures Game API Bruno Workspace

Open this folder in Bruno:

```text
docs/bruno/fixtures-game-api
```

Use the `local` environment before sending requests.

The API spec lives at:

```text
apispec/fixtures-game-api.openapi.yaml
```

The collection is split by intended caller:

- `FE App APIs - Use These In Frontend`
- `Backend - Internal Jobs - Do Not Call From FE`

The local environment lives at:

```text
environments/local.yml
collections/fixtures-game-backend/environments/local.yml
```

Useful request scripts were converted to Bruno post-response scripts. For example, creating a friends group saves `friendsGroupId` and `inviteToken` into the selected environment.
