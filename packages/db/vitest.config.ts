import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Sobe um Postgres real em container (Testcontainers): a 1ª vez baixa a imagem.
    // Um arquivo por vez: dois containers em paralelo derrubam conexões um do outro no CI.
    fileParallelism: false,
    hookTimeout: 180_000,
    testTimeout: 60_000,
  },
});
