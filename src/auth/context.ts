import { AsyncLocalStorage } from "node:async_hooks";

export interface SessionUser {
  id: number;
  email: string;
  name: string;
}
export const userContext = new AsyncLocalStorage<SessionUser>();
export function requireUserId(): number {
  const user = userContext.getStore();
  if (!user) throw new Error("Se requiere una sesión autenticada.");
  return user.id;
}
