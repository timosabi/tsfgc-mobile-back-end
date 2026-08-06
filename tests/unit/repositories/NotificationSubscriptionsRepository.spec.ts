import { NotificationSubscriptionsRepository, type TableInsert, type TableRow } from "../../../src/repositories/index.js";
import { describeBaseRepository } from "./repositorySpecHelpers.js";

describeBaseRepository({
  repositoryName: "NotificationSubscriptionsRepository",
  tableName: "notification_subscriptions",
  Repository: NotificationSubscriptionsRepository,
  sampleId: "notification-1",
  sampleInsert: { id: "notification-1" } as unknown as TableInsert<"notification_subscriptions">,
  sampleRow: { id: "notification-1" } as unknown as TableRow<"notification_subscriptions">,
});
