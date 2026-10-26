import { CONFIG } from './config.mjs';

class HeldThreshold {
  constructor() { this.reset(); }
  reset() { this.on = false; this.pendingAt = null; }
  update(enter, exit, now, dwell) {
    const wantsChange = this.on ? exit : enter;
    if (!wantsChange) this.pendingAt = null;
    else {
      if (this.pendingAt === null) this.pendingAt = now;
      if (now - this.pendingAt >= dwell) {
        this.on = !this.on;
        this.pendingAt = null;
      }
    }
    return this.on;
  }
}

// Accept only named, finite outputs. A missing output is not a neutral expression.
export function extractExpression(result) {
  const categories = result.faceBlendshapes?.[0]?.categories;
  if (!result.faceLandmarks?.[0]?.length || !categories?.length) return null;
  let left, right, jaw;
  for (const category of categories) {
    if (category.categoryName === 'mouthSmileLeft') left = category.score;
    if (category.categoryName === 'mouthSmileRight') right = category.score;
    if (category.categoryName === 'jawOpen') jaw = category.score;
  }
  if (![left, right, jaw].every(Number.isFinite)) return null;
  return { smile: Math.max(0, Math.min(1, (left + right) / 2)), jaw: Math.max(0, Math.min(1, jaw)) };
}

export class ExpressionMachine {
  constructor(config = CONFIG) {
    this.config = config;
    this.smileLatch = new HeldThreshold();
    this.laughLatch = new HeldThreshold();
    this.lastBurst = -Infinity;
    this.lastSample = null;
    this.smile = 0;
    this.jaw = 0;
    this.state = 'no-face';
    this.tracking = false;
  }
  lose() {
    this.smileLatch.reset();
    this.laughLatch.reset();
    this.lastSample = null;
    this.smile = 0;
    this.jaw = 0;
    this.state = 'no-face';
    this.tracking = false;
    // Keep the cooldown across tracking loss, so reacquisition cannot bypass it.
    return { state: this.state, burst: false, smile: 0, jaw: 0 };
  }
  miss(now) {
    this.tracking = false;
    // A gap never contributes to the 300 ms continuous-evidence window.
    this.smileLatch.pendingAt = this.laughLatch.pendingAt = null;
    if (this.lastSample === null || now - this.lastSample > this.config.staleMs || now < this.lastSample) return this.lose();
    return { state: this.state, burst: false, smile: this.smile, jaw: this.jaw };
  }
  update(sample, now) {
    const c = this.config;
    if (!sample || !Number.isFinite(sample.smile) || !Number.isFinite(sample.jaw)) return this.miss(now);
    if (this.lastSample !== null && (now - this.lastSample > c.staleMs || now < this.lastSample)) this.lose();
    const first = this.lastSample === null || !this.tracking;
    this.tracking = true;
    const alpha = first || c.smoothingMs <= 0 ? 1 : 1 - Math.exp(-(now - this.lastSample) / c.smoothingMs);
    this.smile += (sample.smile - this.smile) * alpha;
    this.jaw += (sample.jaw - this.jaw) * alpha;
    this.lastSample = now;
    const before = this.state;
    this.laughLatch.update(
      this.smile >= c.laughSmileEnter && this.jaw >= c.jawEnter,
      this.smile <= c.laughSmileExit || this.jaw <= c.jawExit,
      now, c.dwellMs,
    );
    // Laugh also satisfies smile. Discard that inherited latch on confirmed
    // laugh exit, then require fresh smile evidence; neutral is not required.
    if (before === 'laugh' && !this.laughLatch.on) this.smileLatch.reset();
    this.smileLatch.update(this.smile >= c.smileEnter, this.smile <= c.smileExit, now, c.dwellMs);
    this.state = this.laughLatch.on ? 'laugh' : this.smileLatch.on ? 'smile' : 'idle';
    const burst = this.state === 'laugh' && before !== 'laugh' && now - this.lastBurst >= c.cooldownMs;
    if (burst) this.lastBurst = now;
    return { state: this.state, burst, smile: this.smile, jaw: this.jaw };
  }
  expire(now) {
    if (this.lastSample !== null && now - this.lastSample > this.config.staleMs) this.lose();
    return this.state;
  }
  cooldownRemaining(now) { return Math.max(0, this.config.cooldownMs - (now - this.lastBurst)); }
}

// Phase-preserving target cadence. Skip missed slots; never run a catch-up loop.
export class DetectionClock {
  constructor(hz = CONFIG.detectionHz) { this.interval = 1000 / hz; this.reset(); }
  reset() { this.nextAt = null; this.lastAt = null; }
  due(now) {
    if (this.nextAt === null || now < this.lastAt) { this.lastAt = now; this.nextAt = now + this.interval; return true; }
    if (now + 0.5 < this.nextAt) return false;
    this.nextAt = now - this.nextAt >= this.interval ? now + this.interval : this.nextAt + this.interval;
    this.lastAt = now;
    return true;
  }
}
