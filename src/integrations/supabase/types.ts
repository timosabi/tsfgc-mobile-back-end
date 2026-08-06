export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      fixtures: {
        Row: {
          away_score: number | null
          away_team: string
          created_at: string
          current_minute: number | null
          has_red_card: boolean | null
          home_score: number | null
          home_team: string
          id: number
          live_away_score: number | null
          live_home_score: number | null
          match_date: string
          match_time: string
          matchweek: string | null
          provider: string
          provider_payload: Json | null
          sm_fixture_id: number
          sm_league_id: number
          sm_round_id: number | null
          sm_season_id: number | null
          starting_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          away_score?: number | null
          away_team: string
          created_at?: string
          current_minute?: number | null
          has_red_card?: boolean | null
          home_score?: number | null
          home_team: string
          id?: number
          live_away_score?: number | null
          live_home_score?: number | null
          match_date: string
          match_time: string
          matchweek?: string | null
          provider?: string
          provider_payload?: Json | null
          sm_fixture_id: number
          sm_league_id: number
          sm_round_id?: number | null
          sm_season_id?: number | null
          starting_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          away_score?: number | null
          away_team?: string
          created_at?: string
          current_minute?: number | null
          has_red_card?: boolean | null
          home_score?: number | null
          home_team?: string
          id?: number
          live_away_score?: number | null
          live_home_score?: number | null
          match_date?: string
          match_time?: string
          matchweek?: string | null
          provider?: string
          provider_payload?: Json | null
          sm_fixture_id?: number
          sm_league_id?: number
          sm_round_id?: number | null
          sm_season_id?: number | null
          starting_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      football_competitions: {
        Row: {
          country_name: string | null
          created_at: string
          current_provider_season_id: number | null
          id: string
          logo_url: string | null
          name: string
          provider: string
          provider_league_id: number
          updated_at: string
        }
        Insert: {
          country_name?: string | null
          created_at?: string
          current_provider_season_id?: number | null
          id?: string
          logo_url?: string | null
          name: string
          provider?: string
          provider_league_id: number
          updated_at?: string
        }
        Update: {
          country_name?: string | null
          created_at?: string
          current_provider_season_id?: number | null
          id?: string
          logo_url?: string | null
          name?: string
          provider?: string
          provider_league_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      football_seasons: {
        Row: {
          competition_id: string
          created_at: string
          ends_at: string | null
          id: string
          is_current: boolean
          name: string | null
          provider: string
          provider_season_id: number
          starts_at: string | null
          updated_at: string
        }
        Insert: {
          competition_id: string
          created_at?: string
          ends_at?: string | null
          id?: string
          is_current?: boolean
          name?: string | null
          provider?: string
          provider_season_id: number
          starts_at?: string | null
          updated_at?: string
        }
        Update: {
          competition_id?: string
          created_at?: string
          ends_at?: string | null
          id?: string
          is_current?: boolean
          name?: string | null
          provider?: string
          provider_season_id?: number
          starts_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "football_seasons_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "football_competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      friends_group_join_requests: {
        Row: {
          friends_group_id: string
          id: string
          message: string | null
          processed_at: string | null
          processed_by: string | null
          requested_at: string
          status: string
          user_display_name: string | null
          user_id: string
        }
        Insert: {
          friends_group_id: string
          id?: string
          message?: string | null
          processed_at?: string | null
          processed_by?: string | null
          requested_at?: string
          status?: string
          user_display_name?: string | null
          user_id: string
        }
        Update: {
          friends_group_id?: string
          id?: string
          message?: string | null
          processed_at?: string | null
          processed_by?: string | null
          requested_at?: string
          status?: string
          user_display_name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "friends_group_join_requests_friends_group_id_fkey"
            columns: ["friends_group_id"]
            isOneToOne: false
            referencedRelation: "friends_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      friends_group_subscriptions: {
        Row: {
          competition_id: string
          created_at: string
          created_by: string
          friends_group_id: string
          id: string
          provider: string
          provider_league_id: number
          provider_season_id: number | null
          season_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          competition_id: string
          created_at?: string
          created_by: string
          friends_group_id: string
          id?: string
          provider?: string
          provider_league_id: number
          provider_season_id?: number | null
          season_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          competition_id?: string
          created_at?: string
          created_by?: string
          friends_group_id?: string
          id?: string
          provider?: string
          provider_league_id?: number
          provider_season_id?: number | null
          season_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "friends_group_subscriptions_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "football_competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friends_group_subscriptions_friends_group_id_fkey"
            columns: ["friends_group_id"]
            isOneToOne: false
            referencedRelation: "friends_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friends_group_subscriptions_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "football_seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      friends_group_users: {
        Row: {
          friends_group_id: string
          id: string
          joined_at: string
          role: "owner" | "member"
          user_id: string
        }
        Insert: {
          friends_group_id: string
          id?: string
          joined_at?: string
          role?: "owner" | "member"
          user_id: string
        }
        Update: {
          friends_group_id?: string
          id?: string
          joined_at?: string
          role?: "owner" | "member"
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "friends_group_users_friends_group_id_fkey"
            columns: ["friends_group_id"]
            isOneToOne: false
            referencedRelation: "friends_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      friends_groups: {
        Row: {
          created_at: string
          created_by: string
          id: string
          invite_token: string
          is_open: boolean
          name: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          invite_token?: string
          is_open?: boolean
          name: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          invite_token?: string
          is_open?: boolean
          name?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      live_feed_events: {
        Row: {
          ai_message: string | null
          created_at: string
          event_key: string
          event_type: string
          fixture_id: number | null
          friends_group_id: string | null
          id: string
          matchweek: string | null
          payload: Json
          pushed_at: string | null
          sm_fixture_id: number | null
        }
        Insert: {
          ai_message?: string | null
          created_at?: string
          event_key: string
          event_type: string
          fixture_id?: number | null
          friends_group_id?: string | null
          id?: string
          matchweek?: string | null
          payload?: Json
          pushed_at?: string | null
          sm_fixture_id?: number | null
        }
        Update: {
          ai_message?: string | null
          created_at?: string
          event_key?: string
          event_type?: string
          fixture_id?: number | null
          friends_group_id?: string | null
          id?: string
          matchweek?: string | null
          payload?: Json
          pushed_at?: string | null
          sm_fixture_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "live_feed_events_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_feed_events_friends_group_id_fkey"
            columns: ["friends_group_id"]
            isOneToOne: false
            referencedRelation: "friends_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      match_events: {
        Row: {
          assist_player: string | null
          created_at: string
          event_type: string
          fixture_id: number | null
          id: string
          minute: number
          player_name: string
          provider: string
          provider_payload: Json | null
          sm_event_id: number | null
          sm_fixture_id: number | null
          team: string
        }
        Insert: {
          assist_player?: string | null
          created_at?: string
          event_type: string
          fixture_id?: number | null
          id?: string
          minute: number
          player_name: string
          provider?: string
          provider_payload?: Json | null
          sm_event_id?: number | null
          sm_fixture_id?: number | null
          team: string
        }
        Update: {
          assist_player?: string | null
          created_at?: string
          event_type?: string
          fixture_id?: number | null
          id?: string
          minute?: number
          player_name?: string
          provider?: string
          provider_payload?: Json | null
          sm_event_id?: number | null
          sm_fixture_id?: number | null
          team?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_events_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_subscriptions: {
        Row: {
          auth_secret: string | null
          channel: string
          created_at: string
          device_label: string | null
          endpoint: string
          friends_group_id: string | null
          id: string
          is_active: boolean
          p256dh_key: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auth_secret?: string | null
          channel: string
          created_at?: string
          device_label?: string | null
          endpoint: string
          friends_group_id?: string | null
          id?: string
          is_active?: boolean
          p256dh_key?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auth_secret?: string | null
          channel?: string
          created_at?: string
          device_label?: string | null
          endpoint?: string
          friends_group_id?: string | null
          id?: string
          is_active?: boolean
          p256dh_key?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_subscriptions_friends_group_id_fkey"
            columns: ["friends_group_id"]
            isOneToOne: false
            referencedRelation: "friends_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      predictions: {
        Row: {
          away_score_prediction: number
          created_at: string
          fixture_id: number
          friends_group_id: string | null
          home_score_prediction: number
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          away_score_prediction: number
          created_at?: string
          fixture_id: number
          friends_group_id?: string | null
          home_score_prediction: number
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          away_score_prediction?: number
          created_at?: string
          fixture_id?: number
          friends_group_id?: string | null
          home_score_prediction?: number
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "predictions_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predictions_friends_group_id_fkey"
            columns: ["friends_group_id"]
            isOneToOne: false
            referencedRelation: "friends_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_emoji: string | null
          color_class: string | null
          created_at: string
          default_friends_group_id: string | null
          display_name: string | null
          favorite_team: string | null
          id: string
          is_admin: boolean
          last_active_friends_group_id: string | null
          points: number
          updated_at: string
        }
        Insert: {
          avatar_emoji?: string | null
          color_class?: string | null
          created_at?: string
          default_friends_group_id?: string | null
          display_name?: string | null
          favorite_team?: string | null
          id: string
          is_admin?: boolean
          last_active_friends_group_id?: string | null
          points?: number
          updated_at?: string
        }
        Update: {
          avatar_emoji?: string | null
          color_class?: string | null
          created_at?: string
          default_friends_group_id?: string | null
          display_name?: string | null
          favorite_team?: string | null
          id?: string
          is_admin?: boolean
          last_active_friends_group_id?: string | null
          points?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_default_friends_group_id_fkey"
            columns: ["default_friends_group_id"]
            isOneToOne: false
            referencedRelation: "friends_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_last_active_friends_group_id_fkey"
            columns: ["last_active_friends_group_id"]
            isOneToOne: false
            referencedRelation: "friends_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      red_card_predictions: {
        Row: {
          created_at: string
          fixture_id: number
          friends_group_id: string | null
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          fixture_id: number
          friends_group_id?: string | null
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          fixture_id?: number
          friends_group_id?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "red_card_predictions_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "red_card_predictions_friends_group_id_fkey"
            columns: ["friends_group_id"]
            isOneToOne: false
            referencedRelation: "friends_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      user_submissions: {
        Row: {
          friends_group_id: string
          id: string
          matchweek: string
          submitted_at: string
          user_id: string
        }
        Insert: {
          friends_group_id: string
          id?: string
          matchweek: string
          submitted_at?: string
          user_id: string
        }
        Update: {
          friends_group_id?: string
          id?: string
          matchweek?: string
          submitted_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_submissions_friends_group_id_fkey"
            columns: ["friends_group_id"]
            isOneToOne: false
            referencedRelation: "friends_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_scores: {
        Row: {
          correct_result_points: number
          created_at: string
          exact_score_points: number
          fixtures_predicted: number
          friends_group_id: string
          group_points: number
          id: string
          points_earned: number
          red_card_bonus: number
          total_goals_bonus: number
          updated_at: string
          user_id: string
          week_number: number
        }
        Insert: {
          correct_result_points?: number
          created_at?: string
          exact_score_points?: number
          fixtures_predicted?: number
          friends_group_id: string
          group_points?: number
          id?: string
          points_earned?: number
          red_card_bonus?: number
          total_goals_bonus?: number
          updated_at?: string
          user_id: string
          week_number: number
        }
        Update: {
          correct_result_points?: number
          created_at?: string
          exact_score_points?: number
          fixtures_predicted?: number
          friends_group_id?: string
          group_points?: number
          id?: string
          points_earned?: number
          red_card_bonus?: number
          total_goals_bonus?: number
          updated_at?: string
          user_id?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "weekly_scores_friends_group_id_fkey"
            columns: ["friends_group_id"]
            isOneToOne: false
            referencedRelation: "friends_groups"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      transfer_friends_group_ownership: {
        Args: {
          p_current_owner_id: string
          p_friends_group_id: string
          p_new_owner_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
