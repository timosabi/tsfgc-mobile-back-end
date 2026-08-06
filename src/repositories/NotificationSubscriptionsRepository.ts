import { BaseRepository, type RepositoryClient } from "./base.js";

export default class NotificationSubscriptionsRepository extends BaseRepository<"notification_subscriptions"> {
  constructor(client: RepositoryClient) {
    super(client, "notification_subscriptions");
  }
}
