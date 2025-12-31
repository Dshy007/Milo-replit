-- Fleet Communication Tables
-- Drop-In Sessions & Driver Presence

-- Drop-In Sessions (Jitsi calls between dispatch and drivers)
CREATE TABLE IF NOT EXISTS "drop_in_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"dispatcher_id" varchar NOT NULL,
	"driver_id" varchar NOT NULL,
	"jitsi_room_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"duration_seconds" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Driver Presence Tracking (Real-time online/offline status)
CREATE TABLE IF NOT EXISTS "driver_presence" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"driver_id" varchar NOT NULL,
	"is_online" boolean DEFAULT false NOT NULL,
	"last_seen" timestamp DEFAULT now() NOT NULL,
	"connection_id" text,
	"device_info" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Foreign Keys for drop_in_sessions
ALTER TABLE "drop_in_sessions" ADD CONSTRAINT "drop_in_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_in_sessions" ADD CONSTRAINT "drop_in_sessions_dispatcher_id_users_id_fk" FOREIGN KEY ("dispatcher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_in_sessions" ADD CONSTRAINT "drop_in_sessions_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Foreign Keys for driver_presence
ALTER TABLE "driver_presence" ADD CONSTRAINT "driver_presence_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_presence" ADD CONSTRAINT "driver_presence_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Indexes for driver_presence
CREATE UNIQUE INDEX IF NOT EXISTS "driver_presence_tenant_driver_idx" ON "driver_presence" USING btree ("tenant_id","driver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_presence_online_idx" ON "driver_presence" USING btree ("is_online");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_presence_last_seen_idx" ON "driver_presence" USING btree ("last_seen");--> statement-breakpoint

-- Indexes for drop_in_sessions
CREATE INDEX IF NOT EXISTS "drop_in_sessions_tenant_idx" ON "drop_in_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drop_in_sessions_driver_idx" ON "drop_in_sessions" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drop_in_sessions_dispatcher_idx" ON "drop_in_sessions" USING btree ("dispatcher_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drop_in_sessions_status_idx" ON "drop_in_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drop_in_sessions_started_idx" ON "drop_in_sessions" USING btree ("started_at");
