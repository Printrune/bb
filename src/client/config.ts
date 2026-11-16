export const STATIC_HOSTING = import.meta.env.VITE_STATIC_HOSTING === 'true';
export const BASE_PATH = import.meta.env.BASE_URL;
// The Pages site stays on GitHub; only multiplayer traffic uses this endpoint.
export const GAME_SERVER_URL: string = import.meta.env.VITE_GAME_SERVER_URL || window.location.origin;
export const MULTIPLAYER_AVAILABLE = !STATIC_HOSTING || Boolean(import.meta.env.VITE_GAME_SERVER_URL);
