import { FriendsGroupSubscriptionsRepository, type TableInsert, type TableRow } from "../../../src/repositories/index.js";
import { describeBaseRepository } from "./repositorySpecHelpers.js";

describeBaseRepository({
  repositoryName: "FriendsGroupSubscriptionsRepository",
  tableName: "friends_group_subscriptions",
  Repository: FriendsGroupSubscriptionsRepository,
  sampleId: "subscription-1",
  sampleInsert: { id: "subscription-1" } as unknown as TableInsert<"friends_group_subscriptions">,
  sampleRow: { id: "subscription-1" } as unknown as TableRow<"friends_group_subscriptions">,
});
