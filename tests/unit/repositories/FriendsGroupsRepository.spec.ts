import { FriendsGroupsRepository, type TableInsert, type TableRow } from "../../../src/repositories/index.js";
import { describeBaseRepository } from "./repositorySpecHelpers.js";

describeBaseRepository({
  repositoryName: "FriendsGroupsRepository",
  tableName: "friends_groups",
  Repository: FriendsGroupsRepository,
  sampleId: "friends-group-1",
  sampleInsert: { id: "friends-group-1" } as unknown as TableInsert<"friends_groups">,
  sampleRow: { id: "friends-group-1" } as unknown as TableRow<"friends_groups">,
});
