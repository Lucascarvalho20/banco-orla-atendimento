/**
 * No Windows é comum abrir o site em 127.0.0.1 e a API estar configurada para localhost
 * (ou o contrário). São hosts diferentes para o navegador → CORS e cookie quebram.
 * Aceitamos os dois quando a origem base é loopback.
 */
export function webOrigins(webOrigin: string): string[] {
  const u = new URL(webOrigin);
  const port = u.port ? `:${u.port}` : '';
  const hosts = new Set<string>([u.hostname]);
  if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
    hosts.add('localhost');
    hosts.add('127.0.0.1');
  }
  return [...hosts].map((host) => `${u.protocol}//${host}${port}`);
}

export function isAllowedWebOrigin(webOrigin: string, origin: string | undefined): boolean {
  if (!origin) return false;
  return webOrigins(webOrigin).includes(origin);
}
