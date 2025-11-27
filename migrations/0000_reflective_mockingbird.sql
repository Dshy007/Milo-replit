CREATE TYPE "public"."pattern_group" AS ENUM('sunWed', 'wedSat');--> statement-breakpoint
CREATE TABLE "ai_chat_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tokens_used" integer,
	"tool_calls" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_chat_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"title" text,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_query_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"query" text NOT NULL,
	"context" jsonb,
	"response" text NOT NULL,
	"tokens_used" integer,
	"response_time_ms" integer,
	"helpful" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_results" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"analysis_type" text NOT NULL,
	"input_data" jsonb,
	"result" jsonb NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"execution_time_ms" integer,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"block_id" varchar NOT NULL,
	"driver_id" varchar NOT NULL,
	"contract_id" varchar NOT NULL,
	"start_timestamp" timestamp NOT NULL,
	"canonical_start" timestamp NOT NULL,
	"pattern_group" "pattern_group" NOT NULL,
	"cycle_id" text NOT NULL,
	"bump_minutes" integer DEFAULT 0 NOT NULL,
	"is_auto_assigned" boolean DEFAULT false NOT NULL,
	"confidence_score" integer,
	"assignment_source" text DEFAULT 'manual' NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"assigned_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_patterns" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"block_signature" text NOT NULL,
	"driver_id" varchar NOT NULL,
	"weighted_count" numeric(10, 4) DEFAULT '0' NOT NULL,
	"raw_count" integer DEFAULT 0 NOT NULL,
	"last_assigned" timestamp,
	"confidence" numeric(5, 4) DEFAULT '0' NOT NULL,
	"decay_factor" numeric(5, 4) DEFAULT '0.8660' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_predictions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"shift_occurrence_id" varchar,
	"block_id" text,
	"recommended_driver_id" varchar,
	"confidence_score" numeric(5, 2),
	"reasons" text[],
	"alternative_drivers" jsonb,
	"applied_to_schedule" boolean DEFAULT false,
	"applied_at" timestamp,
	"applied_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auto_build_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"target_week_start" timestamp NOT NULL,
	"target_week_end" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"suggestions" text NOT NULL,
	"total_blocks" integer DEFAULT 0 NOT NULL,
	"high_confidence" integer DEFAULT 0 NOT NULL,
	"medium_confidence" integer DEFAULT 0 NOT NULL,
	"low_confidence" integer DEFAULT 0 NOT NULL,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_by" varchar,
	"reviewed_at" timestamp,
	"approved_block_ids" text[],
	"notes" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "auto_build_status_check" CHECK ("auto_build_runs"."status" IN ('pending', 'approved', 'rejected', 'partial'))
);
--> statement-breakpoint
CREATE TABLE "block_assignments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"block_id" varchar,
	"shift_occurrence_id" varchar,
	"driver_id" varchar NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"assigned_by" varchar,
	"notes" text,
	"validation_status" text DEFAULT 'valid' NOT NULL,
	"validation_summary" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp,
	"import_batch_id" text,
	"amazon_block_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"block_id" text NOT NULL,
	"service_date" timestamp NOT NULL,
	"contract_id" varchar NOT NULL,
	"start_timestamp" timestamp NOT NULL,
	"end_timestamp" timestamp NOT NULL,
	"tractor_id" text NOT NULL,
	"solo_type" text NOT NULL,
	"duration" integer NOT NULL,
	"status" text DEFAULT 'unassigned' NOT NULL,
	"is_carryover" boolean DEFAULT false NOT NULL,
	"on_bench_status" text DEFAULT 'on_bench' NOT NULL,
	"off_bench_reason" text,
	"pattern_group" "pattern_group",
	"canonical_start" timestamp,
	"cycle_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"start_time" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"tractor_id" text NOT NULL,
	"domicile" text DEFAULT '',
	"duration" integer NOT NULL,
	"base_routes" integer NOT NULL,
	"days_per_week" integer DEFAULT 6 NOT NULL,
	"protected_drivers" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_availability_preferences" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"driver_id" varchar NOT NULL,
	"block_type" text NOT NULL,
	"start_time" text NOT NULL,
	"day_of_week" text NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_contract_stats" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"driver_id" varchar NOT NULL,
	"contract_id" varchar NOT NULL,
	"pattern_group" "pattern_group" NOT NULL,
	"last_worked" timestamp,
	"total_assignments" integer DEFAULT 0 NOT NULL,
	"streak_count" integer DEFAULT 0 NOT NULL,
	"avg_bump_minutes" integer DEFAULT 0 NOT NULL,
	"last_cycle_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"license_number" text,
	"license_expiry" timestamp,
	"phone_number" text,
	"email" text,
	"domicile" text,
	"profile_verified" boolean DEFAULT false,
	"load_eligible" boolean DEFAULT true,
	"status" text DEFAULT 'active' NOT NULL,
	"certifications" text[],
	"requires_dot_compliance" boolean DEFAULT false,
	"cdl_class" text,
	"medical_cert_expiry" timestamp,
	"date_of_birth" timestamp,
	"endorsements" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"schedule_id" varchar,
	"load_number" text NOT NULL,
	"pickup_location" text NOT NULL,
	"delivery_location" text NOT NULL,
	"pickup_time" timestamp NOT NULL,
	"delivery_time" timestamp NOT NULL,
	"weight" numeric(10, 2),
	"description" text,
	"hazmat_class" text,
	"requires_placard" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "loads_load_number_unique" UNIQUE("load_number")
);
--> statement-breakpoint
CREATE TABLE "protected_driver_rules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"driver_id" varchar NOT NULL,
	"rule_name" text NOT NULL,
	"rule_type" text NOT NULL,
	"blocked_days" text[],
	"allowed_days" text[],
	"allowed_solo_types" text[],
	"allowed_start_times" text[],
	"max_start_time" text,
	"is_weekday_only" boolean DEFAULT false NOT NULL,
	"effective_from" timestamp,
	"effective_to" timestamp,
	"is_protected" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rule_type_check" CHECK ("protected_driver_rules"."rule_type" IN ('day_restriction', 'time_restriction', 'solo_restriction'))
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"name" text NOT NULL,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"distance" numeric(10, 2),
	"estimated_duration" integer,
	"max_weight" integer,
	"hazmat_allowed" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"driver_id" varchar NOT NULL,
	"truck_id" varchar,
	"route_id" varchar,
	"contract_id" varchar,
	"scheduled_date" timestamp NOT NULL,
	"start_time" timestamp,
	"end_time" timestamp,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_occurrences" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"template_id" varchar NOT NULL,
	"service_date" date NOT NULL,
	"scheduled_start" timestamp NOT NULL,
	"scheduled_end" timestamp NOT NULL,
	"actual_start" timestamp,
	"actual_end" timestamp,
	"tractor_id" text,
	"external_block_id" text,
	"status" text DEFAULT 'unassigned' NOT NULL,
	"is_carryover" boolean DEFAULT false NOT NULL,
	"import_batch_id" text,
	"pattern_group" "pattern_group",
	"cycle_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"operator_id" text NOT NULL,
	"contract_id" varchar NOT NULL,
	"canonical_start_time" text NOT NULL,
	"default_duration" integer NOT NULL,
	"default_tractor_id" text,
	"solo_type" text NOT NULL,
	"pattern_group" "pattern_group",
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "special_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"driver_id" varchar NOT NULL,
	"availability_type" text,
	"start_date" timestamp,
	"end_date" timestamp,
	"start_time" text,
	"end_time" text,
	"block_type" text,
	"contract_id" varchar,
	"is_recurring" boolean DEFAULT false,
	"recurring_pattern" text,
	"recurring_days" text[],
	"reason" text,
	"status" text DEFAULT 'approved',
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp,
	"reviewed_by" varchar,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"request_type" text,
	"affected_date" timestamp,
	"affected_block_id" varchar,
	"swap_candidate_id" varchar,
	CONSTRAINT "availability_type_check" CHECK ("special_requests"."availability_type" IN ('available', 'unavailable')),
	CONSTRAINT "status_check" CHECK ("special_requests"."status" IN ('approved', 'cancelled', 'pending', 'rejected')),
	CONSTRAINT "recurring_pattern_check" CHECK ("special_requests"."recurring_pattern" IS NULL OR "special_requests"."recurring_pattern" IN ('every_monday', 'every_tuesday', 'every_wednesday', 'every_thursday', 'every_friday', 'every_saturday', 'every_sunday', 'every_weekend', 'every_week', 'custom')),
	CONSTRAINT "block_type_check" CHECK ("special_requests"."block_type" IS NULL OR "special_requests"."block_type" IN ('solo1', 'solo2', 'team'))
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trucks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"truck_number" text NOT NULL,
	"type" text,
	"make" text,
	"model" text,
	"year" integer,
	"fuel" text,
	"vin" text,
	"license_plate" text,
	"last_known_location" text,
	"status" text DEFAULT 'available' NOT NULL,
	"compliance_status" text DEFAULT 'pending' NOT NULL,
	"last_inspection" timestamp,
	"next_inspection" timestamp,
	"usdot_number" text,
	"gvwr" integer,
	"registration_expiry" timestamp,
	"insurance_expiry" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_session_id_ai_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_sessions" ADD CONSTRAINT "ai_chat_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_sessions" ADD CONSTRAINT "ai_chat_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_query_history" ADD CONSTRAINT "ai_query_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_query_history" ADD CONSTRAINT "ai_query_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_patterns" ADD CONSTRAINT "assignment_patterns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_patterns" ADD CONSTRAINT "assignment_patterns_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_predictions" ADD CONSTRAINT "assignment_predictions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_predictions" ADD CONSTRAINT "assignment_predictions_shift_occurrence_id_shift_occurrences_id_fk" FOREIGN KEY ("shift_occurrence_id") REFERENCES "public"."shift_occurrences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_predictions" ADD CONSTRAINT "assignment_predictions_recommended_driver_id_drivers_id_fk" FOREIGN KEY ("recommended_driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_predictions" ADD CONSTRAINT "assignment_predictions_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_build_runs" ADD CONSTRAINT "auto_build_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_build_runs" ADD CONSTRAINT "auto_build_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_build_runs" ADD CONSTRAINT "auto_build_runs_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_assignments" ADD CONSTRAINT "block_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_assignments" ADD CONSTRAINT "block_assignments_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_assignments" ADD CONSTRAINT "block_assignments_shift_occurrence_id_shift_occurrences_id_fk" FOREIGN KEY ("shift_occurrence_id") REFERENCES "public"."shift_occurrences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_assignments" ADD CONSTRAINT "block_assignments_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_assignments" ADD CONSTRAINT "block_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_availability_preferences" ADD CONSTRAINT "driver_availability_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_availability_preferences" ADD CONSTRAINT "driver_availability_preferences_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_contract_stats" ADD CONSTRAINT "driver_contract_stats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_contract_stats" ADD CONSTRAINT "driver_contract_stats_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_contract_stats" ADD CONSTRAINT "driver_contract_stats_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protected_driver_rules" ADD CONSTRAINT "protected_driver_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protected_driver_rules" ADD CONSTRAINT "protected_driver_rules_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_occurrences" ADD CONSTRAINT "shift_occurrences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_occurrences" ADD CONSTRAINT "shift_occurrences_template_id_shift_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."shift_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_requests" ADD CONSTRAINT "special_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_requests" ADD CONSTRAINT "special_requests_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_requests" ADD CONSTRAINT "special_requests_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_requests" ADD CONSTRAINT "special_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_requests" ADD CONSTRAINT "special_requests_affected_block_id_blocks_id_fk" FOREIGN KEY ("affected_block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_requests" ADD CONSTRAINT "special_requests_swap_candidate_id_drivers_id_fk" FOREIGN KEY ("swap_candidate_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_chat_messages_session_idx" ON "ai_chat_messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "ai_chat_messages_created_at_idx" ON "ai_chat_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_chat_sessions_user_idx" ON "ai_chat_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_chat_sessions_last_message_idx" ON "ai_chat_sessions" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "ai_chat_sessions_active_idx" ON "ai_chat_sessions" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "ai_query_user_idx" ON "ai_query_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_query_created_at_idx" ON "ai_query_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "analysis_results_type_idx" ON "analysis_results" USING btree ("analysis_type");--> statement-breakpoint
CREATE INDEX "analysis_results_created_at_idx" ON "analysis_results" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "assignment_history_driver_pattern_idx" ON "assignment_history" USING btree ("tenant_id","driver_id","pattern_group","cycle_id");--> statement-breakpoint
CREATE INDEX "assignment_history_contract_idx" ON "assignment_history" USING btree ("contract_id","pattern_group");--> statement-breakpoint
CREATE INDEX "assignment_history_time_idx" ON "assignment_history" USING btree ("assigned_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_patterns_tenant_sig_driver_idx" ON "assignment_patterns" USING btree ("tenant_id","block_signature","driver_id");--> statement-breakpoint
CREATE INDEX "assignment_patterns_block_sig_idx" ON "assignment_patterns" USING btree ("block_signature");--> statement-breakpoint
CREATE INDEX "assignment_patterns_driver_id_idx" ON "assignment_patterns" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "assignment_patterns_confidence_idx" ON "assignment_patterns" USING btree ("confidence");--> statement-breakpoint
CREATE INDEX "predictions_occurrence_idx" ON "assignment_predictions" USING btree ("shift_occurrence_id");--> statement-breakpoint
CREATE INDEX "predictions_driver_idx" ON "assignment_predictions" USING btree ("recommended_driver_id");--> statement-breakpoint
CREATE INDEX "predictions_applied_idx" ON "assignment_predictions" USING btree ("applied_to_schedule");--> statement-breakpoint
CREATE INDEX "auto_build_runs_target_week_idx" ON "auto_build_runs" USING btree ("target_week_start","target_week_end");--> statement-breakpoint
CREATE INDEX "auto_build_runs_status_idx" ON "auto_build_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "block_assignments_tenant_block_idx" ON "block_assignments" USING btree ("tenant_id","block_id") WHERE "block_assignments"."is_active" = true AND "block_assignments"."block_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "block_assignments_tenant_shift_idx" ON "block_assignments" USING btree ("tenant_id","shift_occurrence_id") WHERE "block_assignments"."is_active" = true AND "block_assignments"."shift_occurrence_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "block_assignments_driver_id_idx" ON "block_assignments" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "block_assignments_driver_time_idx" ON "block_assignments" USING btree ("tenant_id","driver_id","assigned_at");--> statement-breakpoint
CREATE INDEX "block_assignments_shift_occurrence_id_idx" ON "block_assignments" USING btree ("shift_occurrence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blocks_tenant_block_servicedate_idx" ON "blocks" USING btree ("tenant_id","block_id","service_date");--> statement-breakpoint
CREATE INDEX "blocks_time_range_idx" ON "blocks" USING btree ("start_timestamp","end_timestamp");--> statement-breakpoint
CREATE INDEX "blocks_pattern_idx" ON "blocks" USING btree ("pattern_group","cycle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_pref_unique_idx" ON "driver_availability_preferences" USING btree ("driver_id","block_type","start_time","day_of_week");--> statement-breakpoint
CREATE INDEX "driver_pref_driver_idx" ON "driver_availability_preferences" USING btree ("driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_contract_stats_unique_idx" ON "driver_contract_stats" USING btree ("tenant_id","driver_id","contract_id","pattern_group");--> statement-breakpoint
CREATE INDEX "driver_contract_stats_driver_idx" ON "driver_contract_stats" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "driver_contract_stats_contract_pattern_idx" ON "driver_contract_stats" USING btree ("contract_id","pattern_group");--> statement-breakpoint
CREATE UNIQUE INDEX "protected_driver_rules_tenant_driver_name_idx" ON "protected_driver_rules" USING btree ("tenant_id","driver_id","rule_name");--> statement-breakpoint
CREATE INDEX "protected_driver_rules_driver_id_idx" ON "protected_driver_rules" USING btree ("driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_occurrences_tenant_template_date_idx" ON "shift_occurrences" USING btree ("tenant_id","template_id","service_date");--> statement-breakpoint
CREATE INDEX "shift_occurrences_time_range_idx" ON "shift_occurrences" USING btree ("scheduled_start","scheduled_end");--> statement-breakpoint
CREATE INDEX "shift_occurrences_pattern_idx" ON "shift_occurrences" USING btree ("pattern_group","cycle_id");--> statement-breakpoint
CREATE INDEX "shift_occurrences_external_block_id_idx" ON "shift_occurrences" USING btree ("external_block_id");--> statement-breakpoint
CREATE INDEX "shift_occurrences_template_date_idx" ON "shift_occurrences" USING btree ("template_id","service_date");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_templates_tenant_operator_idx" ON "shift_templates" USING btree ("tenant_id","operator_id");--> statement-breakpoint
CREATE INDEX "shift_templates_contract_id_idx" ON "shift_templates" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "special_requests_driver_id_idx" ON "special_requests" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "special_requests_start_date_idx" ON "special_requests" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "special_requests_end_date_idx" ON "special_requests" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX "special_requests_is_recurring_idx" ON "special_requests" USING btree ("is_recurring");--> statement-breakpoint
CREATE INDEX "special_requests_status_idx" ON "special_requests" USING btree ("status");