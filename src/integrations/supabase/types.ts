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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
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
      cycle_count_lines: {
        Row: {
          counted_quantity: number | null
          created_at: string
          created_by: string | null
          cycle_count_id: string
          expected_quantity: number
          id: string
          location_id: string | null
          notes: string | null
          pallet_id: string | null
          product_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          updated_at: string
          variance_percent: number | null
          variance_quantity: number | null
        }
        Insert: {
          counted_quantity?: number | null
          created_at?: string
          created_by?: string | null
          cycle_count_id: string
          expected_quantity?: number
          id?: string
          location_id?: string | null
          notes?: string | null
          pallet_id?: string | null
          product_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string
          variance_percent?: number | null
          variance_quantity?: number | null
        }
        Update: {
          counted_quantity?: number | null
          created_at?: string
          created_by?: string | null
          cycle_count_id?: string
          expected_quantity?: number
          id?: string
          location_id?: string | null
          notes?: string | null
          pallet_id?: string | null
          product_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string
          variance_percent?: number | null
          variance_quantity?: number | null
        }
        Relationships: [
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
      cycle_counts: {
        Row: {
          assigned_user_id: string | null
          count_number: string
          created_at: string
          created_by: string | null
          id: string
          location_id: string | null
          notes: string | null
          scope: Database["public"]["Enums"]["count_scope"]
          status: Database["public"]["Enums"]["task_status"]
          updated_at: string
          variance_threshold_percent: number
          warehouse_id: string
          zone_id: string | null
        }
        Insert: {
          assigned_user_id?: string | null
          count_number: string
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string | null
          notes?: string | null
          scope?: Database["public"]["Enums"]["count_scope"]
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string
          variance_threshold_percent?: number
          warehouse_id: string
          zone_id?: string | null
        }
        Update: {
          assigned_user_id?: string | null
          count_number?: string
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string | null
          notes?: string | null
          scope?: Database["public"]["Enums"]["count_scope"]
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string
          variance_threshold_percent?: number
          warehouse_id?: string
          zone_id?: string | null
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
          location_type: Database["public"]["Enums"]["location_type"]
          max_height: number | null
          max_length: number | null
          max_pallets: number
          max_weight: number | null
          max_width: number | null
          mixed_lot_allowed: boolean
          mixed_sku_allowed: boolean
          notes: string | null
          pick_sequence: number | null
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
          location_type?: Database["public"]["Enums"]["location_type"]
          max_height?: number | null
          max_length?: number | null
          max_pallets?: number
          max_weight?: number | null
          max_width?: number | null
          mixed_lot_allowed?: boolean
          mixed_sku_allowed?: boolean
          notes?: string | null
          pick_sequence?: number | null
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
          location_type?: Database["public"]["Enums"]["location_type"]
          max_height?: number | null
          max_length?: number | null
          max_pallets?: number
          max_weight?: number | null
          max_width?: number | null
          mixed_lot_allowed?: boolean
          mixed_sku_allowed?: boolean
          notes?: string | null
          pick_sequence?: number | null
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
          stack_height: number | null
          status: Database["public"]["Enums"]["inventory_status"]
          updated_at: string
          weight: number | null
          width: number | null
        }
        Insert: {
          available_quantity?: number
          client_id?: string | null
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
          stack_height?: number | null
          status?: Database["public"]["Enums"]["inventory_status"]
          updated_at?: string
          weight?: number | null
          width?: number | null
        }
        Update: {
          available_quantity?: number
          client_id?: string | null
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
          stack_height?: number | null
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
        ]
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
          pallet_id: string | null
          pick_list_id: string
          requested_quantity: number
          short_reason: string | null
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
          pallet_id?: string | null
          pick_list_id: string
          requested_quantity?: number
          short_reason?: string | null
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
          pallet_id?: string | null
          pick_list_id?: string
          requested_quantity?: number
          short_reason?: string | null
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
          created_at: string
          created_by: string | null
          height: number | null
          id: string
          is_default: boolean
          is_hidden: boolean
          length: number | null
          package_type: string | null
          product_id: string
          profile_name: string
          units_per_package: number
          updated_at: string
          weight: number | null
          width: number | null
        }
        Insert: {
          barcode?: string | null
          created_at?: string
          created_by?: string | null
          height?: number | null
          id?: string
          is_default?: boolean
          is_hidden?: boolean
          length?: number | null
          package_type?: string | null
          product_id: string
          profile_name: string
          units_per_package?: number
          updated_at?: string
          weight?: number | null
          width?: number | null
        }
        Update: {
          barcode?: string | null
          created_at?: string
          created_by?: string | null
          height?: number | null
          id?: string
          is_default?: boolean
          is_hidden?: boolean
          length?: number | null
          package_type?: string | null
          product_id?: string
          profile_name?: string
          units_per_package?: number
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
          name: string
          product_family: string | null
          rotation_method: Database["public"]["Enums"]["rotation_method"]
          sku: string
          stackable: boolean
          temperature_requirement: Database["public"]["Enums"]["temperature_class"]
          updated_at: string
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
          name: string
          product_family?: string | null
          rotation_method?: Database["public"]["Enums"]["rotation_method"]
          sku: string
          stackable?: boolean
          temperature_requirement?: Database["public"]["Enums"]["temperature_class"]
          updated_at?: string
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
          name?: string
          product_family?: string | null
          rotation_method?: Database["public"]["Enums"]["rotation_method"]
          sku?: string
          stackable?: boolean
          temperature_requirement?: Database["public"]["Enums"]["temperature_class"]
          updated_at?: string
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
          created_at: string
          default_warehouse_id: string | null
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          approved?: boolean
          created_at?: string
          default_warehouse_id?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          approved?: boolean
          created_at?: string
          default_warehouse_id?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
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
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
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
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
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
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
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
            referencedRelation: "pallets"
            referencedColumns: ["id"]
          },
        ]
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
      user_roles: {
        Row: {
          created_at: string
          id: string
          is_hidden: boolean
          role_id: string
          user_id: string
          warehouse_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_hidden?: boolean
          role_id: string
          user_id: string
          warehouse_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_hidden?: boolean
          role_id?: string
          user_id?: string
          warehouse_id?: string | null
        }
        Relationships: [
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
          code: string
          country: string | null
          created_at: string
          created_by: string | null
          has_cool_zone: boolean
          id: string
          is_hidden: boolean
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          code: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          has_cool_zone?: boolean
          id?: string
          is_hidden?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          code?: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          has_cool_zone?: boolean
          id?: string
          is_hidden?: boolean
          name?: string
          updated_at?: string
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
          client_name: string | null
          damaged_quantity: number | null
          expiry_date: string | null
          height: number | null
          held_quantity: number | null
          inventory_balance_id: string | null
          length: number | null
          location_code: string | null
          lot_number: string | null
          manufacture_date: string | null
          pallet_barcode: string | null
          pallet_code: string | null
          product_barcode: string | null
          product_family: string | null
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
          warehouse_name: string | null
          weight: number | null
          width: number | null
          zone_code: string | null
          zone_name: string | null
        }
        Relationships: []
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
          zone_code: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      has_any_role: {
        Args: { _roles: Database["public"]["Enums"]["app_role_code"][] }
        Returns: boolean
      }
      has_role: { Args: { _role: string; _user_id: string }; Returns: boolean }
      is_approved: { Args: never; Returns: boolean }
    }
    Enums: {
      app_role_code:
        | "admin"
        | "warehouse_manager"
        | "inventory_clerk"
        | "warehouse_operator"
        | "dispatch_driver"
      count_scope: "location" | "zone" | "sku" | "spot"
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
      app_role_code: [
        "admin",
        "warehouse_manager",
        "inventory_clerk",
        "warehouse_operator",
        "dispatch_driver",
      ],
      count_scope: ["location", "zone", "sku", "spot"],
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
