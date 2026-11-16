import { createArena } from '../src/client/game/arena';
import { BOTS, type BotId } from '../src/shared/protocol';

const canvas = document.querySelector<HTMLCanvasElement>('#portrait');
const status = document.querySelector<HTMLElement>('#status');
if (!canvas || !status) throw new Error('Portrait preview elements are missing.');
const renderer = await createArena(canvas, {
  onStatus() {}, onDrive() {}, onAction() {}, onFrame() {},
});
renderer.setMuted(true);
function select(botId: BotId): void {
  renderer.setPreview(botId, 'signature');
  if (status) status.textContent = `${BOTS[botId].name}: actual game model, materials and arena lighting. Capture after the camera settles.`;
}
for (const bot of Object.values(BOTS)) {
  document.getElementById(bot.id)?.addEventListener('click', () => select(bot.id));
}
select('witchdoctor');
window.addEventListener('pagehide', () => renderer.dispose(), { once: true });
