import { RedCardPredictionsRepository, type TableInsert, type TableRow } from "../../../src/repositories/index.js";
import { describeBaseRepository } from "./repositorySpecHelpers.js";

describeBaseRepository({
  repositoryName: "RedCardPredictionsRepository",
  tableName: "red_card_predictions",
  Repository: RedCardPredictionsRepository,
  sampleId: "red-card-1",
  sampleInsert: { id: "red-card-1" } as unknown as TableInsert<"red_card_predictions">,
  sampleRow: { id: "red-card-1" } as unknown as TableRow<"red_card_predictions">,
});
