import { describe, expect, it } from 'vitest';
import { isAllowedWebOrigin, webOrigins } from './origins.js';

describe('webOrigins', () => {
  it('aceita localhost e 127.0.0.1 quando a base é loopback', () => {
    expect(webOrigins('http://localhost:3000')).toEqual([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ]);
    expect(isAllowedWebOrigin('http://localhost:3000', 'http://127.0.0.1:3000')).toBe(true);
    expect(isAllowedWebOrigin('http://127.0.0.1:3000', 'http://localhost:3000')).toBe(true);
  });

  it('não abre para origem arbitrária', () => {
    expect(isAllowedWebOrigin('http://localhost:3000', 'https://evil.example')).toBe(false);
    expect(isAllowedWebOrigin('http://localhost:3000', undefined)).toBe(false);
  });
});
