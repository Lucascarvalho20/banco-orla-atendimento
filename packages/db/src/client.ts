import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

/** Mesma conexão, outro usuário de banco (ex.: `ai_reader` só lê, `kb_writer` só escreve na base). */
export function databaseUrlForRole(
  databaseUrl: string,
  role: 'ai_reader' | 'kb_writer',
  password: string,
  host?: string,
): string {
  const url = new URL(databaseUrl);
  url.username = role;
  url.password = password;
  if (host) url.host = host;
  return url.toString();
}

export function createDb(databaseUrl: string, options: { max?: number } = {}) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.max ?? 10,
    // Conexão travada não pode segurar um atendimento para sempre
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  const db: Database = drizzle(pool, { schema });
  return { db, pool };
}
