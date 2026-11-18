import { loadDbEnv } from '../env.js';
import { runMigrations } from '../migrate.js';

const env = loadDbEnv();
await runMigrations(env.DATABASE_URL, {
  aiReader: env.AI_READER_PASSWORD,
  kbWriter: env.KB_WRITER_PASSWORD,
});
process.stdout.write('Migrations aplicadas e senhas do ai_reader e do kb_writer definidas.\n');
