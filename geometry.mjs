export const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
const TAU = Math.PI * 2;
export function angleDelta(a, b) { return ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; }

// Same cover + mirror transform as the video element, in CSS pixels (not DPR pixels).
export function coverTransform(videoWidth, videoHeight, width, height, mirror = true) {
  const scale = Math.max(width / videoWidth, height / videoHeight);
  const drawnWidth = videoWidth * scale, drawnHeight = videoHeight * scale;
  return { width, height, drawnWidth, drawnHeight, offsetX: (width - drawnWidth) / 2, offsetY: (height - drawnHeight) / 2, mirror };
}
export function mapLandmark(point, transform, out = {}) {
  const x = point.x * transform.drawnWidth + transform.offsetX;
  out.x = transform.mirror ? transform.width - x : x;
  out.y = point.y * transform.drawnHeight + transform.offsetY;
  return out;
}
export function indicesFromConnections(connections) {
  return [...new Set(connections.flatMap(({ start, end }) => [start, end]))];
}
export function makeHead() {
  return { cx: 0, cy: 0, rx: 1, ry: 1, angle: 0, vx: 0, vy: 0, omega: 0, vrx: 0, vry: 0, valid: false };
}
export function estimateHead(landmarks, indices, transform, padding = 0.15) {
  if (!landmarks?.[33] || !landmarks?.[263] || indices.length < 4) return null;
  const a = mapLandmark(landmarks[33], transform), b = mapLandmark(landmarks[263], transform);
  let angle = Math.atan2(b.y - a.y, b.x - a.x);
  // Mirroring reverses eye order, but does not turn the head upside down.
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle < -Math.PI / 2) angle += Math.PI;
  const c = Math.cos(angle), s = Math.sin(angle);
  const originX = (a.x + b.x) / 2, originY = (a.y + b.y) / 2;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const p = {};
  for (const index of indices) {
    if (!landmarks[index]) return null;
    mapLandmark(landmarks[index], transform, p);
    const dx = p.x - originX, dy = p.y - originY;
    const x = c * dx + s * dy, y = -s * dx + c * dy;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  minY -= (maxY - minY) * padding;
  const x = (minX + maxX) / 2, y = (minY + maxY) / 2;
  const head = { cx: originX + c * x - s * y, cy: originY + s * x + c * y,
    rx: (maxX - minX) * 0.5, ry: (maxY - minY) * 0.5, angle, valid: true };
  return Object.values(head).every(v => typeof v !== 'number' || Number.isFinite(v)) && head.rx > 4 && head.ry > 4 ? head : null;
}
export function followHead(head, target, dt) {
  if (!target || !target.valid || dt <= 0) { head.valid = false; return; }
  if (!head.valid) {
    Object.assign(head, target, { vx: 0, vy: 0, omega: 0, vrx: 0, vry: 0, valid: true });
    return;
  }
  const alpha = 1 - Math.exp(-20 * dt);
  const dx = (target.cx - head.cx) * alpha, dy = (target.cy - head.cy) * alpha;
  const da = angleDelta(head.angle, target.angle) * alpha;
  const drx = (target.rx - head.rx) * alpha, dry = (target.ry - head.ry) * alpha;
  head.vx = clamp(dx / dt, -650, 650); head.vy = clamp(dy / dt, -650, 650);
  head.omega = clamp(da / dt, -4, 4);
  head.vrx = clamp(drx / dt, -180, 180); head.vry = clamp(dry / dt, -180, 180);
  head.cx += dx; head.cy += dy; head.angle += da; head.rx += drx; head.ry += dry;
}

// Continuous segment/ellipse intersection, including relative head translation.
// Writes into a reusable output object to keep the particle loop allocation-free.
export function sweepEllipse(x0, y0, x1, y1, head, radius, dt, out) {
  if (!head?.valid || head.rx <= 0 || head.ry <= 0) return false;
  const c = Math.cos(head.angle), s = Math.sin(head.angle);
  const rx = head.rx + radius, ry = head.ry + radius;
  const dx0 = x0 - (head.cx - (head.vx || 0) * dt), dy0 = y0 - (head.cy - (head.vy || 0) * dt);
  const dx1 = x1 - head.cx, dy1 = y1 - head.cy;
  const ax = (c * dx0 + s * dy0) / rx, ay = (-s * dx0 + c * dy0) / ry;
  const bx = (c * dx1 + s * dy1) / rx, by = (-s * dx1 + c * dy1) / ry;
  const ux = bx - ax, uy = by - ay;
  let t, hx, hy;
  if (ax * ax + ay * ay < 1) {
    if (bx * bx + by * by >= 1) return false;
    const length = Math.hypot(bx, by);
    hx = length > 1e-6 ? bx / length : 0;
    hy = length > 1e-6 ? by / length : -1;
    t = 1;
  } else {
    const A = ux * ux + uy * uy, B = 2 * (ax * ux + ay * uy), C = ax * ax + ay * ay - 1;
    const discriminant = B * B - 4 * A * C;
    if (A < 1e-12 || discriminant < 0) return false;
    t = (-B - Math.sqrt(discriminant)) / (2 * A);
    if (t < 0 || t > 1) return false;
    hx = ax + ux * t; hy = ay + uy * t;
  }
  const localX = hx * rx, localY = hy * ry;
  let nx = hx / rx, ny = hy / ry;
  const normalLength = Math.hypot(nx, ny);
  nx /= normalLength; ny /= normalLength;
  out.nx = c * nx - s * ny; out.ny = s * nx + c * ny;
  const offsetX = c * localX - s * localY, offsetY = s * localX + c * localY;
  out.x = head.cx + offsetX + out.nx * 0.6;
  out.y = head.cy + offsetY + out.ny * 0.6;
  out.hvx = (head.vx || 0) - (head.omega || 0) * offsetY + c * hx * (head.vrx || 0) - s * hy * (head.vry || 0);
  out.hvy = (head.vy || 0) + (head.omega || 0) * offsetX + s * hx * (head.vrx || 0) + c * hy * (head.vry || 0);
  out.t = t;
  return true;
}
export function reflectVelocity(vx, vy, contact, restitution, out) {
  const relativeX = vx - contact.hvx, relativeY = vy - contact.hvy;
  const inward = relativeX * contact.nx + relativeY * contact.ny;
  out.vx = vx; out.vy = vy;
  if (inward < 0) {
    out.vx = vx - (1 + restitution) * inward * contact.nx;
    out.vy = vy - (1 + restitution) * inward * contact.ny;
    const speed = Math.hypot(out.vx, out.vy);
    if (speed > 1100) { out.vx *= 1100 / speed; out.vy *= 1100 / speed; }
    return true;
  }
  return false;
}
