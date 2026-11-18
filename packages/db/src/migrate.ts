import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { createDb } from './client.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

export interface RolePasswords {
  /** Usuário só-leitura da IA (Etapa 2). */
  aiReader?: string;
  /** Usuário da ingestão da base de conhecimento (Etapa 5). */
  kbWriter?: string;
}

async function setPassword(pool: pg.Pool, role: 'ai_reader' | 'kb_writer', password: string) {
  // CREATE/ALTER ROLE não aceita parâmetro ($1) na senha. `format('%L')` faz o escape
  // dentro do próprio Postgres — nunca concatenar a senha numa string SQL.
  const { rows } = await pool.query<{ sql: string }>(
    `SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS sql`,
    [role, password],
  );
  await pool.query(rows[0]!.sql);
}

export async function runMigrations(
  databaseUrl: string,
  passwords: RolePasswords = {},
): Promise<void> {
  const { db, pool } = createDb(databaseUrl, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
    if (passwords.aiReader) await setPassword(pool, 'ai_reader', passwords.aiReader);
    if (passwords.kbWriter) await setPassword(pool, 'kb_writer', passwords.kbWriter);
  } finally {
    await pool.end();
  }
}
