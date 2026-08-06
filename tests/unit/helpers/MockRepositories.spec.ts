import { createRepositoryMock } from "./mockRepositories.js";

type FixtureRepositoryLike = {
  findById(id: number): Promise<{ id: number } | null>;
  listByMatchweek(matchweek: string): Promise<Array<{ id: number }>>;
};

describe("createRepositoryMock", () => {
  it("creates typed jest mocks for repository methods", async () => {
    const fixtures = createRepositoryMock<FixtureRepositoryLike>([
      "findById",
      "listByMatchweek",
    ]);

    fixtures.findById.mockResolvedValue({ id: 1 });
    fixtures.listByMatchweek.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    await expect(fixtures.findById(1)).resolves.toEqual({ id: 1 });
    await expect(fixtures.listByMatchweek("Matchweek 1")).resolves.toEqual([
      { id: 1 },
      { id: 2 },
    ]);
    expect(fixtures.findById).toHaveBeenCalledWith(1);
    expect(fixtures.listByMatchweek).toHaveBeenCalledWith("Matchweek 1");
  });
});
