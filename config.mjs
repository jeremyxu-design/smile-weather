export const VERSION = '0.5.1';
export const MEDIAPIPE_VERSION = '0.10.35';
export const ASSETS = {
  bundle: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs',
  wasm: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',
  model: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
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
