import { SportMonksTransformer } from "../../../../src/integrations/sportmonks/transformer.js";
import type { SportMonksFixture, SportMonksEvent } from "../../../../src/services/dto/types.js";

function baseFixture(overrides: Partial<SportMonksFixture> = {}): SportMonksFixture {
  return {
    id: 1,
    sport_id: 1,
    league_id: 8,
    season_id: 100,
    stage_id: 1,
    group_id: null,
    aggregate_id: null,
    round_id: 4,
    state_id: 5,
    venue_id: 1,
    name: "Home vs Away",
    starting_at: "2026-09-13 15:00:00",
    result_info: null,
    leg: "1/1",
    details: null,
    length: 90,
    placeholder: false,
    has_odds: false,
    starting_at_timestamp: 0,
    participants: [
      { id: 1, sport_id: 1, country_id: 1, venue_id: 1, gender: "male", name: "Home", short_code: "HOM", image_path: "", founded: 2000, type: "domestic", placeholder: false, last_played_at: "", meta: { location: "home", position: 1, winner: null } } as never,
      { id: 2, sport_id: 1, country_id: 1, venue_id: 1, gender: "male", name: "Away", short_code: "AWY", image_path: "", founded: 2000, type: "domestic", placeholder: false, last_played_at: "", meta: { location: "away", position: 2, winner: null } } as never,
    ],
    scores: [],
    ...overrides,
  } as SportMonksFixture;
}

const redCardEvent: SportMonksEvent = {
  id: 1,
  fixture_id: 1,
  type_id: 20,
  minute: 34,
  player_name: "Some Player",
  related_player_name: null,
} as SportMonksEvent;

describe("SportMonksTransformer.transformFixture -- has_red_card", () => {
  it("omits has_red_card entirely when the events include wasn't requested", () => {
    const fixture = baseFixture({ events: undefined });

    const result = SportMonksTransformer.transformFixture(fixture);

    expect("has_red_card" in result).toBe(false);
  });

  it("sets has_red_card to false when events were fetched and none is a red card", () => {
    const fixture = baseFixture({ events: [] });

    const result = SportMonksTransformer.transformFixture(fixture);

    expect(result.has_red_card).toBe(false);
  });

  it("sets has_red_card to true when a red card event is present", () => {
    const fixture = baseFixture({ events: [redCardEvent] });

    const result = SportMonksTransformer.transformFixture(fixture);

    expect(result.has_red_card).toBe(true);
  });
});
