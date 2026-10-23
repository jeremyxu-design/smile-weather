import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./index.html', import.meta.url), 'utf8').split('// CORE_START\n')[1].split('// CORE_END')[0];
const {CONFIG, ExpressionMachine, extractExpression, coverTransform, mapLandmark, makeHead, estimateHead, sweepEllipse, reflectVelocity, followHead, ParticleSystem, Metrics} = await import('data:text/javascript,' + encodeURIComponent(source + '\nexport {CONFIG, ExpressionMachine, extractExpression, coverTransform, mapLandmark, makeHead, estimateHead, sweepEllipse, reflectVelocity, followHead, ParticleSystem, Metrics};'));
import test from 'node:test';
import assert from 'node:assert/strict';

const sample = (smile, jaw = 0.1) => ({ smile, jaw });
const fresh = () => new ExpressionMachine({ ...CONFIG, smoothingMs: 0 });
function hold(m, s, start, end, step = 50) { let r; for (let t = start; t <= end; t += step) r = m.update(s, t); return r; }
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} ≈ ${b}`);

test('named blendshapes are order independent; missing and nonfinite outputs are unknown', () => {
  const r = { faceLandmarks: [[{}]], faceBlendshapes: [{ categories: [
    { categoryName: 'jawOpen', score: .6 }, { categoryName: 'mouthSmileRight', score: .8 }, { categoryName: 'mouthSmileLeft', score: .6 }
  ] }] };
  assert.deepEqual(extractExpression(r), sample(.7, .6));
  assert.equal(extractExpression({}), null);
  r.faceBlendshapes[0].categories[0].score = NaN;
  assert.equal(extractExpression(r), null);
});
test('300 ms is time based at different sampling rates, and brief spikes do not switch', () => {
  for (const step of [20, 50, 100, 150]) {
    const m = fresh();
    hold(m, sample(.7), 0, 300 - step, step);
    assert.equal(m.state, 'idle');
    assert.equal(m.update(sample(.7), 300).state, 'smile');
  }
  const m = fresh(); hold(m, sample(.7), 0, 200);
  m.update(sample(.1), 250); hold(m, sample(.7), 300, 550);
  assert.equal(m.state, 'idle');
});
test('hysteresis holds in the threshold gap; smile has no jaw dead zone', () => {
  const m = fresh(); hold(m, sample(.45, .4), 0, 300);
  assert.equal(m.state, 'smile');
  hold(m, sample(.3, .4), 350, 900); assert.equal(m.state, 'smile');
  hold(m, sample(.25, .4), 950, 1250); assert.equal(m.state, 'idle');
});
test('laugh has priority, edge trigger never repeats while held', () => {
  const m = fresh(); const first = hold(m, sample(.8, .8), 0, 300);
  assert.equal(first.state, 'laugh'); assert.equal(first.burst, true);
  for (let t = 350; t <= 6000; t += 50) assert.equal(m.update(sample(.8, .8), t).burst, false);
});
test('cooldown suppresses early re-entry without a delayed burst; new entry rearms', () => {
  const m = fresh(); hold(m, sample(.8, .8), 0, 300);
  hold(m, sample(.1), 350, 650); assert.equal(m.state, 'idle');
  assert.equal(hold(m, sample(.8, .8), 700, 1000).burst, false);
  assert.equal(hold(m, sample(.8, .8), 1050, 1900).burst, false);
  hold(m, sample(.1), 1950, 2250);
  assert.equal(hold(m, sample(.8, .8), 2300, 2600).burst, true);
});
test('tracking loss and stale frames reset dwell but preserve cooldown', () => {
  const m = fresh(); hold(m, sample(.8, .8), 0, 300); m.lose();
  assert.equal(hold(m, sample(.8, .8), 350, 650).burst, false);
  m.expire(1200); assert.equal(m.state, 'no-face');
  assert.equal(m.update(sample(.8, .8), 1300).state, 'idle');
  m.update(sample(.8, .8), 2000); assert.equal(m.state, 'idle');
});
test('cover transform and mirror use the same cropped CSS coordinates', () => {
  const plain = coverTransform(640, 480, 300, 600, false);
  const mirror = coverTransform(640, 480, 300, 600, true);
  assert.deepEqual(mapLandmark({ x: .5, y: .5 }, plain), { x: 150, y: 300 });
  const a = mapLandmark({ x: .7, y: .25 }, plain), b = mapLandmark({ x: .7, y: .25 }, mirror);
  near(a.x + b.x, 300); near(a.y, b.y);
});
test('head fit uses eye rotation, padding, and mirrored orientation', () => {
  const points = Array(264); points[33] = { x: .4, y: .45 }; points[263] = { x: .6, y: .45 };
  points[0] = { x: .3, y: .3 }; points[1] = { x: .7, y: .3 };
  points[2] = { x: .7, y: .7 }; points[3] = { x: .3, y: .7 };
  for (const mirror of [false, true]) {
    const h = estimateHead(points, [0, 1, 2, 3], coverTransform(1000, 1000, 1000, 1000, mirror));
    near(h.cx, 500); near(h.cy, 470); near(h.rx, 200); near(h.ry, 230); near(h.angle, 0);
  }
  points[33] = undefined;
  assert.equal(estimateHead(points, [0, 1, 2, 3], coverTransform(1, 1, 1, 1)), null);
});
test('fast sparks crossing the entire head collide even when endpoints are outside', () => {
  const h = { ...makeHead(), cx: 100, cy: 100, rx: 30, ry: 50, valid: true }, hit = {}, out = {};
  assert.equal(sweepEllipse(100, 0, 100, 200, h, 2, .016, hit), true);
  near(hit.t, .24); near(hit.ny, -1);
  assert.equal(reflectVelocity(0, 700, hit, .68, out), true); assert.ok(out.vy < 0);
  assert.equal(sweepEllipse(0, 0, 0, 200, h, 2, .016, hit), false);
});
test('rotated ellipse responds along its surface normal and moving head transfers momentum', () => {
  const h = { ...makeHead(), cx: 100, cy: 100, rx: 30, ry: 50, angle: Math.PI / 4, valid: true }, hit = {}, out = {};
  assert.ok(sweepEllipse(100, 0, 100, 120, h, 0, .016, hit));
  assert.ok(Math.abs(hit.nx) > .1);
  reflectVelocity(0, 100, { nx: 0, ny: -1, hvx: 0, hvy: -200 }, .68, out);
  near(out.vy, -404);
});
test('lost head disables collisions and smoothing handles mirrored angle wrapping', () => {
  const h = makeHead(); followHead(h, { cx: 100, cy: 100, rx: 40, ry: 50, angle: .2, valid: true }, .01);
  assert.ok(h.valid); followHead(h, null, .01); assert.equal(h.valid, false);
  assert.equal(sweepEllipse(100, 0, 100, 200, h, 2, .016, {}), false);
});
test('particle pool remains bounded through many bursts, releases and refills', () => {
  const p = new ParticleSystem(80, () => .3); const arrays = [p.x, p.vx, p.active, p.free];
  for (let round = 0; round < 100; round++) {
    p.burst(null, 800, 600); p.rain(.1, .7, 800, 600);
    p.step(.1, null, 800, 600);
    assert.ok(p.count <= 80); assert.equal(p.count + p.freeCount, 80);
    for (let i = 0; i < 80; i++) if (p.active[i]) assert.ok(Number.isFinite(p.x[i] + p.y[i] + p.vx[i] + p.vy[i]));
  }
  assert.deepEqual([p.x, p.vx, p.active, p.free], arrays);
  for (let i = 0; i < 60; i++) p.step(.1, null, 800, 600);
  assert.equal(p.count, 0); assert.equal(p.freeCount, 80);
  p.burst(null, 800, 600); assert.ok(p.count > 0);
});
test('resize particle reset preserves session collision evidence', () => {
  const p = new ParticleSystem(80); p.collisions = 12; p.peak = 70;
  p.clear({ keepStats: true }); assert.equal(p.collisions, 12); assert.equal(p.peak, 70); assert.equal(p.count, 0);
  p.clear(); assert.equal(p.collisions, 0);
});
test('metrics exclude hidden time and preview does not claim inference measurements', () => {
  const m = new Metrics(); m.reset('preview');
  for (let t = 0; t <= 1000; t += 20) m.frame(t);
  near(m.snapshot().fps, 50); assert.equal(m.snapshot().detectionHz, null);
  assert.equal(m.snapshot().inferenceP95Ms, null);
  m.pause(); m.resume(); m.frame(100000); m.frame(100020);
  assert.equal(m.activeMs, 1020); assert.equal(m.snapshot().frameIntervalP95Ms, 20);
});
test('collision feedback uses a bounded reusable marker pool and expires', () => {
  const p = new ParticleSystem(80);
  const h = { ...makeHead(), cx: 100, cy: 100, rx: 30, ry: 50, valid: true };
  const i = p.allocate();
  p.kind[i] = 1; p.x[i] = 100; p.y[i] = 0; p.vx[i] = 0; p.vy[i] = 700;
  p.life[i] = p.maxLife[i] = 2; p.size[i] = 5;
  const buffers = [p.hitX, p.hitY, p.hitLife];
  p.step(.1, h, 800, 600);
  assert.ok(p.collisions > 0); assert.ok(p.hitLife.some(life => life > 0));
  assert.ok(p.vy[i] < 0); assert.equal(p.hitLife.length, 24);
  p.release(i); p.step(.3, h, 800, 600);
  assert.ok(p.hitLife.every(life => life === 0));
  p.clear(); assert.deepEqual([p.hitX, p.hitY, p.hitLife], buffers);
});
