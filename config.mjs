export const VERSION = '0.5.3';
export const MEDIAPIPE_VERSION = '0.10.35';
export const ASSETS = {
  bundle: new URL('./vendor/mediapipe/vision_bundle.mjs', import.meta.url).href,
  wasm: new URL('./vendor/mediapipe/wasm', import.meta.url).href,
  model: new URL('./models/face_landmarker.task', import.meta.url).href,
};
export const CONFIG = Object.freeze({
  renderHz: 60,
  detectionHz: 15,
  staleMs: 450,
  smoothingMs: 75,
  dwellMs: 300,
  cooldownMs: 1500,
  smileEnter: 0.40,
  smileExit: 0.25,
  laughSmileEnter: 0.50,
  laughSmileExit: 0.35,
  jawEnter: 0.50,
  jawExit: 0.35,
  particleLimit: 800,
  lowParticleLimit: 400,
  gravity: 260,
  restitution: 0.68,
  headPadding: 0.15,
});
export const PALETTE = ['#25f4ee', '#fe2c55', '#f8f4f0', '#ff91b2', '#b3a4ff', '#c3ff5c'];

// Advisory only: embedded browsers may support camera in some versions.
export function embeddedBrowserName(ua = '') {
  if (/MicroMessenger/i.test(ua)) return '微信';
  if (/Lark|Feishu/i.test(ua)) return '飞书';
  if (/aweme|BytedanceWebview|musical_ly|TikTok/i.test(ua)) return '抖音 / TikTok';
  return null;
}
