import { FootballSeasonsRepository, type TableInsert, type TableRow } from "../../../src/repositories/index.js";
import { describeBaseRepository } from "./repositorySpecHelpers.js";

describeBaseRepository({
  repositoryName: "FootballSeasonsRepository",
  tableName: "football_seasons",
  Repository: FootballSeasonsRepository,
  sampleId: "season-1",
  sampleInsert: { id: "season-1" } as unknown as TableInsert<"football_seasons">,
  sampleRow: { id: "season-1" } as unknown as TableRow<"football_seasons">,
});
