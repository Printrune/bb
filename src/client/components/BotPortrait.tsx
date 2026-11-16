import type { BotId } from '../../shared/protocol';
import { BASE_PATH } from '../config';

const PORTRAITS = {
  witchdoctor: { file: 'witch-doctor-game.jpg', alt: 'Witch Doctor as rendered in the game', height: 280 },
  tombstone: { file: 'tombstone-game.jpg', alt: 'Tombstone as rendered in the game', height: 320 },
} satisfies Record<BotId, { file: string; alt: string; height: number }>;

export function BotPortrait({ botId, decorative = false }: { botId: BotId; decorative?: boolean }) {
  const portrait = PORTRAITS[botId];
  return <img className="bot-portrait" src={`${BASE_PATH}assets/bots/${portrait.file}`} alt={decorative ? '' : portrait.alt}
    width={420} height={portrait.height} decoding="async" draggable={false} />;
}
