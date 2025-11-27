CREATE TABLE "neural_agents" (
	"id" varchar PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"system_prompt" text NOT NULL,
	"capabilities" text[],
	"status" text DEFAULT 'active' NOT NULL,
	"last_health_check" timestamp,
	"config" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "neural_decisions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"session_id" varchar,
	"thought_id" varchar,
	"agent_id" varchar NOT NULL,
	"decision" text NOT NULL,
	"reasoning" jsonb NOT NULL,
	"action_taken" jsonb,
	"dot_status" text,
	"protected_rule_check" jsonb,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"outcome_notes" text,
	"user_feedback" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "neural_patterns" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"pattern_type" text NOT NULL,
	"subject_id" varchar,
	"subject_type" text,
	"pattern" text NOT NULL,
	"confidence" integer DEFAULT 50 NOT NULL,
	"observations" integer DEFAULT 1 NOT NULL,
	"last_observed" timestamp DEFAULT now() NOT NULL,
	"first_observed" timestamp DEFAULT now() NOT NULL,
	"evidence" jsonb,
	"status" text DEFAULT 'hypothesis' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "neural_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" varchar NOT NULL,
	"learned_traits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"interaction_count" integer DEFAULT 0 NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "neural_routing" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"session_id" varchar,
	"user_input" text NOT NULL,
	"detected_intent" text NOT NULL,
	"routed_to" varchar NOT NULL,
	"routing_reason" text NOT NULL,
	"fallback_chain" jsonb,
	"response_time_ms" integer,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "neural_thoughts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"parent_id" varchar,
	"agent_id" varchar NOT NULL,
	"session_id" varchar,
	"thought_type" text NOT NULL,
	"content" text NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'exploring' NOT NULL,
	"evidence" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "neural_decisions" ADD CONSTRAINT "neural_decisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "neural_decisions" ADD CONSTRAINT "neural_decisions_session_id_ai_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_chat_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "neural_decisions" ADD CONSTRAINT "neural_decisions_thought_id_neural_thoughts_id_fk" FOREIGN KEY ("thought_id") REFERENCES "public"."neural_thoughts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "neural_decisions" ADD CONSTRAINT "neural_decisions_agent_id_neural_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."neural_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "neural_patterns" ADD CONSTRAINT "neural_patterns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "neural_profiles" ADD CONSTRAINT "neural_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "neural_routing" ADD CONSTRAINT "neural_routing_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "neural_routing" ADD CONSTRAINT "neural_routing_session_id_ai_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_chat_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "neural_routing" ADD CONSTRAINT "neural_routing_routed_to_neural_agents_id_fk" FOREIGN KEY ("routed_to") REFERENCES "public"."neural_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "neural_thoughts" ADD CONSTRAINT "neural_thoughts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "neural_thoughts" ADD CONSTRAINT "neural_thoughts_agent_id_neural_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."neural_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "neural_thoughts" ADD CONSTRAINT "neural_thoughts_session_id_ai_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_chat_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "neural_decisions_tenant_idx" ON "neural_decisions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "neural_decisions_session_idx" ON "neural_decisions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "neural_decisions_outcome_idx" ON "neural_decisions" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "neural_decisions_agent_idx" ON "neural_decisions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "neural_patterns_tenant_idx" ON "neural_patterns" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "neural_patterns_type_idx" ON "neural_patterns" USING btree ("pattern_type");--> statement-breakpoint
CREATE INDEX "neural_patterns_subject_idx" ON "neural_patterns" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "neural_patterns_status_idx" ON "neural_patterns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "neural_patterns_confidence_idx" ON "neural_patterns" USING btree ("confidence");--> statement-breakpoint
CREATE INDEX "neural_profiles_tenant_idx" ON "neural_profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "neural_profiles_entity_idx" ON "neural_profiles" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "neural_profiles_unique" ON "neural_profiles" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "neural_routing_tenant_idx" ON "neural_routing" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "neural_routing_intent_idx" ON "neural_routing" USING btree ("detected_intent");--> statement-breakpoint
CREATE INDEX "neural_routing_agent_idx" ON "neural_routing" USING btree ("routed_to");--> statement-breakpoint
CREATE INDEX "neural_routing_session_idx" ON "neural_routing" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "neural_thoughts_tenant_idx" ON "neural_thoughts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "neural_thoughts_parent_idx" ON "neural_thoughts" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "neural_thoughts_session_idx" ON "neural_thoughts" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "neural_thoughts_status_idx" ON "neural_thoughts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "neural_thoughts_expires_idx" ON "neural_thoughts" USING btree ("expires_at");