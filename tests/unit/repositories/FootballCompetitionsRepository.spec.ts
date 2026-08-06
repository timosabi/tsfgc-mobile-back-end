import { FootballCompetitionsRepository, type TableInsert, type TableRow } from "../../../src/repositories/index.js";
import { describeBaseRepository } from "./repositorySpecHelpers.js";

describeBaseRepository({
  repositoryName: "FootballCompetitionsRepository",
  tableName: "football_competitions",
  Repository: FootballCompetitionsRepository,
  sampleId: "competition-1",
  sampleInsert: { id: "competition-1" } as unknown as TableInsert<"football_competitions">,
  sampleRow: { id: "competition-1" } as unknown as TableRow<"football_competitions">,
});
