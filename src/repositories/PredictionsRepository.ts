import {
  BaseRepository,
  type RepositoryClient,
  type TableInsert,
  type TableRow,
} from "./base.js";

export type ScorePredictionRef = Pick<
  TableRow<"predictions">,
  "user_id" | "fixture_id" | "home_score_prediction" | "away_score_prediction"
>;

export default class PredictionsRepository extends BaseRepository<"predictions"> {
  constructor(client: RepositoryClient) {
    super(client, "predictions");
  }

  async insertPredictions(rows: TableInsert<"predictions">[]): Promise<void> {
    await this.insertMany(rows);
  }

  async listByGroupFixturesUsers(
    friendsGroupId: string,
    fixtureIds: number[],
    userIds: string[],
    select = "*"
  ): Promise<TableRow<"predictions">[]> {
    if (!fixtureIds.length || !userIds.length) return [];

    const { data, error } = await this.table()
      .select(select)
      .eq("friends_group_id", friendsGroupId)
      .in("fixture_id", fixtureIds)
      .in("user_id", userIds);

    this.throwOnError(error, "predictions listByGroupFixturesUsers failed");
    return (data ?? []) as unknown as TableRow<"predictions">[];
  }

  async listByGroupFixtures(
    friendsGroupId: string,
    fixtureIds: number[],
    select = "*"
  ): Promise<TableRow<"predictions">[]> {
    if (!fixtureIds.length) return [];

    const { data, error } = await this.table()
      .select(select)
      .eq("friends_group_id", friendsGroupId)
      .in("fixture_id", fixtureIds);

    this.throwOnError(error, "predictions listByGroupFixtures failed");
    return (data ?? []) as unknown as TableRow<"predictions">[];
  }

  async listScorePredictionsByGroupFixture(
    friendsGroupId: string,
    fixtureId: number,
    userIds: string[]
  ): Promise<ScorePredictionRef[]> {
    if (!userIds.length) return [];

    const { data, error } = await this.table()
      .select("user_id, fixture_id, home_score_prediction, away_score_prediction")
      .eq("friends_group_id", friendsGroupId)
      .eq("fixture_id", fixtureId)
      .in("user_id", userIds);

    this.throwOnError(
      error,
      "predictions listScorePredictionsByGroupFixture failed"
    );
    return (data ?? []) as unknown as ScorePredictionRef[];
  }

  async deleteByUserGroupFixtures(
    userId: string,
    friendsGroupId: string,
    fixtureIds: number[]
  ): Promise<void> {
    if (!fixtureIds.length) return;

    const { error } = await this.table()
      .delete()
      .eq("user_id", userId)
      .eq("friends_group_id", friendsGroupId)
      .in("fixture_id", fixtureIds);

    this.throwOnError(error, "predictions deleteByUserGroupFixtures failed");
  }
}
