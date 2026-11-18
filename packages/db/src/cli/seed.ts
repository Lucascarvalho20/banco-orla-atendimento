import { createDb } from '../client.js';
import { loadDbEnv } from '../env.js';
import { DEMO_AGENT_PASSWORD, seedAll } from '../seed.js';

const env = loadDbEnv();
const { db, pool } = createDb(env.DATABASE_URL, { max: 1 });
try {
  await seedAll(db);
  process.stdout.write(
    `Seed aplicado: assuntos + atendentes demo (senha: ${DEMO_AGENT_PASSWORD}).\n`,
  );
} finally {
  await pool.end();
}
