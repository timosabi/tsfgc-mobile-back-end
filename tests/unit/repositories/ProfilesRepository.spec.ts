import { ProfilesRepository, type TableInsert, type TableRow } from "../../../src/repositories/index.js";
import { describeBaseRepository } from "./repositorySpecHelpers.js";

describeBaseRepository({
  repositoryName: "ProfilesRepository",
  tableName: "profiles",
  Repository: ProfilesRepository,
  sampleId: "profile-1",
  sampleInsert: { id: "profile-1" } as unknown as TableInsert<"profiles">,
  sampleRow: { id: "profile-1" } as unknown as TableRow<"profiles">,
});
