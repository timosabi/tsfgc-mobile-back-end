import { FixturesRepository, type TableInsert, type TableRow } from "../../../src/repositories/index.js";
import { describeBaseRepository } from "./repositorySpecHelpers.js";

describeBaseRepository({
  repositoryName: "FixturesRepository",
  tableName: "fixtures",
  Repository: FixturesRepository,
  sampleId: 1,
  sampleInsert: { id: 1 } as unknown as TableInsert<"fixtures">,
  sampleRow: { id: 1 } as unknown as TableRow<"fixtures">,
});
