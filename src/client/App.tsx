import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { BOTS, MATCH_SECONDS, NEUTRAL_INPUT, PAINTS, paintColor } from '../shared/protocol';
import { KILLSAW_UNLOCK_SECONDS, PULVERIZERS } from '../shared/arena';
import { damageParts, driveCondition, IMMOBILIZATION_SECONDS, partIntegrity } from '../shared/damage';
import type { DamagePartId } from '../shared/damage';
import type { ArenaRenderer, BotId, JoinOptions, MatchState, PaintId, PlayerInput, PlayerSnapshot } from '../shared/protocol';
import { createConnection } from './network';
import type { ConnectionStatus } from './network';
import { Icon } from './components/Icon';
import { BotPortrait } from './components/BotPortrait';
import { MatchInvite } from './components/MatchInvite';
import { Joystick } from './components/Joystick';
import { DEFEAT_REVEAL_SECONDS } from '../shared/presentation';
import type { VRAction, VRStatus } from '../shared/vr';
import { BASE_PATH, MULTIPLAYER_AVAILABLE, STATIC_HOSTING } from './config';
import { loginSession, readSession } from './session';

type Authentication = 'checking' | 'required' | 'authenticated' | 'failed';
type OnlineAction = 'create' | 'join';
interface DamageNotice { title: string; detail: string }
const WHEEL_ORDER: DamagePartId[] = ['wheel-front-left', 'wheel-front-right', 'wheel-rear-left', 'wheel-rear-right', 'wheel-left', 'wheel-right'];
const WHEEL_LABELS: Partial<Record<DamagePartId, string>> = {
  'wheel-front-left': 'LF', 'wheel-front-right': 'RF', 'wheel-rear-left': 'LR',
  'wheel-rear-right': 'RR', 'wheel-left': 'L', 'wheel-right': 'R',
};

function storedName(): string {
  try { return localStorage.getItem('battlebots:driver') || 'Driver'; } catch { return 'Driver'; }
}

function initialRoom(): string { return new URLSearchParams(window.location.search).get('room') ?? ''; }

function roomFromInput(value: string): string {
  try { return new URL(value).searchParams.get('room') ?? value.trim(); } catch { return value.trim(); }
}

function formatTime(seconds: number): string {
  const rounded = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(rounded / 60).toString().padStart(2, '0')}:${(rounded % 60).toString().padStart(2, '0')}`;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    container.current?.querySelector<HTMLElement>('input, button')?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  return <div className="modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
    <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={container} onKeyDown={(event) => {
      if (event.key === 'Escape') onClose?.();
      if (event.key !== 'Tab') return;
      const items = container.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]');
      if (!items?.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <div className="modal-top"><span className="eyebrow">BATTLEBOTS / ARENA</span>{onClose ? <button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button> : null}</div>
      <h2>{title}</h2>
      {children}
    </div>
  </div>;
}

function WheelCondition({ player }: { player: PlayerSnapshot }) {
  const drive = driveCondition(player.botId, player.damage);
  const wheels = damageParts(player.botId).filter((part) => part.kind === 'wheel')
    .sort((a, b) => WHEEL_ORDER.indexOf(a.id) - WHEEL_ORDER.indexOf(b.id));
  return <div className="component-condition" role="group" aria-label={`${drive.wheels} of ${drive.total} wheels attached`}>
    <span className="wheel-group-label">DRIVE</span><div className="wheel-chips">{wheels.map((part) => {
      const integrity = partIntegrity(player.damage, part.id);
      const condition = integrity <= 0 ? 'lost' : integrity <= 0.35 ? 'critical' : integrity < 0.7 ? 'damaged' : 'healthy';
      const label = `${part.label}: ${condition === 'lost' ? 'lost' : `${condition}, ${Math.round(integrity * 100)}% integrity`}`;
      return <span key={part.id} className={`wheel-chip wheel-chip--${condition}`} role="img" aria-label={label} title={label}><span aria-hidden="true">{WHEEL_LABELS[part.id] ?? part.label}</span></span>;
    })}</div>
  </div>;
}

function HealthBar({ player, local = false }: { player: PlayerSnapshot | undefined; local?: boolean }) {
  const health = player ? Math.max(0, Math.min(100, player.health)) : 0;
  const condition = health > 55 ? 'healthy' : health > 25 ? 'warning' : 'critical';
  const label = `${local ? 'Your' : 'Opponent'} ${player ? BOTS[player.botId].name : 'robot'} hull life`;
  return <div className={`fighter-hud ${local ? 'fighter-hud--local' : ''} ${player ? `fighter-hud--${condition}` : ''}`}>
    <div className="fighter-meta"><span>{player ? BOTS[player.botId].name : 'Awaiting challenger'}</span><strong>{player ? Math.ceil(health) : '—'}<small> / 100</small></strong></div>
    <div className={`health-track health-track--${condition}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={player ? health : undefined} aria-valuetext={player ? `${Math.ceil(health)} of 100 hull life` : 'Awaiting challenger'}>
      <div className="health-recent" style={{ width: `${health}%` }} aria-hidden="true" />
      <div className="health-current" style={{ width: `${health}%` }} aria-hidden="true" />
      <span className="life-bar-label" aria-hidden="true">HULL LIFE</span>
    </div>
    <div className="fighter-caption"><span>{local ? 'YOU' : 'OPPONENT'} · {player?.name ?? 'OPEN SEAT'}</span><span>{player && !player.connected ? 'RECONNECTING' : player && partIntegrity(player.damage, 'weapon') <= 0 ? 'WEAPON OUT' : player && partIntegrity(player.damage, 'weapon') < 0.5 ? 'WEAPON DEGRADED' : player?.weaponActive ? 'WEAPON LIVE' : 'WEAPON STANDBY'}</span></div>
    {player ? <WheelCondition player={player} /> : null}
  </div>;
}

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ArenaRenderer | null>(null);
  const connection = useRef<ReturnType<typeof createConnection> | null>(null);
  const currentSnapshot = useRef<MatchState | null>(null);
  const localPlayerId = useRef<string | null>(null);
  const activeRoom = useRef(false);
  const requestedMatch = useRef(false);
  const authRequestGeneration = useRef(0);
  const acceptSnapshots = useRef(false);
  const input = useRef({ ...NEUTRAL_INPUT });
  const sequence = useRef(0);
  const keys = useRef(new Set<string>());
  const recoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const damageNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baselineDamageOnNextSnapshot = useRef(true);
  const vrSession = useRef(false);
  const vrFocused = useRef(false);
  const lastVRInputAt = useRef(0);
  const vrAction = useRef<(action: VRAction) => void>(() => undefined);

  const [botId, setBotId] = useState<BotId>('witchdoctor');
  const [paint, setPaint] = useState<PaintId>('signature');
  const [driverName, setDriverName] = useState(storedName);
  const [snapshot, setSnapshot] = useState<MatchState | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [inRoom, setInRoom] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [practiceMatch, setPracticeMatch] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [authentication, setAuthentication] = useState<Authentication>(MULTIPLAYER_AVAILABLE ? 'checking' : 'authenticated');
  const [authOpen, setAuthOpen] = useState(!STATIC_HOSTING || (MULTIPLAYER_AVAILABLE && Boolean(initialRoom())));
  const [pendingOnlineAction, setPendingOnlineAction] = useState<OnlineAction | null>(STATIC_HOSTING && MULTIPLAYER_AVAILABLE && initialRoom() ? 'join' : null);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [rendererReady, setRendererReady] = useState(false);
  const [rendererError, setRendererError] = useState('');
  const [previewMode, setPreviewMode] = useState<'robot' | 'arena'>('robot');
  const overview = previewMode === 'arena';
  const [vrStatus, setVRStatus] = useState<VRStatus>({ kind: 'checking' });
  const [vrAttempted, setVRAttempted] = useState(false);
  const [vrReport, setVRReport] = useState<string | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState(initialRoom);
  const [muted, setMuted] = useState(true);
  const [weaponOn, setWeaponOn] = useState(false);
  const [rematchPending, setRematchPending] = useState(false);
  const [resultVisible, setResultVisible] = useState(false);
  const [opponentDirection, setOpponentDirection] = useState<string | null>(null);
  const [damageNotice, setDamageNotice] = useState<DamageNotice | null>(null);

  const selectedBot = BOTS[botId];
  const local = snapshot?.players.find((player) => player.id === myId);
  const opponent = snapshot?.players.find((player) => player.id !== myId);
  const localBot = local ? BOTS[local.botId] : selectedBot;
  const botVersion = botId === 'witchdoctor' ? 'WCVII · 2023' : 'CLASSIC · 2021';
  const phase = snapshot?.phase;
  const fighting = phase?.kind === 'fighting';
  const weaponIntegrity = local ? partIntegrity(local.damage, 'weapon') : 1;
  const weaponDestroyed = weaponIntegrity <= 0;
  const countedOutPlayer = local && local.damage.immobilizedFor > 0 ? local
    : opponent && opponent.damage.immobilizedFor > 0 ? opponent : null;
  const countoutRemaining = countedOutPlayer ? Math.max(0, Math.ceil(IMMOBILIZATION_SECONDS - countedOutPlayer.damage.immobilizedFor)) : 0;
  const ownedHammerIds = PULVERIZERS.filter((hammer) => hammer.ownerSlot === local?.spawnSlot).map((hammer) => hammer.id);
  const hammers = snapshot?.arena.hazards.filter((hazard) => hazard.kind === 'pulverizer' && ownedHammerIds.includes(hazard.id)) ?? [];
  const hammerCooldown = hammers.reduce((maximum, hazard) => hazard.kind === 'pulverizer' ? Math.max(maximum, hazard.cooldown) : maximum, 0);
  const hammerMoving = hammers.some((hazard) => hazard.kind === 'pulverizer' && hazard.phase !== 'idle');
  const saws = snapshot?.arena.hazards.filter((hazard) => hazard.kind === 'killsaw') ?? [];
  const sawWarning = saws.some((hazard) => hazard.kind === 'killsaw' && hazard.phase === 'warning');
  const sawCutting = saws.some((hazard) => hazard.kind === 'killsaw' && hazard.phase === 'cutting');
  const sawUnlockIn = Math.max(0, KILLSAW_UNLOCK_SECONDS - (snapshot?.arena.elapsed ?? 0));
  const inviteUrl = roomId ? `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}` : '';
  const isPractice = practiceMatch || Boolean(snapshot?.players.some((player) => player.id === 'practice-bot'));

  const resetInput = useCallback(() => {
    keys.current.clear();
    input.current = { ...NEUTRAL_INPUT, seq: sequence.current };
    setWeaponOn(false);
    renderer.current?.setInput(input.current);
    connection.current?.sendInput({ ...input.current, seq: ++sequence.current });
  }, []);

  useEffect(() => {
    const client = createConnection({
      onState: (state, id) => {
        if (!acceptSnapshots.current) return;
        const previous = currentSnapshot.current;
        if (previous?.roomId !== state.roomId || previous.phase.kind !== state.phase.kind) {
          if (resultTimer.current) clearTimeout(resultTimer.current);
          const showExplosion = previous?.roomId === state.roomId && state.phase.kind === 'finished' &&
            state.events.some((event) => event.kind === 'explosion');
          setResultVisible(state.phase.kind === 'finished' && !showExplosion);
          if (showExplosion) resultTimer.current = setTimeout(() => setResultVisible(true), DEFEAT_REVEAL_SECONDS * 1000);
        }
        const previousLocal = previous?.players.find((player) => player.id === id);
        const nextLocal = state.players.find((player) => player.id === id);
        if (state.phase.kind !== 'fighting') {
          if (damageNoticeTimer.current) clearTimeout(damageNoticeTimer.current);
          setDamageNotice(null);
        } else if (!baselineDamageOnNextSnapshot.current && previous?.roomId === state.roomId && previous.phase.kind === 'fighting' && previousLocal && nextLocal && nextLocal.damage.revision >= previousLocal.damage.revision) {
          const lost = damageParts(nextLocal.botId).filter((part) => partIntegrity(nextLocal.damage, part.id) <= 0 && partIntegrity(previousLocal.damage, part.id) > 0);
          const first = lost[0];
          if (first) {
            const drive = driveCondition(nextLocal.botId, nextLocal.damage);
            const title = lost.length > 1 ? `${lost.length} components lost`
              : `${first.label} ${first.kind === 'weapon' ? 'disabled' : first.detachable ? 'lost' : 'breached'}`;
            const detail = lost.length > 1 ? lost.map((part) => part.label).join(' · ')
              : first.kind === 'wheel' ? `${drive.wheels} ${drive.wheels === 1 ? 'wheel remains' : 'wheels remain'}`
                : first.kind === 'weapon' ? 'Weapon disabled' : 'Armor breached';
            if (damageNoticeTimer.current) clearTimeout(damageNoticeTimer.current);
            setDamageNotice({ title, detail });
            damageNoticeTimer.current = setTimeout(() => setDamageNotice(null), 3_200);
          }
        }
        baselineDamageOnNextSnapshot.current = false;
        if (nextLocal && partIntegrity(nextLocal.damage, 'weapon') <= 0) {
          input.current.weapon = false;
          setWeaponOn(false);
        }
        currentSnapshot.current = state;
        localPlayerId.current = id;
        sequence.current = Math.max(sequence.current, state.players.find((player) => player.id === id)?.lastInputSeq ?? 0);
        activeRoom.current = true;
        renderer.current?.update(state, id);
        setSnapshot(state); setMyId(id); setRoomId(state.roomId); setInRoom(true);
      },
      onStatus: (nextStatus) => {
        if (nextStatus === 'connecting' || nextStatus === 'reconnecting' || nextStatus === 'disconnected' || nextStatus === 'idle') {
          baselineDamageOnNextSnapshot.current = true;
          if (damageNoticeTimer.current) clearTimeout(damageNoticeTimer.current);
          setDamageNotice(null);
        }
        setStatus(nextStatus);
      },
      onError: (message) => setError(message),
    });
    connection.current = client;
    return () => {
      if (damageNoticeTimer.current) clearTimeout(damageNoticeTimer.current);
      if (resultTimer.current) clearTimeout(resultTimer.current);
      connection.current = null; void client.leave();
    };
  }, []);

  useEffect(() => {
    if (!canvas.current) return;
    const element = canvas.current;
    let cancelled = false;
    let instance: ArenaRenderer | null = null;
    void import('./game/arena').then(({ createArena }) => createArena(element, {
      onStatus(next) {
        if (next.kind === 'entering' || next.kind === 'active' || next.kind === 'paused') setVRAttempted(true);
        vrSession.current = next.kind === 'active' || next.kind === 'paused';
        vrFocused.current = next.kind === 'active';
        if (!vrFocused.current) resetInput();
        lastVRInputAt.current = 0;
        setVRStatus(next);
      },
      onDrive(throttle, steer) {
        input.current.throttle = vrFocused.current ? throttle : 0;
        input.current.steer = vrFocused.current ? steer : 0;
      },
      onAction(action) { vrAction.current(action); },
      onError(message) { setError(message); },
      onFrame() {
        const now = performance.now();
        const interval = 1000 / 30;
        if (now - lastVRInputAt.current < interval) return;
        lastVRInputAt.current = now - ((now - lastVRInputAt.current) % interval);
        const canDrive = vrFocused.current && currentSnapshot.current?.phase.kind === 'fighting';
        const packet = { ...(canDrive ? input.current : NEUTRAL_INPUT), seq: ++sequence.current };
        renderer.current?.setInput(packet);
        connection.current?.sendInput(packet);
      },
    })).then((result) => {
      if (cancelled) { result.dispose(); return; }
      instance = result;
      renderer.current = result;
      result.setPreview('witchdoctor', 'signature');
      result.setMuted(true);
      if (activeRoom.current && currentSnapshot.current) result.update(currentSnapshot.current, localPlayerId.current);
      setRendererReady(true);
    }).catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error({ event: 'arena_start_failed', message });
      if (!cancelled) setRendererError(message);
    });
    return () => { cancelled = true; instance?.dispose(); renderer.current = null; };
  }, []);

  useEffect(() => {
    if (!inRoom && rendererReady) renderer.current?.setPreview(botId, paint);
  }, [botId, paint, inRoom, rendererReady]);

  useEffect(() => { renderer.current?.setMuted(muted); }, [muted, rendererReady]);
  useEffect(() => { renderer.current?.setOverview(overview); }, [overview, rendererReady]);

  const checkSession = useCallback(async () => {
    if (!MULTIPLAYER_AVAILABLE) { setAuthentication('authenticated'); return; }
    const generation = ++authRequestGeneration.current;
    setAuthentication('checking'); setAuthError('');
    try {
      const session = await readSession();
      if (generation !== authRequestGeneration.current) return;
      setAuthentication(session.authenticated ? 'authenticated' : 'required');
    } catch (cause: unknown) {
      if (generation !== authRequestGeneration.current) return;
      setAuthentication('failed');
      setAuthError(cause instanceof Error ? cause.message : 'Could not reach the arena server.');
    }
  }, []);

  useEffect(() => {
    if (!STATIC_HOSTING || (MULTIPLAYER_AVAILABLE && initialRoom())) void checkSession();
  }, [checkSession]);

  useEffect(() => {
    if (STATIC_HOSTING || authentication !== 'authenticated' || requestedMatch.current) return;
    let cancelled = false;
    acceptSnapshots.current = true;
    void connection.current?.reconnect().then((found) => {
      if (cancelled || activeRoom.current) return;
      if (!found) {
        acceptSnapshots.current = false;
        if (initialRoom()) setJoinOpen(true);
      }
    });
    return () => { cancelled = true; };
  }, [authentication]);

  useEffect(() => {
    if (authentication !== 'authenticated' || !pendingOnlineAction || !rendererReady || activeRoom.current) return;
    const action = pendingOnlineAction;
    setPendingOnlineAction(null); setAuthOpen(false);
    if (action === 'join') setJoinOpen(true);
    else void createMatch(false);
  }, [authentication, pendingOnlineAction, rendererReady]);

  useEffect(() => {
    if (!inRoom) return;
    const interval = setInterval(() => {
      if (vrSession.current) return;
      const canDrive = currentSnapshot.current?.phase.kind === 'fighting' && document.visibilityState === 'visible';
      const packet: PlayerInput = { ...(canDrive ? input.current : NEUTRAL_INPUT), seq: ++sequence.current };
      renderer.current?.setInput(packet);
      connection.current?.sendInput(packet);
    }, 1000 / 30);
    const directionInterval = setInterval(() => {
      const direction = canvas.current?.dataset.opponentDirection;
      setOpponentDirection(direction === 'left' || direction === 'right' ? direction : null);
    }, 200);
    return () => { clearInterval(interval); clearInterval(directionInterval); resetInput(); };
  }, [inRoom, resetInput]);

  useEffect(() => {
    if (!fighting) resetInput();
    if (phase?.kind !== 'finished') setRematchPending(false);
  }, [fighting, phase?.kind, resetInput]);


  const toggleWeapon = useCallback(() => {
    const state = currentSnapshot.current;
    const player = state?.players.find((candidate) => candidate.id === localPlayerId.current);
    if (state?.phase.kind !== 'fighting' || !player || partIntegrity(player.damage, 'weapon') <= 0) return;
    input.current.weapon = !input.current.weapon;
    setWeaponOn(input.current.weapon);
  }, []);

  const recover = useCallback(() => {
    const state = currentSnapshot.current;
    const player = state?.players.find((candidate) => candidate.id === localPlayerId.current);
    if (state?.phase.kind !== 'fighting' || !player || !BOTS[player.botId].physics.selfRight || player.recovering || player.recoveryCooldown > 0) return;
    input.current.recover = true;
    if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
    recoveryTimer.current = setTimeout(() => { input.current.recover = false; }, 150);
  }, []);

  const pulverize = useCallback(() => {
    if (currentSnapshot.current?.phase.kind === 'fighting') connection.current?.pulverize();
  }, []);

  useEffect(() => {
    function updateDrive() {
      input.current.throttle = (keys.current.has('w') || keys.current.has('arrowup') ? 1 : 0) - (keys.current.has('s') || keys.current.has('arrowdown') ? 1 : 0);
      input.current.steer = (keys.current.has('d') || keys.current.has('arrowright') ? 1 : 0) - (keys.current.has('a') || keys.current.has('arrowleft') ? 1 : 0);
      renderer.current?.setInput({ ...input.current });
    }
    function keyDown(event: KeyboardEvent) {
      if (!activeRoom.current || event.metaKey || event.ctrlKey || event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const key = event.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'r', 'h'].includes(key)) event.preventDefault();
      keys.current.add(key); updateDrive();
      if (!event.repeat && key === ' ') toggleWeapon();
      if (!event.repeat && key === 'r') recover();
      if (!event.repeat && key === 'h') pulverize();
    }
    function keyUp(event: KeyboardEvent) { keys.current.delete(event.key.toLowerCase()); updateDrive(); }
    function hide() { if (!vrSession.current && document.visibilityState !== 'visible') resetInput(); }
    function blur() { if (!vrSession.current) resetInput(); }
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hide);
      if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
    };
  }, [pulverize, recover, resetInput, toggleWeapon]);

  async function login(event: FormEvent) {
    event.preventDefault();
    const generation = ++authRequestGeneration.current;
    setBusy('Unlocking arena'); setAuthError('');
    try {
      await loginSession(password);
      if (generation !== authRequestGeneration.current) return;
      setPassword(''); setAuthentication('authenticated');
    } catch (cause: unknown) {
      if (generation === authRequestGeneration.current) setAuthError(cause instanceof Error ? cause.message : 'Unable to unlock the arena.');
    } finally {
      if (generation === authRequestGeneration.current) setBusy('');
    }
  }

  function requestOnline(action: OnlineAction) {
    requestedMatch.current = true;
    setPendingOnlineAction(action); setAuthOpen(true); setError('');
    void checkSession();
  }

  function closeAuthentication() {
    authRequestGeneration.current += 1;
    setAuthOpen(false); setPendingOnlineAction(null); setPassword(''); setAuthError(''); setBusy('');
  }

  function selection(practice: boolean): JoinOptions {
    const name = driverName.trim() || 'Driver';
    try { localStorage.setItem('battlebots:driver', name); } catch { /* Storage is optional. */ }
    return { botId, paint, name, practice };
  }

  async function createMatch(practice: boolean) {
    if (!connection.current) return;
    setPracticeMatch(practice);
    requestedMatch.current = true;
    authRequestGeneration.current += 1;
    setPendingOnlineAction(null); setAuthOpen(false);
    setBusy(practice ? 'Starting practice' : 'Creating arena'); setError(''); acceptSnapshots.current = true;
    try {
      const id = await connection.current.create(selection(practice));
      activeRoom.current = true; setInRoom(true); setRoomId(id);
      // A headset user can enter VR and finish its permission prompt before combat.
      if (practice && vrStatus.kind !== 'available') connection.current.ready();
    } catch (cause: unknown) {
      acceptSnapshots.current = false;
      setError(cause instanceof Error ? cause.message : 'Could not create this arena.');
    } finally { setBusy(''); }
  }

  async function joinMatch(event: FormEvent) {
    event.preventDefault(); if (!connection.current) return;
    setPracticeMatch(false);
    requestedMatch.current = true;
    setBusy('Joining arena'); setError(''); acceptSnapshots.current = true;
    try {
      const id = roomFromInput(joinCode);
      if (!/^[0-9]{4}$/.test(id)) throw new Error('Enter the four-digit room code or paste its invitation link.');
      await connection.current.join(id, selection(false));
      activeRoom.current = true; setInRoom(true); setRoomId(id); setJoinOpen(false);
    } catch (cause: unknown) {
      acceptSnapshots.current = false;
      setError(cause instanceof Error ? cause.message : 'Could not join this arena.');
    } finally { setBusy(''); }
  }

  async function leaveMatch() {
    await renderer.current?.exitVR().catch(() => undefined);
    if (resultTimer.current) clearTimeout(resultTimer.current);
    setResultVisible(false);
    acceptSnapshots.current = false; activeRoom.current = false; resetInput();
    try { await connection.current?.leave(); } catch { /* A disconnected room can still be left locally. */ }
    setInRoom(false); setSnapshot(null); setRoomId(''); setMyId(null); currentSnapshot.current = null;
    setError(''); setRematchPending(false);
    const next = new URL(window.location.href); next.searchParams.delete('room'); window.history.replaceState(null, '', next);
    renderer.current?.setPreview(botId, paint);
  }

  async function copyVRReport() {
    const report = renderer.current?.getVRReport();
    if (!report) return;
    setVRReport(report);
    try {
      await navigator.clipboard.writeText(report);
      setError('VR report copied.');
    } catch {
      // The report remains selectable when clipboard permission is unavailable.
    }
  }

  const isBusy = busy !== '';
  const result = phase?.kind === 'finished' ? phase.result : null;
  const resultTitle = !result ? '' : result.winnerId === null ? 'A battle well fought.' : result.winnerId === myId ? 'Victory is yours.' : 'Back to the workshop.';
  const immersive = vrStatus.kind === 'active' || vrStatus.kind === 'paused';
  const canEnterVR = vrStatus.kind === 'available';
  async function enterVR() {
    setError('');
    try { await renderer.current?.enterVR(); }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'VR could not start. Try again in your headset browser.'); }
  }
  vrAction.current = (action) => {
    switch (action) {
      case 'weapon': toggleWeapon(); break;
      case 'recover': recover(); break;
      case 'pulverize': pulverize(); break;
      case 'ready': if (currentSnapshot.current?.phase.kind === 'lobby') connection.current?.ready(); break;
      case 'rematch': if (currentSnapshot.current?.phase.kind === 'finished') { connection.current?.rematch(); setRematchPending(true); } break;
      case 'recenter': renderer.current?.recenterVR(); break;
      default: { const unexpected: never = action; throw new Error(`Unknown VR action: ${unexpected}`); }
    }
  };

  return <div className={`app ${inRoom ? 'app--match' : ''} ${immersive ? 'app--vr' : ''}`}>
    <header className="lobby-header" hidden={inRoom}>
      <a href={BASE_PATH} className="wordmark" aria-label="BattleBots Arena home"><span>BATTLE<span className="wordmark-bots">BOTS</span><sup>®</sup></span><small>ARENA</small></a>
      <div className="lobby-header-right"><span className="lobby-edition"><i /> {STATIC_HOSTING ? 'FREE TO PLAY' : 'FRIENDS. RIVALS. ROBOTS.'}</span><button className="icon-button" onClick={() => setMuted(!muted)} aria-label={muted ? 'Turn sound on' : 'Mute sound'}><Icon name={muted ? 'muted' : 'sound'} /></button></div>
    </header>

    <main className={inRoom ? 'match-main' : 'lobby-main'}>
      <section className="lobby-intro" hidden={inRoom}>
        <div><p className="lobby-kicker">IT'S ROBOT FIGHTING TIME</p><h1>PICK YOUR BOT.<br /><span>OWN THE BOX.</span></h1></div>
        <div className="lobby-match-facts"><span><strong>250</strong> LB MACHINES</span><span><strong>3:00</strong> ON THE CLOCK</span><span><Icon name="vr" size={27} />VR READY</span></div>
      </section>

      <div className="arena-layout">
        <section className={`arena-stage ${inRoom ? 'arena-stage--match' : 'lobby-stage'}`} aria-label={inRoom ? '3D BattleBox arena' : `${selectedBot.name} preview`}>
          <canvas ref={canvas} className="arena-canvas" aria-label="Live 3D robot arena" />
          {!rendererReady && !rendererError ? <div className="arena-loading"><span className="loader" /><span>POWERING UP THE BATTLEBOX</span></div> : null}
          {rendererError ? <div className="arena-loading arena-failed"><Icon name="help" size={30} /><strong>Let’s get your arena running.</strong><p>{rendererError}</p><button className="button button-secondary" onClick={() => window.location.reload()}>RELOAD ARENA</button></div> : null}

          {!inRoom ? <>
            <div className="lobby-stage-top"><span className="lobby-preview-label">{overview ? 'THE BATTLEBOX' : 'LIVE GAME PREVIEW'}</span><div className="preview-switch" role="group" aria-label="Preview view">
              <button aria-pressed={previewMode === 'robot'} onClick={() => setPreviewMode('robot')}>Bot</button>
              <button aria-pressed={overview} onClick={() => setPreviewMode('arena')}>Arena</button>
            </div></div>
            <div className="lobby-stage-caption"><div><span className="lobby-bot-edition">{overview ? '48 × 48 FT · ACTIVE HAZARDS' : botVersion}</span><h2>{overview ? 'THE BATTLEBOX' : selectedBot.name}</h2></div><span className="lobby-bot-number" aria-hidden="true">{overview ? '48' : selectedBot.number}</span></div>
          </> : <>
            <div className="match-header"><HealthBar player={local} local /><div className="match-clock"><span>{phase?.kind === 'finished' ? 'MATCH ENDED' : phase?.kind === 'fighting' ? 'ROUND 01' : 'BATTLEBOTS ARENA'}</span><strong>{phase?.kind === 'finished' ? 'FINAL' : phase?.kind === 'fighting' ? formatTime(phase.seconds) : formatTime(MATCH_SECONDS)}</strong><span className={`connection-label ${status === 'connected' || phase?.kind === 'finished' ? '' : 'connection-label--lost'}`}><i />{phase?.kind === 'finished' ? 'COMPLETE' : status === 'connected' ? 'LIVE' : status.toUpperCase()}</span></div><HealthBar player={opponent} /></div>
            {fighting ? <div className={`arena-hazards ${sawCutting ? 'arena-hazards--cutting' : sawWarning ? 'arena-hazards--warning' : ''}`} aria-label="Arena hazard status"><span className="hazard-saws"><i />KILLSAWS {sawUnlockIn > 0 ? <>IN <strong>{formatTime(sawUnlockIn)}</strong></> : <strong>{sawCutting ? 'CUTTING' : sawWarning ? 'WARNING' : 'ARMED'}</strong>}</span><span className="hazard-screws">SCREWS <strong>{snapshot?.arena.hazards.some((hazard) => hazard.kind === 'screw' && hazard.active) ? 'LIVE' : 'STANDBY'}</strong></span></div> : null}
            {fighting && countedOutPlayer ? <div className={`countout-notice ${countedOutPlayer.id === myId ? 'countout-notice--local' : ''}`} role="status" aria-live="off"><strong>{countoutRemaining}</strong><div><span>{countedOutPlayer.id === myId ? 'MOBILITY LOST' : 'OPPONENT IMMOBILIZED'}</span><small>COUNT OUT</small></div></div> : null}
            {fighting && damageNotice ? <div className="damage-notice" role="status"><Icon name="warning" size={19} /><div><strong>{damageNotice.title}</strong><span>{damageNotice.detail}</span></div></div> : null}
            <div className="match-utility"><button className="vr-button" disabled={!immersive && !canEnterVR} aria-label={immersive ? "Exit VR" : canEnterVR ? "Enter VR" : "VR unavailable"} title={!immersive && !canEnterVR ? "VR unavailable" : undefined} onClick={() => { if (immersive) void renderer.current?.exitVR().catch(() => undefined); else if (canEnterVR) void enterVR(); }}><Icon name="vr" size={20} /><span>{immersive ? "EXIT VR" : vrStatus.kind === "entering" ? "STARTING" : "VR"}</span></button>{vrAttempted && !immersive ? <button className="icon-button" onClick={() => void copyVRReport()} aria-label="Copy VR report" title="VR report"><Icon name="copy" /></button> : null}<button className="icon-button" onClick={() => setMuted(!muted)} aria-label={muted ? 'Turn sound on' : 'Mute sound'}><Icon name={muted ? 'muted' : 'sound'} /></button><button className="icon-button" onClick={() => void leaveMatch()} aria-label="Leave match"><Icon name="exit" /></button></div>
            {(phase?.kind === 'lobby' || (!phase && roomId)) ? <div className="match-overlay match-overlay--lobby"><div className="lobby-panel">
              <span className="eyebrow"><span className="status-dot" />{isPractice ? 'PRACTICE READY' : 'YOUR BATTLEBOX IS READY'}</span>
              {!isPractice ? <MatchInvite key={roomId} roomId={roomId} inviteUrl={inviteUrl} /> : null}
              <h2>{isPractice ? 'Ready to rumble?' : opponent ? 'Both bots are here.' : 'Waiting for a challenger.'}</h2>
              <div className="lobby-seats"><span><i className={local?.ready ? 'is-ready' : ''} />{local?.name ?? 'You'} {local?.ready ? '· READY' : ''}</span><span><i className={opponent?.ready ? 'is-ready' : ''} />{opponent?.name ?? 'Waiting for opponent'} {opponent?.ready ? '· READY' : ''}</span></div>
              <button className="button button-primary" disabled={!local || local.ready || status !== 'connected'} onClick={() => connection.current?.ready()}>{local?.ready ? <><Icon name="check" /> READY TO RUMBLE</> : <>I’M READY <Icon name="arrow" /></>}</button>
            </div></div> : null}
            {phase?.kind === 'countdown' ? <div className="countdown-overlay"><span>IT’S ROBOT FIGHTING TIME</span><strong key={Math.ceil(phase.seconds)}>{Math.max(1, Math.ceil(phase.seconds))}</strong><span>COUNTDOWN</span></div> : null}
            {result && !resultVisible ? <div className="finish-callout" role="status">{result.reason === 'draw' ? 'DOUBLE KNOCKOUT' : result.reason === 'timeout' ? 'TIME DECISION' : 'ROBOT DESTROYED'}</div> : null}
            {result && resultVisible ? <div className="match-overlay"><div className="result-panel"><span className="eyebrow">{result.winnerId === myId ? 'THE WINNER’S CIRCLE' : result.winnerId === null ? 'DRAW' : 'EVERY GREAT BOT GETS REBUILT'}</span><h2>{resultTitle}</h2><span className="result-method">{result.reason === 'knockout' ? 'KNOCKOUT' : result.reason === 'timeout' ? 'TIME DECISION' : result.reason === 'forfeit' ? 'FORFEIT' : result.reason.toUpperCase()}</span><div className="result-stats"><div><strong>{Math.round(local?.damageDealt ?? 0)}</strong><span>DAMAGE DEALT</span></div><div><strong>{local?.hits ?? 0}</strong><span>HITS LANDED</span></div><div><strong>{Math.ceil(local?.health ?? 0)}%</strong><span>HULL REMAINING</span></div></div><button className="button button-primary" disabled={rematchPending || status !== 'connected'} onClick={() => { connection.current?.rematch(); setRematchPending(true); }}>{rematchPending ? 'WAITING FOR OPPONENT' : 'RUN IT BACK'}<Icon name="recover" /></button><button className="text-button" onClick={() => void leaveMatch()}>BACK TO THE GARAGE <Icon name="arrow" size={16} /></button></div></div> : null}
            {status === 'reconnecting' || status === 'disconnected' ? <div className="connection-notice" role="status"><span className="loader" /><div><strong>{status === 'reconnecting' ? 'Reconnecting to your arena' : 'Connection interrupted'}</strong><span>Your bot stops safely while disconnected.</span></div>{status === 'disconnected' ? <button className="button button-secondary" onClick={() => { acceptSnapshots.current = true; void connection.current?.reconnect(); }}>RETRY</button> : null}</div> : null}
            {phase?.kind !== 'finished' ? <div className={`touch-controls ${!fighting ? 'touch-controls--inactive' : ''}`}>
              <div className="drive-control"><Joystick disabled={!fighting} onChange={(throttle, steer) => { input.current.throttle = throttle; input.current.steer = steer; renderer.current?.setInput({ ...input.current }); }} /><span>DRIVE</span></div>
              <div className="weapon-controls">
                <div className="aux-controls">
                  {localBot.physics.selfRight ? <button className="recover-control" disabled={!fighting || !local || local.recovering || local.recoveryCooldown > 0} onClick={recover} aria-label={local?.recovering ? 'Witch Doctor is self-righting' : local && local.recoveryCooldown > 0 ? `Self-righting available in ${Math.ceil(local.recoveryCooldown)} seconds` : 'Activate Witch Doctor self-righting'}><Icon name="recover" size={23} /><span>{local?.recovering ? 'RIGHTING…' : local && local.recoveryCooldown > 0 ? `${Math.ceil(local.recoveryCooldown)}s` : 'SELF RIGHT'}</span>{local?.recovering ? <small>{Math.round(local.recoveryProgress * 100)}%</small> : null}</button> : <div className="recover-control recover-control--passive" role="note" aria-label="Tombstone can drive upside down. It has no active self-righting control."><Icon name="rotate" size={23} /><span>INVERTIBLE</span><small>{local?.inverted ? 'UPSIDE DOWN' : 'PASSIVE'}</small></div>}
                  <button className={`pulverizer-control ${hammerMoving ? 'pulverizer-control--moving' : ''}`} disabled={!fighting || status !== 'connected' || hammers.length !== 2 || hammerMoving || hammerCooldown > 0} onClick={pulverize} aria-label={hammerMoving ? 'Your two assigned pulverizers are swinging' : hammerCooldown > 0 ? `Pulverizers ready in ${Math.ceil(hammerCooldown)} seconds` : 'Trigger both assigned corner pulverizers'}><Icon name="hammer" size={21} /><span>PULVERIZERS</span><small>{hammerMoving ? 'SWINGING' : hammerCooldown > 0 ? `${Math.ceil(hammerCooldown)}s` : 'READY'}</small></button>
                </div>
                <button className={`weapon-control ${weaponOn ? 'weapon-control--active' : ''} ${weaponDestroyed ? 'weapon-control--destroyed' : weaponIntegrity < 0.5 ? 'weapon-control--damaged' : ''}`} disabled={!fighting || weaponDestroyed} onClick={toggleWeapon} aria-pressed={weaponOn && !weaponDestroyed} aria-label={weaponDestroyed ? 'Weapon destroyed. It cannot spin up.' : weaponIntegrity < 0.5 ? 'Toggle damaged weapon' : 'Toggle weapon'}><Icon name="weapon" size={29} /><span>{weaponDestroyed ? 'WEAPON OUT' : weaponOn ? 'WEAPON ON' : 'SPIN UP'}</span><small className="weapon-readout"><span>{Math.round(local?.weaponRpm ?? 0).toLocaleString('en-GB')} RPM</span>{weaponIntegrity < 0.5 ? <strong>{weaponDestroyed ? 'OUT' : 'DEGRADED'}</strong> : null}</small></button>
              </div>
            </div> : null}
            {fighting && opponentDirection ? <div className={`opponent-indicator opponent-indicator--${opponentDirection}`}><Icon name="arrow" style={{ transform: opponentDirection === 'left' ? 'rotate(180deg)' : undefined }} /><span>OPPONENT</span></div> : null}
          </>}
        </section>

        <aside className="lobby-setup" hidden={inRoom} aria-label="Choose your bot and play">
          <div className="lobby-roster-heading"><h2>CHOOSE YOUR MACHINE</h2><span>02 BOTS</span></div>
          <div className="lobby-roster" role="group" aria-label="Robot selection">
            {Object.values(BOTS).map((bot) => <button key={bot.id} className={`lobby-bot ${botId === bot.id ? 'lobby-bot--selected' : ''}`} onClick={() => { setBotId(bot.id); setPaint('signature'); setPreviewMode('robot'); }} aria-label={`Select ${bot.name}`} aria-pressed={botId === bot.id}>
              <span className="lobby-bot-photo"><BotPortrait botId={bot.id} decorative /></span><span className="lobby-bot-copy"><strong>{bot.name}</strong><span>{bot.weapon.kind === 'vertical-disc' ? 'Vertical spinner' : 'Horizontal spinner'}</span></span><span className="lobby-bot-check" aria-hidden="true">{botId === bot.id ? <Icon name="check" size={15} /> : null}</span>
            </button>)}
          </div>
          <div className="lobby-specs" aria-label={`${selectedBot.name} capabilities`}>
            <div><span>DRIVE</span><strong>{selectedBot.physics.wheelZ.length * 2} wheels</strong></div><div><span>WEAPON</span><strong>{selectedBot.weapon.kind === 'vertical-disc' ? 'Vertical disc' : 'Horizontal bar'}</strong></div><div><span>RECOVERY</span><strong>{selectedBot.physics.selfRight ? 'Self-righting' : 'Invertible'}</strong></div>
          </div>
          <div className="lobby-play">
            <div className="lobby-mode"><span>{MULTIPLAYER_AVAILABLE ? 'PRIVATE MATCH' : 'SOLO PRACTICE'}</span><span>{MULTIPLAYER_AVAILABLE ? 'You vs. a friend' : 'You vs. House Robot'}</span></div>
            <button className="button button-primary lobby-play-button" onClick={() => MULTIPLAYER_AVAILABLE ? requestOnline('create') : void createMatch(true)} disabled={isBusy || !rendererReady}><span>{isBusy ? busy.toUpperCase() : !rendererReady ? 'PREPARING ARENA…' : MULTIPLAYER_AVAILABLE ? 'CREATE MATCH' : 'FIGHT NOW'}</span>{!rendererReady || isBusy ? <span className="loader" /> : <Icon name="arrow" size={25} />}</button>
            {MULTIPLAYER_AVAILABLE ? <div className="lobby-other-modes"><button className="button button-secondary" onClick={() => requestOnline('join')} disabled={isBusy || !rendererReady}>JOIN FRIEND <Icon name="link" size={16} /></button><button className="button button-secondary" onClick={() => void createMatch(true)} disabled={isBusy || !rendererReady || (!STATIC_HOSTING && authentication !== 'authenticated')}>PRACTICE <Icon name="arrow" size={16} /></button></div> : null}
          </div>
          <details className="lobby-customize"><summary>Customize<span>{PAINTS.find((item) => item.id === paint)?.name}<Icon name="plus" size={15} /></span></summary>
            <div className="lobby-customize-content"><label className="driver-label" htmlFor="driver-name">DRIVER NAME</label><input id="driver-name" className="text-input driver-input" value={driverName} maxLength={20} onChange={(event) => setDriverName(event.target.value)} placeholder="Driver" autoComplete="nickname" />
              <div className="lobby-paint"><span>Bot paint</span><div className="paint-options" role="group" aria-label="Robot paint">{PAINTS.map((option) => <button key={option.id} className={`paint-chip ${paint === option.id ? 'paint-chip--selected' : ''}`} onClick={() => { setPaint(option.id); setPreviewMode('robot'); }} aria-label={`${option.name} paint`} aria-pressed={paint === option.id}><i style={{ backgroundColor: paintColor(botId, option.id) }} />{paint === option.id ? <Icon name="check" size={13} /> : null}</button>)}</div></div>
            </div>
          </details>
        </aside>
      </div>

    </main>

    <footer className="lobby-footer" hidden={inRoom}><span>STEEL. SPARKS. TOTAL DESTRUCTION.</span><span>BATTLEBOTS ARENA <span>V0.8.3</span></span></footer>

    {error ? <div className="toast" role="alert"><Icon name="help" size={18} /><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="Dismiss message"><Icon name="close" size={16} /></button></div> : null}

    {vrReport ? <Modal title="VR report" onClose={() => setVRReport(null)}><textarea className="text-input vr-report" aria-label="VR report" readOnly value={vrReport} onFocus={(event) => event.currentTarget.select()} /></Modal> : null}

    {authOpen && authentication !== 'authenticated' ? <Modal title={authentication === 'checking' ? 'Opening the BattleBox.' : authentication === 'failed' ? 'The arena is warming up.' : 'Enter the BattleBox.'} onClose={STATIC_HOSTING ? closeAuthentication : undefined}>
      {authentication === 'checking' ? <div className="session-loading"><span className="loader" /><p>Connecting to the arena server. The first connection can take a minute.</p></div> : authentication === 'failed' ? <><p>{authError}</p><button className="button button-primary" onClick={() => void checkSession()}>TRY AGAIN <Icon name="recover" /></button></> : <form onSubmit={(event) => void login(event)}><p>Enter the shared arena password to play with a friend.</p><label className="field-label" htmlFor="arena-password">ARENA PASSWORD</label><input id="arena-password" className="text-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" placeholder="Enter your arena password" />{authError ? <p className="form-error" role="alert">{authError}</p> : null}<button className="button button-primary" disabled={isBusy}>{isBusy ? 'UNLOCKING…' : 'UNLOCK THE ARENA'}<Icon name="arrow" /></button></form>}
    </Modal> : null}

    {joinOpen && authentication === 'authenticated' ? <Modal title="Meet in the BattleBox." onClose={() => setJoinOpen(false)}><form onSubmit={(event) => void joinMatch(event)}><label className="field-label" htmlFor="room-code">4-DIGIT ROOM CODE OR INVITATION LINK</label><input id="room-code" className="text-input" value={joinCode} onChange={(event) => setJoinCode(event.target.value)} placeholder="0000" inputMode="numeric" spellCheck={false} autoCapitalize="none" required autoComplete="off" /><div className="join-selection"><span className="join-bot-photo"><BotPortrait botId={botId} decorative /></span><div><small>YOUR MACHINE</small><strong>{selectedBot.name}</strong><span>{driverName.trim() || 'Driver'}</span></div></div><button className="button button-primary" disabled={isBusy}>{isBusy ? 'JOINING…' : 'JOIN THE ARENA'}<Icon name="arrow" /></button></form></Modal> : null}


  </div>;
}
