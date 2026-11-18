// Empacota a Lambda num arquivo só (esbuild) e gera o .zip que a AWS/MiniStack recebe.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { zipSync } from 'fflate';

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
mkdirSync(path('../dist/'), { recursive: true });

await build({
  entryPoints: [path('../src/handler.ts')],
  outfile: path('../dist/index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // Driver nativo opcional do `pg`, não usado.
  external: ['pg-native'],
  // Dependências CommonJS (ex.: `pg`) usam `require` dentro de um bundle ESM.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  legalComments: 'none',
  logLevel: 'warning',
});

const code = readFileSync(path('../dist/index.mjs'));
writeFileSync(path('../dist/function.zip'), zipSync({ 'index.mjs': code }, { level: 9 }));
process.stdout.write(
  `Lambda empacotada: dist/function.zip (${Math.round(code.length / 1024)} KB)\n`,
);
