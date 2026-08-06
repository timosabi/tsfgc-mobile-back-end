import { FriendsGroupUsersRepository, type TableInsert, type TableRow } from "../../../src/repositories/index.js";
import { describeBaseRepository } from "./repositorySpecHelpers.js";

describeBaseRepository({
  repositoryName: "FriendsGroupUsersRepository",
  tableName: "friends_group_users",
  Repository: FriendsGroupUsersRepository,
  sampleId: "membership-1",
  sampleInsert: { id: "membership-1" } as unknown as TableInsert<"friends_group_users">,
  sampleRow: { id: "membership-1" } as unknown as TableRow<"friends_group_users">,
});
