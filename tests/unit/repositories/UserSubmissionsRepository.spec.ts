import { UserSubmissionsRepository, type TableInsert, type TableRow } from "../../../src/repositories/index.js";
import { describeBaseRepository } from "./repositorySpecHelpers.js";

describeBaseRepository({
  repositoryName: "UserSubmissionsRepository",
  tableName: "user_submissions",
  Repository: UserSubmissionsRepository,
  sampleId: "submission-1",
  sampleInsert: { id: "submission-1" } as unknown as TableInsert<"user_submissions">,
  sampleRow: { id: "submission-1" } as unknown as TableRow<"user_submissions">,
});
