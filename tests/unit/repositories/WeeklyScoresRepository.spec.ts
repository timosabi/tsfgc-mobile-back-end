import { WeeklyScoresRepository, type TableInsert, type TableRow } from "../../../src/repositories/index.js";
import { describeBaseRepository } from "./repositorySpecHelpers.js";

describeBaseRepository({
  repositoryName: "WeeklyScoresRepository",
  tableName: "weekly_scores",
  Repository: WeeklyScoresRepository,
  sampleId: "weekly-score-1",
  sampleInsert: { id: "weekly-score-1" } as unknown as TableInsert<"weekly_scores">,
  sampleRow: { id: "weekly-score-1" } as unknown as TableRow<"weekly_scores">,
});
