import { ASSETS, embeddedBrowserName, CONFIG, MEDIAPIPE_VERSION, VERSION } from './config.mjs';
import { ExpressionMachine, extractExpression, DetectionClock } from './expression.mjs';
import { clamp, makeHead, coverTransform, estimateHead, indicesFromConnections, followHead } from './geometry.mjs';
import { ParticleSystem, ParticleRenderer } from './particles.mjs';
import { Metrics } from './metrics.mjs';

const $ = id => document.getElementById(id);
const embeddedBrowser = embeddedBrowserName(navigator.userAgent);
const video = $('camera'), stage = $('stage'), canvas = $('effects');
const machine = new ExpressionMachine();
const detectionClock = new DetectionClock();
const pool = new ParticleSystem();
const renderer = new ParticleRenderer(canvas);
renderer.drawPoster($('weather-poster'));
const metrics = new Metrics();
const head = makeHead();
let target = null, lastLandmarks = null, ovalIndices = [];
let mode = 'idle', stream = null, model = null, modelModule = null, backend = null;
let sessionToken = 0, frameHandle = null, lastFrameAt = null;
let lastVideoTime = -1, lastResultAt = null, lastUiAt = 0, lastRecordAt = 0, lastState = 'no-face';
let width = 1, height = 1, mirrored = true, lowQuality = false, showCollider = false;
let previewMissingUntil = 0;
let previewChoice = 'idle', previewX = 0.5, previewY = 0.46;
let flash = null, priorCollisions = 0, collisionHighlightUntil = 0, lastBurstAt = -Infinity;
let captureSettings = null, finalSnapshot = null, initialTime = null, missingOutput = false;
let loadingTimer = null, dragging = false, consecutiveInferenceErrors = 0;
let renderScheduleAt = null;
let hintUntil = 0, toastTimer = null, sheetTrigger = null;

function setMode(next) {
  mode = next; stage.dataset.mode = next;
  hintUntil = performance.now() + 7000;
  $('switch-camera').hidden = next === 'camera' || next === 'loading';
  $('welcome').hidden = next !== 'idle';
  $('loading').hidden = next !== 'loading';
  $('preview-controls').hidden = next !== 'preview';
  $('simulate-miss').hidden = next !== 'preview';
  $('stage-hint').hidden = next === 'idle' || next === 'loading';
  $('stop').hidden = next === 'idle';
  $('input-label').textContent = { idle: '等待开启', loading: '正在准备', camera: '实时摄像头', preview: '效果预览 · 模拟输入' }[next];
  $('start').disabled = next === 'loading';
}
function setSessionStatus(text, active = false) {
  $('session-status').textContent = text;
  $('session-dot').classList.toggle('muted-dot', !active);
}
function hideError() { $('error-panel').hidden = true; }
function showError(title, copy) { $('browser-help').hidden = false; $('error-title').textContent = title; $('error-copy').textContent = copy; $('error-panel').hidden = false; }
function previewTarget() {
  const rx = Math.min(width * 0.15, 105);
  return { cx: previewX * width, cy: previewY * height, rx, ry: rx * 1.22, angle: (previewX - 0.5) * 0.3, valid: true };
}
function mapHead() {
  if (!lastLandmarks || !video.videoWidth || !video.videoHeight) return null;
  return estimateHead(lastLandmarks, ovalIndices, coverTransform(video.videoWidth, video.videoHeight, width, height, mirrored), CONFIG.headPadding);
}
function resize() {
  const rect = stage.getBoundingClientRect();
  width = rect.width; height = rect.height;
  renderer.resize(width, height, Math.min(window.devicePixelRatio || 1, lowQuality ? 1 : 1.5));
  pool.clear({ keepStats: true }); head.valid = false;
  target = mode === 'preview' ? previewTarget() : mapHead();
  if (target) followHead(head, target, 1 / 60);
  renderer.draw(pool, head, { preview: mode === 'preview', expression: machine.state, debug: showCollider });
}
new ResizeObserver(resize).observe(stage);

function snapshot() {
  return { state: machine.state, particles: pool.count, peakParticles: pool.peak, collisionEvents: pool.collisions, splashEvents: pool.splashes, tracking: machine.tracking,
    resultAgeMs: lastResultAt === null ? null : Math.max(0, performance.now() - lastResultAt),
    quality: lowQuality ? 'low' : 'standard', backend, capture: captureSettings,
    canvas: { width: Math.round(width), height: Math.round(height), pixelRatio: renderer.dpr }, hidden: document.hidden };
}
function resetSession(input) {
  machine.lose(); machine.lastBurst = -Infinity;
  pool.clear(); head.valid = false; target = null; lastLandmarks = null;
  lastResultAt = null; lastVideoTime = -1; detectionClock.reset(); previewMissingUntil = 0; lastFrameAt = null;
  lastUiAt = lastRecordAt = 0; priorCollisions = 0; collisionHighlightUntil = 0;
  flash = null; lastBurstAt = -Infinity; lastState = 'no-face'; finalSnapshot = null; missingOutput = false; consecutiveInferenceErrors = 0;
  metrics.reset(input); $('export').disabled = false;
}
function cancelLoop() { if (frameHandle !== null) cancelAnimationFrame(frameHandle); frameHandle = null; lastFrameAt = null; renderScheduleAt = null; }
function releaseHardware() {
  if (stream) { for (const track of stream.getTracks()) track.stop(); stream = null; }
  video.pause(); video.srcObject = null; delete video.dataset.ready;
  if (model) { model.close(); model = null; }
}
function stopSession({ preserve = true } = {}) {
  sessionToken++; clearTimeout(loadingTimer); cancelLoop();
  if (preserve && metrics.input !== 'idle' && (mode === 'camera' || mode === 'preview')) {
    metrics.record(snapshot()); metrics.event('stop'); finalSnapshot = metrics.snapshot(snapshot());
  }
  setMode('idle'); releaseHardware();
  machine.lose(); target = null; lastLandmarks = null; head.valid = false; lastResultAt = null;
  pool.clear(); renderer.draw(pool, head);
  setSessionStatus(preserve && metrics.input !== 'idle' ? '体验已停止。可以重新开启，或导出本次记录。' : '准备好，制造一点小惊喜。');
  updateUi(performance.now());
}

async function createModel(token) {
  if (!modelModule) modelModule = await import(ASSETS.bundle);
  const { FaceLandmarker, FilesetResolver } = modelModule;
  const fileset = await FilesetResolver.forVisionTasks(ASSETS.wasm);
  if (token !== sessionToken) return null;
  const options = { baseOptions: { modelAssetPath: ASSETS.model, delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true,
    minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5 };
  let instance;
  try {
    instance = await FaceLandmarker.createFromOptions(fileset, options);
    backend = 'GPU';
  } catch (error) {
    if (token !== sessionToken) return null;
    metrics.event('gpu-fallback', 'GPU 初始化失败，尝试 CPU');
    options.baseOptions.delegate = 'CPU';
    instance = await FaceLandmarker.createFromOptions(fileset, options);
    backend = 'CPU';
  }
  if (token !== sessionToken) { instance.close(); return null; }
  ovalIndices = indicesFromConnections(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL);
  return instance;
}
function waitForVideo(token) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    function check() {
      if (token !== sessionToken) return reject(new Error('cancelled'));
      if (video.readyState >= 2 && video.videoWidth > 0) return resolve();
      if (performance.now() - started > 12000) return reject(new Error('video-timeout'));
      setTimeout(check, 80);
    }
    check();
  });
}
async function startCamera() {
  stopSession({ preserve: false }); hideError();
  resetSession('camera'); captureSettings = null; backend = null;
  const token = sessionToken;
  initialTime = performance.now(); setMode('loading');
  $('loading-title').textContent = '先和你的摄像头打个招呼';
  $('loading-copy').textContent = '请允许使用摄像头。我们只在本地处理画面，不会录制或上传。';
  setSessionStatus('等待摄像头授权…');
  let phase = 'camera';
  loadingTimer = setTimeout(() => {
    if (token === sessionToken && mode === 'loading') $('loading-copy').textContent = phase === 'camera' ? '请查看浏览器的摄像头权限提示；也可以取消后重试。' : '首次模型加载可能稍慢，请保持页面打开。';
  }, 12000);
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('insecure-context');
    const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } } });
    if (token !== sessionToken) { acquired.getTracks().forEach(track => track.stop()); return; }
    stream = acquired;
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings();
    captureSettings = { width: settings.width, height: settings.height, frameRate: settings.frameRate, facingMode: settings.facingMode || 'unknown' };
    track.addEventListener('ended', () => {
      if (token !== sessionToken || mode === 'idle') return;
      stopSession(); showError('摄像头已断开', '设备或系统停止了摄像头。请检查连接，然后重新开启。');
    });
    phase = 'playback'; video.srcObject = acquired; video.muted = true;
    await video.play(); await waitForVideo(token);
    if (token !== sessionToken) return;
    video.dataset.ready = 'true'; phase = 'model';
    $('loading-title').textContent = '正在认识你的笑容';
    $('loading-copy').textContent = '正在加载本地识别模型，首次访问需要下载运行资源。';
    setSessionStatus('摄像头已连接，正在加载识别模型…');
    const instance = await createModel(token);
    if (token !== sessionToken || !instance) return;
    model = instance; clearTimeout(loadingTimer);
    metrics.initMs = performance.now() - initialTime;
    metrics.event('camera-ready', `MediaPipe ${MEDIAPIPE_VERSION}; ${backend}; main thread`);
    setMode('camera'); resize(); updateUi(performance.now()); startLoop();
  } catch (error) {
    if (token !== sessionToken) return;
    metrics.event('start-error', `${phase}: ${error.name || error.message}`);
    stopSession({ preserve: false });
    const name = error.name;
    if (error.message === 'insecure-context') showError('请在安全链接中开启', '摄像头需要 HTTPS 或电脑上的 localhost。请使用完整浏览器打开正式链接。');
    else if (phase === 'camera' && (name === 'NotAllowedError' || name === 'PermissionDeniedError')) showError('还没有获得摄像头权限', '在浏览器网站设置中允许摄像头，再点击“开启摄像头”。iPhone 建议使用 Safari 直接打开链接。');
    else if (phase === 'camera' && name === 'NotFoundError') showError('没有找到摄像头', '请连接摄像头，或换一台带前置摄像头的设备。你也可以先看看效果预览。');
    else if (phase === 'camera' && name === 'NotReadableError') showError('摄像头暂时无法使用', '它可能正被其他应用占用。关闭占用摄像头的程序，检查系统权限后重试。');
    else if (phase === 'playback') showError('视频预览暂未启动', '浏览器可能暂停了视频播放。保持此页面在前台，再点击“开启摄像头”重试。');
    else if (phase === 'model') showError('识别模型加载失败', '请检查网络后重试。摄像头已关闭；效果预览仍可使用。若问题持续，请导出记录用于排查。');
    else showError('暂时无法开始', '请检查摄像头和浏览器权限后重试，或使用 Safari / Chrome 打开此页面。');
  }
}
function startPreview() {
  stopSession({ preserve: false }); hideError(); resetSession('preview');
  backend = null; captureSettings = null; previewChoice = 'idle'; previewX = 0.5; previewY = 0.46;
  setMode('preview'); resize();
  document.querySelectorAll('[data-expression]').forEach(button => button.classList.toggle('selected', button.dataset.expression === 'idle'));
  metrics.event('preview-start', 'Synthetic input. Not camera validation.');
  updateUi(performance.now()); startLoop();
}
function detect(now) {
  if (mode === 'preview') {
    if (now < previewMissingUntil) { target = null; head.valid = false; consume(machine.miss(now), now); return; }
    const values = previewChoice === 'laugh' ? { smile: 0.85, jaw: 0.8 } : previewChoice === 'smile' ? { smile: 0.72, jaw: 0.15 } : { smile: 0.05, jaw: 0.05 };
    lastResultAt = now; target = previewTarget();
    consume(machine.update(values, now), now);
    return;
  }
  if (mode !== 'camera' || !model || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const started = performance.now();
  try {
    const result = model.detectForVideo(video, started);
    consecutiveInferenceErrors = 0;
    metrics.inferred(performance.now() - started);
    lastResultAt = started;
    const values = extractExpression(result);
    missingOutput = !!result.faceLandmarks?.[0]?.length && !values;
    if (!values) { lastLandmarks = null; target = null; head.valid = false; consume(machine.miss(started), performance.now()); return; }
    lastLandmarks = result.faceLandmarks[0]; target = mapHead();
    if (!target) { consume(machine.miss(started), performance.now()); head.valid = false; return; }
    consume(machine.update(values, started), performance.now());
  } catch (error) {
    lastLandmarks = null; target = null; head.valid = false; consume(machine.miss(started), performance.now());
    metrics.inferenceErrors++; metrics.event('inference-error', error.name || 'Error');
    if (++consecutiveInferenceErrors >= 3) {
      stopSession(); showError('识别暂时中断', '连续推理失败，已停止摄像头。请重新开启，或导出本次记录用于排查。');
    }
  }
}
function consume(result, now) {
  if (result.state !== lastState) { metrics.event('expression', result.state); lastState = result.state; }
  if (result.burst && target) {
    const origin = pool.burst(head.valid ? head : target, width, height);
    flash = { ...origin, at: now }; lastBurstAt = now;
    metrics.event('firework', 'expression-entry');
  }
}
function startLoop() {
  if (frameHandle === null && !document.hidden && (mode === 'camera' || mode === 'preview')) frameHandle = requestAnimationFrame(tick);
}
function tick(now) {
  frameHandle = null;
  if (document.hidden || (mode !== 'camera' && mode !== 'preview')) return;
  // rAF follows the screen refresh rate (e.g. 120 Hz); cap actual drawing work.
  const renderInterval = 1000 / CONFIG.renderHz;
  if (renderScheduleAt !== null) {
    const elapsed = now - renderScheduleAt;
    if (elapsed < renderInterval - 0.5) { startLoop(); return; }
    renderScheduleAt += Math.max(1, Math.floor((elapsed + 0.5) / renderInterval)) * renderInterval;
  } else renderScheduleAt = now;
  metrics.frame(now);
  const dt = lastFrameAt === null ? 1 / 60 : Math.min(0.05, Math.max(0.001, (now - lastFrameAt) / 1000));
  lastFrameAt = now;
  if (detectionClock.due(now)) detect(now);
  if (mode !== 'camera' && mode !== 'preview') return;
  machine.expire(performance.now());
  if (!machine.tracking) { head.valid = false; target = null; lastLandmarks = null; }
  const steps = Math.ceil(dt / (1 / 120)), step = dt / steps;
  for (let n = 0; n < steps; n++) {
    followHead(head, target, step);
    if (machine.tracking && head.valid && machine.state === 'smile') pool.rain(step, machine.smile, width, height, head);
    pool.step(step, head, width, height);
  }
  if (pool.collisions > priorCollisions) { collisionHighlightUntil = now + 500; priorCollisions = pool.collisions; }
  renderer.draw(pool, head, { debug: showCollider, preview: mode === 'preview', expression: machine.state, flash, now });
  if (now - lastUiAt >= 250) { updateUi(now); lastUiAt = now; }
  if (now - lastRecordAt >= 1000) { metrics.record(snapshot()); lastRecordAt = now; }
  startLoop();
}
const fmt = value => value === null || !Number.isFinite(value) ? '—' : value.toFixed(1);
function updateUi(now) {
  const active = mode === 'camera' || mode === 'preview';
  const found = active && machine.tracking && head.valid;
  const interrupted = active && !found && machine.state !== 'no-face';
  let title = '等一张笑脸', copy = '找到光线明亮的位置，让整张脸进入画面。', hint = '看向镜头，试着微笑一下', symbol = '○';
  if (active) {
    if (!found) { title = interrupted ? '追踪短暂中断' : '正在寻找你的笑脸'; copy = interrupted ? '已暂停下雨与碰撞。回到镜头中，继续刚才的表情。' : copy; hint = missingOutput ? '已找到脸，正在等待表情输出' : '让整张脸进入画面，靠近一点'; }
    else if (machine.state === 'smile') { title = '一场微笑雨'; copy = '保持笑容，或者张嘴笑开，让烟花绽放。'; hint = '微笑雨来了 · 试着张嘴笑开'; symbol = '☂'; }
    else if (machine.state === 'laugh') { title = '你的烟花时刻'; copy = '动动头接住火花；放松后再笑，可以再次绽放。'; hint = now - lastBurstAt < 2800 ? '动动头，接住落下的火花' : '放松一下，再次大笑就能绽放'; symbol = '✳'; }
    else { title = '好天气，准备就绪'; copy = '先微笑一下，看看会发生什么。'; symbol = '◡'; }
    if (mode === 'preview') hint = '模拟体验 · 拖动头像接火花';
    setSessionStatus(mode === 'preview' ? '效果预览中 · 未使用摄像头' : found ? '已捕捉到你的表情 · 试着微笑或大笑' : interrupted ? '追踪短暂中断 · 下雨与碰撞已暂停' : missingOutput ? '已找到人脸，表情输出暂不可用' : '摄像头已开启 · 正在寻找人脸', found);
  }
  $('weather-title').textContent = title; $('weather-copy').textContent = copy; $('weather-symbol').textContent = symbol;
  $('stage-hint-text').textContent = hint;
  $('stage-hint').classList.toggle('quiet', found && now > hintUntil);
  $('live-effect-name').textContent = active ? title : '微笑，给直播加点天气';
  $('smile-fill').style.width = `${found ? Math.round(machine.smile * 100) : 0}%`;
  $('expression-value').textContent = found ? machine.smile.toFixed(2) : '—';
  $('expression-label').textContent = mode === 'preview' ? '笑容强度 · 模拟' : '笑容强度';
  $('step-smile').classList.toggle('active', found && machine.state === 'smile');
  $('step-laugh').classList.toggle('active', found && machine.state === 'laugh');
  $('step-move').classList.toggle('active', active && collisionHighlightUntil > now);
  const stats = !active && finalSnapshot ? finalSnapshot : metrics.snapshot(snapshot());
  $('metric-session-fps').textContent = fmt(stats.sessionAverageFps); $('metric-session-hz').textContent = fmt(stats.sessionAverageDetectionHz);
  $('metric-fps').textContent = fmt(stats.fps); $('metric-hz').textContent = fmt(stats.detectionHz);
  $('metric-infer').textContent = fmt(stats.inferenceP95Ms); $('metric-frame').textContent = fmt(stats.frameIntervalP95Ms);
  $('metric-age').textContent = active && mode === 'camera' ? fmt(stats.resultAgeMs) : '—';
  $('metric-particles').textContent = `${stats.particles || 0} / ${pool.budget}`;
  $('metric-collisions').textContent = stats.collisionEvents || 0;
  $('metric-splashes').textContent = stats.splashEvents || 0;
  $('metric-state').textContent = active ? machine.state : 'stopped';
  $('raw-smile').textContent = found ? machine.smile.toFixed(3) : '—'; $('raw-jaw').textContent = found ? machine.jaw.toFixed(3) : '—';
  $('input-size').textContent = captureSettings ? `视频 ${captureSettings.width}×${captureSettings.height}` : mode === 'preview' ? '输入：模拟' : '视频 —';
  $('diagnostic-note').textContent = metrics.input === 'idle' ? '尚未开启会话。预览数据与真实摄像头数据会分别标记。' :
    `${metrics.input === 'camera' ? '真实摄像头' : '模拟输入（不作为摄像头验收）'} · ${backend || '无模型推理'} · ${active ? '运行中' : '已停止'} · 活跃时长 ${(metrics.activeMs / 1000).toFixed(0)}s · 全程均值排除后台；P95 为最近最多 450 个样本`;
}
function exportReport() {
  const report = { schema: 'smile-weather-session/v1', appVersion: VERSION, mediapipeVersion: MEDIAPIPE_VERSION,
    exportedAt: new Date().toISOString(), startedAt: metrics.startedAt, input: metrics.input,
    userAgent: navigator.userAgent, capture: captureSettings, backend, threading: 'main-thread-throttled',
    settings: CONFIG, initMs: metrics.initMs, summary: finalSnapshot || metrics.snapshot(snapshot()),
    samples: metrics.samples, events: metrics.events,
    measurementNotes: ['Rendering FPS and inference frequency are distinct.', 'fps/detectionHz are approximately 1-second windows. P95/P50 use up to the most recent 450 samples; they are not session percentiles.',
      'sessionAverageFps = totalFrameIntervals / active seconds; first/resumed anchor frames are excluded.',
      'sessionAverageDetectionHz = totalInferences / active seconds; sessionMeanInferenceMs covers all valid completed inference samples.',
      'Active time sums foreground rendered-frame intervals, excluding loading and hidden/resume gaps. Session aggregates use constant memory.',
      'Result age starts when detectForVideo is called, not at sensor exposure.', 'Trigger accuracy and end-to-end expression latency require human evaluation.',
      'Preview mode uses synthetic input and is not camera or model verification.', 'No images, video, landmarks or persistent face identifiers are included.'] };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `smile-weather-${metrics.input}-${new Date().toISOString().replaceAll(':', '-')}.json`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// The live chrome is local UI only: no comments, gifts or likes leave this page.
function openTools(trigger, guide = false) {
  sheetTrigger = trigger;
  $('tools-panel').hidden = false; $('close-backdrop').hidden = false;
  $('open-tools').setAttribute('aria-expanded', 'true');
  if (guide) $('play-guide').open = true;
  $('close-tools').focus();
}
function closeTools() {
  $('tools-panel').hidden = true; $('close-backdrop').hidden = true;
  $('open-tools').setAttribute('aria-expanded', 'false');
  sheetTrigger?.focus();
}
$('open-tools').addEventListener('click', event => openTools(event.currentTarget));
$('open-guide').addEventListener('click', event => openTools(event.currentTarget, true));
$('open-effects').addEventListener('click', event => openTools(event.currentTarget, true));
$('close-tools').addEventListener('click', closeTools);
$('close-backdrop').addEventListener('click', closeTools);
$('switch-camera').addEventListener('click', () => { closeTools(); startCamera(); });
$('like').addEventListener('click', () => {
  const liked = $('like').getAttribute('aria-pressed') !== 'true';
  $('like').setAttribute('aria-pressed', String(liked));
  $('like').querySelector('.heart').textContent = liked ? '♥' : '♡';
  $('local-toast').textContent = liked ? '喜欢 +1 · 仅本机反馈' : '已取消喜欢 · 仅本机反馈';
  $('local-toast').hidden = false; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('local-toast').hidden = true; }, 1600);
});
document.addEventListener('keydown', event => {
  if ($('tools-panel').hidden) return;
  if (event.key === 'Escape') { event.preventDefault(); closeTools(); return; }
  if (event.key !== 'Tab') return;
  const items = [...$('tools-panel').querySelectorAll('button, a, select, input, summary')].filter(el => !el.disabled && el.getClientRects().length);
  const first = items[0], last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
});

$('start').addEventListener('click', startCamera);
$('preview').addEventListener('click', startPreview);
$('stop').addEventListener('click', () => { closeTools(); stopSession(); });
$('cancel-start').addEventListener('click', () => stopSession());
$('mirror').addEventListener('click', () => {
  mirrored = !mirrored; video.style.transform = mirrored ? 'scaleX(-1)' : 'none';
  $('mirror').setAttribute('aria-pressed', String(mirrored)); $('mirror').querySelector('span').textContent = mirrored ? '开' : '关';
  head.valid = false; target = mode === 'preview' ? previewTarget() : mapHead(); metrics.event('mirror', String(mirrored));
});
$('quality').addEventListener('change', event => {
  lowQuality = event.target.value === 'low'; pool.budget = lowQuality ? CONFIG.lowParticleLimit : CONFIG.particleLimit;
  resize(); metrics.event('quality', event.target.value);
});
$('show-collider').addEventListener('change', event => { showCollider = event.target.checked; });
$('export').addEventListener('click', exportReport);
$('simulate-miss').addEventListener('click', () => {
  if (mode !== 'preview') return;
  const now = performance.now(); previewMissingUntil = now + 180;
  target = null; head.valid = false; consume(machine.miss(now), now); updateUi(now);
  metrics.event('synthetic-miss', '180 ms tracking interruption');
});
document.querySelectorAll('[data-expression]').forEach(button => button.addEventListener('click', () => {
  if (mode !== 'preview') return;
  previewChoice = button.dataset.expression;
  document.querySelectorAll('[data-expression]').forEach(item => item.classList.toggle('selected', item === button));
  metrics.event('synthetic-expression', previewChoice);
}));
canvas.addEventListener('pointerdown', event => {
  if (mode !== 'preview') return;
  dragging = true; canvas.setPointerCapture(event.pointerId); movePreview(event);
});
canvas.addEventListener('pointermove', event => { if (dragging && mode === 'preview') movePreview(event); });
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('pointercancel', () => { dragging = false; });
function movePreview(event) {
  const rect = canvas.getBoundingClientRect();
  previewX = clamp((event.clientX - rect.left) / rect.width, 0.18, 0.82);
  previewY = clamp((event.clientY - rect.top) / rect.height, 0.28, 0.76);
  target = previewTarget();
}
canvas.addEventListener('keydown', event => {
  if (mode !== 'preview' || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'ArrowLeft') previewX -= 0.035;
  if (event.key === 'ArrowRight') previewX += 0.035;
  if (event.key === 'ArrowUp') previewY -= 0.035;
  if (event.key === 'ArrowDown') previewY += 0.035;
  previewX = clamp(previewX, 0.18, 0.82); previewY = clamp(previewY, 0.28, 0.76); target = previewTarget();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelLoop(); metrics.pause(); machine.lose(); target = null; head.valid = false;
    if (stream) stream.getVideoTracks().forEach(track => { track.enabled = false; });
    if (mode === 'camera' || mode === 'preview') metrics.event('hidden', 'rendering and inference paused');
  } else {
    if (stream) stream.getVideoTracks().forEach(track => { track.enabled = true; });
    metrics.resume(); detectionClock.reset(); lastVideoTime = -1;
    if (mode === 'preview') target = previewTarget();
    if (mode === 'camera' && video.paused) video.play().catch(() => { stopSession(); showError('预览已暂停', '浏览器暂停了视频，请点击“开启摄像头”恢复体验。'); });
    startLoop();
  }
});
window.addEventListener('pagehide', () => stopSession());
setMode('idle'); resize(); updateUi(performance.now());

$('browser-help').hidden = !embeddedBrowser;
$('browser-help-copy').textContent = embeddedBrowser
  ? `你正在${embeddedBrowser}内打开。若摄像头无法启动，请复制链接到 Safari 或 Chrome；也可继续尝试或先体验模拟效果。`
  : '若摄像头无法启动，请复制链接到 Safari 或 Chrome，允许摄像头后重试。模拟效果也可使用。';
$('copy-link').addEventListener('click', async () => {
  const url = new URL(location.href); url.search = ''; url.hash = '';
  try {
    await navigator.clipboard.writeText(url.href);
    $('copy-status').textContent = '链接已复制，请粘贴到 Safari 或 Chrome 打开。';
  } catch {
    $('copy-url').hidden = false; $('copy-url').value = url.href;
    $('copy-url').focus(); $('copy-url').select();
    $('copy-status').textContent = '未能自动复制，请长按或手动复制下方链接。';
  }
});
