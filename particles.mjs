import { CONFIG, PALETTE } from './config.mjs';
import { clamp, sweepEllipse, reflectVelocity } from './geometry.mjs';

export class ParticleSystem {
  constructor(capacity = CONFIG.particleLimit, random = Math.random) {
    this.capacity = capacity;
    this.budget = capacity;
    this.random = random;
    for (const field of ['x', 'y', 'px', 'py', 'vx', 'vy', 'life', 'maxLife', 'size', 'delay', 'impact', 'impactAngle']) this[field] = new Float32Array(capacity);
    this.kind = new Uint8Array(capacity);
    this.depth = new Uint8Array(capacity);
    this.color = new Uint8Array(capacity);
    this.active = new Uint8Array(capacity);
    this.free = new Int32Array(capacity);
    this.hitX = new Float32Array(24);
    this.hitY = new Float32Array(24);
    this.hitLife = new Float32Array(24);
    this.hitCursor = 0;
    for (const field of ['splashX', 'splashY', 'splashAngle', 'splashLife']) this[field] = new Float32Array(32);
    this.splashCursor = 0;
    this.anchor = {};
    this.contact = {};
    this.reflected = {};
    this.clear();
  }
  clear({ keepStats = false } = {}) {
    this.active.fill(0);
    for (let i = 0; i < this.capacity; i++) this.free[i] = i;
    this.freeCount = this.capacity;
    this.count = 0;
    if (!keepStats) { this.peak = 0; this.collisions = 0; this.splashes = 0; }
    this.hitLife.fill(0); this.hitCursor = 0;
    this.splashLife.fill(0); this.splashCursor = 0;
    this.rainCarry = 0;
    this.lastContact = null;
  }
  allocate() {
    if (!this.freeCount || this.count >= this.budget) return -1;
    const i = this.free[--this.freeCount];
    this.active[i] = 1; this.depth[i] = 1; this.delay[i] = 0; this.impact[i] = 0;
    this.count++;
    this.peak = Math.max(this.peak, this.count);
    return i;
  }
  release(i) {
    if (!this.active[i]) return;
    this.active[i] = 0;
    this.free[this.freeCount++] = i;
    this.count--;
  }
  rain(dt, strength, width, height, head = null) {
    if (!head?.valid) { this.rainCarry = 0; return; }
    weatherAnchor(head, width, height, this.anchor);
    this.rainCarry += dt * (16 + 26 * strength) * Math.min(1, width / 650);
    const number = Math.min(16, Math.floor(this.rainCarry));
    this.rainCarry -= number;
    for (let n = 0; n < number; n++) {
      const i = this.allocate();
      if (i < 0) { this.rainCarry = 0; break; }
      this.kind[i] = 0; this.color[i] = 0;
      this.x[i] = this.anchor.x + (this.random() - 0.5) * this.anchor.w * 0.8;
      this.y[i] = this.anchor.y + this.anchor.w * 0.15;
      this.px[i] = this.x[i]; this.py[i] = this.y[i];
      this.vx[i] = -12 + this.random() * 24; this.vy[i] = 190 + this.random() * 130;
      this.life[i] = this.maxLife[i] = (height + 100) / this.vy[i] + 0.25;
      this.size[i] = (4.5 + this.random() * 3.5) * Math.min(1, width / 420);
    }
  }
  burst(head, width, height) {
    let x = width * 0.5, y = height * 0.22;
    if (head?.valid) {
      const distance = head.ry + 55;
      x = head.cx + Math.sin(head.angle) * distance;
      y = head.cy - Math.cos(head.angle) * distance;
    }
    x = clamp(x, 20, width - 20);
    y = clamp(y, 12, height * 0.65);
    // If the top is cropped, use an outside point beside the head.
    if (head?.valid) {
      const dx = x - head.cx, dy = y - head.cy, c = Math.cos(head.angle), s = Math.sin(head.angle);
      if (((c * dx + s * dy) / (head.rx + 8)) ** 2 + ((-s * dx + c * dy) / (head.ry + 8)) ** 2 < 1.1) {
        x = head.cx < width / 2 ? head.cx + head.rx + 30 : head.cx - head.rx - 30;
        y = head.cy - head.ry * 0.6;
      }
    }
    const amount = Math.min(104, Math.floor(this.budget * 0.26));
    for (let n = 0; n < amount; n++) {
      const i = this.allocate();
      if (i < 0) break;
      const hero = n < 8;
      const angle = hero ? n / 8 * Math.PI * 2 + 0.15 : this.random() * Math.PI * 2;
      const velocity = hero ? Math.min(130, width * 0.23) : 65 + Math.sqrt(this.random()) * Math.min(320, width * 0.48);
      this.kind[i] = hero ? 2 : 1;
      const wave = hero ? 0 : n < 32 ? 1 : 2;
      this.depth[i] = hero || n % 3 === 1 ? 1 : n % 3 === 0 ? 0 : 2;
      this.color[i] = wave === 0 ? (n % 4 === 0 ? 2 : 1) : wave === 1 ? 0 : (n % 4 === 0 ? 3 : 2);
      // Separate the eight hero stars while preserving the shared burst origin.
      const ring = hero ? Math.min(18, Math.max(12, width * 0.04)) : 0;
      this.x[i] = clamp(x + Math.cos(angle) * ring, 8, width - 8);
      this.y[i] = clamp(y + Math.sin(angle) * ring, 8, height - 8);
      this.px[i] = this.x[i]; this.py[i] = this.y[i];
      const depthSpeed = this.depth[i] === 0 ? 0.78 : this.depth[i] === 2 ? 1.12 : 1;
      this.vx[i] = Math.cos(angle) * velocity * depthSpeed; this.vy[i] = (Math.sin(angle) * velocity - 85) * depthSpeed;
      this.delay[i] = 0.18 + wave * 0.075;
      this.life[i] = this.maxLife[i] = hero ? 4.2 : 2.4 + this.random() * 1.2;
      this.size[i] = (hero ? 23 + this.random() * 10 : n < 32 ? 10 + this.random() * 7 : 3 + this.random() * 5) * Math.min(1, width / 480) * (this.depth[i] === 0 ? 0.7 : this.depth[i] === 2 ? 1.15 : 1);
    }
    return { x, y };
  }
  step(dt, head, width, height) {
    const drag = Math.exp(-0.35 * dt);
    for (let n = 0; n < this.hitLife.length; n++) this.hitLife[n] = Math.max(0, this.hitLife[n] - dt);
    for (let n = 0; n < this.splashLife.length; n++) this.splashLife[n] = Math.max(0, this.splashLife[n] - dt);
    for (let i = 0; i < this.capacity; i++) {
      if (!this.active[i]) continue;
      this.impact[i] = Math.max(0, this.impact[i] - dt);
      if (this.delay[i] > 0) { this.delay[i] = Math.max(0, this.delay[i] - dt); continue; }
      this.life[i] -= dt;
      if (this.life[i] <= 0 || this.y[i] > height + 100 || this.x[i] < -250 || this.x[i] > width + 250) { this.release(i); continue; }
      this.px[i] = this.x[i]; this.py[i] = this.y[i];
      if (this.kind[i]) { this.vx[i] *= drag; this.vy[i] = this.vy[i] * drag + CONFIG.gravity * dt; }
      let nx = this.x[i] + this.vx[i] * dt, ny = this.y[i] + this.vy[i] * dt;
      if (this.depth[i] === 1 && sweepEllipse(this.x[i], this.y[i], nx, ny, head, this.size[i], dt, this.contact)) {
        if (this.kind[i] === 0) {
          const marker = this.splashCursor++ % this.splashLife.length;
          this.splashX[marker] = this.contact.x; this.splashY[marker] = this.contact.y;
          this.splashAngle[marker] = Math.atan2(this.contact.ny, this.contact.nx) + Math.PI / 2;
          this.splashLife[marker] = 0.32; this.splashes++;
          this.release(i); continue;
        }
        const bounced = reflectVelocity(this.vx[i], this.vy[i], this.contact, CONFIG.restitution, this.reflected);
        this.vx[i] = this.reflected.vx; this.vy[i] = this.reflected.vy;
        const remaining = dt * (1 - this.contact.t);
        nx = this.contact.x + this.vx[i] * remaining;
        ny = this.contact.y + this.vy[i] * remaining;
        if (bounced) {
          this.collisions++;
          this.impact[i] = 0.28; this.impactAngle[i] = Math.atan2(this.contact.ny, this.contact.nx);
          const marker = this.hitCursor++ % this.hitLife.length;
          this.hitX[marker] = this.contact.x; this.hitY[marker] = this.contact.y;
          this.hitLife[marker] = 0.24;
          // One reusable contact is enough for the optional visual debugging marker.
          this.lastContact = this.contact;
        }
      }
      this.x[i] = nx; this.y[i] = ny;
    }
  }
}



// 2.5D artwork is rasterized once. Animation reuses these small canvases;
// gradients, paths and shading never run once per particle per frame.
function weatherAnchor(head, width, height, out) {
  out.w = Math.min(230, width * 0.53);
  out.x = clamp(head?.valid ? head.cx : width / 2, out.w * 0.52, width - out.w * 0.52);
  out.y = clamp(head?.valid ? head.cy - head.ry - out.w * 0.28 : height * 0.18, out.w * 0.27 + 24, height * 0.45);
  return out;
}
function tone(hex, amount) {
  return '#' + [1, 3, 5].map(i => Math.round(clamp(parseInt(hex.slice(i, i + 2), 16) + amount, 0, 255)).toString(16).padStart(2, '0')).join('');
}
export function roundedPath(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
export function popScale(age) {
  const t = clamp(age / 0.3, 0, 1), u = t - 1;
  return 1 + 2.4 * u * u * u + 1.4 * u * u;
}
function starPath(c, shape) {
  c.beginPath();
  if (shape === 2) { roundedPath(c, -11, -29, 22, 58, 10); return; }
  const count = shape === 0 ? 10 : 8, outer = shape === 0 ? 46 : 40, inner = shape === 0 ? 24 : 11;
  const points = Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + i * Math.PI * 2 / count, r = i % 2 ? inner : outer;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
  for (let i = 0; i < count; i++) {
    const a = points[i], b = points[(i + 1) % count];
    const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
    if (!i) c.moveTo(x, y);
    else c.quadraticCurveTo(a[0], a[1], x, y);
  }
  c.quadraticCurveTo(points[0][0], points[0][1], (points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2); c.closePath();
}
export class ParticleRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.anchor = {}; this.cloudAmount = 0; this.previousTime = null;
    this.stickers = PALETTE.map(color => [0, 1, 2].map(shape => {
      const sprite = document.createElement('canvas'); sprite.width = sprite.height = 128;
      const c = sprite.getContext('2d'); c.translate(60, 58);
      c.save(); c.translate(5, 9); starPath(c, shape); c.fillStyle = tone(color, -65); c.fill(); c.restore();
      starPath(c, shape);
      const g = c.createLinearGradient(-20, -40, 27, 46);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.23, tone(color, 42)); g.addColorStop(0.6, color); g.addColorStop(1, tone(color, -38));
      c.fillStyle = g; c.fill(); c.strokeStyle = tone(color, 40); c.lineWidth = 1.5; c.stroke();
      c.save(); c.clip();
      const light = c.createRadialGradient(-13, -20, 0, -12, -20, 34);
      light.addColorStop(0, '#ffffffb0'); light.addColorStop(1, '#ffffff00');
      c.fillStyle = light; c.fillRect(-50, -50, 100, 100); c.restore();
      c.strokeStyle = '#ffffffb0'; c.lineWidth = 3.5; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-8, -25); c.quadraticCurveTo(-3, -30, 0, -30); c.stroke();
      if (shape === 0) {
        c.fillStyle = '#301d47';
        for (const x of [-8, 8]) { c.beginPath(); c.ellipse(x, 0, 2, 3, 0, 0, Math.PI * 2); c.fill(); }
        c.strokeStyle = '#301d47'; c.lineWidth = 1.8; c.beginPath(); c.arc(0, 6, 4, 0.2, Math.PI - 0.2); c.stroke();
      }
      return sprite;
    }));
    this.drop = document.createElement('canvas'); this.drop.width = 48; this.drop.height = 72;
    const c = this.drop.getContext('2d');
    c.beginPath(); c.moveTo(24, 3); c.bezierCurveTo(19, 19, 5, 33, 6, 46); c.bezierCurveTo(7, 72, 43, 73, 43, 46); c.bezierCurveTo(43, 31, 29, 15, 24, 3); c.closePath();
    const g = c.createLinearGradient(8, 20, 43, 64); g.addColorStop(0, '#d0ffff'); g.addColorStop(.35, '#45f7f0'); g.addColorStop(.7, '#18c9e6'); g.addColorStop(1, '#438bdc');
    c.fillStyle = g; c.fill(); c.strokeStyle = '#b2fffc'; c.lineWidth = 1.5; c.stroke();
    c.strokeStyle = '#ffffffd0'; c.lineWidth = 4; c.lineCap = 'round'; c.beginPath(); c.moveTo(15, 35); c.quadraticCurveTo(11, 42, 14, 47); c.stroke();
    this.splash = document.createElement('canvas'); this.splash.width = 96; this.splash.height = 64;
    const sp = this.splash.getContext('2d');
    sp.strokeStyle = '#a8fffa'; sp.lineWidth = 4; sp.lineCap = 'round';
    sp.beginPath(); sp.ellipse(48, 50, 24, 5, 0, Math.PI, Math.PI * 2); sp.stroke();
    for (const [x, y, a] of [[15,32,-.8],[30,15,-.4],[48,9,0],[67,18,.5],[81,35,.9]]) {
      sp.save(); sp.translate(x,y); sp.rotate(a); sp.drawImage(this.drop,-4,-9,8,14); sp.restore();
    }
    this.face = document.createElement('canvas'); this.face.width = 256; this.face.height = 320;
    const f = this.face.getContext('2d');
    const fg = f.createRadialGradient(90, 80, 12, 140, 168, 170);
    fg.addColorStop(0, '#fffdf5'); fg.addColorStop(.55, '#fff1d9'); fg.addColorStop(.82, '#e8c7b3'); fg.addColorStop(1, '#bc8f9c');
    f.fillStyle = fg; f.beginPath(); f.ellipse(128, 160, 127, 159, 0, 0, Math.PI*2); f.fill();
    this.cloud = document.createElement('canvas'); this.cloud.width = 360; this.cloud.height = 220;
    const q = this.cloud.getContext('2d');
    const cloudPath = () => { q.beginPath(); q.moveTo(71, 173); q.bezierCurveTo(7, 172, 5, 91, 64, 86); q.bezierCurveTo(68, 31, 137, 14, 172, 54); q.bezierCurveTo(220, -5, 290, 36, 285, 88); q.bezierCurveTo(353, 88, 354, 171, 291, 173); q.closePath(); };
    q.save(); q.translate(0, 10); cloudPath(); q.fillStyle = '#678bb8'; q.fill(); q.restore();
    cloudPath(); const cg = q.createLinearGradient(0, 45, 0, 182); cg.addColorStop(0, '#fffdfd'); cg.addColorStop(.47, '#f1ffff'); cg.addColorStop(.76, '#cae9f5'); cg.addColorStop(1, '#a0bedf'); q.fillStyle = cg; q.fill();
    q.save(); q.clip();
    for (const [x,y,r] of [[114,69,51],[224,66,55],[63,122,39],[297,122,39]]) {
      const h = q.createRadialGradient(x - 10, y - 12, 3, x, y, r); h.addColorStop(0, '#ffffffea'); h.addColorStop(1, '#ffffff00'); q.fillStyle = h; q.fillRect(x-r, y-r, r*2, r*2);
    }
    q.restore(); q.lineCap = 'round'; q.strokeStyle = '#34465b'; q.lineWidth = 5;
    for (const x of [149, 208]) { q.beginPath(); q.arc(x, 123, 9, Math.PI * 1.15, Math.PI * 1.85); q.stroke(); }
    q.beginPath(); q.arc(179, 127, 10, .15, Math.PI-.15); q.stroke();
    q.fillStyle = '#ff9fb2'; for(const x of [131,226]) { q.beginPath(); q.ellipse(x,135,11,5,0,0,Math.PI*2); q.fill(); }
  }
  drawPoster(canvas) {
    const original = this.ctx, c = canvas.getContext('2d');
    c.clearRect(0, 0, canvas.width, canvas.height); c.save(); c.scale(2, 2);
    this.ctx = c;
    this.drawAvatar({ cx: 179, cy: 132, rx: 61, ry: 76, angle: -0.12 }, 'laugh');
    c.drawImage(this.cloud, 22, 20, 157, 96);
    for (const [x, y, size, color, angle] of [[282,77,90,1,.2],[275,178,55,0,-.25],[79,169,48,3,.3],[309,135,24,2,0]]) {
      c.save(); c.translate(x,y); c.rotate(angle); c.drawImage(this.stickers[color][0],-size/2,-size/2,size,size); c.restore();
    }
    for (let i=0;i<3;i++) c.drawImage(this.drop, 54+i*27, 108+i%2*9, 13, 20);
    c.restore(); this.ctx = original;
  }
  resize(width, height, dpr) {
    this.width = width; this.height = height; this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr); this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  draw(pool, head, { debug = false, preview = false, expression = 'idle', flash = null, now = 0 } = {}) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    const dt = this.previousTime === null ? 0 : Math.min(0.05, Math.max(0, (now - this.previousTime) / 1000));
    this.previousTime = now;
    this.cloudAmount += ((expression === 'smile' && head.valid ? 1 : 0) - this.cloudAmount) * (1 - Math.exp(-dt * 9));
    if (!head.valid) this.cloudAmount = 0;
    this.drawLayer(pool, 0);
    // Erase only the already drawn rear particles. Video stays on its own DOM layer.
    if (head.valid) {
      ctx.save(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.ellipse(head.cx, head.cy, head.rx, head.ry, head.angle, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (preview && head.valid) this.drawAvatar(head, expression);
    if (this.cloudAmount > 0.01) {
      weatherAnchor(head, this.width, this.height, this.anchor);
      const w = this.anchor.w * (0.8 + this.cloudAmount * 0.2);
      const bob = Math.sin(now / 420) * 3;
      ctx.globalAlpha = this.cloudAmount;
      ctx.drawImage(this.cloud, this.anchor.x - w / 2, this.anchor.y - w * 0.31 + bob, w, w * 220 / 360);
      ctx.globalAlpha = 1;
    }
    this.drawLayer(pool, 1);
    this.drawLayer(pool, 2);
    ctx.globalAlpha = 1;
    for (let n = 0; n < pool.hitLife.length; n++) {
      if (!pool.hitLife[n]) continue;
      const remaining = pool.hitLife[n] / 0.24, size = 26 + (1 - remaining) * 34;
      ctx.globalAlpha = remaining;
      ctx.drawImage(this.stickers[2][1], pool.hitX[n] - size / 2, pool.hitY[n] - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    for (let n = 0; n < pool.splashLife.length; n++) {
      if (pool.splashLife[n] <= 0) continue;
      const t = 1 - pool.splashLife[n] / 0.32, size = 34 + t * 28;
      ctx.save(); ctx.globalAlpha = 1 - t; ctx.translate(pool.splashX[n], pool.splashY[n]);
      ctx.rotate(pool.splashAngle[n]); ctx.drawImage(this.splash, -size / 2, -size * 0.55, size, size * 2 / 3); ctx.restore();
    }
    if (flash && now - flash.at < 1000) {
      const elapsed = Math.max(0, now - flash.at);
      if (elapsed < 180) {
        const t = elapsed / 180, size = 42 * (1 - t * 0.45);
        ctx.save(); ctx.translate(flash.x, flash.y); ctx.rotate(t * Math.PI);
        ctx.drawImage(this.stickers[2][0], -size / 2, -size / 2, size, size); ctx.restore();
      } else {
        const progress = (elapsed - 180) / 820, radius = 22 + progress * Math.min(165, this.width * 0.32);
        ctx.globalAlpha = (1 - progress) ** 2; ctx.lineWidth = 4 * (1 - progress) + 1; ctx.lineCap = 'round';
        for (let n = 0; n < 12; n++) {
          const a = n * Math.PI / 6;
          ctx.strokeStyle = n % 2 ? '#25f4ee' : '#fe2c55';
          ctx.beginPath(); ctx.moveTo(flash.x + Math.cos(a) * radius, flash.y + Math.sin(a) * radius);
          ctx.lineTo(flash.x + Math.cos(a) * (radius + 22), flash.y + Math.sin(a) * (radius + 22)); ctx.stroke();
        }
        // Let the first stars separate, then hold the label at full opacity.
        // When the burst is near the header, place the label to its side/below it.
        if (elapsed >= 350) {
          const labelAge = elapsed - 350;
          const nearTop = flash.y < 220;
          const labelX = nearTop ? flash.x + (flash.x < this.width / 2 ? 80 : -80) : flash.x;
          const labelY = nearTop ? Math.max(190, flash.y + 60) : flash.y - 60;
          ctx.globalAlpha = labelAge <= 300 ? 1 : Math.max(0, 1 - (labelAge - 300) / 350);
          ctx.save(); ctx.translate(clamp(labelX, 65, this.width - 65), clamp(labelY, 180, this.height - 235)); ctx.rotate(-0.12);
          ctx.scale(1 + Math.sin(Math.min(1, labelAge / 220) * Math.PI) * .18, 1);
          ctx.font = '900 32px sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 7; ctx.strokeStyle = '#59213e';
          ctx.strokeText('YAY!', 0, 0); ctx.fillStyle = '#fff6fb'; ctx.fillText('YAY!', 0, 0); ctx.restore();
        }
        ctx.globalAlpha = 1;
      }
    }
    if (debug && head.valid) {
      ctx.strokeStyle = '#25f4ee'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.ellipse(head.cx, head.cy, head.rx, head.ry, head.angle, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = '#25f4ee'; ctx.font = '11px monospace';
      ctx.fillText('2D HEAD COLLIDER', head.cx - 57, head.cy + head.ry + 22);
      if (pool.lastContact) {
        const p = pool.lastContact;
        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.nx * 25, p.y + p.ny * 25); ctx.stroke();
      }
    }
  }
  drawLayer(pool, layer) {
    const ctx = this.ctx;
    for (let i = 0; i < pool.capacity; i++) {
      if (!pool.active[i] || pool.delay[i] > 0 || pool.depth[i] !== layer) continue;
      if (!pool.kind[i]) {
        const w = pool.size[i] * 2.4;
        ctx.globalAlpha = Math.min(1, pool.life[i] / 0.25) * 0.9;
        ctx.drawImage(this.drop, pool.x[i] - w / 2, pool.y[i] - w * 0.75, w, w * 1.5);
      } else {
        const age = pool.maxLife[i] - pool.life[i];
        const scale = popScale(age) * Math.min(1, pool.life[i] / 0.65);
        const size = pool.size[i] * 3.5 * scale;
        const spin = i * 1.4 + age * (i % 2 ? 1.1 : -1.1);
        ctx.globalAlpha = Math.min(1, pool.life[i] / 0.45) * (layer === 0 ? 0.5 : layer === 2 ? 0.85 : 1);
        ctx.save(); ctx.translate(pool.x[i], pool.y[i]);
        if (pool.impact[i] > 0) {
          const phase = (0.28 - pool.impact[i]) / 0.28;
          const squish = Math.sin(phase * Math.PI * 2) * 0.25 * (1 - phase);
          ctx.rotate(pool.impactAngle[i]); ctx.scale(1 - squish, 1 + squish); ctx.rotate(-pool.impactAngle[i]);
        }
        if (pool.kind[i] === 2 && pool.impact[i] <= 0) {
          const speed = Math.hypot(pool.vx[i], pool.vy[i]);
          const stretch = Math.min(0.2, speed / 1800), direction = Math.atan2(pool.vy[i], pool.vx[i]);
          ctx.rotate(direction); ctx.scale(1 + stretch, 1 / (1 + stretch)); ctx.rotate(-direction);
        }
        ctx.rotate(spin);
        // Gentle foreshortening gives a toy-like tumble without a 3D runtime.
        ctx.scale(0.84 + Math.cos(age * 3 + i) * 0.16, 1);
        ctx.drawImage(this.stickers[pool.color[i]][pool.kind[i] === 2 ? 0 : i % 3], -size / 2, -size / 2, size, size);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }
  drawAvatar(head, expression) {
    const ctx = this.ctx;
    ctx.save(); ctx.translate(head.cx, head.cy); ctx.rotate(head.angle);
    const { rx, ry } = head;
    // The pre-rendered toy face remains aligned with the physical ellipse.
    ctx.drawImage(this.face, -rx, -ry, rx * 2, ry * 2);
    ctx.strokeStyle = '#171719'; ctx.fillStyle = '#171719'; ctx.lineWidth = Math.max(2, rx * 0.05); ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      const x = side * rx * 0.32;
      ctx.beginPath();
      if (expression === 'idle') ctx.ellipse(x, -ry * 0.13, rx * 0.045, ry * 0.065, 0, 0, Math.PI * 2);
      else ctx.arc(x, -ry * 0.02, rx * 0.1, Math.PI * 1.15, Math.PI * 1.85);
      if (expression === 'idle') ctx.fill(); else ctx.stroke();
    }
    ctx.beginPath();
    if (expression === 'laugh') {
      ctx.ellipse(0, ry * 0.28, rx * 0.25, ry * 0.18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fe2c55'; ctx.beginPath(); ctx.ellipse(0, ry * 0.37, rx * 0.14, ry * 0.05, 0, 0, Math.PI * 2); ctx.fill();
    } else { ctx.arc(0, ry * 0.1, rx * (expression === 'smile' ? 0.3 : 0.19), 0.25, Math.PI - 0.25); ctx.stroke(); }
    ctx.strokeStyle = '#fe2c55'; ctx.lineWidth = rx * 0.05;
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(side * rx * 0.52, ry * 0.12); ctx.lineTo(side * rx * 0.68, ry * 0.12); ctx.stroke(); }
    ctx.restore();
  }
}
