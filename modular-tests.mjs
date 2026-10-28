import test from 'node:test';
import assert from 'node:assert/strict';
import { embeddedBrowserName, CONFIG } from './config.mjs';
import { ExpressionMachine, extractExpression, DetectionClock } from './expression.mjs';
import { coverTransform, mapLandmark, makeHead, estimateHead, sweepEllipse, reflectVelocity, followHead } from './geometry.mjs';
import { ParticleSystem, ParticleRenderer, roundedPath, popScale } from './particles.mjs';
import { Metrics } from './metrics.mjs';

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

test('anticipation freezes particles briefly, then releases bounded hero stars', () => {
  const p = new ParticleSystem(800, () => .5);
  p.burst(null, 800, 600);
  assert.equal(p.count, 104);
  assert.equal(p.kind.filter((kind, i) => p.active[i] && kind === 2).length, 8);
  const i = p.kind.findIndex((kind, index) => p.active[index] && kind === 2), x = p.x[i], y = p.y[i];
  p.step(.1, null, 800, 600); near(p.x[i], x); near(p.y[i], y);
  p.step(.1, null, 800, 600); p.step(.02, null, 800, 600);
  assert.ok(p.x[i] !== x || p.y[i] !== y);
  p.impact[i] = .28; p.release(i); const reused = p.allocate();
  assert.equal(reused, i); assert.equal(p.impact[i], 0); assert.equal(p.delay[i], 0);
});
test('rain originates near tracked cloud and stays on narrow screens', () => {
  const p = new ParticleSystem(80, () => .5);
  const h = { ...makeHead(), cx: 300, cy: 230, rx: 45, ry: 60, valid: true };
  p.rain(.5, .8, 320, 600, h);
  assert.ok(p.count > 0);
  for (let i = 0; i < p.capacity; i++) if (p.active[i]) {
    assert.ok(p.x[i] > 160 && p.x[i] < 320);
    assert.ok(p.y[i] > 30 && p.y[i] < h.cy);
  }
});

test('single missing detection after cooldown preserves laugh and never re-fires', () => {
  const m = fresh(); let bursts = 0;
  for (let t = 0; t <= 2000; t += 50) bursts += Number(m.update(sample(.8, .8), t).burst);
  m.miss(2050); assert.equal(m.state, 'laugh'); assert.equal(m.tracking, false);
  for (let t = 2100; t <= 2600; t += 50) bursts += Number(m.update(sample(.8, .8), t).burst);
  assert.equal(bursts, 1); assert.equal(m.tracking, true);
  hold(m, sample(.1), 2650, 2950);
  assert.equal(hold(m, sample(.8, .8), 3000, 3300).burst, true);
});
test('missing frames cannot complete pending entrance or exit dwell', () => {
  const m = fresh(); hold(m, sample(.8, .8), 0, 200); m.miss(250);
  assert.equal(m.update(sample(.8, .8), 550).burst, false);
  assert.equal(hold(m, sample(.8, .8), 600, 850).burst, true);
  hold(m, sample(.1), 900, 1100); m.miss(1150);
  assert.equal(m.update(sample(.1), 1400).state, 'laugh');
  assert.equal(hold(m, sample(.1), 1450, 1700).state, 'idle');
});
test('grace period uses last valid sample, repeated misses cannot extend it', () => {
  const m = fresh(); hold(m, sample(.8), 0, 300);
  for (let t = 350; t <= 750; t += 50) m.miss(t);
  assert.equal(m.state, 'smile'); assert.equal(m.tracking, false);
  m.miss(751); assert.equal(m.state, 'no-face');
  assert.equal(m.update(sample(.8), 800).state, 'idle');
  assert.equal(hold(m, sample(.8), 850, 1100).state, 'smile');
});
test('deadline cadence stays near 15 Hz on jittering refresh rates and never catches up', () => {
  for (const hz of [30, 60, 120]) {
    const clock = new DetectionClock(15); let count = 0;
    for (let frame = 0; frame < hz * 10; frame++) {
      const now = frame * 1000 / hz + (frame % 2 ? .3 : -.3);
      count += Number(clock.due(now));
    }
    assert.ok(count >= 149 && count <= 151, `${hz} Hz: ${count}`);
    assert.equal(clock.due(20000), true); assert.equal(clock.due(20000), false); assert.equal(clock.due(20001), false);
    clock.reset(); assert.equal(clock.due(0), true);
  }
});
test('rain is suspended immediately without a valid head', () => {
  const p = new ParticleSystem(80);
  p.rain(.5, 1, 600, 600, null); assert.equal(p.count, 0);
  p.rain(.5, 1, 600, 600, { valid:false }); assert.equal(p.count, 0);
});
test('rain crossing head is consumed into bounded splashes; stale head has no collision', () => {
  const p = new ParticleSystem(80), h = { ...makeHead(), cx:100, cy:100, rx:30, ry:50, valid:true };
  const arrays = [p.splashX,p.splashLife];
  const spawn = () => { const i=p.allocate(); p.kind[i]=0;p.x[i]=100;p.y[i]=0;p.vx[i]=0;p.vy[i]=700;p.life[i]=2;p.size[i]=5;return i; };
  for(let n=0;n<100;n++) {const i=spawn();p.step(.1,h,600,600);assert.equal(p.active[i],0);}
  assert.equal(p.splashes,100); assert.equal(p.splashLife.length,32); assert.equal(p.collisions,0);
  p.step(.4,null,600,600);assert.ok(p.splashLife.every(v=>v===0));
  const i=spawn();p.step(.1,{...h,valid:false},600,600);assert.equal(p.active[i],1);assert.equal(p.splashes,100);
  p.clear();assert.deepEqual([p.splashX,p.splashLife],arrays);
});
test('only middle depth stars collide; rear and foreground decoration pass through', () => {
  const p=new ParticleSystem(80),h={...makeHead(),cx:100,cy:100,rx:30,ry:50,valid:true};const ids=[];
  for(let layer=0;layer<3;layer++){const i=p.allocate();ids.push(i);p.kind[i]=1;p.depth[i]=layer;p.x[i]=100;p.y[i]=0;p.vx[i]=0;p.vy[i]=700;p.life[i]=2;p.size[i]=5;}
  p.step(.1,h,600,600);assert.ok(p.vy[ids[0]]>0);assert.ok(p.vy[ids[1]]<0);assert.ok(p.vy[ids[2]]>0);
});
test('three waves release in order and entry overshoot settles to one', () => {
  const p=new ParticleSystem(800,()=>.5);p.burst(null,800,600);
  const started=()=>Array.from(p.active).reduce((n,a,i)=>n+Number(a&&p.life[i]<p.maxLife[i]),0);
  for(let n=0;n<21;n++)p.step(.01,null,800,600);assert.equal(started(),8);
  for(let n=0;n<8;n++)p.step(.01,null,800,600);assert.equal(started(),32);
  for(let n=0;n<8;n++)p.step(.01,null,800,600);assert.equal(started(),104);
  near(popScale(0),0);assert.ok(popScale(.2)>1);near(popScale(.3),1);near(popScale(1),1);
});
test('renderer initializes without roundRect and masks only rear particles before front drawing', () => {
  const original=globalThis.document, events=[]; let rendering=false;
  const makeContext = () => {
    const c={ globalAlpha:1,globalCompositeOperation:'source-over' };
    for(const key of ['translate','rotate','scale','moveTo','lineTo','quadraticCurveTo','bezierCurveTo','closePath','stroke','beginPath','ellipse','arc','fillRect','clearRect','setTransform','setLineDash','strokeText','fillText','clip']) c[key]=()=>{};
    const stack=[];c.save=()=>stack.push(c.globalCompositeOperation);c.restore=()=>{c.globalCompositeOperation=stack.pop()};
    c.fill=()=>{if(rendering)events.push(c.globalCompositeOperation)};
    c.drawImage=img=>{if(rendering)events.push(img)};
    c.createLinearGradient=c.createRadialGradient=()=>{assert.equal(rendering,false,'no per-frame gradients');return{addColorStop(){}}};
    return c;
  };
  globalThis.document={createElement:()=>({getContext:()=>makeContext()})};
  try {
    const ctx=makeContext(), renderer=new ParticleRenderer({getContext:()=>ctx});renderer.resize(400,400,1);
    const p=new ParticleSystem(3);
    for(let layer=0;layer<3;layer++){const i=p.allocate();p.depth[i]=layer;p.kind[i]=2;p.color[i]=layer;p.size[i]=10;p.life[i]=2;p.maxLife[i]=3;p.x[i]=p.y[i]=200;}
    rendering=true;renderer.draw(p,{...makeHead(),valid:true,cx:200,cy:200,rx:50,ry:60},{now:1000});
    assert.deepEqual(events,[renderer.stickers[0][0],'destination-out',renderer.stickers[1][0],renderer.stickers[2][0]]);
  } finally {globalThis.document=original;}
});

test('laugh exit requires a fresh 300 ms smile without returning to neutral', () => {
  for (const step of [50, 100, 150]) {
    const m = fresh(); hold(m, sample(.8, .8), 0, 300, step);
    const start = 300 + step, exit = start + 300;
    hold(m, sample(.7, .1), start, exit, step);
    assert.equal(m.state, 'idle');
    assert.equal(m.smileLatch.pendingAt, exit);
    for (let t = exit + step; t < exit + 300; t += step) assert.equal(m.update(sample(.7, .1), t).state, 'idle');
    assert.equal(m.update(sample(.7, .1), exit + 300).state, 'smile');
  }
});
test('brief residual smile after laugh never starts rain', () => {
  const m = fresh(); hold(m, sample(.8, .8), 0, 300);
  hold(m, sample(.7), 350, 650); assert.equal(m.state, 'idle');
  hold(m, sample(.7), 700, 850); assert.equal(m.state, 'idle');
  hold(m, sample(.1), 900, 1300); assert.equal(m.state, 'idle');
  // A residual score in the old hysteresis band cannot inherit smile either.
  hold(m, sample(.8, .8), 1350, 1650);
  hold(m, sample(.3), 1700, 2600); assert.equal(m.state, 'idle');
});
test('missing input restarts post-laugh smile confirmation; renewed laugh retains priority', () => {
  const m = fresh(); hold(m, sample(.8, .8), 0, 300);
  hold(m, sample(.7), 350, 850); m.miss(900);
  assert.equal(m.update(sample(.7), 950).state, 'idle');
  hold(m, sample(.7), 1000, 1200); assert.equal(m.state, 'idle');
  assert.equal(m.update(sample(.7), 1250).state, 'smile');
  hold(m, sample(.8, .8), 1300, 1600);
  hold(m, sample(.7), 1650, 1950); assert.equal(m.state, 'idle');
  const result = hold(m, sample(.8, .8), 2000, 2300);
  assert.equal(result.state, 'laugh'); assert.equal(result.burst, true);
});


test('hero stars start separated inside the stage, with matching previous positions', () => {
  for (const width of [320, 390, 600]) {
    const pool = new ParticleSystem(800, () => .5);
    pool.burst({ ...makeHead(), valid:true, cx:width / 2, cy:60, rx:50, ry:65, angle:0 }, width, 568);
    const positions = new Set(); let heroes = 0;
    for (let i=0;i<pool.capacity;i++) {
      if (!pool.active[i] || pool.kind[i] !== 2) continue;
      heroes++; positions.add(`${pool.x[i]},${pool.y[i]}`);
      assert.ok(pool.x[i]>=8 && pool.x[i]<=width-8 && pool.y[i]>=8 && pool.y[i]<=560);
      near(pool.x[i],pool.px[i]); near(pool.y[i],pool.py[i]);
      assert.equal(pool.depth[i],1);
    }
    assert.equal(heroes,8); assert.equal(positions.size,8); assert.equal(pool.count,104);
  }
});

test('session averages retain all samples after rolling windows wrap', () => {
  const m = new Metrics(); m.reset('camera'); m.frame(0);
  let t = 0;
  for (let i = 0; i < 600; i++) { t += 10; m.frame(t); m.inferred(4); }
  for (let i = 0; i < 600; i++) { t += 20; m.frame(t); m.inferred(12); }
  const s = m.snapshot();
  near(s.sessionAverageFps, 1200 / 18);
  near(s.sessionAverageDetectionHz, 1200 / 18);
  near(s.sessionMeanInferenceMs, 8);
  assert.equal(s.totalFrameIntervals, 1200);
  assert.equal(s.rollingFrameSamples, 450); assert.equal(s.rollingInferenceSamples, 450);
  assert.equal(s.frameIntervalP95Ms, 20); assert.equal(s.inferenceP95Ms, 12);
});
test('session averages exclude hidden gaps, retain foreground stalls, and reset cleanly', () => {
  const m = new Metrics(); m.reset('camera'); m.frame(0); m.frame(20); m.inferred(8);
  m.pause(); m.inferred(100); m.resume(); m.frame(100000); m.frame(100020); m.inferred(12);
  near(m.snapshot().sessionAverageFps, 50); near(m.snapshot().sessionAverageDetectionHz, 50);
  near(m.snapshot().sessionMeanInferenceMs, 10);
  m.frame(100220);
  near(m.snapshot().sessionAverageFps, 3000 / 240);
  assert.equal(m.snapshot().elapsedSeconds, .24);
  m.reset('camera');
  assert.equal(m.snapshot().sessionAverageFps, null); assert.equal(m.snapshot().sessionAverageDetectionHz, null);
  assert.equal(m.snapshot().sessionMeanInferenceMs, null); assert.equal(m.snapshot().totalInferences, 0);
});
test('preview reports rendering averages without camera metrics and invalid inference samples are ignored', () => {
  const m = new Metrics(); m.reset('preview'); m.frame(0); m.frame(25);
  near(m.snapshot().sessionAverageFps, 40);
  assert.equal(m.snapshot().sessionAverageDetectionHz, null); assert.equal(m.snapshot().sessionMeanInferenceMs, null);
  m.reset('camera'); m.frame(0); m.frame(50);
  for (const invalid of [NaN, Infinity, -1]) m.inferred(invalid);
  assert.equal(m.snapshot().totalInferences, 0); assert.equal(m.snapshot().sessionMeanInferenceMs, null);
});

test('embedded-browser advice does not misclassify Safari or Chrome', () => {
  assert.equal(embeddedBrowserName('Mozilla/5.0 MicroMessenger/8.0'), '微信');
  assert.equal(embeddedBrowserName('Mozilla/5.0 Lark/7.0'), '飞书');
  assert.equal(embeddedBrowserName('Mozilla/5.0 aweme/29.0'), '抖音 / TikTok');
  assert.equal(embeddedBrowserName('Mozilla/5.0 Version/18.0 Mobile Safari/605.1'), null);
  assert.equal(embeddedBrowserName('Mozilla/5.0 Chrome/130 Safari/537.36'), null);
});
