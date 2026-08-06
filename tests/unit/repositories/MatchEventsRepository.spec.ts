import { MatchEventsRepository, type TableInsert, type TableRow } from "../../../src/repositories/index.js";
import { describeBaseRepository } from "./repositorySpecHelpers.js";

describeBaseRepository({
  repositoryName: "MatchEventsRepository",
  tableName: "match_events",
  Repository: MatchEventsRepository,
  sampleId: "match-event-1",
  sampleInsert: { id: "match-event-1" } as unknown as TableInsert<"match_events">,
  sampleRow: { id: "match-event-1" } as unknown as TableRow<"match_events">,
});
