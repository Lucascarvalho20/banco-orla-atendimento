import { and, eq, gt } from 'drizzle-orm';
import type { Database } from './client.js';
import { customerSessions } from './schema.js';

export interface NewCustomerSession {
  displayName: string;
  cpfHash: string;
  cpfLast2: string;
  expiresAt: Date;
}

export interface CustomerSession {
  id: string;
  displayName: string;
  cpfLast2: string;
  expiresAt: Date;
}

const publicColumns = {
  id: customerSessions.id,
  displayName: customerSessions.displayName,
  cpfLast2: customerSessions.cpfLast2,
  expiresAt: customerSessions.expiresAt,
};

export async function createCustomerSession(
  db: Database,
  data: NewCustomerSession,
): Promise<CustomerSession> {
  const [row] = await db.insert(customerSessions).values(data).returning(publicColumns);
  return row!;
}

/** Sessão ainda válida, ou `undefined` (não existe ou expirou). Nunca devolve o hash do CPF. */
export async function findActiveSession(
  db: Database,
  id: string,
  now: Date = new Date(),
): Promise<CustomerSession | undefined> {
  const [row] = await db
    .select(publicColumns)
    .from(customerSessions)
    .where(and(eq(customerSessions.id, id), gt(customerSessions.expiresAt, now)));
  return row;
}
