export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      book_chapters: {
        Row: {
          book_id: string
          bpm: number | null
          chapter_number: number
          content: string | null
          created_at: string
          id: string
          level: number
          mood: string | null
          part_id: string | null
          scene_type: string | null
          title: string
        }
        Insert: {
          book_id: string
          bpm?: number | null
          chapter_number?: number
          content?: string | null
          created_at?: string
          id?: string
          level?: number
          mood?: string | null
          part_id?: string | null
          scene_type?: string | null
          title?: string
        }
        Update: {
          book_id?: string
          bpm?: number | null
          chapter_number?: number
          content?: string | null
          created_at?: string
          id?: string
          level?: number
          mood?: string | null
          part_id?: string | null
          scene_type?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_chapters_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "book_chapters_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "book_parts"
            referencedColumns: ["id"]
          },
        ]
      }
      book_characters: {
        Row: {
          age_group: string
          aliases: string[]
          book_id: string
          color: string | null
          created_at: string
          description: string | null
          gender: string
          id: string
          name: string
          sort_order: number
          speech_style: string | null
          temperament: string | null
          updated_at: string
          voice_config: Json
        }
        Insert: {
          age_group?: string
          aliases?: string[]
          book_id: string
          color?: string | null
          created_at?: string
          description?: string | null
          gender?: string
          id?: string
          name?: string
          sort_order?: number
          speech_style?: string | null
          temperament?: string | null
          updated_at?: string
          voice_config?: Json
        }
        Update: {
          age_group?: string
          aliases?: string[]
          book_id?: string
          color?: string | null
          created_at?: string
          description?: string | null
          gender?: string
          id?: string
          name?: string
          sort_order?: number
          speech_style?: string | null
          temperament?: string | null
          updated_at?: string
          voice_config?: Json
        }
        Relationships: [
          {
            foreignKeyName: "book_characters_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      book_parts: {
        Row: {
          book_id: string
          created_at: string
          id: string
          part_number: number
          title: string
        }
        Insert: {
          book_id: string
          created_at?: string
          id?: string
          part_number?: number
          title?: string
        }
        Update: {
          book_id?: string
          created_at?: string
          id?: string
          part_number?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_parts_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      book_scenes: {
        Row: {
          bpm: number | null
          chapter_id: string
          content: string | null
          created_at: string
          id: string
          mood: string | null
          scene_number: number
          scene_type: string | null
          silence_sec: number
          title: string
        }
        Insert: {
          bpm?: number | null
          chapter_id: string
          content?: string | null
          created_at?: string
          id?: string
          mood?: string | null
          scene_number?: number
          scene_type?: string | null
          silence_sec?: number
          title?: string
        }
        Update: {
          bpm?: number | null
          chapter_id?: string
          content?: string | null
          created_at?: string
          id?: string
          mood?: string | null
          scene_number?: number
          scene_type?: string | null
          silence_sec?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_scenes_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: false
            referencedRelation: "book_chapters"
            referencedColumns: ["id"]
          },
        ]
      }
      books: {
        Row: {
          created_at: string
          file_name: string
          file_path: string | null
          id: string
          raw_text: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name?: string
          file_path?: string | null
          id?: string
          raw_text?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string | null
          id?: string
          raw_text?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      character_appearances: {
        Row: {
          character_id: string
          id: string
          role_in_scene: string
          scene_id: string
          segment_ids: string[]
        }
        Insert: {
          character_id: string
          id?: string
          role_in_scene?: string
          scene_id: string
          segment_ids?: string[]
        }
        Update: {
          character_id?: string
          id?: string
          role_in_scene?: string
          scene_id?: string
          segment_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "character_appearances_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "book_characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_appearances_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "book_scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      clip_plugin_configs: {
        Row: {
          clip_id: string
          config: Json
          created_at: string
          id: string
          scene_id: string
          track_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          clip_id: string
          config?: Json
          created_at?: string
          id?: string
          scene_id: string
          track_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          clip_id?: string
          config?: Json
          created_at?: string
          id?: string
          scene_id?: string
          track_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clip_plugin_configs_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "book_scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      convolution_impulses: {
        Row: {
          category: string
          channels: number
          created_at: string
          description: string | null
          duration_ms: number
          file_path: string
          id: string
          is_public: boolean
          name: string
          peaks: Json | null
          sample_rate: number
          uploaded_by: string
        }
        Insert: {
          category?: string
          channels?: number
          created_at?: string
          description?: string | null
          duration_ms?: number
          file_path: string
          id?: string
          is_public?: boolean
          name?: string
          peaks?: Json | null
          sample_rate?: number
          uploaded_by: string
        }
        Update: {
          category?: string
          channels?: number
          created_at?: string
          description?: string | null
          duration_ms?: number
          file_path?: string
          id?: string
          is_public?: boolean
          name?: string
          peaks?: Json | null
          sample_rate?: number
          uploaded_by?: string
        }
        Relationships: []
      }
      montage_parts: {
        Row: {
          chapter_id: string
          created_at: string
          id: string
          part_number: number
          scene_ids: string[]
          user_id: string
        }
        Insert: {
          chapter_id: string
          created_at?: string
          id?: string
          part_number?: number
          scene_ids?: string[]
          user_id: string
        }
        Update: {
          chapter_id?: string
          created_at?: string
          id?: string
          part_number?: number
          scene_ids?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "montage_parts_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: false
            referencedRelation: "book_chapters"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          api_keys: Json | null
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          language: string | null
          theme: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          api_keys?: Json | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          language?: string | null
          theme?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          api_keys?: Json | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          language?: string | null
          theme?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      proxy_api_logs: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          latency_ms: number | null
          model_id: string
          provider: string
          request_type: string
          status: string
          tokens_input: number | null
          tokens_output: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          model_id: string
          provider?: string
          request_type?: string
          status?: string
          tokens_input?: number | null
          tokens_output?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          model_id?: string
          provider?: string
          request_type?: string
          status?: string
          tokens_input?: number | null
          tokens_output?: number | null
          user_id?: string
        }
        Relationships: []
      }
      scene_atmospheres: {
        Row: {
          audio_path: string
          created_at: string
          duration_ms: number
          fade_in_ms: number
          fade_out_ms: number
          id: string
          layer_type: string
          prompt_used: string
          scene_id: string
          volume: number
        }
        Insert: {
          audio_path: string
          created_at?: string
          duration_ms?: number
          fade_in_ms?: number
          fade_out_ms?: number
          id?: string
          layer_type?: string
          prompt_used?: string
          scene_id: string
          volume?: number
        }
        Update: {
          audio_path?: string
          created_at?: string
          duration_ms?: number
          fade_in_ms?: number
          fade_out_ms?: number
          id?: string
          layer_type?: string
          prompt_used?: string
          scene_id?: string
          volume?: number
        }
        Relationships: [
          {
            foreignKeyName: "scene_atmospheres_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "book_scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      scene_playlists: {
        Row: {
          created_at: string
          id: string
          scene_id: string
          segments: Json
          status: string
          total_duration_ms: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          scene_id: string
          segments?: Json
          status?: string
          total_duration_ms?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          scene_id?: string
          segments?: Json
          status?: string
          total_duration_ms?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scene_playlists_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: true
            referencedRelation: "book_scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      scene_renders: {
        Row: {
          atmo_duration_ms: number
          atmo_path: string | null
          created_at: string
          id: string
          render_config: Json
          scene_id: string
          sfx_duration_ms: number
          sfx_path: string | null
          status: string
          updated_at: string
          user_id: string
          voice_duration_ms: number
          voice_path: string | null
        }
        Insert: {
          atmo_duration_ms?: number
          atmo_path?: string | null
          created_at?: string
          id?: string
          render_config?: Json
          scene_id: string
          sfx_duration_ms?: number
          sfx_path?: string | null
          status?: string
          updated_at?: string
          user_id: string
          voice_duration_ms?: number
          voice_path?: string | null
        }
        Update: {
          atmo_duration_ms?: number
          atmo_path?: string | null
          created_at?: string
          id?: string
          render_config?: Json
          scene_id?: string
          sfx_duration_ms?: number
          sfx_path?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          voice_duration_ms?: number
          voice_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scene_renders_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: true
            referencedRelation: "book_scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      scene_segments: {
        Row: {
          created_at: string
          id: string
          metadata: Json | null
          scene_id: string
          segment_number: number
          segment_type: Database["public"]["Enums"]["segment_type"]
          speaker: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json | null
          scene_id: string
          segment_number?: number
          segment_type?: Database["public"]["Enums"]["segment_type"]
          speaker?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json | null
          scene_id?: string
          segment_number?: number
          segment_type?: Database["public"]["Enums"]["segment_type"]
          speaker?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scene_segments_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "book_scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      scene_type_mappings: {
        Row: {
          character_id: string
          created_at: string
          id: string
          scene_id: string
          segment_type: string
        }
        Insert: {
          character_id: string
          created_at?: string
          id?: string
          scene_id: string
          segment_type: string
        }
        Update: {
          character_id?: string
          created_at?: string
          id?: string
          scene_id?: string
          segment_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "scene_type_mappings_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "book_characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scene_type_mappings_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "book_scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      segment_audio: {
        Row: {
          audio_path: string
          created_at: string
          duration_ms: number
          id: string
          segment_id: string
          status: string
          voice_config: Json
        }
        Insert: {
          audio_path: string
          created_at?: string
          duration_ms?: number
          id?: string
          segment_id: string
          status?: string
          voice_config?: Json
        }
        Update: {
          audio_path?: string
          created_at?: string
          duration_ms?: number
          id?: string
          segment_id?: string
          status?: string
          voice_config?: Json
        }
        Relationships: [
          {
            foreignKeyName: "segment_audio_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: true
            referencedRelation: "scene_segments"
            referencedColumns: ["id"]
          },
        ]
      }
      segment_phrases: {
        Row: {
          created_at: string
          id: string
          metadata: Json | null
          phrase_number: number
          segment_id: string
          text: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json | null
          phrase_number?: number
          segment_id: string
          text?: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json | null
          phrase_number?: number
          segment_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "segment_phrases_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "scene_segments"
            referencedColumns: ["id"]
          },
        ]
      }
      stress_dictionary: {
        Row: {
          context: string | null
          created_at: string
          id: string
          stressed_index: number
          user_id: string
          word: string
        }
        Insert: {
          context?: string | null
          created_at?: string
          id?: string
          stressed_index: number
          user_id: string
          word: string
        }
        Update: {
          context?: string | null
          created_at?: string
          id?: string
          stressed_index?: number
          user_id?: string
          word?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          created_at: string
          id: string
          setting_key: string
          setting_value: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          setting_key: string
          setting_value?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          setting_key?: string
          setting_value?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_my_api_keys: { Args: never; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      segment_type:
        | "epigraph"
        | "narrator"
        | "first_person"
        | "inner_thought"
        | "dialogue"
        | "lyric"
        | "footnote"
        | "monologue"
        | "telephone"
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
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      segment_type: [
        "epigraph",
        "narrator",
        "first_person",
        "inner_thought",
        "dialogue",
        "lyric",
        "footnote",
        "monologue",
        "telephone",
      ],
    },
  },
} as const
