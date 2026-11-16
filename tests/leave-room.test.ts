import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { CloseCode, Protocol, Room } from '@colyseus/sdk';
import { Connection } from '@colyseus/sdk/Connection';
import { leaveRoom } from '../src/client/leave-room';

test('leaving sends consent before closing and returns while the SDK awaits remote acknowledgement', () => {
  const room = new Room<unknown>('arena');
  room.connection = new Connection();
  const events: { kind: 'frame' | 'close'; code: number | undefined }[] = [];
  // Only the network boundary is held open. The real SDK owns leave semantics.
  room.connection.transport = {
    isOpen: true,
    connect() {},
    send(data) { events.push({ kind: 'frame', code: data[0] }); },
    sendUnreliable() {},
    close(code) { events.push({ kind: 'close', code }); },
  };
  let acknowledged = false;
  room.onLeave(() => { acknowledged = true; });

  assert.equal(leaveRoom(room), undefined);
  assert.equal(acknowledged, false, 'Returning to the menu must not depend on a close acknowledgement.');
  assert.deepEqual(events, [
    { kind: 'frame', code: Protocol.LEAVE_ROOM },
    { kind: 'close', code: CloseCode.CONSENTED },
  ]);
  room.onLeave.invoke(CloseCode.CONSENTED);
  assert.equal(acknowledged, true);
});

test('a rejected leave acknowledgement and an already closed transport do not block local exit', async () => {
  let consented: boolean | undefined;
  let closedWith: number | undefined;
  assert.doesNotThrow(() => leaveRoom({
    leave(consent) {
      consented = consent;
      return Promise.reject(new Error('Remote close failed.'));
    },
    connection: {
      close(code) {
        closedWith = code;
        throw new Error('The transport is already closed.');
      },
    },
  }));
  await delay(0); // The test runner also fails on an unhandled rejection.
  assert.equal(consented, true);
  assert.equal(closedWith, CloseCode.CONSENTED);
});
