import { FriendsGroupJoinRequestsRepository, type TableInsert, type TableRow } from "../../../src/repositories/index.js";
import { describeBaseRepository } from "./repositorySpecHelpers.js";

describeBaseRepository({
  repositoryName: "FriendsGroupJoinRequestsRepository",
  tableName: "friends_group_join_requests",
  Repository: FriendsGroupJoinRequestsRepository,
  sampleId: "join-request-1",
  sampleInsert: { id: "join-request-1" } as unknown as TableInsert<"friends_group_join_requests">,
  sampleRow: { id: "join-request-1" } as unknown as TableRow<"friends_group_join_requests">,
});
