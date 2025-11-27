import { db } from "./db";
import { sql } from "drizzle-orm";

async function migrate() {
  try {
    console.log("Creating ai_chat_sessions table...");

    // Create ai_chat_sessions table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_chat_sessions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id VARCHAR NOT NULL REFERENCES tenants(id),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        title TEXT,
        last_message_at TIMESTAMP DEFAULT NOW() NOT NULL,
        message_count INTEGER DEFAULT 0 NOT NULL,
        is_active BOOLEAN DEFAULT true NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    // Create indexes
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_chat_sessions_user_idx ON ai_chat_sessions(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_chat_sessions_last_message_idx ON ai_chat_sessions(last_message_at)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_chat_sessions_active_idx ON ai_chat_sessions(is_active)`);

    console.log("Creating ai_chat_messages table...");

    // Create ai_chat_messages table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_chat_messages (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id VARCHAR NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tokens_used INTEGER,
        tool_calls JSONB,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    // Create indexes
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_chat_messages_session_idx ON ai_chat_messages(session_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_chat_messages_created_at_idx ON ai_chat_messages(created_at)`);

    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
  }
  process.exit(0);
}

migrate();
