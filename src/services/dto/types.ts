import type { Json } from "../../integrations/supabase/types.js";

export interface SportMonksApiResponse<T> {
  data: T;
  pagination?: {
    count: number;
    per_page: number;
    current_page: number;
    next_page: string | null;
    has_more: boolean;
  };
  subscription: Array<{
    meta: unknown;
    plans: unknown[];
  }>;
  rate_limit: {
    resets_in_seconds: number;
    remaining: number;
    requested_entity: string;
  };
  timezone: string;
}

export interface SportMonksFixture {
  id: number;
  sport_id: number;
  league_id: number;
  season_id: number;
  stage_id: number;
  group_id: number | null;
  aggregate_id: number | null;
  round_id: number;
  state_id: number;
  venue_id: number;
  name: string;
  starting_at: string;
  result_info: string | null;
  leg: string;
  details: string | null;
  length: number;
  placeholder: boolean;
  has_odds: boolean;
  starting_at_timestamp: number;
  participants: SportMonksParticipant[];
  periods?: SportMonksPeriod[];
  statistics?: SportMonksStatistic[];
  scores?: SportMonksScore[];
  state?: SportMonksState;
  round?: SportMonksRound;
  stage?: SportMonksStage;
  league?: SportMonksLeague;
  venue?: SportMonksVenue;
  events?: SportMonksEvent[];
}

export interface SportMonksParticipant {
  id: number;
  sport_id: number;
  country_id: number;
  venue_id: number;
  gender: string;
  name: string;
  short_code: string;
  image_path: string;
  founded: number;
  type: string;
  placeholder: boolean;
  last_played_at: string;
  meta: {
    location: string;
    winner: boolean;
    position: number;
  };
}

export interface SportMonksPeriod {
  id: number;
  fixture_id: number;
  type_id: number;
  started: number;
  ended: number | null;
  counts_from: number;
  ticking: boolean;
  sort_order: number;
  description: string;
  time_added: number | null;
  period_length: number | null;
  minutes: number | null;
  seconds: number | null;
  has_timer: boolean;
}

export interface SportMonksScore {
  id: number;
  fixture_id: number;
  type_id: number;
  participant_id: number;
  score: {
    goals: number;
    participant: string;
  };
  description: string;
}

export interface SportMonksState {
  id: number;
  state: string;
  name: string;
  short_name: string;
  developer_name: string;
}

export interface SportMonksRound {
  id: number;
  sport_id: number;
  league_id: number;
  season_id: number;
  stage_id: number;
  name: string;
  finished: boolean;
  is_current: boolean;
  starting_at: string;
  ending_at: string;
  games_in_current_week: boolean;
}

export interface SportMonksStage {
  id: number;
  sport_id: number;
  league_id: number;
  season_id: number;
  type_id: number;
  name: string;
  sort_order: number;
  finished: boolean;
  is_current: boolean;
  starting_at: string;
  ending_at: string;
  games_in_current_week: boolean;
}

export interface SportMonksLeague {
  id: number;
  sport_id: number;
  country_id: number;
  name: string;
  active: boolean;
  short_code: string;
  image_path: string;
  type: string;
  sub_type: string;
  last_played_at: string;
  category: number;
  has_jerseys: boolean;
  currentseason?: SportMonksSeason | null;
}

export interface SportMonksSeason {
  id: number;
  sport_id?: number;
  league_id: number;
  name?: string | null;
  finished?: boolean;
  pending?: boolean;
  is_current?: boolean;
  starting_at?: string | null;
  ending_at?: string | null;
}

export interface SportMonksVenue {
  id: number;
  country_id: number;
  city_id: number;
  name: string;
  address: string;
  city: string;
  capacity: number;
  image_path: string;
  city_name: string;
  surface: string;
  national_team: boolean;
}

export interface SportMonksStatistic {
  id: number;
  fixture_id: number;
  type_id: number;
  participant_id: number;
  data: {
    value: number;
    display_name: string;
    model_type: string;
  };
}

export interface SportMonksEvent {
  id: number;
  fixture_id: number;
  period_id: number;
  participant_id: number;
  type_id: number;
  sub_type_id: number;
  player_id: number;
  player_name: string;
  related_player_id: number | null;
  related_player_name: string | null;
  minute: number;
  extra_minute: number | null;
  injured: boolean;
  on_bench: boolean;
  coach_id: number | null;
  addition: string | null;
  reason: string | null;
  order: number;
  result: string | null;
}

// Configuration types
export interface SportMonksConfig {
  apiUrl: string;
  token: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  rateLimit?: {
    requests: number;
    window: number; // in seconds
  };
}

// Error types
export class SportMonksError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown
  ) {
    super(message);
    this.name = "SportMonksError";
  }
}

export class SportMonksRateLimitError extends SportMonksError {
  constructor(message: string, public resetTime: number) {
    super(message, 429);
    this.name = "SportMonksRateLimitError";
  }
}

export interface FixtureExternalRefs {
  sm_fixture_id: number;
  sm_league_id: number;
  sm_season_id?: number | null;
  sm_round_id: number | null;
}

// Database mapping types
export interface FixtureInsert extends FixtureExternalRefs {
  away_score?: number | null;
  away_team: string;
  current_minute?: number | null;
  has_red_card?: boolean | null;
  home_score?: number | null;
  home_team: string;
  live_away_score?: number | null;
  live_home_score?: number | null;
  match_date: string; // "YYYY-MM-DD"
  match_time: string; // "HH:MM:SS"
  matchweek?: string | null;
  provider?: string;
  provider_payload?: Json | null;
  starting_at?: string | null;
  status?: string;
}

export interface MatchEventInsert {
  assist_player?: string | null;
  event_type: string;
  fixture_id?: number | null;
  minute: number;
  player_name: string;
  provider?: string;
  provider_payload?: Json | null;
  sm_event_id?: number;
  sm_fixture_id?: number;
  team: string;
}

export interface FixtureUpsert extends FixtureInsert {
  id?: number;
}
