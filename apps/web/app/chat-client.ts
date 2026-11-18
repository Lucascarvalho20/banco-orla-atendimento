import type { ClientToServerEvents, ServerToClientEvents } from '@orla/shared';
import { io, type Socket } from 'socket.io-client';

export type ChatClient = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Conexão real com o servidor. O cookie de sessão (httpOnly) vai junto por `withCredentials`. */
export function createChatClient(apiUrl: string): ChatClient {
  return io(apiUrl, { withCredentials: true, transports: ['websocket'] });
}
