import { db } from "./server/db";
import { sql } from "drizzle-orm";

db.execute(sql`SELECT COUNT(*) as count FROM neural_decisions`)
  .then(r => { console.log(r.rows[0]); process.exit(0); });
