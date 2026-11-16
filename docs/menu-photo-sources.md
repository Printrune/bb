# Menu robot portraits

Version 0.7.7 uses captures of the actual game renderer for selection-card pictures. The main preview is the live game scene. There are no studio photographs in the menu. The game models, materials, lighting, shadows, arena and robot proportions are unchanged.

| Public asset | Capture size | View |
| --- | --- | --- |
| `public/assets/bots/witch-doctor-game.jpg` | 420 × 280 | Witch Doctor, signature paint, front three-quarter |
| `public/assets/bots/tombstone-game.jpg` | 420 × 320 | Tombstone, signature paint, front three-quarter |

The images are browser screenshots of the real `createArena` renderer, cropped to keep the selected bot's full weapon and wheels visible. No generated replacement, studio-photo overlay, recoloring or model substitution is used. Cropping removes the preview controls and the distant rival. The live preview follows the selected paint; the small roster portraits use signature paint.

## Recapture after model changes

Run `node scripts/preview-bot-portraits.mjs`, then open `http://127.0.0.1:3003/scripts/bot-portraits.html`. Select a bot and wait for its model and camera to settle. The fixture imports the same `createArena` entry point as the game and calls its public `setPreview` method. Its canvas is 640 × 480 CSS pixels.

Capture the visible canvas with browser screenshot tools. The current Witch Doctor crop is x=110, y=128, width=420, height=280 relative to the canvas. Tombstone uses x=120, y=109, width=420, height=320. Confirm the full model remains visible after any geometry or camera changes, and adjust framing when needed. Save JPEGs to the paths above. Stop the preview server after capture. The fixture is a development script, not part of the published client.

The official studio originals remain in `assets/reference` for model research. Their sources and model-build baselines are documented in [Robot references](bot-references.md). The previous v0.7.6 photo-menu assets were removed from public output.
