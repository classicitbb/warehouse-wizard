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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_product_hints: {
        Row: {
          confidence: number | null
          hint_type: string
          hint_value: Json
          id: string
          last_observed_at: string
          product_id: string
          sample_count: number
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          confidence?: number | null
          hint_type: string
          hint_value?: Json
          id?: string
          last_observed_at?: string
          product_id: string
          sample_count?: number
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          confidence?: number | null
          hint_type?: string
          hint_value?: Json
          id?: string
          last_observed_at?: string
          product_id?: string
          sample_count?: number
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_product_hints_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_product_hints_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_recommendations: {
        Row: {
          acted_at: string | null
          acted_by: string | null
          audience: Database["public"]["Enums"]["app_role_code"][]
          context: Json
          created_at: string
          id: string
          next_action: string
          reason: string
          recommendation_key: string
          severity: string
          status: Database["public"]["Enums"]["recommendation_status"]
          title: string
        }
        Insert: {
          acted_at?: string | null
          acted_by?: string | null
          audience: Database["public"]["Enums"]["app_role_code"][]
          context?: Json
          created_at?: string
          id?: string
          next_action: string
          reason: string
          recommendation_key: string
          severity: string
          status?: Database["public"]["Enums"]["recommendation_status"]
          title: string
        }
        Update: {
          acted_at?: string | null
          acted_by?: string | null
          audience?: Database["public"]["Enums"]["app_role_code"][]
          context?: Json
          created_at?: string
          id?: string
          next_action?: string
          reason?: string
          recommendation_key?: string
          severity?: string
          status?: Database["public"]["Enums"]["recommendation_status"]
          title?: string
        }
        Relationships: []
      }
      app_client_heartbeat: {
        Row: {
          app_version: string
          device_id: string
          last_seen_at: string
          user_id: string
          user_label: string | null
        }
        Insert: {
          app_version: string
          device_id: string
          last_seen_at?: string
          user_id?: string
          user_label?: string | null
        }
        Update: {
          app_version?: string
          device_id?: string
          last_seen_at?: string
          user_id?: string
          user_label?: string | null
        }
        Relationships: []
      }
      app_release_policy: {
        Row: {
          daily_refresh_enabled: boolean
          daily_refresh_hour: number
          force_after: string | null
          grace_minutes: number
          id: boolean
          message: string | null
          min_required_version: string | null
          nightly_signout_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          daily_refresh_enabled?: boolean
          daily_refresh_hour?: number
          force_after?: string | null
          grace_minutes?: number
          id?: boolean
          message?: string | null
          min_required_version?: string | null
          nightly_signout_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          daily_refresh_enabled?: boolean
          daily_refresh_hour?: number
          force_after?: string | null
          grace_minutes?: number
          id?: boolean
          message?: string | null
          min_required_version?: string | null
          nightly_signout_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          entity_id: string
          entity_table: string
          event_type: string
          from_location_id: string | null
          id: string
          metadata: Json | null
          pallet_id: string | null
          to_location_id: string | null
          warehouse_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          entity_id: string
          entity_table: string
          event_type: string
          from_location_id?: string | null
          id?: string
          metadata?: Json | null
          pallet_id?: string | null
          to_location_id?: string | null
          warehouse_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string
          entity_table?: string
          event_type?: string
          from_location_id?: string | null
          id?: string
          metadata?: Json | null
          pallet_id?: string | null
          to_location_id?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "location_occupancy_view"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "audit_events_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "inventory_search_view"
            referencedColumns: ["pallet_id"]
          },
          {
            foreignKeyName: "audit_events_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "pallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "location_occupancy_view"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "audit_events_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      barcode_labels: {
        Row: {
          created_at: string
          entity_id: string
          id: string
          label_code: string
          label_type: string
          last_printed_at: string | null
          printed_by: string | null
          reprint_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          id?: string
          label_code: string
          label_type: string
          last_printed_at?: string | null
          printed_by?: string | null
          reprint_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          id?: string
          label_code?: string
          label_type?: string
          last_printed_at?: string | null
          printed_by?: string | null
          reprint_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      client_variables: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_hidden: boolean
          key: string
          updated_at: string
          value: string
          variable_type: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_hidden?: boolean
          key: string
          updated_at?: string
          value?: string
          variable_type?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_hidden?: boolean
          key?: string
          updated_at?: string
          value?: string
          variable_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_variables_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          active: boolean
          allow_mixed_lot_pallet: boolean
          allow_mixed_sku_pallet: boolean
          allow_mixed_stock: boolean
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_hidden: boolean
          name: string
          require_expiry: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          allow_mixed_lot_pallet?: boolean
          allow_mixed_sku_pallet?: boolean
          allow_mixed_stock?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_hidden?: boolean
          name: string
          require_expiry?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          allow_mixed_lot_pallet?: boolean
          allow_mixed_sku_pallet?: boolean
          allow_mixed_stock?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_hidden?: boolean
          name?: string
          require_expiry?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      copilot_conversations: {
        Row: {
          created_at: string
          id: string
          title: string | null
          updated_at: string
          user_id: string
          warehouse_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id: string
          warehouse_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "copilot_conversations_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_messages: {
        Row: {
          citations: Json
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          citations?: Json
          content?: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          citations?: Json
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "copilot_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_suggestions: {
        Row: {
          created_at: string
          decided_at: string | null
          decision: string
          id: string
          suggestion: Json
          surface: string
          user_id: string
          warehouse_id: string | null
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decision?: string
          id?: string
          suggestion?: Json
          surface: string
          user_id: string
          warehouse_id?: string | null
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decision?: string
          id?: string
          suggestion?: Json
          surface?: string
          user_id?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "copilot_suggestions_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_tool_calls: {
        Row: {
          conversation_id: string | null
          created_at: string
          error_message: string | null
          id: string
          latency_ms: number | null
          outcome: string
          row_count: number | null
          tool_input: Json
          tool_name: string
          user_id: string
          warehouse_id: string | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          outcome?: string
          row_count?: number | null
          tool_input?: Json
          tool_name: string
          user_id: string
          warehouse_id?: string | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          outcome?: string
          row_count?: number | null
          tool_input?: Json
          tool_name?: string
          user_id?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "copilot_tool_calls_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "copilot_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_tool_calls_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_assignees: {
        Row: {
          assigned_by: string | null
          created_at: string
          cycle_count_id: string
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          cycle_count_id: string
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          cycle_count_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_assignees_cycle_count_id_fkey"
            columns: ["cycle_count_id"]
            isOneToOne: false
            referencedRelation: "cycle_counts"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_lines: {
        Row: {
          adjustment_id: string | null
          approved_at: string | null
          approved_by: string | null
          assigned_user_id: string | null
          claim_expires_at: string | null
          claimed_at: string | null
          claimed_by_user_id: string | null
          counted_quantity: number | null
          created_at: string
          created_by: string | null
          cycle_count_id: string
          exception_reason: string | null
          expected_quantity: number
          first_count_qty: number | null
          first_counted_at: string | null
          first_counted_by: string | null
          id: string
          line_status: Database["public"]["Enums"]["count_line_status"]
          location_id: string | null
          notes: string | null
          pallet_id: string | null
          product_id: string | null
          recount_qty: number | null
          recounted_at: string | null
          recounted_by: string | null
          status: Database["public"]["Enums"]["task_status"]
          updated_at: string
          variance_percent: number | null
          variance_quantity: number | null
        }
        Insert: {
          adjustment_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          assigned_user_id?: string | null
          claim_expires_at?: string | null
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          counted_quantity?: number | null
          created_at?: string
          created_by?: string | null
          cycle_count_id: string
          exception_reason?: string | null
          expected_quantity?: number
          first_count_qty?: number | null
          first_counted_at?: string | null
          first_counted_by?: string | null
          id?: string
          line_status?: Database["public"]["Enums"]["count_line_status"]
          location_id?: string | null
          notes?: string | null
          pallet_id?: string | null
          product_id?: string | null
          recount_qty?: number | null
          recounted_at?: string | null
          recounted_by?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string
          variance_percent?: number | null
          variance_quantity?: number | null
        }
        Update: {
          adjustment_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          assigned_user_id?: string | null
          claim_expires_at?: string | null
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          counted_quantity?: number | null
          created_at?: string
          created_by?: string | null
          cycle_count_id?: string
          exception_reason?: string | null
          expected_quantity?: number
          first_count_qty?: number | null
          first_counted_at?: string | null
          first_counted_by?: string | null
          id?: string
          line_status?: Database["public"]["Enums"]["count_line_status"]
          location_id?: string | null
          notes?: string | null
          pallet_id?: string | null
          product_id?: string | null
          recount_qty?: number | null
          recounted_at?: string | null
          recounted_by?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string
          variance_percent?: number | null
          variance_quantity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_lines_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "stock_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_count_lines_cycle_count_id_fkey"
            columns: ["cycle_count_id"]
            isOneToOne: false
            referencedRelation: "cycle_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_count_lines_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "location_occupancy_view"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "cycle_count_lines_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_count_lines_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "inventory_search_view"
            referencedColumns: ["pallet_id"]
          },
          {
            foreignKeyName: "cycle_count_lines_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "pallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_count_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_schedules: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          frequency_days: number
          id: string
          name: string
          next_run_at: string
          variance_threshold_percent: number
          velocity_class: string | null
          warehouse_id: string
          zone_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          frequency_days: number
          id?: string
          name: string
          next_run_at: string
          variance_threshold_percent?: number
          velocity_class?: string | null
          warehouse_id: string
          zone_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          frequency_days?: number
          id?: string
          name?: string
          next_run_at?: string
          variance_threshold_percent?: number
          velocity_class?: string | null
          warehouse_id?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_schedules_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_count_schedules_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_counts: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          assigned_user_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          count_number: string
          created_at: string
          created_by: string | null
          freeze_expires_at: string | null
          id: string
          initiated_by: string | null
          location_id: string | null
          location_ids: string[] | null
          notes: string | null
          product_ids: string[] | null
          schedule_id: string | null
          scope: Database["public"]["Enums"]["count_scope"]
          snapshot_at: string | null
          status: Database["public"]["Enums"]["count_status"]
          updated_at: string
          variance_threshold_percent: number
          warehouse_id: string
          zone_id: string | null
          zone_ids: string[] | null
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          assigned_user_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          count_number: string
          created_at?: string
          created_by?: string | null
          freeze_expires_at?: string | null
          id?: string
          initiated_by?: string | null
          location_id?: string | null
          location_ids?: string[] | null
          notes?: string | null
          product_ids?: string[] | null
          schedule_id?: string | null
          scope?: Database["public"]["Enums"]["count_scope"]
          snapshot_at?: string | null
          status?: Database["public"]["Enums"]["count_status"]
          updated_at?: string
          variance_threshold_percent?: number
          warehouse_id: string
          zone_id?: string | null
          zone_ids?: string[] | null
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          assigned_user_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          count_number?: string
          created_at?: string
          created_by?: string | null
          freeze_expires_at?: string | null
          id?: string
          initiated_by?: string | null
          location_id?: string | null
          location_ids?: string[] | null
          notes?: string | null
          product_ids?: string[] | null
          schedule_id?: string | null
          scope?: Database["public"]["Enums"]["count_scope"]
          snapshot_at?: string | null
          status?: Database["public"]["Enums"]["count_status"]
          updated_at?: string
          variance_threshold_percent?: number
          warehouse_id?: string
          zone_id?: string | null
          zone_ids?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "cycle_counts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "location_occupancy_view"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "cycle_counts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_counts_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_counts_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_counts_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      deployment_subscription: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          features: Json
          id: string
          is_active: boolean
          licence_key: string | null
          licence_valid_until: string | null
          max_users: number
          max_warehouses: number
          notes: string | null
          plan_code: string
          plan_name: string
          subscribed_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          features?: Json
          id?: string
          is_active?: boolean
          licence_key?: string | null
          licence_valid_until?: string | null
          max_users?: number
          max_warehouses?: number
          notes?: string | null
          plan_code?: string
          plan_name?: string
          subscribed_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          features?: Json
          id?: string
          is_active?: boolean
          licence_key?: string | null
          licence_valid_until?: string | null
          max_users?: number
          max_warehouses?: number
          notes?: string | null
          plan_code?: string
          plan_name?: string
          subscribed_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deployment_subscription_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dock_appointments: {
        Row: {
          appointment_number: string
          carrier: string | null
          created_at: string
          dock_door: string
          driver_name: string | null
          id: string
          scheduled_at: string
          status: Database["public"]["Enums"]["task_status"]
          warehouse_id: string | null
        }
        Insert: {
          appointment_number: string
          carrier?: string | null
          created_at?: string
          dock_door: string
          driver_name?: string | null
          id?: string
          scheduled_at: string
          status?: Database["public"]["Enums"]["task_status"]
          warehouse_id?: string | null
        }
        Update: {
          appointment_number?: string
          carrier?: string | null
          created_at?: string
          dock_door?: string
          driver_name?: string | null
          id?: string
          scheduled_at?: string
          status?: Database["public"]["Enums"]["task_status"]
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dock_appointments_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      external_record_links: {
        Row: {
          external_id: string
          external_record_type: string
          external_url: string | null
          id: string
          last_synced_at: string | null
          local_id: string
          local_table: string
          system: Database["public"]["Enums"]["integration_system"]
        }
        Insert: {
          external_id: string
          external_record_type: string
          external_url?: string | null
          id?: string
          last_synced_at?: string | null
          local_id: string
          local_table: string
          system: Database["public"]["Enums"]["integration_system"]
        }
        Update: {
          external_id?: string
          external_record_type?: string
          external_url?: string | null
          id?: string
          last_synced_at?: string | null
          local_id?: string
          local_table?: string
          system?: Database["public"]["Enums"]["integration_system"]
        }
        Relationships: []
      }
      integration_connections: {
        Row: {
          base_url: string | null
          config: Json
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          name: string
          system: Database["public"]["Enums"]["integration_system"]
          updated_at: string
        }
        Insert: {
          base_url?: string | null
          config?: Json
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          name: string
          system: Database["public"]["Enums"]["integration_system"]
          updated_at?: string
        }
        Update: {
          base_url?: string | null
          config?: Json
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          name?: string
          system?: Database["public"]["Enums"]["integration_system"]
          updated_at?: string
        }
        Relationships: []
      }
      integration_dead_letters: {
        Row: {
          created_at: string
          id: string
          payload: Json
          reason: string
          resolved_at: string | null
          resolved_by: string | null
          sync_job_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          payload?: Json
          reason: string
          resolved_at?: string | null
          resolved_by?: string | null
          sync_job_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          sync_job_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_dead_letters_sync_job_id_fkey"
            columns: ["sync_job_id"]
            isOneToOne: false
            referencedRelation: "integration_sync_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_payload_logs: {
        Row: {
          created_at: string
          direction: string
          http_status: number | null
          id: string
          payload: Json
          response: Json | null
          sync_job_id: string | null
        }
        Insert: {
          created_at?: string
          direction: string
          http_status?: number | null
          id?: string
          payload: Json
          response?: Json | null
          sync_job_id?: string | null
        }
        Update: {
          created_at?: string
          direction?: string
          http_status?: number | null
          id?: string
          payload?: Json
          response?: Json | null
          sync_job_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_payload_logs_sync_job_id_fkey"
            columns: ["sync_job_id"]
            isOneToOne: false
            referencedRelation: "integration_sync_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_secrets: {
        Row: {
          connection_id: string
          created_at: string
          id: string
          secret_type: string
          secret_value: string
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          id?: string
          secret_type: string
          secret_value: string
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          id?: string
          secret_type?: string
          secret_value?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_secrets_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_sync_jobs: {
        Row: {
          attempts: number
          connection_id: string | null
          created_at: string
          error_message: string | null
          id: string
          idempotency_key: string
          job_type: string
          payload: Json
          result: Json | null
          status: Database["public"]["Enums"]["integration_job_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          connection_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          idempotency_key: string
          job_type: string
          payload?: Json
          result?: Json | null
          status?: Database["public"]["Enums"]["integration_job_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          connection_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string
          job_type?: string
          payload?: Json
          result?: Json | null
          status?: Database["public"]["Enums"]["integration_job_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_sync_jobs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_balances: {
        Row: {
          available_quantity: number
          client_id: string | null
          correction_state: string | null
          created_at: string
          damaged_quantity: number
          expiry_date: string | null
          held_quantity: number
          id: string
          inventory_lot_id: string | null
          location_id: string | null
          pallet_id: string
          product_id: string
          quantity: number
          received_at: string | null
          reserved_quantity: number
          status: Database["public"]["Enums"]["inventory_status"]
          updated_at: string
          warehouse_id: string
          zone_id: string | null
        }
        Insert: {
          available_quantity?: number
          client_id?: string | null
          correction_state?: string | null
          created_at?: string
          damaged_quantity?: number
          expiry_date?: string | null
          held_quantity?: number
          id?: string
          inventory_lot_id?: string | null
          location_id?: string | null
          pallet_id: string
          product_id: string
          quantity?: number
          received_at?: string | null
          reserved_quantity?: number
          status?: Database["public"]["Enums"]["inventory_status"]
          updated_at?: string
          warehouse_id: string
          zone_id?: string | null
        }
        Update: {
          available_quantity?: number
          client_id?: string | null
          correction_state?: string | null
          created_at?: string
          damaged_quantity?: number
          expiry_date?: string | null
          held_quantity?: number
          id?: string
          inventory_lot_id?: string | null
          location_id?: string | null
          pallet_id?: string
          product_id?: string
          quantity?: number
          received_at?: string | null
          reserved_quantity?: number
          status?: Database["public"]["Enums"]["inventory_status"]
          updated_at?: string
          warehouse_id?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_balances_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_inventory_lot_id_fkey"
            columns: ["inventory_lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "location_occupancy_view"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "inventory_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "inventory_search_view"
            referencedColumns: ["pallet_id"]
          },
          {
            foreignKeyName: "inventory_balances_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "pallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_freezes: {
        Row: {
          created_at: string
          created_by: string
          cycle_count_id: string
          expires_at: string
          frozen_at: string
          id: string
          location_id: string | null
          pallet_id: string | null
          released_at: string | null
          released_by: string | null
          status: Database["public"]["Enums"]["freeze_status"]
          warehouse_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          cycle_count_id: string
          expires_at: string
          frozen_at?: string
          id?: string
          location_id?: string | null
          pallet_id?: string | null
          released_at?: string | null
          released_by?: string | null
          status?: Database["public"]["Enums"]["freeze_status"]
          warehouse_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          cycle_count_id?: string
          expires_at?: string
          frozen_at?: string
          id?: string
          location_id?: string | null
          pallet_id?: string | null
          released_at?: string | null
          released_by?: string | null
          status?: Database["public"]["Enums"]["freeze_status"]
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_freezes_cycle_count_id_fkey"
            columns: ["cycle_count_id"]
            isOneToOne: false
            referencedRelation: "cycle_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_freezes_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "location_occupancy_view"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "inventory_freezes_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_freezes_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "inventory_search_view"
            referencedColumns: ["pallet_id"]
          },
          {
            foreignKeyName: "inventory_freezes_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "pallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_freezes_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_lots: {
        Row: {
          batch_number: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          expiry_date: string | null
          id: string
          loading_date: string | null
          lot_number: string | null
          manufacture_date: string | null
          product_id: string
          rotation_date: string | null
          updated_at: string
        }
        Insert: {
          batch_number?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          expiry_date?: string | null
          id?: string
          loading_date?: string | null
          lot_number?: string | null
          manufacture_date?: string | null
          product_id: string
          rotation_date?: string | null
          updated_at?: string
        }
        Update: {
          batch_number?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          expiry_date?: string | null
          id?: string
          loading_date?: string | null
          lot_number?: string | null
          manufacture_date?: string | null
          product_id?: string
          rotation_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_lots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      label_templates: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          label_type: Database["public"]["Enums"]["label_type"]
          printer_language: string
          template_body: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          label_type: Database["public"]["Enums"]["label_type"]
          printer_language?: string
          template_body: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          label_type?: Database["public"]["Enums"]["label_type"]
          printer_language?: string
          template_body?: string
          updated_at?: string
        }
        Relationships: []
      }
      licence_events: {
        Row: {
          created_at: string
          created_by: string | null
          event_type: string
          id: string
          licence_key: string | null
          metadata: Json
          subscription_id: string | null
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_type: string
          id?: string
          licence_key?: string | null
          metadata?: Json
          subscription_id?: string | null
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_type?: string
          id?: string
          licence_key?: string | null
          metadata?: Json
          subscription_id?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "licence_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "licence_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "deployment_subscription"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          aisle: string | null
          allowed_product_family: string | null
          bay: string | null
          code: string
          created_at: string
          created_by: string | null
          depth: number | null
          id: string
          is_hidden: boolean
          layout_height: number | null
          layout_width: number | null
          layout_x: number | null
          layout_y: number | null
          level: number | null
          level_style: string
          location_type: Database["public"]["Enums"]["location_type"]
          max_height: number | null
          max_height_mm: number | null
          max_length: number | null
          max_pallet_height_cm: number | null
          max_pallets: number
          max_weight: number | null
          max_width: number | null
          mixed_lot_allowed: boolean
          mixed_sku_allowed: boolean
          notes: string | null
          pick_sequence: number | null
          position: number | null
          putaway_sequence: number | null
          status: string
          temperature_class: Database["public"]["Enums"]["temperature_class"]
          updated_at: string
          warehouse_id: string
          zone_id: string
        }
        Insert: {
          aisle?: string | null
          allowed_product_family?: string | null
          bay?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          depth?: number | null
          id?: string
          is_hidden?: boolean
          layout_height?: number | null
          layout_width?: number | null
          layout_x?: number | null
          layout_y?: number | null
          level?: number | null
          level_style?: string
          location_type?: Database["public"]["Enums"]["location_type"]
          max_height?: number | null
          max_height_mm?: number | null
          max_length?: number | null
          max_pallet_height_cm?: number | null
          max_pallets?: number
          max_weight?: number | null
          max_width?: number | null
          mixed_lot_allowed?: boolean
          mixed_sku_allowed?: boolean
          notes?: string | null
          pick_sequence?: number | null
          position?: number | null
          putaway_sequence?: number | null
          status?: string
          temperature_class?: Database["public"]["Enums"]["temperature_class"]
          updated_at?: string
          warehouse_id: string
          zone_id: string
        }
        Update: {
          aisle?: string | null
          allowed_product_family?: string | null
          bay?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          depth?: number | null
          id?: string
          is_hidden?: boolean
          layout_height?: number | null
          layout_width?: number | null
          layout_x?: number | null
          layout_y?: number | null
          level?: number | null
          level_style?: string
          location_type?: Database["public"]["Enums"]["location_type"]
          max_height?: number | null
          max_height_mm?: number | null
          max_length?: number | null
          max_pallet_height_cm?: number | null
          max_pallets?: number
          max_weight?: number | null
          max_width?: number | null
          mixed_lot_allowed?: boolean
          mixed_sku_allowed?: boolean
          notes?: string | null
          pick_sequence?: number | null
          position?: number | null
          putaway_sequence?: number | null
          status?: string
          temperature_class?: Database["public"]["Enums"]["temperature_class"]
          updated_at?: string
          warehouse_id?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locations_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      move_tasks: {
        Row: {
          assigned_user_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          from_location_id: string | null
          id: string
          pallet_id: string
          reason: string | null
          status: Database["public"]["Enums"]["task_status"]
          task_number: string
          to_location_id: string | null
          transfer_id: string | null
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          assigned_user_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          from_location_id?: string | null
          id?: string
          pallet_id: string
          reason?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          task_number: string
          to_location_id?: string | null
          transfer_id?: string | null
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          assigned_user_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          from_location_id?: string | null
          id?: string
          pallet_id?: string
          reason?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          task_number?: string
          to_location_id?: string | null
          transfer_id?: string | null
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "move_tasks_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "location_occupancy_view"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "move_tasks_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_tasks_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "inventory_search_view"
            referencedColumns: ["pallet_id"]
          },
          {
            foreignKeyName: "move_tasks_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "pallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_tasks_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "location_occupancy_view"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "move_tasks_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_tasks_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "transfers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "move_tasks_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_ticket_events: {
        Row: {
          actor_id: string | null
          actor_kind: string
          created_at: string
          detail: Json
          event: string
          id: string
          ticket_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_kind?: string
          created_at?: string
          detail?: Json
          event: string
          id?: string
          ticket_id: string
        }
        Update: {
          actor_id?: string | null
          actor_kind?: string
          created_at?: string
          detail?: Json
          event?: string
          id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_ticket_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "operator_ticket_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_ticket_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "operator_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_tickets: {
        Row: {
          actual_behavior: string | null
          agent_brief: string | null
          app_version: string | null
          assigned_to: string | null
          clarifications: Json
          conversation_id: string | null
          created_at: string
          expected_behavior: string | null
          id: string
          kind: string
          labels: string[]
          module: string | null
          reported_by: string
          resolution: string | null
          resolved_at: string | null
          route: string | null
          screenshot_path: string | null
          severity: string
          status: string
          steps_to_reproduce: string | null
          submitted_at: string | null
          summary: string
          telemetry: Json
          ticket_number: string | null
          title: string
          updated_at: string
          user_agent: string | null
          warehouse_id: string | null
        }
        Insert: {
          actual_behavior?: string | null
          agent_brief?: string | null
          app_version?: string | null
          assigned_to?: string | null
          clarifications?: Json
          conversation_id?: string | null
          created_at?: string
          expected_behavior?: string | null
          id?: string
          kind?: string
          labels?: string[]
          module?: string | null
          reported_by?: string
          resolution?: string | null
          resolved_at?: string | null
          route?: string | null
          screenshot_path?: string | null
          severity?: string
          status?: string
          steps_to_reproduce?: string | null
          submitted_at?: string | null
          summary?: string
          telemetry?: Json
          ticket_number?: string | null
          title?: string
          updated_at?: string
          user_agent?: string | null
          warehouse_id?: string | null
        }
        Update: {
          actual_behavior?: string | null
          agent_brief?: string | null
          app_version?: string | null
          assigned_to?: string | null
          clarifications?: Json
          conversation_id?: string | null
          created_at?: string
          expected_behavior?: string | null
          id?: string
          kind?: string
          labels?: string[]
          module?: string | null
          reported_by?: string
          resolution?: string | null
          resolved_at?: string | null
          route?: string | null
          screenshot_path?: string | null
          severity?: string
          status?: string
          steps_to_reproduce?: string | null
          submitted_at?: string | null
          summary?: string
          telemetry?: Json
          ticket_number?: string | null
          title?: string
          updated_at?: string
          user_agent?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operator_tickets_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "copilot_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_tickets_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      order_lines: {
        Row: {
          allocated_quantity: number
          created_at: string
          created_by: string | null
          id: string
          inventory_lot_id: string | null
          notes: string | null
          order_id: string
          picked_quantity: number
          product_id: string
          quantity: number
          updated_at: string
        }
        Insert: {
          allocated_quantity?: number
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_lot_id?: string | null
          notes?: string | null
          order_id: string
          picked_quantity?: number
          product_id: string
          quantity?: number
          updated_at?: string
        }
        Update: {
          allocated_quantity?: number
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_lot_id?: string | null
          notes?: string | null
          order_id?: string
          picked_quantity?: number
          product_id?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_inventory_lot_id_fkey"
            columns: ["inventory_lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          order_number: string
          order_type: string
          priority: number
          requested_ship_date: string | null
          status: Database["public"]["Enums"]["task_status"]
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          order_number: string
          order_type?: string
          priority?: number
          requested_ship_date?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          order_number?: string
          order_type?: string
          priority?: number
          requested_ship_date?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      pallets: {
        Row: {
          available_quantity: number
          client_id: string | null
          correction_state: string | null
          created_at: string
          created_by: string | null
          current_location_id: string | null
          current_warehouse_id: string | null
          damaged_quantity: number
          height: number | null
          held_quantity: number
          id: string
          inventory_lot_id: string | null
          is_stored: boolean
          last_counted_at: string | null
          length: number | null
          packaging_profile_id: string | null
          pallet_barcode: string
          pallet_code: string
          product_id: string
          quantity: number
          receipt_line_id: string | null
          reserved_quantity: number
          reused_from_pallet_id: string | null
          stack_height: number | null
          standard_height_mm: number | null
          standard_layers_per_pallet: number | null
          standard_packages_per_layer: number | null
          status: Database["public"]["Enums"]["inventory_status"]
          updated_at: string
          weight: number | null
          width: number | null
        }
        Insert: {
          available_quantity?: number
          client_id?: string | null
          correction_state?: string | null
          created_at?: string
          created_by?: string | null
          current_location_id?: string | null
          current_warehouse_id?: string | null
          damaged_quantity?: number
          height?: number | null
          held_quantity?: number
          id?: string
          inventory_lot_id?: string | null
          is_stored?: boolean
          last_counted_at?: string | null
          length?: number | null
          packaging_profile_id?: string | null
          pallet_barcode: string
          pallet_code: string
          product_id: string
          quantity?: number
          receipt_line_id?: string | null
          reserved_quantity?: number
          reused_from_pallet_id?: string | null
          stack_height?: number | null
          standard_height_mm?: number | null
          standard_layers_per_pallet?: number | null
          standard_packages_per_layer?: number | null
          status?: Database["public"]["Enums"]["inventory_status"]
          updated_at?: string
          weight?: number | null
          width?: number | null
        }
        Update: {
          available_quantity?: number
          client_id?: string | null
          correction_state?: string | null
          created_at?: string
          created_by?: string | null
          current_location_id?: string | null
          current_warehouse_id?: string | null
          damaged_quantity?: number
          height?: number | null
          held_quantity?: number
          id?: string
          inventory_lot_id?: string | null
          is_stored?: boolean
          last_counted_at?: string | null
          length?: number | null
          packaging_profile_id?: string | null
          pallet_barcode?: string
          pallet_code?: string
          product_id?: string
          quantity?: number
          receipt_line_id?: string | null
          reserved_quantity?: number
          reused_from_pallet_id?: string | null
          stack_height?: number | null
          standard_height_mm?: number | null
          standard_layers_per_pallet?: number | null
          standard_packages_per_layer?: number | null
          status?: Database["public"]["Enums"]["inventory_status"]
          updated_at?: string
          weight?: number | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pallets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pallets_current_location_id_fkey"
            columns: ["current_location_id"]
            isOneToOne: false
            referencedRelation: "location_occupancy_view"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "pallets_current_location_id_fkey"
            columns: ["current_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pallets_current_warehouse_id_fkey"
            columns: ["current_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pallets_inventory_lot_id_fkey"
            columns: ["inventory_lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pallets_packaging_profile_id_fkey"
            columns: ["packaging_profile_id"]
            isOneToOne: false
            referencedRelation: "product_packaging_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pallets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pallets_receipt_line_id_fkey"
            columns: ["receipt_line_id"]
            isOneToOne: false
            referencedRelation: "receipt_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pallets_reused_from_pallet_id_fkey"
            columns: ["reused_from_pallet_id"]
            isOneToOne: false
            referencedRelation: "inventory_search_view"
            referencedColumns: ["pallet_id"]
          },
          {
            foreignKeyName: "pallets_reused_from_pallet_id_fkey"
            columns: ["reused_from_pallet_id"]
            isOneToOne: false
            referencedRelation: "pallets"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_features: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      pick_lists: {
        Row: {
          client_id: string | null
          consolidated: boolean
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          order_id: string | null
          pick_list_number: string
          released_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          client_id?: string | null
          consolidated?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          order_id?: string | null
          pick_list_number: string
          released_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          client_id?: string | null
          consolidated?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          order_id?: string | null
          pick_list_number?: string
          released_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pick_lists_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_lists_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_lists_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      pick_tasks: {
        Row: {
          assigned_user_id: string | null
          completed_at: string | null
          confirmed_quantity: number
          created_at: string
          created_by: string | null
          id: string
          location_id: string | null
          order_line_id: string | null
          original_location_id: string | null
          original_pallet_id: string | null
          pallet_id: string | null
          pick_list_id: string
          picked_location_id: string | null
          picked_pallet_id: string | null
          requested_quantity: number
          short_reason: string | null
          source_override_reason: string | null
          source_reassigned_at: string | null
          staging_location_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          task_number: string
          updated_at: string
        }
        Insert: {
          assigned_user_id?: string | null
          completed_at?: string | null
          confirmed_quantity?: number
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string | null
          order_line_id?: string | null
          original_location_id?: string | null
          original_pallet_id?: string | null
          pallet_id?: string | null
          pick_list_id: string
          picked_location_id?: string | null
          picked_pallet_id?: string | null
          requested_quantity?: number
          short_reason?: string | null
          source_override_reason?: string | null
          source_reassigned_at?: string | null
          staging_location_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          task_number: string
          updated_at?: string
        }
        Update: {
          assigned_user_id?: string | null
          completed_at?: string | null
          confirmed_quantity?: number
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string | null
          order_line_id?: string | null
          original_location_id?: string | null
          original_pallet_id?: string | null
          pallet_id?: string | null
          pick_list_id?: string
          picked_location_id?: string | null
          picked_pallet_id?: string | null
          requested_quantity?: number
          short_reason?: string | null
          source_override_reason?: string | null
          source_reassigned_at?: string | null
          staging_location_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          task_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pick_tasks_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "location_occupancy_view"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "pick_tasks_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_tasks_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: false
            referencedRelation: "order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_tasks_original_location_id_fkey"
            columns: ["original_location_id"]
            isOneToOne: false
            referencedRelation: "location_occupancy_view"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "pick_tasks_original_location_id_fkey"
            columns: ["original_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_tasks_original_pallet_id_fkey"
            columns: ["original_pallet_id"]
            isOneToOne: false
            referencedRelation: "inventory_search_view"
            referencedColumns: ["pallet_id"]
          },
          {
            foreignKeyName: "pick_tasks_original_pallet_id_fkey"
            columns: ["original_pallet_id"]
            isOneToOne: false
            referencedRelation: "pallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_tasks_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "inventory_search_view"
            referencedColumns: ["pallet_id"]
          },
          {
            foreignKeyName: "pick_tasks_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "pallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_tasks_pick_list_id_fkey"
            columns: ["pick_list_id"]
            isOneToOne: false
            referencedRelation: "pick_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_tasks_picked_location_id_fkey"
            columns: ["picked_location_id"]
            isOneToOne: false
            referencedRelation: "location_occupancy_view"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "pick_tasks_picked_location_id_fkey"
            columns: ["picked_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_tasks_picked_pallet_id_fkey"
            columns: ["picked_pallet_id"]
            isOneToOne: false
            referencedRelation: "inventory_search_view"
            referencedColumns: ["pallet_id"]
          },
          {
            foreignKeyName: "pick_tasks_picked_pallet_id_fkey"
            columns: ["picked_pallet_id"]
            isOneToOne: false
            referencedRelation: "pallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_tasks_staging_location_id_fkey"
            columns: ["staging_location_id"]
            isOneToOne: false
            referencedRelation: "location_occupancy_view"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "pick_tasks_staging_location_id_fkey"
            columns: ["staging_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      print_jobs: {
        Row: {
          barcode_label_id: string | null
          created_at: string
          error_message: string | null
          id: string
          label_template_id: string | null
          printed_at: string | null
          printer_station_id: string | null
          requested_by: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["print_job_status"]
          zpl_payload: string
        }
        Insert: {
          barcode_label_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          label_template_id?: string | null
          printed_at?: string | null
          printer_station_id?: string | null
          requested_by?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["print_job_status"]
          zpl_payload: string
        }
        Update: {
          barcode_label_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          label_template_id?: string | null
          printed_at?: string | null
          printer_station_id?: string | null
          requested_by?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["print_job_status"]
          zpl_payload?: string
        }
        Relationships: [
          {
            foreignKeyName: "print_jobs_barcode_label_id_fkey"
            columns: ["barcode_label_id"]
            isOneToOne: false
            referencedRelation: "barcode_labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_label_template_id_fkey"
            columns: ["label_template_id"]
            isOneToOne: false
            referencedRelation: "label_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_printer_station_id_fkey"
            columns: ["printer_station_id"]
            isOneToOne: false
            referencedRelation: "printer_stations"
            referencedColumns: ["id"]
          },
        ]
      }
      printer_stations: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          network_address: string | null
          printer_language: string
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          network_address?: string | null
          printer_language?: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          network_address?: string | null
          printer_language?: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "printer_stations_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      product_packaging_profiles: {
        Row: {
          barcode: string | null
          build_notes: string | null
          created_at: string
          created_by: string | null
          effective_from: string | null
          fit_checked_at: string | null
          fit_status: string | null
          fit_summary: Json | null
          height: number | null
          id: string
          is_default: boolean
          is_hidden: boolean
          is_pallet_standard: boolean
          layer_columns: number | null
          layer_pattern: string | null
          layers_per_pallet: number | null
          length: number | null
          max_stack_pallets: number | null
          package_height_mm: number | null
          package_length_mm: number | null
          package_type: string | null
          package_width_mm: number | null
          packages_per_layer: number | null
          packages_per_pallet: number | null
          pallet_base_height_mm: number | null
          pallet_footprint_length_mm: number | null
          pallet_footprint_width_mm: number | null
          pallet_tare_kg: number | null
          product_id: string
          profile_name: string
          quantity_tolerance: number | null
          revision: number
          slip_sheet_height_mm: number | null
          standard_gross_weight_kg: number | null
          standard_height_mm: number | null
          superseded_by_id: string | null
          units_per_package: number
          units_per_pallet: number | null
          updated_at: string
          weight: number | null
          width: number | null
        }
        Insert: {
          barcode?: string | null
          build_notes?: string | null
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          fit_checked_at?: string | null
          fit_status?: string | null
          fit_summary?: Json | null
          height?: number | null
          id?: string
          is_default?: boolean
          is_hidden?: boolean
          is_pallet_standard?: boolean
          layer_columns?: number | null
          layer_pattern?: string | null
          layers_per_pallet?: number | null
          length?: number | null
          max_stack_pallets?: number | null
          package_height_mm?: number | null
          package_length_mm?: number | null
          package_type?: string | null
          package_width_mm?: number | null
          packages_per_layer?: number | null
          packages_per_pallet?: number | null
          pallet_base_height_mm?: number | null
          pallet_footprint_length_mm?: number | null
          pallet_footprint_width_mm?: number | null
          pallet_tare_kg?: number | null
          product_id: string
          profile_name: string
          quantity_tolerance?: number | null
          revision?: number
          slip_sheet_height_mm?: number | null
          standard_gross_weight_kg?: number | null
          standard_height_mm?: number | null
          superseded_by_id?: string | null
          units_per_package?: number
          units_per_pallet?: number | null
          updated_at?: string
          weight?: number | null
          width?: number | null
        }
        Update: {
          barcode?: string | null
          build_notes?: string | null
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          fit_checked_at?: string | null
          fit_status?: string | null
          fit_summary?: Json | null
          height?: number | null
          id?: string
          is_default?: boolean
          is_hidden?: boolean
          is_pallet_standard?: boolean
          layer_columns?: number | null
          layer_pattern?: string | null
          layers_per_pallet?: number | null
          length?: number | null
          max_stack_pallets?: number | null
          package_height_mm?: number | null
          package_length_mm?: number | null
          package_type?: string | null
          package_width_mm?: number | null
          packages_per_layer?: number | null
          packages_per_pallet?: number | null
          pallet_base_height_mm?: number | null
          pallet_footprint_length_mm?: number | null
          pallet_footprint_width_mm?: number | null
          pallet_tare_kg?: number | null
          product_id?: string
          profile_name?: string
          quantity_tolerance?: number | null
          revision?: number
          slip_sheet_height_mm?: number | null
          standard_gross_weight_kg?: number | null
          standard_height_mm?: number | null
          superseded_by_id?: string | null
          units_per_package?: number
          units_per_pallet?: number | null
          updated_at?: string
          weight?: number | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_packaging_profiles_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_packaging_profiles_superseded_by_id_fkey"
            columns: ["superseded_by_id"]
            isOneToOne: false
            referencedRelation: "product_packaging_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          barcode: string | null
          batch_tracked: boolean
          client_owner_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          expiry_tracked: boolean
          height: number | null
          id: string
          is_hidden: boolean
          length: number | null
          lot_tracked: boolean
          max_stack_height: number | null
          maximum_stock_level: number
          minimum_stock_level: number
          name: string
          pick_down_to_level: number
          product_family: string | null
          rotation_method: Database["public"]["Enums"]["rotation_method"]
          sku: string
          stackable: boolean
          supplier_lead_time_days: number
          temperature_requirement: Database["public"]["Enums"]["temperature_class"]
          unit_cost: number | null
          updated_at: string
          velocity_class: string
          weight: number | null
          width: number | null
        }
        Insert: {
          active?: boolean
          barcode?: string | null
          batch_tracked?: boolean
          client_owner_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          expiry_tracked?: boolean
          height?: number | null
          id?: string
          is_hidden?: boolean
          length?: number | null
          lot_tracked?: boolean
          max_stack_height?: number | null
          maximum_stock_level?: number
          minimum_stock_level?: number
          name: string
          pick_down_to_level?: number
          product_family?: string | null
          rotation_method?: Database["public"]["Enums"]["rotation_method"]
          sku: string
          stackable?: boolean
          supplier_lead_time_days?: number
          temperature_requirement?: Database["public"]["Enums"]["temperature_class"]
          unit_cost?: number | null
          updated_at?: string
          velocity_class?: string
          weight?: number | null
          width?: number | null
        }
        Update: {
          active?: boolean
          barcode?: string | null
          batch_tracked?: boolean
          client_owner_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          expiry_tracked?: boolean
          height?: number | null
          id?: string
          is_hidden?: boolean
          length?: number | null
          lot_tracked?: boolean
          max_stack_height?: number | null
          maximum_stock_level?: number
          minimum_stock_level?: number
          name?: string
          pick_down_to_level?: number
          product_family?: string | null
          rotation_method?: Database["public"]["Enums"]["rotation_method"]
          sku?: string
          stackable?: boolean
          supplier_lead_time_days?: number
          temperature_requirement?: Database["public"]["Enums"]["temperature_class"]
          unit_cost?: number | null
          updated_at?: string
          velocity_class?: string
          weight?: number | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_client_owner_id_fkey"
            columns: ["client_owner_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          approved: boolean
          badge_code: string | null
          created_at: string
          default_warehouse_id: string | null
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          pin_hash: string | null
          updated_at: string
          user_code: string | null
        }
        Insert: {
          active?: boolean
          approved?: boolean
          badge_code?: string | null
          created_at?: string
          default_warehouse_id?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          pin_hash?: string | null
          updated_at?: string
          user_code?: string | null
        }
        Update: {
          active?: boolean
          approved?: boolean
          badge_code?: string | null
          created_at?: string
          default_warehouse_id?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          pin_hash?: string | null
          updated_at?: string
          user_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_default_warehouse_id_fkey"
            columns: ["default_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      putaway_tasks: {
        Row: {
          alternative_requested: boolean
          assigned_user_id: string | null
          completed_at: string | null
          confirmed_location_id: string | null
          created_at: string
          created_by: string | null
          id: string
          pallet_id: string
          status: Database["public"]["Enums"]["task_status"]
          suggested_location_id: string | null
          task_number: string
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          alternative_requested?: boolean
          assigned_user_id?: string | null
          completed_at?: string | null
          confirmed_location_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          pallet_id: string
          status?: Database["public"]["Enums"]["task_status"]
          suggested_location_id?: string | null
          task_number: string
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          alternative_requested?: boolean
          assigned_user_id?: string | null
          completed_at?: string | null
          confirmed_location_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          pallet_id?: string
          status?: Database["public"]["Enums"]["task_status"]
          suggested_location_id?: string | null
          task_number?: string
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "putaway_tasks_confirmed_location_id_fkey"
            columns: ["confirmed_location_id"]
            isOneToOne: false
            referencedRelation: "location_occupancy_view"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "putaway_tasks_confirmed_location_id_fkey"
            columns: ["confirmed_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "putaway_tasks_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "inventory_search_view"
            referencedColumns: ["pallet_id"]
          },
          {
            foreignKeyName: "putaway_tasks_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "pallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "putaway_tasks_suggested_location_id_fkey"
            columns: ["suggested_location_id"]
            isOneToOne: false
            referencedRelation: "location_occupancy_view"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "putaway_tasks_suggested_location_id_fkey"
            columns: ["suggested_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "putaway_tasks_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_inspections: {
        Row: {
          completed_at: string | null
          corrective_action: string | null
          created_at: string
          disposition: Database["public"]["Enums"]["quality_disposition"]
          id: string
          inspected_by: string | null
          inspection_number: string
          pallet_id: string | null
          pass_fail_criteria: Json
          receipt_id: string | null
          root_cause_code: string | null
        }
        Insert: {
          completed_at?: string | null
          corrective_action?: string | null
          created_at?: string
          disposition?: Database["public"]["Enums"]["quality_disposition"]
          id?: string
          inspected_by?: string | null
          inspection_number: string
          pallet_id?: string | null
          pass_fail_criteria?: Json
          receipt_id?: string | null
          root_cause_code?: string | null
        }
        Update: {
          completed_at?: string | null
          corrective_action?: string | null
          created_at?: string
          disposition?: Database["public"]["Enums"]["quality_disposition"]
          id?: string
          inspected_by?: string | null
          inspection_number?: string
          pallet_id?: string | null
          pass_fail_criteria?: Json
          receipt_id?: string | null
          root_cause_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_inspections_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "inventory_search_view"
            referencedColumns: ["pallet_id"]
          },
          {
            foreignKeyName: "quality_inspections_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "pallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspections_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_lines: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          id: string
          inventory_lot_id: string | null
          notes: string | null
          override_height: number | null
          override_length: number | null
          override_weight: number | null
          override_width: number | null
          packaging_profile_id: string | null
          product_id: string
          quantity: number
          receipt_id: string
          received_quantity: number
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_lot_id?: string | null
          notes?: string | null
          override_height?: number | null
          override_length?: number | null
          override_weight?: number | null
          override_width?: number | null
          packaging_profile_id?: string | null
          product_id: string
          quantity?: number
          receipt_id: string
          received_quantity?: number
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_lot_id?: string | null
          notes?: string | null
          override_height?: number | null
          override_length?: number | null
          override_weight?: number | null
          override_width?: number | null
          packaging_profile_id?: string | null
          product_id?: string
          quantity?: number
          receipt_id?: string
          received_quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_lines_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_lines_inventory_lot_id_fkey"
            columns: ["inventory_lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_lines_packaging_profile_id_fkey"
            columns: ["packaging_profile_id"]
            isOneToOne: false
            referencedRelation: "product_packaging_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_lines_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          client_id: string | null
          container_number: string | null
          created_at: string
          created_by: string | null
          draft_count: number | null
          draft_group_id: string | null
          draft_pallet_barcode: string | null
          draft_sequence: number | null
          id: string
          notes: string | null
          po_number: string | null
          receipt_number: string
          receipt_type: Database["public"]["Enums"]["receipt_type"]
          reference_number: string | null
          source_warehouse_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          client_id?: string | null
          container_number?: string | null
          created_at?: string
          created_by?: string | null
          draft_count?: number | null
          draft_group_id?: string | null
          draft_pallet_barcode?: string | null
          draft_sequence?: number | null
          id?: string
          notes?: string | null
          po_number?: string | null
          receipt_number: string
          receipt_type?: Database["public"]["Enums"]["receipt_type"]
          reference_number?: string | null
          source_warehouse_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          client_id?: string | null
          container_number?: string | null
          created_at?: string
          created_by?: string | null
          draft_count?: number | null
          draft_group_id?: string | null
          draft_pallet_barcode?: string | null
          draft_sequence?: number | null
          id?: string
          notes?: string | null
          po_number?: string | null
          receipt_number?: string
          receipt_type?: Database["public"]["Enums"]["receipt_type"]
          reference_number?: string | null
          source_warehouse_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_source_warehouse_id_fkey"
            columns: ["source_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      reorder_alerts: {
        Row: {
          available_quantity: number
          created_at: string
          daily_demand: number
          email_queued_at: string | null
          id: string
          product_id: string
          projected_lead_demand: number
          recommended_quantity: number
          reorder_point: number
          resolved_at: string | null
          status: string
          warehouse_id: string
        }
        Insert: {
          available_quantity?: number
          created_at?: string
          daily_demand?: number
          email_queued_at?: string | null
          id?: string
          product_id: string
          projected_lead_demand?: number
          recommended_quantity?: number
          reorder_point?: number
          resolved_at?: string | null
          status?: string
          warehouse_id: string
        }
        Update: {
          available_quantity?: number
          created_at?: string
          daily_demand?: number
          email_queued_at?: string | null
          id?: string
          product_id?: string
          projected_lead_demand?: number
          recommended_quantity?: number
          reorder_point?: number
          resolved_at?: string | null
          status?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reorder_alerts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reorder_alerts_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      reorder_forecast_settings: {
        Row: {
          alert_threshold_percent: number
          email_enabled: boolean
          id: boolean
          lookback_days: number
          safety_lead_days: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          alert_threshold_percent?: number
          email_enabled?: boolean
          id?: boolean
          lookback_days?: number
          safety_lead_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          alert_threshold_percent?: number
          email_enabled?: boolean
          id?: boolean
          lookback_days?: number
          safety_lead_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      replenishment_tasks: {
        Row: {
          assigned_user_id: string | null
          completed_at: string | null
          created_at: string
          from_location_id: string | null
          id: string
          product_id: string | null
          reorder_point: number
          status: Database["public"]["Enums"]["task_status"]
          target_quantity: number
          task_number: string
          to_location_id: string | null
          warehouse_id: string | null
        }
        Insert: {
          assigned_user_id?: string | null
          completed_at?: string | null
          created_at?: string
          from_location_id?: string | null
          id?: string
          product_id?: string | null
          reorder_point?: number
          status?: Database["public"]["Enums"]["task_status"]
          target_quantity?: number
          task_number: string
          to_location_id?: string | null
          warehouse_id?: string | null
        }
        Update: {
          assigned_user_id?: string | null
          completed_at?: string | null
          created_at?: string
          from_location_id?: string | null
          id?: string
          product_id?: string | null
          reorder_point?: number
          status?: Database["public"]["Enums"]["task_status"]
          target_quantity?: number
          task_number?: string
          to_location_id?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "replenishment_tasks_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "location_occupancy_view"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "replenishment_tasks_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replenishment_tasks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replenishment_tasks_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "location_occupancy_view"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "replenishment_tasks_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replenishment_tasks_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      report_definitions: {
        Row: {
          active: boolean
          audience: Database["public"]["Enums"]["app_role_code"][]
          code: string
          columns: Json
          created_at: string
          created_by: string | null
          filters: Json
          id: string
          name: string
          schedule_cron: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          audience?: Database["public"]["Enums"]["app_role_code"][]
          code: string
          columns?: Json
          created_at?: string
          created_by?: string | null
          filters?: Json
          id?: string
          name: string
          schedule_cron?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          audience?: Database["public"]["Enums"]["app_role_code"][]
          code?: string
          columns?: Json
          created_at?: string
          created_by?: string | null
          filters?: Json
          id?: string
          name?: string
          schedule_cron?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      report_exports: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          file_path: string | null
          id: string
          report_definition_id: string | null
          requested_by: string | null
          row_count: number | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          file_path?: string | null
          id?: string
          report_definition_id?: string | null
          requested_by?: string | null
          row_count?: number | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          file_path?: string | null
          id?: string
          report_definition_id?: string | null
          requested_by?: string | null
          row_count?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_exports_report_definition_id_fkey"
            columns: ["report_definition_id"]
            isOneToOne: false
            referencedRelation: "report_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      return_authorizations: {
        Row: {
          client_id: string | null
          completed_at: string | null
          created_at: string
          disposition: Database["public"]["Enums"]["quality_disposition"]
          id: string
          reason: string | null
          rma_number: string
          status: Database["public"]["Enums"]["task_status"]
          warehouse_id: string | null
        }
        Insert: {
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          disposition?: Database["public"]["Enums"]["quality_disposition"]
          id?: string
          reason?: string | null
          rma_number: string
          status?: Database["public"]["Enums"]["task_status"]
          warehouse_id?: string | null
        }
        Update: {
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          disposition?: Database["public"]["Enums"]["quality_disposition"]
          id?: string
          reason?: string | null
          rma_number?: string
          status?: Database["public"]["Enums"]["task_status"]
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "return_authorizations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_authorizations_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          can_edit: boolean
          can_view: boolean
          feature_id: string
          role_id: string
          updated_at: string
        }
        Insert: {
          can_edit?: boolean
          can_view?: boolean
          feature_id: string
          role_id: string
          updated_at?: string
        }
        Update: {
          can_edit?: boolean
          can_view?: boolean
          feature_id?: string
          role_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "permission_features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      staging_loads: {
        Row: {
          blocker: string | null
          created_at: string
          dock_appointment_id: string | null
          id: string
          load_sequence: number
          pick_list_id: string | null
          route_code: string
          status: string
          updated_at: string
        }
        Insert: {
          blocker?: string | null
          created_at?: string
          dock_appointment_id?: string | null
          id?: string
          load_sequence?: number
          pick_list_id?: string | null
          route_code: string
          status?: string
          updated_at?: string
        }
        Update: {
          blocker?: string | null
          created_at?: string
          dock_appointment_id?: string | null
          id?: string
          load_sequence?: number
          pick_list_id?: string | null
          route_code?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staging_loads_dock_appointment_id_fkey"
            columns: ["dock_appointment_id"]
            isOneToOne: false
            referencedRelation: "dock_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staging_loads_pick_list_id_fkey"
            columns: ["pick_list_id"]
            isOneToOne: false
            referencedRelation: "pick_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustments: {
        Row: {
          adjustment_number: string
          adjustment_type: string
          created_at: string
          created_by: string | null
          id: string
          inventory_balance_id: string | null
          new_status: Database["public"]["Enums"]["inventory_status"] | null
          old_status: Database["public"]["Enums"]["inventory_status"] | null
          pallet_id: string | null
          quantity_delta: number
          reason: string | null
          updated_at: string
        }
        Insert: {
          adjustment_number: string
          adjustment_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_balance_id?: string | null
          new_status?: Database["public"]["Enums"]["inventory_status"] | null
          old_status?: Database["public"]["Enums"]["inventory_status"] | null
          pallet_id?: string | null
          quantity_delta?: number
          reason?: string | null
          updated_at?: string
        }
        Update: {
          adjustment_number?: string
          adjustment_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_balance_id?: string | null
          new_status?: Database["public"]["Enums"]["inventory_status"] | null
          old_status?: Database["public"]["Enums"]["inventory_status"] | null
          pallet_id?: string | null
          quantity_delta?: number
          reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_inventory_balance_id_fkey"
            columns: ["inventory_balance_id"]
            isOneToOne: false
            referencedRelation: "inventory_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_inventory_balance_id_fkey"
            columns: ["inventory_balance_id"]
            isOneToOne: false
            referencedRelation: "inventory_search_view"
            referencedColumns: ["inventory_balance_id"]
          },
          {
            foreignKeyName: "stock_adjustments_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "inventory_search_view"
            referencedColumns: ["pallet_id"]
          },
          {
            foreignKeyName: "stock_adjustments_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "pallets"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      system_logs: {
        Row: {
          context: Json
          created_at: string
          created_by: string | null
          details: Json | null
          id: string
          level: Database["public"]["Enums"]["system_log_level"]
          log_type: string
          message: string
          record_count: number | null
          request_id: string | null
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          source: string
          table_name: string | null
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          context?: Json
          created_at?: string
          created_by?: string | null
          details?: Json | null
          id?: string
          level?: Database["public"]["Enums"]["system_log_level"]
          log_type?: string
          message?: string
          record_count?: number | null
          request_id?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source: string
          table_name?: string | null
          title: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          context?: Json
          created_at?: string
          created_by?: string | null
          details?: Json | null
          id?: string
          level?: Database["public"]["Enums"]["system_log_level"]
          log_type?: string
          message?: string
          record_count?: number | null
          request_id?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source?: string
          table_name?: string | null
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_logs_created_by_profiles_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      system_logs_archive: {
        Row: {
          archived_at: string
          archived_by: string | null
          created_at: string
          created_by: string | null
          details: Json | null
          id: string
          log_type: string
          message: string
          record_count: number | null
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          source: string | null
          table_name: string | null
          title: string
        }
        Insert: {
          archived_at?: string
          archived_by?: string | null
          created_at: string
          created_by?: string | null
          details?: Json | null
          id: string
          log_type: string
          message?: string
          record_count?: number | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity: string
          source?: string | null
          table_name?: string | null
          title: string
        }
        Update: {
          archived_at?: string
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          details?: Json | null
          id?: string
          log_type?: string
          message?: string
          record_count?: number | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source?: string | null
          table_name?: string | null
          title?: string
        }
        Relationships: []
      }
      transfer_lines: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          id: string
          inventory_lot_id: string | null
          pallet_id: string
          product_id: string
          quantity: number
          transfer_id: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_lot_id?: string | null
          pallet_id: string
          product_id: string
          quantity?: number
          transfer_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_lot_id?: string | null
          pallet_id?: string
          product_id?: string
          quantity?: number
          transfer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_lines_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_lines_inventory_lot_id_fkey"
            columns: ["inventory_lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_lines_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "inventory_search_view"
            referencedColumns: ["pallet_id"]
          },
          {
            foreignKeyName: "transfer_lines_pallet_id_fkey"
            columns: ["pallet_id"]
            isOneToOne: false
            referencedRelation: "pallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_lines_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      transfers: {
        Row: {
          created_at: string
          created_by: string | null
          destination_warehouse_id: string
          dispatched_at: string | null
          id: string
          notes: string | null
          received_at: string | null
          source_warehouse_id: string
          status: Database["public"]["Enums"]["task_status"]
          transfer_number: string
          transfer_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          destination_warehouse_id: string
          dispatched_at?: string | null
          id?: string
          notes?: string | null
          received_at?: string | null
          source_warehouse_id: string
          status?: Database["public"]["Enums"]["task_status"]
          transfer_number: string
          transfer_type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          destination_warehouse_id?: string
          dispatched_at?: string | null
          id?: string
          notes?: string | null
          received_at?: string | null
          source_warehouse_id?: string
          status?: Database["public"]["Enums"]["task_status"]
          transfer_number?: string
          transfer_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfers_destination_warehouse_id_fkey"
            columns: ["destination_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_source_warehouse_id_fkey"
            columns: ["source_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      user_action_events: {
        Row: {
          action: string
          duration_ms: number | null
          id: number
          metadata: Json
          occurred_at: string
          outcome: string
          route: string
          target: string | null
          user_id: string
          warehouse_id: string | null
        }
        Insert: {
          action: string
          duration_ms?: number | null
          id?: number
          metadata?: Json
          occurred_at?: string
          outcome?: string
          route?: string
          target?: string | null
          user_id?: string
          warehouse_id?: string | null
        }
        Update: {
          action?: string
          duration_ms?: number | null
          id?: number
          metadata?: Json
          occurred_at?: string
          outcome?: string
          route?: string
          target?: string | null
          user_id?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_action_events_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      user_habit_profiles: {
        Row: {
          active_hours: Json
          friction_points: Json
          sample_size: number
          top_actions: Json
          top_routes: Json
          updated_at: string
          user_id: string
          warehouse_id: string | null
          window_days: number
        }
        Insert: {
          active_hours?: Json
          friction_points?: Json
          sample_size?: number
          top_actions?: Json
          top_routes?: Json
          updated_at?: string
          user_id: string
          warehouse_id?: string | null
          window_days?: number
        }
        Update: {
          active_hours?: Json
          friction_points?: Json
          sample_size?: number
          top_actions?: Json
          top_routes?: Json
          updated_at?: string
          user_id?: string
          warehouse_id?: string | null
          window_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_habit_profiles_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      user_mobile_toolbar_preferences: {
        Row: {
          created_at: string
          module_flags: Json
          module_keys: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          module_flags?: Json
          module_keys?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          module_flags?: Json
          module_keys?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_mobile_toolbar_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          assigned_by: string | null
          created_at: string
          id: string
          is_hidden: boolean
          role_id: string
          user_id: string
          warehouse_id: string | null
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          is_hidden?: boolean
          role_id: string
          user_id: string
          warehouse_id?: string | null
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          is_hidden?: boolean
          role_id?: string
          user_id?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          active: boolean
          address_line_1: string | null
          address_line_2: string | null
          city: string | null
          clearance_safety_margin_mm: number
          code: string
          country: string | null
          created_at: string
          created_by: string | null
          freeze_default_hours: number
          has_cool_zone: boolean
          id: string
          is_hidden: boolean
          name: string
          supervisor_approval_cap: number
          updated_at: string
          variance_value_floor: number
        }
        Insert: {
          active?: boolean
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          clearance_safety_margin_mm?: number
          code: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          freeze_default_hours?: number
          has_cool_zone?: boolean
          id?: string
          is_hidden?: boolean
          name: string
          supervisor_approval_cap?: number
          updated_at?: string
          variance_value_floor?: number
        }
        Update: {
          active?: boolean
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          clearance_safety_margin_mm?: number
          code?: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          freeze_default_hours?: number
          has_cool_zone?: boolean
          id?: string
          is_hidden?: boolean
          name?: string
          supervisor_approval_cap?: number
          updated_at?: string
          variance_value_floor?: number
        }
        Relationships: []
      }
      work_templates: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          priority: number
          query_rules: Json
          step_rules: Json
          updated_at: string
          workflow: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          priority?: number
          query_rules?: Json
          step_rules?: Json
          updated_at?: string
          workflow: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          priority?: number
          query_rules?: Json
          step_rules?: Json
          updated_at?: string
          workflow?: string
        }
        Relationships: []
      }
      zones: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_dispatch: boolean
          is_hidden: boolean
          is_quarantine: boolean
          is_staging: boolean
          name: string
          notes: string | null
          sort_order: number
          temperature_class: Database["public"]["Enums"]["temperature_class"]
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_dispatch?: boolean
          is_hidden?: boolean
          is_quarantine?: boolean
          is_staging?: boolean
          name: string
          notes?: string | null
          sort_order?: number
          temperature_class?: Database["public"]["Enums"]["temperature_class"]
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_dispatch?: boolean
          is_hidden?: boolean
          is_quarantine?: boolean
          is_staging?: boolean
          name?: string
          notes?: string | null
          sort_order?: number
          temperature_class?: Database["public"]["Enums"]["temperature_class"]
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zones_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      inventory_search_view: {
        Row: {
          available_quantity: number | null
          batch_number: string | null
          client_code: string | null
          client_id: string | null
          client_name: string | null
          container_number: string | null
          correction_state: string | null
          damaged_quantity: number | null
          expiry_date: string | null
          height: number | null
          held_quantity: number | null
          inventory_balance_id: string | null
          length: number | null
          location_code: string | null
          location_id: string | null
          lot_number: string | null
          manufacture_date: string | null
          pallet_barcode: string | null
          pallet_code: string | null
          pallet_correction_state: string | null
          pallet_id: string | null
          po_number: string | null
          product_barcode: string | null
          product_family: string | null
          product_id: string | null
          product_name: string | null
          quantity: number | null
          received_at: string | null
          reserved_quantity: number | null
          rotation_method: Database["public"]["Enums"]["rotation_method"] | null
          sku: string | null
          status: Database["public"]["Enums"]["inventory_status"] | null
          temperature_requirement:
            | Database["public"]["Enums"]["temperature_class"]
            | null
          warehouse_code: string | null
          warehouse_id: string | null
          warehouse_name: string | null
          weight: number | null
          width: number | null
          zone_code: string | null
          zone_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_balances_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "location_occupancy_view"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "inventory_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      location_occupancy_view: {
        Row: {
          is_full: boolean | null
          location_code: string | null
          location_id: string | null
          location_type: Database["public"]["Enums"]["location_type"] | null
          max_pallets: number | null
          occupied_pallets: number | null
          temperature_class:
            | Database["public"]["Enums"]["temperature_class"]
            | null
          warehouse_code: string | null
          warehouse_id: string | null
          zone_code: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locations_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_ticket_queue: {
        Row: {
          actual_behavior: string | null
          agent_brief: string | null
          app_version: string | null
          assigned_to: string | null
          created_at: string | null
          event_count: number | null
          expected_behavior: string | null
          id: string | null
          kind: string | null
          labels: string[] | null
          module: string | null
          reported_by: string | null
          route: string | null
          severity: string | null
          status: string | null
          steps_to_reproduce: string | null
          submitted_at: string | null
          summary: string | null
          ticket_number: string | null
          title: string | null
          updated_at: string | null
          warehouse_id: string | null
        }
        Insert: {
          actual_behavior?: string | null
          agent_brief?: string | null
          app_version?: string | null
          assigned_to?: string | null
          created_at?: string | null
          event_count?: never
          expected_behavior?: string | null
          id?: string | null
          kind?: string | null
          labels?: string[] | null
          module?: string | null
          reported_by?: string | null
          route?: string | null
          severity?: string | null
          status?: string | null
          steps_to_reproduce?: string | null
          submitted_at?: string | null
          summary?: string | null
          ticket_number?: string | null
          title?: string | null
          updated_at?: string | null
          warehouse_id?: string | null
        }
        Update: {
          actual_behavior?: string | null
          agent_brief?: string | null
          app_version?: string | null
          assigned_to?: string | null
          created_at?: string | null
          event_count?: never
          expected_behavior?: string | null
          id?: string | null
          kind?: string | null
          labels?: string[] | null
          module?: string | null
          reported_by?: string | null
          route?: string | null
          severity?: string | null
          status?: string | null
          steps_to_reproduce?: string | null
          submitted_at?: string | null
          summary?: string | null
          ticket_number?: string | null
          title?: string | null
          updated_at?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operator_tickets_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _delete_guard_check: { Args: never; Returns: boolean }
      admin_delete_user: { Args: { in_user_id: string }; Returns: undefined }
      admin_invite_user: {
        Args: {
          in_email: string
          in_full_name: string
          in_password: string
          in_role_code?: string
          in_warehouse_id?: string
        }
        Returns: string
      }
      admin_sign_out_all_sessions: {
        Args: { in_user_id: string }
        Returns: undefined
      }
      admin_update_user_password: {
        Args: { in_password: string; in_user_id: string }
        Returns: undefined
      }
      admin_update_user_pin:
        | { Args: { in_pin: string; in_user_id: string }; Returns: undefined }
        | { Args: { in_pin: string; in_user_id: string }; Returns: undefined }
      archive_system_log: { Args: { in_id: string }; Returns: undefined }
      archive_system_logs_older_than: {
        Args: { in_days?: number }
        Returns: number
      }
      assert_location_not_frozen: {
        Args: { in_location_id: string; in_pallet_id?: string }
        Returns: undefined
      }
      begin_inventory_pallet_correction: {
        Args: { in_inventory_balance_id: string }
        Returns: {
          draft_id: string
          former_location_code: string
          replacement_pallet_barcode: string
        }[]
      }
      can_access_warehouse: {
        Args: { target_warehouse_id: string }
        Returns: boolean
      }
      cancel_cycle_count: {
        Args: { p_count_id: string; p_reason: string }
        Returns: Json
      }
      cancel_inventory_pallet_correction: {
        Args: { in_draft_id: string }
        Returns: undefined
      }
      cancel_receiving_draft: {
        Args: { in_draft_id: string; in_reason?: string }
        Returns: undefined
      }
      claim_cycle_count_line: {
        Args: { p_line_id: string }
        Returns: undefined
      }
      claim_integration_sync_jobs: {
        Args: { p_connection_id: string; p_limit: number }
        Returns: {
          attempts: number
          connection_id: string | null
          created_at: string
          error_message: string | null
          id: string
          idempotency_key: string
          job_type: string
          payload: Json
          result: Json | null
          status: Database["public"]["Enums"]["integration_job_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "integration_sync_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_inventory_pallet_correction: {
        Args: {
          in_draft_id: string
          in_expiry_date: string
          in_quantity: number
          in_still_at_former_location: boolean
        }
        Returns: {
          inventory_balance_id: string
          pallet_barcode: string
          pallet_id: string
          putaway_task_id: string
          putaway_task_number: string
        }[]
      }
      complete_inventory_pallet_correction_in_place: {
        Args: { in_draft_id: string; in_quantity: number }
        Returns: {
          inventory_balance_id: string
          pallet_barcode: string
          pallet_id: string
        }[]
      }
      confirm_pick_task: {
        Args: {
          in_allow_quantity_anomaly?: boolean
          in_allow_source_quantity_variance?: boolean
          in_confirm_source_override?: boolean
          in_confirmed_quantity: number
          in_pick_list_code: string
          in_scanned_pallet_barcode: string
          in_task_id: string
        }
        Returns: Json
      }
      confirm_receiving_draft_labels_printed: {
        Args: { in_draft_id: string }
        Returns: {
          pallet_barcode: string
          pallet_id: string
          putaway_task_id: string
          putaway_task_number: string
        }[]
      }
      create_pick_shortfall_task: {
        Args: { in_quantity: number; in_task_id: string }
        Returns: Json
      }
      delete_client_cascade: { Args: { in_id: string }; Returns: Json }
      delete_location_cascade: { Args: { in_id: string }; Returns: Json }
      delete_product_cascade: { Args: { in_id: string }; Returns: Json }
      delete_warehouse_cascade: { Args: { in_id: string }; Returns: Json }
      delete_zone_cascade: { Args: { in_id: string }; Returns: Json }
      directed_putaway_candidates: {
        Args: { in_pallet_id: string }
        Returns: {
          location_code: string
          location_id: string
          reason: string
          score: number
        }[]
      }
      effective_clearance_mm: {
        Args: { in_clearance_mm: number; in_margin_mm: number }
        Returns: number
      }
      evaluate_reorder_alert: {
        Args: { in_product_id: string; in_warehouse_id: string }
        Returns: undefined
      }
      get_deployment_licence: { Args: never; Returns: Json }
      get_or_create_unsubscribe_token: {
        Args: { in_email: string }
        Returns: string
      }
      has_any_role: {
        Args: { _roles: Database["public"]["Enums"]["app_role_code"][] }
        Returns: boolean
      }
      has_min_role: {
        Args: { _minimum_role: string; _user_id: string }
        Returns: boolean
      }
      has_role: { Args: { _role: string; _user_id: string }; Returns: boolean }
      has_unrestricted_warehouse_access: { Args: never; Returns: boolean }
      inventory_correction_code: {
        Args: { in_prefix: string }
        Returns: string
      }
      is_approved: { Args: never; Returns: boolean }
      location_clearance_mm: {
        Args: {
          in_max_height: number
          in_max_height_mm: number
          in_max_pallet_height_cm: number
        }
        Returns: number
      }
      log_audit_event: {
        Args: {
          in_entity_id: string
          in_entity_table: string
          in_event_type: string
          in_from_location_id?: string
          in_metadata?: Json
          in_pallet_id?: string
          in_to_location_id?: string
          in_warehouse_id?: string
        }
        Returns: string
      }
      next_operator_ticket_number: { Args: never; Returns: string }
      notification_email_shell: {
        Args: { in_body_html: string; in_title: string }
        Returns: string
      }
      operator_ticket_fallback_brief: {
        Args: { t: Database["public"]["Tables"]["operator_tickets"]["Row"] }
        Returns: string
      }
      pallet_height_mm: {
        Args: { in_height: number; in_standard_height_mm: number }
        Returns: number
      }
      pallet_in_accessible_transfer: {
        Args: { target_pallet_id: string }
        Returns: boolean
      }
      preview_pick_source_override: {
        Args: {
          in_pick_list_code: string
          in_scanned_pallet_barcode: string
          in_task_id: string
        }
        Returns: Json
      }
      product_quantity_totals: {
        Args: never
        Returns: {
          product_id: string
          total_quantity: number
        }[]
      }
      purge_expired_system_log_archive: { Args: never; Returns: number }
      reclaim_stale_integration_sync_jobs: { Args: never; Returns: number }
      reconcile_location_occupancy: {
        Args: { in_apply?: boolean; in_location_code: string }
        Returns: Json
      }
      record_user_action_events: { Args: { in_events: Json }; Returns: number }
      recover_missing_pallet_to_draft: {
        Args: { in_inventory_balance_id: string; in_quantity?: number }
        Returns: {
          draft_id: string
          draft_pallet_barcode: string
          quantity: number
        }[]
      }
      recover_missing_pallet_to_putaway: {
        Args: { in_inventory_balance_id: string }
        Returns: {
          pallet_barcode: string
          pallet_id: string
          putaway_task_id: string
          putaway_task_number: string
        }[]
      }
      refresh_reorder_alerts: { Args: never; Returns: undefined }
      refresh_user_habit_profile: {
        Args: { in_user_id?: string; in_window_days?: number }
        Returns: {
          active_hours: Json
          friction_points: Json
          sample_size: number
          top_actions: Json
          top_routes: Json
          updated_at: string
          user_id: string
          warehouse_id: string | null
          window_days: number
        }
        SetofOptions: {
          from: "*"
          to: "user_habit_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_cycle_count_line_claim: {
        Args: { p_line_id: string }
        Returns: undefined
      }
      render_notification_email: {
        Args: { in_data: Json; in_kind: string }
        Returns: {
          html_body: string
          subject: string
          text_body: string
        }[]
      }
      reset_wms_data: { Args: never; Returns: Json }
      return_putaway_to_receiving_draft: {
        Args: { in_task_id: string }
        Returns: {
          draft_id: string
          draft_pallet_barcode: string
        }[]
      }
      save_inventory_pallet_correction_as_draft: {
        Args: {
          in_draft_id: string
          in_expiry_date?: string
          in_expiry_provided?: boolean
          in_quantity?: number
        }
        Returns: {
          draft_id: string
          draft_pallet_barcode: string
          expiry_date: string
          quantity: number
        }[]
      }
      write_system_log: {
        Args: {
          in_details?: Json
          in_log_type: string
          in_message?: string
          in_record_count?: number
          in_severity: string
          in_source?: string
          in_table_name?: string
          in_title: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role_code:
        | "admin"
        | "warehouse_manager"
        | "inventory_clerk"
        | "warehouse_operator"
        | "dispatch_driver"
        | "dev"
        | "developer"
      count_line_status:
        | "queued"
        | "counted"
        | "recount"
        | "variance_hold"
        | "approved"
        | "adjusted"
        | "reconciled"
        | "exception"
      count_scope: "location" | "zone" | "sku" | "spot" | "abc"
      count_status:
        | "draft"
        | "frozen"
        | "counting"
        | "review"
        | "approved"
        | "closed"
        | "cancelled"
      freeze_status: "active" | "released" | "expired" | "overridden"
      integration_job_status:
        | "queued"
        | "running"
        | "succeeded"
        | "failed"
        | "dead_letter"
      integration_system: "netsuite" | "generic_rest"
      inventory_status:
        | "receiving"
        | "available"
        | "reserved"
        | "hold"
        | "quarantine"
        | "damaged"
        | "missing"
        | "in_transit"
        | "shipped"
        | "putaway"
      label_type:
        | "pallet"
        | "location"
        | "carton"
        | "count_sheet"
        | "pick_list"
        | "transfer_document"
      location_type:
        | "rack"
        | "staging"
        | "dispatch"
        | "quarantine"
        | "floor"
        | "dock"
        | "other"
      print_job_status: "queued" | "sent" | "printed" | "failed" | "cancelled"
      quality_disposition:
        | "pending"
        | "pass"
        | "fail"
        | "hold"
        | "release"
        | "scrap"
        | "return_to_vendor"
      receipt_type: "po" | "transfer" | "return" | "other"
      recommendation_status: "open" | "accepted" | "dismissed" | "resolved"
      rotation_method: "fifo" | "fefo" | "lifo"
      system_log_level: "debug" | "info" | "warning" | "error" | "critical"
      task_status:
        | "draft"
        | "queued"
        | "assigned"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "exception"
      temperature_class: "ambient" | "cool" | "frozen"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role_code: [
        "admin",
        "warehouse_manager",
        "inventory_clerk",
        "warehouse_operator",
        "dispatch_driver",
        "dev",
        "developer",
      ],
      count_line_status: [
        "queued",
        "counted",
        "recount",
        "variance_hold",
        "approved",
        "adjusted",
        "reconciled",
        "exception",
      ],
      count_scope: ["location", "zone", "sku", "spot", "abc"],
      count_status: [
        "draft",
        "frozen",
        "counting",
        "review",
        "approved",
        "closed",
        "cancelled",
      ],
      freeze_status: ["active", "released", "expired", "overridden"],
      integration_job_status: [
        "queued",
        "running",
        "succeeded",
        "failed",
        "dead_letter",
      ],
      integration_system: ["netsuite", "generic_rest"],
      inventory_status: [
        "receiving",
        "available",
        "reserved",
        "hold",
        "quarantine",
        "damaged",
        "missing",
        "in_transit",
        "shipped",
        "putaway",
      ],
      label_type: [
        "pallet",
        "location",
        "carton",
        "count_sheet",
        "pick_list",
        "transfer_document",
      ],
      location_type: [
        "rack",
        "staging",
        "dispatch",
        "quarantine",
        "floor",
        "dock",
        "other",
      ],
      print_job_status: ["queued", "sent", "printed", "failed", "cancelled"],
      quality_disposition: [
        "pending",
        "pass",
        "fail",
        "hold",
        "release",
        "scrap",
        "return_to_vendor",
      ],
      receipt_type: ["po", "transfer", "return", "other"],
      recommendation_status: ["open", "accepted", "dismissed", "resolved"],
      rotation_method: ["fifo", "fefo", "lifo"],
      system_log_level: ["debug", "info", "warning", "error", "critical"],
      task_status: [
        "draft",
        "queued",
        "assigned",
        "in_progress",
        "completed",
        "cancelled",
        "exception",
      ],
      temperature_class: ["ambient", "cool", "frozen"],
    },
  },
} as const
