import { PredictionsRepository, type TableInsert, type TableRow } from "../../../src/repositories/index.js";
import { describeBaseRepository } from "./repositorySpecHelpers.js";

describeBaseRepository({
  repositoryName: "PredictionsRepository",
  tableName: "predictions",
  Repository: PredictionsRepository,
  sampleId: "prediction-1",
  sampleInsert: { id: "prediction-1" } as unknown as TableInsert<"predictions">,
  sampleRow: { id: "prediction-1" } as unknown as TableRow<"predictions">,
});
