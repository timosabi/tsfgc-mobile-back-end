# Client Change Implementation Plan

This file tracks the client-meeting changes as small PR-sized milestones.

## Milestone 1 - Group Creation And Join Links

Status: complete

- Auto-approve friends groups on creation.
- Activate the selected football subscription immediately.
- Add the creator as owner/member immediately.
- Generate an unguessable invite token for join links.
- Open groups allow token-based join immediately.
- Private groups create token-based join requests for owner approval.
- Enforce one owned friends group per user.

## Milestone 2 - Matchweek Prediction Slip

Status: complete

- Add one FE-facing matchweek prediction resource.
- Save all score predictions for a matchweek in one request.
- Require exactly one red-card fixture per matchweek.
- Submit validates a complete slip.
- Allow editing until the first fixture in the matchweek starts.

## Milestone 3 - Score And History API Cleanup

Status: complete

- Add FE matchweek history endpoint with fixtures, predictions, points, and live chat.
- Keep manual maintenance score APIs in backend/internal Bruno folders only.

## Milestone 4 - Matchweek Live Chat

Status: complete

- Store live feed by friends group and matchweek.
- Keep optional fixture origin for event context.
- FE reads matchweek live chat from the backend only.

## Milestone 5 - Docs And Bruno

Status: complete

- Keep Bruno split by intended caller.
- Update FE guide with only the final FE-safe APIs.
- Mark old score/red-card/submission APIs as deprecated after replacement exists.
