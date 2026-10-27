class SampleWindow {
  constructor(capacity = 450) { this.values = new Float64Array(capacity); this.index = 0; this.count = 0; }
  add(value) { if (!Number.isFinite(value) || value < 0) return; this.values[this.index] = value; this.index = (this.index + 1) % this.values.length; this.count = Math.min(this.count + 1, this.values.length); }
  percentile(p) { if (!this.count) return null; const values = Array.from(this.values.subarray(0, this.count)).sort((a, b) => a - b); return values[Math.min(values.length - 1, Math.ceil(p * values.length) - 1)]; }
  reset() { this.index = this.count = 0; }
}
export class Metrics {
  constructor() { this.frames = new SampleWindow(); this.inference = new SampleWindow(); this.reset('idle'); }
  reset(input) {
    this.input = input; this.frames.reset(); this.inference.reset();
    this.lastFrame = null; this.windowAt = null; this.frameCount = 0; this.inferCount = 0;
    this.fps = null; this.hz = null; this.totalInferences = 0; this.inferenceErrors = 0;
    this.totalFrameIntervals = 0; this.totalInferenceMs = 0;
    this.startedAt = new Date().toISOString(); this.initMs = null; this.activeMs = 0;
    this.samples = []; this.events = []; this.paused = false;
  }
  frame(now) {
    if (this.windowAt === null) this.windowAt = now;
    if (this.lastFrame !== null) { this.frames.add(now - this.lastFrame); this.activeMs += now - this.lastFrame; this.frameCount++; this.totalFrameIntervals++; }
    this.lastFrame = now;
    const elapsed = now - this.windowAt;
    if (elapsed >= 1000) {
      this.fps = this.frameCount * 1000 / elapsed;
      this.hz = this.inferCount * 1000 / elapsed;
      this.frameCount = this.inferCount = 0; this.windowAt = now;
    }
  }
  inferred(duration) {
    if (this.paused || !Number.isFinite(duration) || duration < 0) return;
    this.inference.add(duration); this.inferCount++; this.totalInferences++; this.totalInferenceMs += duration;
  }
  pause() { this.paused = true; this.lastFrame = this.windowAt = null; this.frameCount = this.inferCount = 0; }
  resume() { this.paused = false; }
  event(type, detail = '') {
    this.events.push({ at: new Date().toISOString(), input: this.input, type, detail });
    if (this.events.length > 300) this.events.shift();
  }
  snapshot(extra = {}) {
    return { elapsedSeconds: Number((this.activeMs / 1000).toFixed(2)), input: this.input,
      fps: this.fps, detectionHz: this.input === 'camera' ? this.hz : null,
      sessionAverageFps: this.activeMs > 0 ? this.totalFrameIntervals * 1000 / this.activeMs : null,
      sessionAverageDetectionHz: this.input === 'camera' && this.activeMs > 0 ? this.totalInferences * 1000 / this.activeMs : null,
      sessionMeanInferenceMs: this.input === 'camera' && this.totalInferences > 0 ? this.totalInferenceMs / this.totalInferences : null,
      totalFrameIntervals: this.totalFrameIntervals,
      rollingFrameSamples: this.frames.count, rollingInferenceSamples: this.inference.count,
      frameIntervalP95Ms: this.frames.percentile(0.95), inferenceP50Ms: this.inference.percentile(0.5),
      inferenceP95Ms: this.inference.percentile(0.95), totalInferences: this.totalInferences,
      inferenceErrors: this.inferenceErrors, ...extra };
  }
  record(extra) { this.samples.push(this.snapshot(extra)); if (this.samples.length > 600) this.samples.shift(); }
}
