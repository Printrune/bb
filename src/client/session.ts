import { z } from 'zod';
import { GAME_SERVER_URL } from './config';

const sessionSchema = z.object({ authenticated: z.boolean(), passwordRequired: z.boolean() });
const loginSchema = sessionSchema.extend({ token: z.string().min(1) });
const errorSchema = z.object({ error: z.string() });
const TOKEN_KEY = `battlebots:session:${GAME_SERVER_URL}`;
let token: string | undefined;
try { token = sessionStorage.getItem(TOKEN_KEY) || undefined; } catch { /* Session storage is optional. */ }

export function sessionToken(): string | undefined { return token; }

function storeToken(value: string | undefined): void {
  token = value;
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* The current tab can still authenticate without storage. */ }
}

async function sessionRequest(path: string, password?: string): Promise<unknown> {
  try {
    const headers = new Headers();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (password !== undefined) headers.set('Content-Type', 'application/json');
    const response = await fetch(new URL(path, GAME_SERVER_URL), {
      method: password === undefined ? 'GET' : 'POST',
      credentials: 'same-origin', headers,
      body: password === undefined ? undefined : JSON.stringify({ password }),
      // A free server can take about a minute to wake after inactivity.
      signal: AbortSignal.timeout(75_000),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const error = errorSchema.safeParse(body);
      throw new Error(error.success ? error.data.error : 'Could not connect to the arena. Try again in a moment.');
    }
    return body;
  } catch (error) {
    if (error instanceof TypeError || (error instanceof DOMException && ['TimeoutError', 'AbortError'].includes(error.name))) {
      throw new Error('The multiplayer server could not be reached. Try again shortly, or play Practice.');
    }
    throw error;
  }
}

export async function readSession(): Promise<z.infer<typeof sessionSchema>> {
  const checkedToken = token;
  const session = sessionSchema.parse(await sessionRequest('/api/session'));
  if (!session.authenticated && token === checkedToken) storeToken(undefined);
  return session;
}

export async function loginSession(password: string): Promise<void> {
  const session = loginSchema.parse(await sessionRequest('/api/login', password));
  storeToken(session.token);
}
