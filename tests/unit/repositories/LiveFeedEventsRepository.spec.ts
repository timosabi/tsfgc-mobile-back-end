import { LiveFeedEventsRepository, type TableInsert, type TableRow } from "../../../src/repositories/index.js";
import { describeBaseRepository } from "./repositorySpecHelpers.js";

describeBaseRepository({
  repositoryName: "LiveFeedEventsRepository",
  tableName: "live_feed_events",
  Repository: LiveFeedEventsRepository,
  sampleId: "live-feed-1",
  sampleInsert: { id: "live-feed-1" } as unknown as TableInsert<"live_feed_events">,
  sampleRow: { id: "live-feed-1" } as unknown as TableRow<"live_feed_events">,
});
