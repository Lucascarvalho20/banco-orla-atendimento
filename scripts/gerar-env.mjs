// Gera o .env a partir do .env.example com segredos aleatórios (crypto.randomBytes).
// Uso: node scripts/gerar-env.mjs [--force]
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const force = process.argv.includes('--force');
if (existsSync('.env') && !force) {
  console.error('.env já existe. Use --force para sobrescrever (isso troca todas as senhas).');
  process.exit(1);
}

const secret = () => randomBytes(32).toString('hex');
const pgPassword = secret();

const content = readFileSync('.env.example', 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/^POSTGRES_PASSWORD=.*$/m, `POSTGRES_PASSWORD=${pgPassword}`)
  .replace(/^DATABASE_URL=(.*):[^:@]*@/m, (_, prefix) => `DATABASE_URL=${prefix}:${pgPassword}@`)
  .replace(/^AI_READER_PASSWORD=.*$/m, `AI_READER_PASSWORD=${secret()}`)
  .replace(/^KB_WRITER_PASSWORD=.*$/m, `KB_WRITER_PASSWORD=${secret()}`)
  .replace(/^CPF_HMAC_SECRET=.*$/m, `CPF_HMAC_SECRET=${secret()}`)
  .replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret()}`);

writeFileSync('.env', content, { mode: 0o600 });
console.log('.env gerado com segredos novos. Ele é ignorado pelo Git — nunca o commite.');
