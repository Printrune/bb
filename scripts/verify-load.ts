import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { TICK_RATE } from '../src/shared/protocol';
import { autopilot, createHarness, report, waitFor } from './verify-multiplayer';
import type { TrackedRoom } from './verify-multiplayer';

const durationSeconds = z.coerce.number().int().min(5).max(120).parse(process.env.VERIFY_LOAD_SECONDS ?? 20);
const targetRooms = z.coerce.number().int().min(1).max(20).parse(process.env.VERIFY_LOAD_ROOMS ?? 4);
const combat = process.env.VERIFY_LOAD_COMBAT === '1';
const harness = await createHarness();
const drivers: TrackedRoom[] = [];
let inputs: ReturnType<typeof setInterval> | undefined;

try {
  const before = await harness.metrics();
  assert.equal(before.activeRooms, 0, 'Close existing matches before this capacity test.');
  assert.equal(before.maxRooms, targetRooms, 'Set VERIFY_LOAD_ROOMS to match the server MAX_ROOMS.');
  for (let index = 0; index < targetRooms; index += 1) {
    const first = await harness.create({ name: `Load ${index + 1}A`, botId: 'witchdoctor', paint: 'signature', practice: false });
    drivers.push(first);
    const second = await harness.join(first.room.roomId, { name: `Load ${index + 1}B`, botId: 'tombstone', paint: 'glacier', practice: false });
    drivers.push(second);
    first.room.send('ready');
    second.room.send('ready');
  }
  await waitFor('all capacity-test matches to start', () => drivers.every((driver) => driver.snapshot?.phase.kind === 'fighting'));

  let rejectedAtCapacity = false;
  try {
    await harness.create({ name: 'Overflow', botId: 'witchdoctor', paint: 'signature', practice: false });
  } catch (error) {
    rejectedAtCapacity = typeof error === 'object' && error !== null && 'code' in error && error.code === 503;
    if (!rejectedAtCapacity) throw error;
  }
  assert.equal(rejectedAtCapacity, true, 'The server must reject an extra room at capacity with code 503.');

  inputs = setInterval(() => {
    for (const driver of drivers) {
      if (!driver.connected) continue;
      if (combat) autopilot(driver);
      else {
        driver.sequence += 1;
        // Neutral driving still exercises the actual 30 Hz input pipeline per client.
        driver.room.send('input', { seq: driver.sequence, throttle: 0, steer: 0, weapon: true, recover: false });
      }
    }
  }, 1_000 / TICK_RATE);
  const started = Date.now();
  for (const driver of drivers) {
    driver.lastSnapshotAt = started;
    driver.maxSnapshotGapMs = 0;
  }
  const sample = await harness.metrics();
  await delay(durationSeconds * 1_000);
  clearInterval(inputs);
  inputs = undefined;
  const after = await harness.metrics();
  const elapsedSeconds = (Date.now() - started) / 1_000;
  const measuredTicks = after.ticks - sample.ticks;
  const tickCpuMs = after.totalTickMs - sample.totalTickMs;
  const expectedTicks = elapsedSeconds * TICK_RATE * targetRooms;
  const achievedTickRatio = measuredTicks / expectedTicks;
  const averageTickMs = measuredTicks > 0 ? tickCpuMs / measuredTicks : Infinity;
  // One client per room avoids double-counting shared damage and match results.
  // Hits and damage persist when a fight finishes; no rematches run in this sample.
  const roomOutcomes = drivers.filter((_, index) => index % 2 === 0).map((driver) => ({
    phase: driver.snapshot?.phase.kind ?? 'missing',
    fightSeconds: driver.snapshot?.phase.kind === 'fighting' ? driver.snapshot.phase.seconds : null,
    weaponHits: driver.snapshot?.players.reduce((sum, player) => sum + player.hits, 0) ?? 0,
    damagedPlayers: driver.snapshot?.players.filter((player) => player.health < 100).length ?? 0,
    debrisParts: driver.snapshot?.debris.length ?? 0,
  }));
  const finalPhaseCounts: Record<string, number> = {};
  for (const outcome of roomOutcomes) finalPhaseCounts[outcome.phase] = (finalPhaseCounts[outcome.phase] ?? 0) + 1;
  const measurement = {
    mode: combat ? 'combat' : 'neutral',
    rooms: targetRooms, clients: drivers.length, elapsedSeconds,
    extraRoomRejected: rejectedAtCapacity,
    achievedTickRatePerRoom: measuredTicks / elapsedSeconds / targetRooms,
    averageSimulationTickMs: averageTickMs,
    historicalMaximumSimulationTickMs: after.maxTickMs,
    maximumSnapshotGapMs: Math.max(...drivers.map((driver) => driver.maxSnapshotGapMs)),
    memoryMiB: after.memory / 1024 / 1024,
    memoryDeltaMiB: (after.memory - before.memory) / 1024 / 1024,
    snapshots: drivers.reduce((total, driver) => total + driver.snapshots, 0),
    finalPhaseCounts,
    roomsWithWeaponHits: roomOutcomes.filter((outcome) => outcome.weaponHits > 0).length,
    roomsWithDamage: roomOutcomes.filter((outcome) => outcome.damagedPlayers > 0).length,
    roomOutcomes,
  };
  report('capacity-measurement', measurement);
  assert.equal(after.activeRooms, targetRooms);
  assert.ok(achievedTickRatio >= 0.85, `Simulation tick throughput fell to ${(achievedTickRatio * 100).toFixed(1)}% of target.`);
  assert.ok(averageTickMs < 1_000 / TICK_RATE / targetRooms * 0.8, 'Measured simulation CPU time leaves insufficient per-frame headroom.');
  assert.ok(drivers.every((driver) => driver.connected && driver.errors.length === 0), 'Every load-test client must remain connected with valid snapshots.');
  assert.ok(drivers.every((driver) => driver.snapshots >= durationSeconds * 8), 'Every client must receive a sustained stream of snapshots.');
  assert.ok(drivers.every((driver) => driver.maxSnapshotGapMs < 1_000), 'A client experienced a sustained snapshot interruption.');
  if (combat) {
    assert.equal(measurement.roomsWithWeaponHits, targetRooms, 'Every combat-load room must observe an actual weapon hit.');
    assert.equal(measurement.roomsWithDamage, targetRooms, 'Every combat-load room must observe damage.');
  }
  report('PASS: capacity', measurement);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ check: 'FAIL: capacity', error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
} finally {
  if (inputs) clearInterval(inputs);
  await harness.close();
}
