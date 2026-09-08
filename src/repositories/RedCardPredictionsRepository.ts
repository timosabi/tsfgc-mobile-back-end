import {
  BaseRepository,
  type RepositoryClient,
  type TableInsert,
  type TableRow,
} from "./base.js";

export type RedCardPredictionRef = Pick<
  TableRow<"red_card_predictions">,
  "user_id" | "fixture_id"
>;

export default class RedCardPredictionsRepository extends BaseRepository<"red_card_predictions"> {
  constructor(client: RepositoryClient) {
    super(client, "red_card_predictions");
  }

  async insertPrediction(
    row: TableInsert<"red_card_predictions">
  ): Promise<void> {
    const { error } = await this.table().insert(row as never);
    this.throwOnError(error, "red_card_predictions insertPrediction failed");
  }

  async listByGroupFixturesUsers(
    friendsGroupId: string,
    fixtureIds: number[],
    userIds: string[],
    select = "*"
  ): Promise<TableRow<"red_card_predictions">[]> {
    if (!fixtureIds.length || !userIds.length) return [];

    const { data, error } = await this.table()
      .select(select)
      .eq("friends_group_id", friendsGroupId)
      .in("fixture_id", fixtureIds)
      .in("user_id", userIds);

    this.throwOnError(
      error,
      "red_card_predictions listByGroupFixturesUsers failed"
    );
    return (data ?? []) as unknown as TableRow<"red_card_predictions">[];
  }

  async listByGroupFixtures(
    friendsGroupId: string,
    fixtureIds: number[],
    select = "*"
  ): Promise<TableRow<"red_card_predictions">[]> {
    if (!fixtureIds.length) return [];

    const { data, error } = await this.table()
      .select(select)
      .eq("friends_group_id", friendsGroupId)
      .in("fixture_id", fixtureIds);

    this.throwOnError(error, "red_card_predictions listByGroupFixtures failed");
    return (data ?? []) as unknown as TableRow<"red_card_predictions">[];
  }

  async listUserIdsByGroupFixture(
    friendsGroupId: string,
    fixtureId: number,
    userIds: string[]
  ): Promise<RedCardPredictionRef[]> {
    if (!userIds.length) return [];

    const { data, error } = await this.table()
      .select("user_id, fixture_id")
      .eq("friends_group_id", friendsGroupId)
      .eq("fixture_id", fixtureId)
      .in("user_id", userIds);

    this.throwOnError(
      error,
      "red_card_predictions listUserIdsByGroupFixture failed"
    );
    return (data ?? []) as RedCardPredictionRef[];
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

    this.throwOnError(
      error,
      "red_card_predictions deleteByUserGroupFixtures failed"
    );
  }

  async deleteByUserId(userId: string): Promise<void> {
    const { error } = await this.table().delete().eq("user_id", userId);

    this.throwOnError(error, "red_card_predictions deleteByUserId failed");
  }

  async listByUserId(
    userId: string
  ): Promise<
    Array<Pick<TableRow<"red_card_predictions">, "fixture_id" | "friends_group_id" | "created_at">>
  > {
    const { data, error } = await this.table()
      .select("fixture_id, friends_group_id, created_at")
      .eq("user_id", userId);

    this.throwOnError(error, "red_card_predictions listByUserId failed");
    return (data ?? []) as unknown as Array<
      Pick<TableRow<"red_card_predictions">, "fixture_id" | "friends_group_id" | "created_at">
    >;
  }
}
