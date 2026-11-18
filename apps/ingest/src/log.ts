/**
 * Log estruturado (uma linha JSON por evento): o CloudWatch Logs indexa os campos e dá para
 * filtrar por `key`, `messageId` etc. Nunca recebe o conteúdo dos documentos.
 */
export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export const jsonLogger: Logger = {
  info: (msg, fields) => write('info', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
};

function write(level: string, msg: string, fields: Record<string, unknown> = {}) {
  process.stdout.write(
    `${JSON.stringify({ level, msg, time: new Date().toISOString(), ...fields })}\n`,
  );
}

/** Erro → só nome e mensagem (sem stack com caminhos nem objetos com dados). */
export const describeError = (error: unknown) =>
  error instanceof Error ? { name: error.name, message: error.message } : { name: 'Unknown' };
