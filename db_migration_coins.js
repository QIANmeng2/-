const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:OHgfbDBtBUxgcBbwSUTVglzoyEimCAgD@yamabiko.proxy.rlwy.net:35510/railway' });

async function run() {
  try {
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS dream_coins INTEGER DEFAULT 0");
    console.log('users.dream_coins added');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS competitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        qr_code_url TEXT,
        created_by TEXT,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('competitions table created');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS coin_transactions (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        type TEXT NOT NULL,
        note TEXT,
        related_match_id TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('coin_transactions table created');
  } catch(e) { console.error(e.message); }
  pool.end();
}
run();
