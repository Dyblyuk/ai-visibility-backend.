import pg from 'pg';

const TOKEN = /^[a-zA-Z0-9_-]{10,128}$/;
export const validReportToken = token => typeof token === 'string' && TOKEN.test(token);

// The same SQL is exercised against PostgreSQL (PGlite) in the restart test.
// Reports and generated PDFs are deliberately not deleted after delivery.
export class PostgresReportStore {
  constructor(db) { this.db = db; this.durable = true; this.kind = 'postgres'; }
  async init() {
    await this.db.query(`CREATE TABLE IF NOT EXISTS ai_visibility_reports (
      token TEXT PRIMARY KEY,
      report JSONB NOT NULL,
      pdf BYTEA,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      lead_notified_at TIMESTAMPTZ
    )`);
  }
  async set(token, report) {
    await this.db.query('INSERT INTO ai_visibility_reports (token, report) VALUES ($1, $2::jsonb)', [token, JSON.stringify(report)]);
  }
  async get(token) {
    if (!validReportToken(token)) return null;
    const { rows } = await this.db.query('SELECT report FROM ai_visibility_reports WHERE token = $1', [token]);
    return rows[0]?.report ?? null;
  }
  async getPdf(token) {
    if (!validReportToken(token)) return null;
    const { rows } = await this.db.query('SELECT pdf FROM ai_visibility_reports WHERE token = $1', [token]);
    return rows[0]?.pdf ? Buffer.from(rows[0].pdf) : null;
  }
  async savePdf(token, pdf) {
    const { rows } = await this.db.query('UPDATE ai_visibility_reports SET pdf = COALESCE(pdf, $2) WHERE token = $1 RETURNING pdf', [token, pdf]);
    if (!rows[0]) throw new Error('Report does not exist');
    return Buffer.from(rows[0].pdf);
  }
  async claimLeadNotification(token) {
    const { rows } = await this.db.query('UPDATE ai_visibility_reports SET lead_notified_at = NOW() WHERE token = $1 AND lead_notified_at IS NULL RETURNING token', [token]);
    return rows.length === 1;
  }
  async releaseLeadNotification(token) {
    await this.db.query('UPDATE ai_visibility_reports SET lead_notified_at = NULL WHERE token = $1', [token]);
  }
  async close() { await this.db.end(); }
}

// Compatibility mode until REPORT_DATABASE_URL is connected. It is explicitly
// reported as non-durable by /api/health; it must not masquerade as persistence.
class MemoryReportStore {
  constructor() { this.records = new Map(); this.kind = 'memory'; this.durable = false; }
  async set(token, report) {
    for (const [key, value] of this.records) {
      if (Date.now() - value.report.ts > 24 * 60 * 60 * 1000) this.records.delete(key);
    }
    if (this.records.size >= 1000) throw new Error('Report storage is full; connect PostgreSQL');
    this.records.set(token, { report, pdf: null, notified: false });
  }
  async get(token) { return this.records.get(token)?.report ?? null; }
  async getPdf(token) { return this.records.get(token)?.pdf ?? null; }
  async savePdf(token, pdf) {
    const record = this.records.get(token);
    if (!record) throw new Error('Report does not exist');
    record.pdf ||= pdf;
    return record.pdf;
  }
  async claimLeadNotification(token) {
    const record = this.records.get(token);
    if (!record || record.notified) return false;
    record.notified = true;
    return true;
  }
  async releaseLeadNotification(token) {
    const record = this.records.get(token);
    if (record) record.notified = false;
  }
  async close() {}
}

export async function createReportStore(databaseUrl) {
  if (!databaseUrl) return new MemoryReportStore();
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
  // Never fall back to volatile memory if a configured database is unavailable.
  const store = new PostgresReportStore(pool);
  try { await store.init(); } catch (error) { await pool.end(); throw error; }
  return store;
}
