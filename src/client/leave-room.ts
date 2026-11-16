import { CloseCode } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';

type LeavingRoom = Pick<Room<unknown>, 'leave'> & {
  connection: Pick<Room<unknown>['connection'], 'close'>;
};

/** Release the local view without waiting for a remote close acknowledgement. */
export function leaveRoom(room: LeavingRoom): void {
  // Consent stops SDK retries and sends the forfeit before closing the socket.
  try { void room.leave(true).catch(() => undefined); } catch { /* Already disconnected. */ }
  try { room.connection.close(CloseCode.CONSENTED, 'Leaving match'); } catch { /* Already closed. */ }
}
