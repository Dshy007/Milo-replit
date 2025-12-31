-- Voice Broadcasts Table (for Twilio phone calls)
CREATE TABLE IF NOT EXISTS "voice_broadcasts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"driver_id" varchar NOT NULL,
	"block_id" varchar,
	"trip_id" varchar,
	"broadcast_type" text NOT NULL,
	"phone_number" text NOT NULL,
	"message" text NOT NULL,
	"twilio_call_sid" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"scheduled_for" timestamp,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"completed_at" timestamp,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Foreign Keys
ALTER TABLE "voice_broadcasts" ADD CONSTRAINT "voice_broadcasts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_broadcasts" ADD CONSTRAINT "voice_broadcasts_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_broadcasts" ADD CONSTRAINT "voice_broadcasts_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_broadcasts" ADD CONSTRAINT "voice_broadcasts_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Indexes
CREATE INDEX IF NOT EXISTS "voice_broadcasts_driver_id_idx" ON "voice_broadcasts" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_broadcasts_status_idx" ON "voice_broadcasts" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_broadcasts_scheduled_idx" ON "voice_broadcasts" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_broadcasts_type_idx" ON "voice_broadcasts" USING btree ("broadcast_type");
