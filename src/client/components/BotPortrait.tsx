import type { BotId } from '../../shared/protocol';
import { BASE_PATH } from '../config';

const PORTRAITS = {
  witchdoctor: { file: 'witch-doctor-wcvii.jpg', alt: 'Witch Doctor with its green armor, ribcage and vertical spinning disc' },
  tombstone: { file: 'tombstone-2021.jpg', alt: 'Tombstone with its exposed wheels and massive horizontal steel blade' },
} satisfies Record<BotId, { file: string; alt: string }>;

export function BotPortrait({ botId, decorative = false, featured = false }: { botId: BotId; decorative?: boolean; featured?: boolean }) {
  const portrait = PORTRAITS[botId];
  return <img className="bot-portrait" src={`${BASE_PATH}assets/bots/${portrait.file}`} alt={decorative ? '' : portrait.alt}
    width={1140} height={760} decoding="async" fetchPriority={featured ? 'high' : 'auto'} draggable={false} />;
}
