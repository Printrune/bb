import { z } from 'zod';
import { GAME_SERVER_URL } from './config';

const sessionSchema = z.object({ authenticated: z.literal(true), passwordRequired: z.literal(false), token: z.string().min(1) });
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

async function sessionRequest(): Promise<unknown> {
  try {
    const headers = new Headers();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(new URL('/api/session', GAME_SERVER_URL), {
      method: 'GET',
      credentials: 'same-origin', headers,
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

export async function readSession(): Promise<void> {
  const session = sessionSchema.safeParse(await sessionRequest());
  if (!session.success) throw new Error('The arena is updating. Please try again shortly.');
  storeToken(session.data.token);
}
