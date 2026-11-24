/**
 * Screen-shatter transition (Component 2 → 3, matched to recording/componet 2to3.mov at 4.5–5.3 s): the black screen
 * breaks into angular shards that fly toward the viewer and away, some of them flashing red with a halftone dot
 * texture, revealing the red scene underneath. Pure 2D canvas overlay, removes itself when done.
 */
type Shard = { pts: Array<[number, number]>; cx: number; cy: number; vx: number; vy: number; vr: number; red: boolean; delay: number };

function dotPattern(g: CanvasRenderingContext2D) {
  const c = document.createElement('canvas'); c.width = c.height = 6;
  const p = c.getContext('2d')!;
  p.fillStyle = '#c8102e'; p.fillRect(0, 0, 6, 6);
  p.fillStyle = '#ff3b4f'; p.beginPath(); p.arc(3, 3, 1.4, 0, Math.PI * 2); p.fill();
  return g.createPattern(c, 'repeat')!;
}

export function playShatter(onDone?: () => void) {
  const cv = document.createElement('canvas');
  cv.id = 'shatter';
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  document.body.appendChild(cv);
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const dots = dotPattern(g);
  // jittered grid → each cell split into two triangles-ish quads: irregular glass pieces
  const cols = 9, rows = 6, jit = 0.38;
  const P: Array<Array<[number, number]>> = [];
  for (let j = 0; j <= rows; j++) {
    P.push([]);
    for (let i = 0; i <= cols; i++) {
      const edgeX = i === 0 || i === cols, edgeY = j === 0 || j === rows;
      const x = (i / cols) * W + (edgeX ? 0 : (Math.random() - 0.5) * jit * (W / cols));
      const y = (j / rows) * H + (edgeY ? 0 : (Math.random() - 0.5) * jit * (H / rows));
      P[j].push([x, y]);
    }
  }
  const ox = W * 0.55, oy = H * 0.55;   // impact point (where the hand breaks through)
  const shards: Shard[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = P[j][i], b = P[j][i + 1], c = P[j + 1][i + 1], d = P[j + 1][i];
    const tris: Array<Array<[number, number]>> = Math.random() < 0.5 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
    for (const pts of tris) {
      const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3, cy = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;
      const dx = cx - ox, dy = cy - oy, dist = Math.hypot(dx, dy) + 1;
      const sp = 900 + Math.random() * 700;
      shards.push({
        pts, cx, cy, vx: (dx / dist) * sp, vy: (dy / dist) * sp + 200, vr: (Math.random() - 0.5) * 6,
        red: Math.random() < 0.35, delay: (dist / Math.hypot(W, H)) * 0.35 + Math.random() * 0.06,
      });
    }
  }
  const t0 = performance.now();
  const DUR = 1.25;
  const frame = () => {
    const t = (performance.now() - t0) / 1000;
    g.clearRect(0, 0, W, H);
    for (const s of shards) {
      const k = Math.max(0, t - s.delay);
      const e = k * k;   // accelerate away
      const sc = 1 + k * 1.6;   // pieces fly toward the viewer as they break off
      g.save();
      g.translate(s.cx + s.vx * e * 0.6, s.cy + s.vy * e * 0.6);
      g.rotate(s.vr * k);
      g.scale(sc, sc);
      g.beginPath();
      g.moveTo(s.pts[0][0] - s.cx, s.pts[0][1] - s.cy);
      for (let i = 1; i < s.pts.length; i++) g.lineTo(s.pts[i][0] - s.cx, s.pts[i][1] - s.cy);
      g.closePath();
      // red flash on some shards as they crack, then they fade out
      const redK = s.red ? Math.min(1, k * 6) * (1 - Math.min(1, k * 1.4)) : 0;
      g.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.35) * 1.6);
      g.fillStyle = redK > 0.05 ? dots : '#000';
      g.fill();
      if (k > 0 && k < 0.5) { g.strokeStyle = `rgba(255,60,70,${0.5 * (1 - k * 2)})`; g.lineWidth = 1; g.stroke(); }
      g.restore();
    }
    if (t < DUR) requestAnimationFrame(frame);
    else { cv.remove(); onDone?.(); }
  };
  requestAnimationFrame(frame);
}
