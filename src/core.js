/* ParaVent core v2 — parametric perforation geometry + SVG / DXF / STEP (AP214 B-rep) writers.
 * Pure functions, no DOM. Units: millimetres, Y up.
 * Loop = closed list of segments:
 *   {t:'l', a:[x,y], b:[x,y]}           line a -> b
 *   {t:'a', c:[x,y], r, a0, a1}         arc, CCW when a1 > a0, CW when a1 < a0
 * Outer loops CCW, hole loops CW (material on the left of travel).
 *
 * Gradient channels (each with its own driver, controllers and noise):
 *   size    -> hole size in mm          spacing -> pitch multiplier
 *   angle   -> rotation in degrees      shape   -> morph factor base shape -> target shape
 */
const VF = (() => {
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function hash2(x, y, seed) { // stable per-position random in [0,1)
    let h = Math.imul((Math.round(x * 1000) | 0) ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul((Math.round(y * 1000) | 0) + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed | 0, 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  /* ---------- segments / loops ---------- */
  const segStart = (s) => s.t === 'l' ? s.a : [s.c[0] + s.r * Math.cos(s.a0), s.c[1] + s.r * Math.sin(s.a0)];
  const segEnd = (s) => s.t === 'l' ? s.b : [s.c[0] + s.r * Math.cos(s.a1), s.c[1] + s.r * Math.sin(s.a1)];
  const reverseSeg = (s) => s.t === 'l' ? { t: 'l', a: s.b, b: s.a } : { t: 'a', c: s.c, r: s.r, a0: s.a1, a1: s.a0 };
  const reverseLoop = (L) => L.slice().reverse().map(reverseSeg);
  function loopArea(L) {
    let A = 0;
    for (const s of L) {
      if (s.t === 'l') A += (s.a[0] * s.b[1] - s.b[0] * s.a[1]) / 2;
      else { const [cx, cy] = s.c, r = s.r;
        A += 0.5 * (r * r * (s.a1 - s.a0) + r * cx * (Math.sin(s.a1) - Math.sin(s.a0)) - r * cy * (Math.cos(s.a1) - Math.cos(s.a0))); }
    }
    return A;
  }
  const orient = (L, ccw) => ((loopArea(L) > 0) === ccw ? L : reverseLoop(L));
  function polyLoop(pts) { const L = []; for (let i = 0; i < pts.length; i++) L.push({ t: 'l', a: pts[i], b: pts[(i + 1) % pts.length] }); return L; }
  function circleLoop(cx, cy, r) { return [{ t: 'a', c: [cx, cy], r, a0: 0, a1: Math.PI }, { t: 'a', c: [cx, cy], r, a0: Math.PI, a1: TAU }]; }
  function flatten(L, tol = 0.02) { // polyline vertices (no repeated closing point)
    const out = [];
    for (const s of L) {
      if (s.t === 'l') { out.push(s.a); continue; }
      const da = s.a1 - s.a0, step = 2 * Math.acos(clamp(1 - tol / Math.max(s.r, 1e-6), -1, 1)); let n = Math.ceil(Math.abs(da) / (step || 1)); if (!isFinite(n) || n < 2) n = 2;
      for (let k = 0; k < Math.min(n, 256); k++) { const a = s.a0 + da * k / n; out.push([s.c[0] + s.r * Math.cos(a), s.c[1] + s.r * Math.sin(a)]); }
    }
    return out;
  }
  function polyArea(p) { let A = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) A += (p[j][0] * p[i][1] - p[i][0] * p[j][1]); return A / 2; }
  function cleanPoly(p, eps = 1e-7) { // drop duplicate and collinear points; linear time
    let q = [];
    for (const v of p) { const w = q[q.length - 1]; if (!w || Math.hypot(v[0] - w[0], v[1] - w[1]) > eps) q.push(v); }
    while (q.length > 1 && Math.hypot(q[0][0] - q[q.length - 1][0], q[0][1] - q[q.length - 1][1]) <= eps) q.pop();
    const coll = (a, b, c) => { const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      return Math.abs(cr) / L < eps * 10 && ((b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])) >= 0; };
    for (let pass = 0; pass < 3 && q.length > 3; pass++) {
      const out = []; let removed = 0;
      for (let i = 0; i < q.length; i++) {
        const a = out.length ? out[out.length - 1] : q[q.length - 1], b = q[i], c = q[(i + 1) % q.length];
        if (out.length + (q.length - i) > 3 && coll(a, b, c)) { removed++; continue; }
        out.push(b);
      }
      q = out; if (!removed) break;
    }
    return q;
  }


  /* ---------- 2D geometry predicates ---------- */
  function segDist(px, py, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 ? clamp(((px - a[0]) * dx + (py - a[1]) * dy) / L2, 0, 1) : 0;
    return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
  }
  function pointInPoly(x, y, p) { let c = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; }
    return c; }
  function segsCross(a, b, c, d) {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }
  function selfIntersects(p) {
    const n = p.length;
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segsCross(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return true;
    }
    return false;
  }
  function bbox(P) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const v of P) { if (v[0] < x0) x0 = v[0]; if (v[0] > x1) x1 = v[0]; if (v[1] < y0) y0 = v[1]; if (v[1] > y1) y1 = v[1]; } return [x0, y0, x1, y1]; }
  const boxDist = (x, y, b) => Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - y, 0, y - b[3]));
  function polyGap(A, B) { // < 0 when overlapping, else exact min distance; bounding boxes prune most segment pairs
    const ba = bbox(A), bb = bbox(B);
    if (ba[0] <= bb[2] && bb[0] <= ba[2] && ba[1] <= bb[3] && bb[1] <= ba[3]) {
      for (let i = 0; i < A.length; i++) { const a = A[i], b = A[(i + 1) % A.length];
        if (Math.max(a[0], b[0]) < bb[0] || Math.min(a[0], b[0]) > bb[2] || Math.max(a[1], b[1]) < bb[1] || Math.min(a[1], b[1]) > bb[3]) continue;
        for (let j = 0; j < B.length; j++) { const c = B[j], d = B[(j + 1) % B.length];
          if (Math.max(c[0], d[0]) < Math.min(a[0], b[0]) || Math.min(c[0], d[0]) > Math.max(a[0], b[0]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1]) || Math.min(c[1], d[1]) > Math.max(a[1], b[1])) continue;
          if (segsCross(a, b, c, d)) return -1; } }
      if (pointInPoly(A[0][0], A[0][1], B) || pointInPoly(B[0][0], B[0][1], A)) return -1;
    }
    let m = Infinity;
    for (const v of A) { if (boxDist(v[0], v[1], bb) >= m) continue; for (let j = 0; j < B.length; j++) { const d = segDist(v[0], v[1], B[j], B[(j + 1) % B.length]); if (d < m) m = d; } }
    for (const v of B) { if (boxDist(v[0], v[1], ba) >= m) continue; for (let j = 0; j < A.length; j++) { const d = segDist(v[0], v[1], A[j], A[(j + 1) % A.length]); if (d < m) m = d; } }
    return m;
  }

  function polyPointDist(x, y, P) { let m = Infinity; for (let j = 0; j < P.length; j++) m = Math.min(m, segDist(x, y, P[j], P[(j + 1) % P.length])); return pointInPoly(x, y, P) ? -m : m; }

  /* ---------- SVG path import (for custom hole shapes and plate outlines) ---------- */
  function parseSVGPath(d, tol = 0.25) {
    const toks = (d.match(/[a-df-zA-DF-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || []);
    let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, qx = 0, qy = 0, prev = '';
    const subs = []; let cur = null;
    const num = () => parseFloat(toks[i++]);
    const isNum = () => i < toks.length && !/[a-zA-Z]/.test(toks[i]);
    const add = (px, py) => { if (!cur) { cur = [[x, y]]; subs.push(cur); } cur.push([px, py]); x = px; y = py; };
    const cubic = (x1, y1, x2, y2, x3, y3) => { const x0 = x, y0 = y, n = 16; for (let k = 1; k <= n; k++) { const t = k / n, u = 1 - t;
      add(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3); } };
    const quad = (x1, y1, x2, y2) => { const x0 = x, y0 = y, n = 12; for (let k = 1; k <= n; k++) { const t = k / n, u = 1 - t; add(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2); } };
    const arc = (rx, ry, phi, fa, fs, x2, y2) => { // endpoint -> center parameterisation
      const x1 = x, y1 = y; if (!rx || !ry) { add(x2, y2); return; }
      rx = Math.abs(rx); ry = Math.abs(ry); const p = phi * Math.PI / 180, cp = Math.cos(p), sp = Math.sin(p);
      const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
      let L = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry); if (L > 1) { rx *= Math.sqrt(L); ry *= Math.sqrt(L); }
      let num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p; num2 = Math.max(0, num2);
      let co = Math.sqrt(num2 / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)); if (fa === fs) co = -co;
      const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx, ccx = cp * cxp - sp * cyp + (x1 + x2) / 2, ccy = sp * cxp + cp * cyp + (y1 + y2) / 2;
      const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry); let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
      if (!fs && dt > 0) dt -= TAU; else if (fs && dt < 0) dt += TAU;
      const n = Math.max(4, Math.ceil(Math.abs(dt) / (TAU / 48)));
      for (let k = 1; k <= n; k++) { const t = t1 + dt * k / n; add(ccx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, ccy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp); }
    };
    while (i < toks.length) {
      if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
      const rel = cmd === cmd.toLowerCase() && cmd !== 'z' ? 1 : 0, C = cmd.toUpperCase();
      const ox = rel ? x : 0, oy = rel ? y : 0;
      switch (C) {
        case 'M': { const px = num() + ox, py = num() + oy; x = px; y = py; sx = px; sy = py; cur = [[px, py]]; subs.push(cur); cmd = rel ? 'l' : 'L'; break; }
        case 'L': add(num() + ox, num() + oy); break;
        case 'H': add(num() + ox, y); break;
        case 'V': add(x, num() + oy); break;
        case 'C': { const a = num() + ox, b = num() + oy; cx = num() + ox; cy = num() + oy; const e = num() + ox, f = num() + oy; cubic(a, b, cx, cy, e, f); break; }
        case 'S': { const a = /[CS]/.test(prev) ? 2 * x - cx : x, b = /[CS]/.test(prev) ? 2 * y - cy : y; cx = num() + ox; cy = num() + oy; const e = num() + ox, f = num() + oy; cubic(a, b, cx, cy, e, f); break; }
        case 'Q': { qx = num() + ox; qy = num() + oy; quad(qx, qy, num() + ox, num() + oy); break; }
        case 'T': { qx = /[QT]/.test(prev) ? 2 * x - qx : x; qy = /[QT]/.test(prev) ? 2 * y - qy : y; quad(qx, qy, num() + ox, num() + oy); break; }
        case 'A': { const rx = num(), ry = num(), ph = num(), fa = num(), fs = num(); arc(rx, ry, ph, fa ? 1 : 0, fs ? 1 : 0, num() + ox, num() + oy); break; }
        case 'Z': x = sx; y = sy; cur = null; break;
        default: i++;
      }
      prev = C;
      if (C === 'Z') continue;
      if (!isNum() && i < toks.length && !/[a-zA-Z]/.test(toks[i])) i++;
    }
    return subs.map((s) => cleanPoly(s.map(([a, b]) => [a, -b]))).filter((s) => s.length >= 3 && Math.abs(polyArea(s)) > 1e-9); // flip to Y-up
  }
  function shapesFromSVG(text) {
    const ds = [];
    const grab = (re, f) => { let m; while ((m = re.exec(text))) ds.push(f(m)); };
    grab(/<path[^>]*\sd\s*=\s*"([^"]+)"/gi, (m) => m[1]);
    grab(/<path[^>]*\sd\s*=\s*'([^']+)'/gi, (m) => m[1]);
    grab(/<polygon[^>]*points\s*=\s*"([^"]+)"/gi, (m) => 'M' + m[1].trim() + 'Z');
    grab(/<rect[^>]*>/gi, (m) => { const g = (k) => parseFloat((m[0].match(new RegExp('\\s' + k + '\\s*=\\s*"([^"]+)"')) || [])[1] || 0); const X = g('x'), Y = g('y'), W = g('width'), H = g('height'); return W && H ? `M${X} ${Y}H${X + W}V${Y + H}H${X}Z` : ''; });
    grab(/<circle[^>]*>/gi, (m) => { const g = (k) => parseFloat((m[0].match(new RegExp('\\s' + k + '\\s*=\\s*"([^"]+)"')) || [])[1] || 0); const X = g('cx'), Y = g('cy'), R = g('r'); return R ? `M${X - R} ${Y}A${R} ${R} 0 1 0 ${X + R} ${Y}A${R} ${R} 0 1 0 ${X - R} ${Y}Z` : ''; });
    grab(/<ellipse[^>]*>/gi, (m) => { const g = (k) => parseFloat((m[0].match(new RegExp('\\s' + k + '\\s*=\\s*"([^"]+)"')) || [])[1] || 0); const X = g('cx'), Y = g('cy'), A = g('rx'), B = g('ry'); return A && B ? `M${X - A} ${Y}A${A} ${B} 0 1 0 ${X + A} ${Y}A${A} ${B} 0 1 0 ${X - A} ${Y}Z` : ''; });
    if (!ds.length && /^[\s]*[Mm]/.test(text)) ds.push(text); // raw path data pasted
    return ds.filter(Boolean).flatMap((d) => parseSVGPath(d));
  }
  /* normalise a polygon to a unit shape: centred on its bbox, circumradius 1, CCW, simple */
  function normaliseShape(pts) {
    let p = cleanPoly(pts); if (p.length < 3) throw new Error('A shape needs at least 3 points.');
    if (selfIntersects(p)) throw new Error('The outline crosses itself. Redraw it so edges do not cross.');
    if (polyArea(p) < 0) p = p.slice().reverse();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const [x, y] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; let R = 0; for (const [x, y] of p) R = Math.max(R, Math.hypot(x - cx, y - cy));
    return p.map(([x, y]) => [+((x - cx) / R).toFixed(6), +((y - cy) / R).toFixed(6)]);
  }

  /* ---------- hole shapes: unit loops, circumradius 1, centred ---------- */
  function unitShape(s) {
    const P = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
    switch (s.shape) {
      case 'polygon': { const n = Math.max(3, s.sides | 0); return polyLoop(Array.from({ length: n }, (_, k) => P(1, Math.PI / 2 + k * TAU / n))); }
      case 'star': { const n = Math.max(3, s.sides | 0), k = clamp(s.starK ?? 0.5, 0.1, 0.95);
        return polyLoop(Array.from({ length: 2 * n }, (_, i) => P(i % 2 ? k : 1, Math.PI / 2 + i * Math.PI / n))); }
      case 'rect': { const a = Math.atan(clamp(s.aspect ?? 1, 0.05, 20)), w = Math.cos(a), h = Math.sin(a);
        return polyLoop([[-w, -h], [w, -h], [w, h], [-w, h]]); }
      case 'slot': { const rr = clamp(s.slotW ?? 0.35, 0.05, 0.99), hl = 1 - rr;
        return [{ t: 'l', a: [-hl, -rr], b: [hl, -rr] }, { t: 'a', c: [hl, 0], r: rr, a0: -Math.PI / 2, a1: Math.PI / 2 },
                { t: 'l', a: [hl, rr], b: [-hl, rr] }, { t: 'a', c: [-hl, 0], r: rr, a0: Math.PI / 2, a1: 1.5 * Math.PI }]; }
      case 'custom': return s.custom && s.custom.length >= 3 ? polyLoop(s.custom) : circleLoop(0, 0, 1);
      default: return circleLoop(0, 0, 1);
    }
  }
  function placeLoop(L, cx, cy, D, sx, sy, rot) { // scale unit loop to size D (circumscribed), stretch, rotate, translate
    const R = D / 2, c = Math.cos(rot), s = Math.sin(rot);
    const T = (p) => { const x = p[0] * R * sx, y = p[1] * R * sy; return [cx + x * c - y * s, cy + x * s + y * c]; };
    if (Math.abs(sx - sy) < 1e-9) return L.map((g) => g.t === 'l' ? { t: 'l', a: T(g.a), b: T(g.b) } : { t: 'a', c: T(g.c), r: g.r * R * sx, a0: g.a0 + rot, a1: g.a1 + rot });
    return polyLoop(flatten(L, 0.004).map(T)); // ellipses are exported as fine polylines
  }

  /* Morph correspondence: both outlines are sampled at a shared parameter set that includes every
     sharp corner of either shape, so tips and corners are never cut off by resampling. */
  function outlineData(L) {
    const d = flatten(orient(L, true), 0.0015), n = d.length, cum = [0];
    for (let i = 0; i < n; i++) { const a = d[i], b = d[(i + 1) % n]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const tot = cum[n]; let s0 = 0, best = Infinity;
    for (let i = 0; i < n; i++) { const a = d[i], b = d[(i + 1) % n];
      if ((a[1] <= 0 && b[1] > 0) || (a[1] < 0 && b[1] >= 0)) { const t = -a[1] / (b[1] - a[1]), x = a[0] + t * (b[0] - a[0]);
        if (x > 0 && -x < best) { best = -x; s0 = cum[i] + t * (cum[i + 1] - cum[i]); } } }
    const corners = [];
    for (let i = 0; i < n; i++) { const p = d[(i + n - 1) % n], v = d[i], q = d[(i + 1) % n];
      const t1 = Math.atan2(v[1] - p[1], v[0] - p[0]), t2 = Math.atan2(q[1] - v[1], q[0] - v[0]);
      const turn = Math.abs(((t2 - t1 + 3 * Math.PI) % TAU) - Math.PI);
      if (turn > 0.35) corners.push((((cum[i] - s0) % tot) + tot) % tot / tot); }
    return { d, n, cum, tot, s0, corners };
  }
  function sampleAt(o, u) {
    const s = ((o.s0 + u * o.tot) % o.tot + o.tot) % o.tot; let lo = 0, hi = o.n - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (o.cum[m] <= s) lo = m; else hi = m - 1; }
    const a = o.d[lo], b = o.d[(lo + 1) % o.n], t = (s - o.cum[lo]) / ((o.cum[lo + 1] - o.cum[lo]) || 1);
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  }
  function resamplePair(LA, LB, N) {
    const a = outlineData(LA), b = outlineData(LB), us = [];
    for (let k = 0; k < N; k++) us.push(k / N);
    us.push(...a.corners, ...b.corners); us.sort((x, y) => x - y);
    const list = us.filter((u, i) => i === 0 || u - us[i - 1] > 1e-5);
    return [list.map((u) => sampleAt(a, u)), list.map((u) => sampleAt(b, u))];
  }

  /* G2 (curvature-continuous) corner fillet. Each sharp corner is replaced by a quintic Bezier whose first
     three and last three control points lie on the adjoining edges, so curvature is zero where it meets
     the straight edges: tangent AND curvature continuous. r is the equivalent fillet radius in mm. */
  const B5 = [1, 5, 10, 10, 5, 1];
  /* The setback is measured ALONG the outline (crossing short segments, e.g. on morphed or imported
     shapes) and limited to just under half the distance to the neighbouring corners. */
  function filletPoly(pts, r, minTurn = 0.26) {
    const n = pts.length; if (n < 3 || !(r > 0)) return pts;
    const cum = [0]; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const L = cum[n]; if (!(L > 0)) return pts;
    const dir = (i) => { const a = pts[i], b = pts[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
    const turn = (i) => { const d1 = dir((i + n - 1) % n), d2 = dir(i); return Math.acos(clamp(d1[0] * d2[0] + d1[1] * d2[1], -1, 1)); };
    const C = []; for (let i = 0; i < n; i++) if (cum[i + 1] - cum[i] > 1e-9 && turn(i) > minTurn) C.push(i);
    if (!C.length) return pts;
    const m = C.length, rel = (a, b) => ((cum[b] - cum[a]) % L + L) % L || L; // arc length from corner a forward to corner b
    const sb = C.map((ci, k) => { const th = turn(ci);
      const lim = m === 1 ? L / 2 : Math.min(rel(C[(k + m - 1) % m], ci), rel(ci, C[(k + 1) % m]));
      return Math.min(r * Math.tan(Math.min(th, 3.05) / 2) * 1.6, 0.48 * lim); });
    const at = (s) => { s = ((s % L) + L) % L; let lo = 0, hi = n - 1; while (lo < hi) { const md = (lo + hi + 1) >> 1; if (cum[md] <= s) lo = md; else hi = md - 1; }
      const a = pts[lo], b = pts[(lo + 1) % n], t = (s - cum[lo]) / ((cum[lo + 1] - cum[lo]) || 1); return { p: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], d: dir(lo) }; };
    const out = [];
    for (let k = 0; k < m; k++) {
      const ci = C[k], s = sb[k];
      if (s < 1e-6) out.push(pts[ci]);
      else {
        const A = at(cum[ci] - s), B = at(cum[ci] + s), ta = A.d, tb = B.d, dx = B.p[0] - A.p[0], dy = B.p[1] - A.p[1];
        const det = ta[0] * tb[1] - ta[1] * tb[0]; let u = Math.hypot(dx, dy) / 2, w = u;
        if (Math.abs(det) > 1e-6) { const uu = (dx * tb[1] - dy * tb[0]) / det, ww = (ta[0] * dy - ta[1] * dx) / det; if (uu > 0 && ww > 0 && uu < 4 * s && ww < 4 * s) { u = uu; w = ww; } }
        const c = [A.p, [A.p[0] + ta[0] * 0.38 * u, A.p[1] + ta[1] * 0.38 * u], [A.p[0] + ta[0] * 0.74 * u, A.p[1] + ta[1] * 0.74 * u],
          [B.p[0] - tb[0] * 0.74 * w, B.p[1] - tb[1] * 0.74 * w], [B.p[0] - tb[0] * 0.38 * w, B.p[1] - tb[1] * 0.38 * w], B.p];
        const th = turn(ci), mm = Math.max(6, Math.ceil(th / 0.1));
        for (let q = 0; q <= mm; q++) { const t = q / mm, v = 1 - t; let x = 0, y = 0;
          for (let j = 0; j < 6; j++) { const wgt = B5[j] * Math.pow(v, 5 - j) * Math.pow(t, j); x += wgt * c[j][0]; y += wgt * c[j][1]; }
          out.push([x, y]); }
      }
      // original vertices strictly between this blend's end and the next blend's start
      const nk = (k + 1) % m, endRel = (m === 1 ? L : rel(ci, C[nk])) - sb[nk];
      for (let t = 1; t < n; t++) { const j = (ci + t) % n, rj = ((cum[j] - cum[ci]) % L + L) % L;
        if (rj >= endRel - 1e-9) break; if (rj > s + 1e-9) out.push(pts[j]); }
    }
    return out;
  }
  const hasArcs = (L) => L.some((s) => s.t === 'a');
  function filletLoop(L, r) { return r > 0 && !hasArcs(L) ? polyLoop(cleanPoly(filletPoly(L.map((s) => s.a), r), 1e-6)) : L; }

  /* Regions: closed outlines that either delete the holes they touch ('cut') or keep only the holes fully inside ('keep') */
  function catmullClosed(P, seg = 14) { // centripetal Catmull-Rom through the points, closed
    const n = P.length, out = [];
    const tj = (ti, a, b) => ti + Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-6, 0.5);
    for (let i = 0; i < n; i++) {
      const p0 = P[(i + n - 1) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
      const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
      for (let k = 0; k < seg; k++) { const t = t1 + (t2 - t1) * k / seg;
        const L = (a, b, ta, tb) => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
        const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3), B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
        out.push(L(B1, B2, t1, t2)); }
    }
    return out;
  }
  function regionPoly(g) {
    if (g.kind === 'circle') return flatten(circleLoop(g.x, g.y, Math.max(g.r, 0.01)), 0.02);
    if (g.kind === 'rect') { const a = (g.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), w = Math.max(g.w, 0.01) / 2, h = Math.max(g.h, 0.01) / 2;
      return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => [g.x + x * c - y * s, g.y + x * s + y * c]); }
    if (g.kind === 'polygon') { const n = Math.max(3, g.sides | 0), a0 = (g.rot || 0) * Math.PI / 180;
      return Array.from({ length: n }, (_, k) => { const a = a0 + Math.PI / 2 + k * TAU / n; return [g.x + g.r * Math.cos(a), g.y + g.r * Math.sin(a)]; }); }
    if (g.kind === 'spline') return g.closed && g.pts && g.pts.length >= 3 ? catmullClosed(g.pts) : null;
    return null;
  }

  /* ---------- plate ---------- */
  function plateLoop(p) {
    if (p.shape === 'circle') return circleLoop(0, 0, p.d / 2);
    if (p.shape === 'polygon') { const n = Math.max(3, p.sides | 0), R = p.d / 2, r0 = (p.rot || 0) * Math.PI / 180;
      return polyLoop(Array.from({ length: n }, (_, k) => { const a = r0 - Math.PI / 2 + Math.PI / n + k * TAU / n; return [R * Math.cos(a), R * Math.sin(a)]; })); }
    if (p.shape === 'custom' && p.custom && p.custom.outer) return orient(polyLoop(customPlatePts(p).outer), true);
    const W = p.w / 2, H = p.h / 2, rc = clamp(p.r || 0, 0, Math.min(W, H) * 0.998);
    if (rc < 1e-6) return polyLoop([[-W, -H], [W, -H], [W, H], [-W, H]]);
    const ix = W - rc, iy = H - rc, L = [];
    const line = (a, b) => { if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6) L.push({ t: 'l', a, b }); };
    line([-ix, -H], [ix, -H]); L.push({ t: 'a', c: [ix, -iy], r: rc, a0: -Math.PI / 2, a1: 0 });
    line([W, -iy], [W, iy]); L.push({ t: 'a', c: [ix, iy], r: rc, a0: 0, a1: Math.PI / 2 });
    line([ix, H], [-ix, H]); L.push({ t: 'a', c: [-ix, iy], r: rc, a0: Math.PI / 2, a1: Math.PI });
    line([-W, iy], [-W, -iy]); L.push({ t: 'a', c: [-ix, -iy], r: rc, a0: Math.PI, a1: 1.5 * Math.PI });
    return L;
  }
  function customPlatePts(p) { // scale the stored outline (normalised) to plate width
    const c = p.custom, k = p.w / c.w;
    return { outer: c.outer.map(([x, y]) => [x * k, y * k]), inner: (c.inner || []).map((q) => q.map(([x, y]) => [x * k, y * k])), h: c.h * k };
  }
  function plateSDF(p) {
    if (p.shape === 'circle') { const R = p.d / 2; return (x, y) => Math.hypot(x, y) - R; }
    if (p.shape === 'polygon') { const n = Math.max(3, p.sides | 0), R = p.d / 2, r0 = (p.rot || 0) * Math.PI / 180, ap = R * Math.cos(Math.PI / n), N = [];
      for (let k = 0; k < n; k++) { const a = r0 - Math.PI / 2 + 2 * Math.PI / n + k * TAU / n; N.push([Math.cos(a), Math.sin(a)]); }
      return (x, y) => { let m = -Infinity; for (const q of N) m = Math.max(m, x * q[0] + y * q[1] - ap); return m; }; }
    if (p.shape === 'custom' && p.custom && p.custom.outer) { const o = customPlatePts(p).outer; return (x, y) => polyPointDist(x, y, o); }
    const W = p.w / 2, H = p.h / 2, rc = clamp(p.r || 0, 0, Math.min(W, H) * 0.998);
    return (x, y) => { const qx = Math.abs(x) - (W - rc), qy = Math.abs(y) - (H - rc); return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rc; };
  }
  function plateExtent(p) {
    if (p.shape === 'rect') return { w: p.w, h: p.h, R: Math.hypot(p.w, p.h) / 2 };
    if (p.shape === 'custom' && p.custom && p.custom.outer) { const h = customPlatePts(p).h; return { w: p.w, h, R: Math.hypot(p.w, h) / 2 }; }
    return { w: p.d, h: p.d, R: p.d / 2 };
  }
  function importPlate(text, widthMM) { // returns stored custom-plate record from SVG
    const polys = shapesFromSVG(text); if (!polys.length) throw new Error('No closed outline found in that SVG.');
    polys.sort((a, b) => Math.abs(polyArea(b)) - Math.abs(polyArea(a)));
    const outer = polys[0]; if (selfIntersects(outer)) throw new Error('The outline crosses itself.');
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const [x, y] of outer) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0, h = y1 - y0;
    const N = (q) => q.map(([x, y]) => [+(x - cx).toFixed(5), +(y - cy).toFixed(5)]);
    const inner = polys.slice(1).filter((q) => pointInPoly(q[0][0], q[0][1], outer) && !selfIntersects(q)).map(N);
    return { outer: N(outer), inner, w, h, svgW: w, srcWidth: widthMM || w };
  }

  /* ---------- fields ---------- */
  function valueNoise(seed) {
    const r = rng(seed), T = new Float32Array(256 * 256); for (let i = 0; i < T.length; i++) T[i] = r();
    const at = (i, j) => T[((j & 255) << 8) | (i & 255)];
    const n = (x, y) => { const i = Math.floor(x), j = Math.floor(y), fx = smooth(x - i), fy = smooth(y - j);
      const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; };
    return (x, y) => clamp((0.6 * n(x, y) + 0.3 * n(x * 2.07 + 17, y * 2.07 + 9) + 0.1 * n(x * 4.3 + 3, y * 4.3 + 71) - 0.18) / 0.64, 0, 1);
  }
  const FALL = { smooth: (u) => smooth(1 - u), linear: (u) => 1 - u, hard: () => 1, sharp: (u) => (1 - u) * (1 - u) };
  function makeField(F, plate, sampler) {
    let base; const ext = plateExtent(plate);
    switch (F.type) {
      case 'linear': { const a = (F.angle || 0) * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), half = Math.abs(dx) * ext.w / 2 + Math.abs(dy) * ext.h / 2 || 1;
        base = (x, y) => clamp(((x * dx + y * dy) / half + 1) / 2, 0, 1); break; }
      case 'radial': { const rad = Math.max(F.radius || 1, 0.1); base = (x, y) => clamp(Math.hypot(x - (F.cx || 0), y - (F.cy || 0)) / rad, 0, 1); break; }
      case 'controls': { const cs = F.controls || [];
        base = (x, y) => { let v = F.base || 0;
          for (const c of cs) { let d;
            if (c.k === 'line') d = c.inf ? (() => { const dx = c.x2 - c.x, dy = c.y2 - c.y, L = Math.hypot(dx, dy) || 1; const sd = ((x - c.x) * dy - (y - c.y) * dx) / L; return c.side ? Math.max(0, sd) : Math.abs(sd); })() : segDist(x, y, [c.x, c.y], [c.x2, c.y2]);
            else d = Math.hypot(x - c.x, y - c.y);
            const u = d / Math.max(c.r, 0.01); if (u < 1) v += c.s * (FALL[c.fall] || FALL.smooth)(u); }
          return clamp(v, 0, 1); }; break; }
      case 'noise': { const nz = valueNoise(F.seed || 1), sc = Math.max(F.noiseScale || 20, 0.5); base = (x, y) => nz(x / sc + 50, y / sc + 50); break; }
      case 'image': base = sampler ? (x, y) => clamp(sampler(x, y), 0, 1) : () => 0.5; break;
      case 'random': { const sd = (F.seed || 1) * 131 + 17; base = (x, y) => hash2(x, y, sd); break; } // independent value per hole
      default: base = () => clamp(F.level ?? 1, 0, 1);
    }
    const g = Math.max(F.gamma || 1, 0.05), inv = !!F.invert;
    const N = F.noise || {}, amt = clamp(N.amt || 0, 0, 1);
    const nz = amt && N.kind !== 'random' ? valueNoise((N.seed || 1) + 101) : null, nsc = Math.max(N.scale || 15, 0.3);
    return (x, y) => {
      let v = base(x, y); if (inv) v = 1 - v; v = Math.pow(v, g);
      if (amt) { const n = N.kind === 'random' ? hash2(x, y, (N.seed || 1) * 31 + 7) : nz(x / nsc + 11, y / nsc + 23); v = clamp(v + amt * (2 * n - 1), 0, 1); }
      return v;
    };
  }
  function channel(C, plate, sampler, def) {
    if (!C || !C.on) return () => def;
    const f = makeField(C.field || {}, plate, sampler);
    return (x, y) => lerp(C.min, C.max, f(x, y));
  }

  const LIMIT = 20000; // max holes per pattern; keeps the editor responsive
  /* ---------- layouts with spacing gradient (m = pitch multiplier) ---------- */
  function layoutPoints(lay, plate, m) {
    const pitch = Math.max(lay.pitch, 0.2), R = plateExtent(plate).R + pitch * 3;
    const rot = (lay.rot || 0) * Math.PI / 180, cr = Math.cos(rot), sr = Math.sin(rot), ox = lay.ox || 0, oy = lay.oy || 0;
    const W = (x, y) => [ox + x * cr - y * sr, oy + x * sr + y * cr];
    const M = (x, y) => { const [a, b] = W(x, y); return Math.max(0.08, m(a, b)); };
    const out = [], MAX = LIMIT + 1;
    const push = (x, y, i, j) => { const [a, b] = W(x, y); out.push({ x: a, y: b, i, j }); };
    const t = lay.type;
    if (t === 'grid' || t === 'stagger' || t === 'hex') {
      const px = pitch, py = t === 'hex' ? pitch * Math.sqrt(3) / 2 : Math.max(lay.pitchY || pitch, 0.2);
      const rows = [[0, 0]];
      for (const dir of [1, -1]) { let y = 0, j = 0; while (Math.abs(y) < R && rows.length < 4000) { const h = py * M(0, y + dir * py * M(0, y) / 2); y += dir * h; j += dir; rows.push([y, j]); } }
      for (const [y, j] of rows) {
        const off = t !== 'grid' && (j & 1) ? 0.5 : 0, s0 = px * M(0, y), x0 = off * s0;
        for (const dir of [1, -1]) { let x = dir > 0 ? x0 : x0 - px * M(x0 - s0 / 2, y), i = dir > 0 ? 0 : -1;
          while (Math.abs(x) < R && out.length < MAX) { if (x * x + y * y <= R * R) push(x, y, i, j); x += dir * px * M(x + dir * px * M(x, y) / 2, y); i += dir; } }
      }
    } else if (t === 'radial') {
      const step = Math.max(lay.ringStep || pitch, 0.2); if (lay.center !== false) push(0, 0, 0, 0);
      let r = 0, k = 0;
      while (out.length < MAX) { r += step * M(r + step / 2, 0); k++; if (r > R) break;
        const steps = []; let a = 0; while (a < TAU && steps.length < 20000) { const s = pitch * M(r * Math.cos(a), r * Math.sin(a)) / r; steps.push(s); a += s; }
        const n = Math.max(3, steps.length), sum = steps.reduce((p, q) => p + q, 0), sc = TAU / sum;
        let ang = lay.stagger !== false && (k & 1) ? steps[0] * sc / 2 : 0;
        for (let i = 0; i < steps.length && i < n; i++) { push(r * Math.cos(ang), r * Math.sin(ang), i, k); ang += steps[i] * sc; } }
    } else if (t === 'fibonacci') {
      const c = pitch / Math.sqrt(Math.PI) * 0.95, g = Math.PI * (3 - Math.sqrt(5)); let A = lay.center === false ? Math.PI * c * c : Math.PI * c * c * 0.5;
      for (let i = 0; out.length < MAX; i++) { const r = Math.sqrt(A / Math.PI); if (r > R) break; const a = i * g, x = r * Math.cos(a), y = r * Math.sin(a);
        push(x, y, i, 0); const mm = M(x, y); A += Math.PI * c * c * mm * mm; }
    } else if (t === 'spiral') { // Archimedean
      const step = Math.max(lay.ringStep || pitch, 0.2); let a = 0, i = 0;
      if (lay.center !== false) push(0, 0, i++, 0);
      let r = Math.max(pitch * M(0, 0), step * 0.75); // first turn starts one pitch out, no centre clustering
      while (r < R && out.length < MAX) { const x = r * Math.cos(a), y = r * Math.sin(a); push(x, y, i++, Math.floor(a / TAU));
        const mm = M(x, y), ds = pitch * mm, da = ds / Math.max(r, ds); a += da; r += step * mm * da / TAU; }
    } else if (t === 'poisson' || t === 'random') {
      const rand = rng(lay.seed || 1);
      if (t === 'random') { let mmin = Infinity; for (let k = 0; k < 400; k++) mmin = Math.min(mmin, M((rand() * 2 - 1) * R, (rand() * 2 - 1) * R));
        const n = Math.min(MAX, Math.round(4 * R * R / (pitch * pitch * mmin * mmin)));
        for (let k = 0; k < n; k++) { const x = (rand() * 2 - 1) * R, y = (rand() * 2 - 1) * R, mm = M(x, y); if (rand() < (mmin / mm) ** 2) push(x, y, k, 0); }
      } else {
        let mmin = Infinity, mmax = 0; for (let k = 0; k < 400; k++) { const v = M((rand() * 2 - 1) * R, (rand() * 2 - 1) * R); mmin = Math.min(mmin, v); mmax = Math.max(mmax, v); }
        const rmin = pitch * mmin, cell = rmin / Math.SQRT2, gn = Math.ceil(2 * R / cell), reach = Math.ceil(pitch * mmax / cell) + 1;
        if (gn * gn > 6e6) return out;
        const grid = new Int32Array(gn * gn).fill(-1), pts = [], act = [];
        const add = (x, y, r) => { pts.push([x, y, r]); act.push(pts.length - 1); grid[Math.floor((y + R) / cell) * gn + Math.floor((x + R) / cell)] = pts.length - 1; };
        add(0, 0, pitch * M(0, 0));
        while (act.length && pts.length < MAX) {
          const ai = Math.floor(rand() * act.length), p = pts[act[ai]]; let found = false;
          for (let k = 0; k < 24; k++) { const a = rand() * TAU, d = p[2] * (1 + rand()), x = p[0] + d * Math.cos(a), y = p[1] + d * Math.sin(a);
            if (x < -R || y < -R || x >= R || y >= R) continue; const rn = pitch * M(x, y);
            const gx = Math.floor((x + R) / cell), gy = Math.floor((y + R) / cell); let ok = true;
            for (let jj = Math.max(0, gy - reach); jj <= Math.min(gn - 1, gy + reach) && ok; jj++) for (let ii = Math.max(0, gx - reach); ii <= Math.min(gn - 1, gx + reach); ii++) {
              const q = grid[jj * gn + ii]; if (q >= 0 && Math.hypot(pts[q][0] - x, pts[q][1] - y) < (pts[q][2] + rn) / 2) { ok = false; break; } }
            if (ok) { add(x, y, rn); found = true; break; } }
          if (!found) act.splice(ai, 1);
        }
        pts.forEach((q, k) => push(q[0], q[1], k, 0));
      }
    }
    return out;
  }

  /* ---------- fixed features: mounting holes + custom-plate cutouts ---------- */
  function mountCenters(m, plate) {
    if (!m || !m.enabled) return [];
    if (m.mode === 'manual') return (m.list || []).map((q) => [q.x, q.y]);
    const ins = m.inset;
    if (plate.shape === 'rect') { const x = plate.w / 2 - ins, y = plate.h / 2 - ins; return [[-x, -y], [x, -y], [x, y], [-x, y]]; }
    if (plate.shape === 'custom') return [];
    const out = [];
    if (plate.shape === 'polygon') { const n = Math.max(3, plate.sides | 0), ap = plate.d / 2 * Math.cos(Math.PI / n), r = (ap - ins) / Math.cos(Math.PI / n), r0 = (plate.rot || 0) * Math.PI / 180;
      for (let k = 0; k < n; k++) { const a = r0 - Math.PI / 2 + Math.PI / n + k * TAU / n; out.push([r * Math.cos(a), r * Math.sin(a)]); } return out; }
    const R = plate.d / 2 - ins, n = Math.max(2, m.count | 0);
    for (let k = 0; k < n; k++) { const a = Math.PI / 4 + k * TAU / n; out.push([R * Math.cos(a), R * Math.sin(a)]); }
    return out;
  }
  function bound(pts, cx, cy) { let R = 0; for (const [x, y] of pts) R = Math.max(R, Math.hypot(x - cx, y - cy)); return R; }

  /* ---------- main generator ---------- */
  function generate(P, sampler, opt = {}) { // opt.fast: skip the web/overlap check (interactive dragging)
    const t0 = Date.now();
    const plate = P.plate, H = P.hole, D = P.dfm, G = P.grad || {}, sdf = plateSDF(plate);
    const sizeF = channel(G.size, plate, sampler, H.d);
    const spaceF = channel(G.spacing, plate, sampler, 1);
    const angF = channel(G.angle, plate, sampler, 0);
    const morphOn = G.shape && G.shape.on;
    const morphF = channel(G.shape, plate, sampler, 0);
    const steps = morphOn ? (G.shape.steps | 0) : 0, res = clamp(G.shape?.res | 0 || 48, 12, 256);
    const baseU = unitShape(H), targU = morphOn ? unitShape(Object.assign({}, H, G.shape.target || {})) : null;
    const [A, B] = morphOn ? resamplePair(baseU, targU, res) : [null, null];
    // size while morphing: 'area' keeps open area of the base shape, 'outer' keeps circumscribed size, 'scale' goes linearly to scaleAt
    const sizeMode = morphOn ? (G.shape.keep || 'area') : 'outer', scaleAt = morphOn ? Math.max(G.shape.scaleAt ?? 1, 0.05) : 1;
    const aA = morphOn ? Math.abs(polyArea(A)) : 1, aB = morphOn ? Math.abs(polyArea(B)) : 1;
    const morphScale = (t, mixPts) => sizeMode === 'scale' ? lerp(1, scaleAt, t) : sizeMode === 'area' ? Math.sqrt(aA / Math.max(t >= 1 - 1e-4 ? aB : Math.abs(polyArea(mixPts)), 1e-9)) : 1;
    // fillet per shape: base shape uses hole.fillet, target uses its own; morphed holes blend between them
    const filA = Math.max(H.fillet || 0, 0), filB = morphOn ? Math.max((G.shape.target || {}).fillet ?? 0, 0) : filA;
    const sx = Math.max(H.sx ?? 1, 0.05), sy = Math.max(H.sy ?? 1, 0.05);
    const rand = rng((H.seed || 7) * 7919);
    const spin = (H.spin || 0) * Math.PI / 180;

    // fixed features
    const outer = orient(plateLoop(plate), true);
    const fixed = [];
    let mountsDropped = 0;
    for (const [x, y] of mountCenters(P.mounts, plate)) {
      const r = P.mounts.d / 2; if (!(r > 0) || sdf(x, y) > -(r + 0.05)) { mountsDropped++; continue; }
      const loop = orient(circleLoop(x, y, r), false);
      fixed.push({ kind: 'mount', cx: x, cy: y, R: r, loop, pts: flatten(loop), circ: r, clear: P.mounts.clear || 0 });
    }
    if (plate.shape === 'custom' && plate.custom && plate.custom.outer) for (const q of customPlatePts(plate).inner) {
      const loop = orient(polyLoop(q), false); let cx = 0, cy = 0; q.forEach(([a, b]) => { cx += a; cy += b; }); cx /= q.length; cy /= q.length;
      fixed.push({ kind: 'cutout', cx, cy, R: bound(q, cx, cy), loop, pts: q, clear: 0 });
    }
    const regs = [...(P.regions || []), ...(P.keepouts || []).map((k) => ({ kind: 'circle', x: k.x, y: k.y, r: k.r, mode: 'cut' }))].map((g) => {
      const pts = regionPoly(g); if (!pts || pts.length < 3) return null;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const [a, b] of pts) { x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      return { mode: g.mode === 'keep' ? 'keep' : 'cut', gap: Math.max(g.gap ?? (D.web || 0), 0), pts, cx, cy, R: bound(pts, cx, cy), circ: g.kind === 'circle' ? { x: g.x, y: g.y, r: g.r } : null };
    }).filter(Boolean);
    const cutRegs = regs.filter((r) => r.mode === 'cut'), keepRegs = regs.filter((r) => r.mode === 'keep');
    const outerPts = plate.shape === 'custom' ? flatten(outer) : null;

    let pts = layoutPoints(P.layout, plate, spaceF); const capped = pts.length > LIMIT; if (capped) pts = pts.slice(0, LIMIT);
    let holes = []; const dropped = { small: 0, edge: 0, keep: 0, region: 0, edited: 0, random: 0 };
    // layout randomness: position jitter (random or smooth, as a share of the local spacing) and random removal
    const LJ = P.layout, jAmt = clamp(LJ.jitter || 0, 0, 1), drop = clamp(LJ.dropout || 0, 0, 0.95), js = (LJ.jseed || 1) | 0;
    const jSmooth = LJ.jkind === 'smooth', jsc = Math.max(LJ.jscale || 20, 0.5), nzx = jAmt && jSmooth ? valueNoise(js * 7 + 3) : null, nzy = jAmt && jSmooth ? valueNoise(js * 7 + 5) : null;
    const pitch0 = Math.max(LJ.pitch || 1, 0.2);
    for (const p of pts) {
      if (drop && hash2(p.x, p.y, js * 97 + 1) < drop) { dropped.random++; continue; }
      if (jAmt) { const amp = jAmt * 0.5 * pitch0 * spaceF(p.x, p.y);
        const ux = jSmooth ? nzx(p.x / jsc + 7, p.y / jsc + 3) * 2 - 1 : hash2(p.x, p.y, js * 13 + 2) * 2 - 1;
        const uy = jSmooth ? nzy(p.x / jsc + 19, p.y / jsc + 11) * 2 - 1 : hash2(p.x, p.y, js * 29 + 5) * 2 - 1;
        p.x += ux * amp; p.y += uy * amp; }
      const { x, y } = p;
      const Dn = sizeF(x, y);
      if (!(Dn >= Math.max(D.minFeat, 0.05))) { dropped.small++; continue; }
      let rot = ((H.rot || 0) + angF(x, y)) * Math.PI / 180;
      if (H.rotMode === 'radial') rot += Math.atan2(y, x);
      else if (H.rotMode === 'random') rot += (rand() - 0.5) * TAU * clamp(H.jitter ?? 1, 0, 1);
      if (spin) { const by = H.spinBy || 'row'; const k = by === 'row' ? p.j : by === 'col' ? p.i : p.i + p.j; if (k & 1) rot += spin; }
      let loop, tm = 0, De = Dn;
      if (morphOn) { tm = clamp(morphF(x, y), 0, 1); if (steps > 1) tm = Math.round(tm * (steps - 1)) / (steps - 1); }
      if (!morphOn || tm < 1e-4) loop = placeLoop(baseU, x, y, Dn, sx, sy, rot);
      else if (tm > 1 - 1e-4) { De = Dn * morphScale(1); loop = placeLoop(targU, x, y, De, sx, sy, rot); }
      else { const mix = A.map((a, k) => [lerp(a[0], B[k][0], tm), lerp(a[1], B[k][1], tm)]); De = Dn * morphScale(tm, mix); loop = placeLoop(polyLoop(mix), x, y, De, sx, sy, rot); }
      const fil = morphOn ? lerp(filA, filB, tm) : filA; if (fil > 0) loop = filletLoop(loop, fil);
      loop = orient(loop, false);
      const circ = loop.length === 2 && loop[0].t === 'a' ? loop[0].r : 0;
      const hp = flatten(loop, Math.max(Dn * 0.004, 0.005));
      const R = circ || bound(hp, x, y);
      // plate edge
      let partial = false, edgeMax = null; const s = sdf(x, y);
      if (s > -(R + D.edge)) {
        if (s >= R) { continue; }
        let mx = -Infinity, mn = Infinity; for (const v of hp) { const q = sdf(v[0], v[1]); mx = Math.max(mx, q); mn = Math.min(mn, q); }
        edgeMax = mx; let ok = mx <= -D.edge;
        if (ok && outerPts) for (const v of outerPts) if (Math.hypot(v[0] - x, v[1] - y) < R && pointInPoly(v[0], v[1], hp)) { ok = false; break; }
        if (!ok) { if (D.clip && mn < 0) partial = true; else { dropped.edge++; continue; } }
      }
      // regions: delete holes touching a cut region; with keep regions, keep only holes fully inside one
      let bad = false;
      for (const g of cutRegs) { const dc = Math.hypot(x - g.cx, y - g.cy); if (dc > g.R + R + g.gap) continue;
        const gp = circ && g.circ ? Math.hypot(x - g.circ.x, y - g.circ.y) - circ - g.circ.r : polyGap(hp, g.pts); if (gp < g.gap) { bad = true; break; } }
      if (!bad && keepRegs.length) { bad = true;
        for (const g of keepRegs) { if (Math.hypot(x - g.cx, y - g.cy) > g.R + R) continue; if (!pointInPoly(x, y, g.pts)) continue;
          let ok = true; for (const v of hp) if (polyPointDist(v[0], v[1], g.pts) > -g.gap) { ok = false; break; }
          if (ok) for (const v of g.pts) if (Math.hypot(v[0] - x, v[1] - y) < R && pointInPoly(v[0], v[1], hp)) { ok = false; break; }
          if (ok) { bad = false; break; } } }
      if (bad) { dropped.region++; continue; }
      if (!bad) for (const f of fixed) { const need = (D.web || 0) + f.clear, dc = Math.hypot(x - f.cx, y - f.cy); if (dc > f.R + R + need) continue;
        const gap = circ && f.circ ? dc - circ - f.circ : polyGap(hp, f.pts); if (gap < Math.max(need, 0.01)) { bad = true; break; } }
      if (bad) { dropped.keep++; continue; }
      holes.push({ cx: x, cy: y, D: De, R, rot, t: tm, loop, pts: hp, circ, area: Math.abs(loopArea(loop)), partial, edgeMax, viol: 0 });
    }
    // per-hole edits from selection: 'only' keeps just those holes, 'del' removes them (matched by position)
    const E = P.edits || {}, tol = Math.max(0.05, 0.3 * Math.max(P.layout.pitch || 1, 0.2));
    let editsUnmatched = 0;
    if ((E.only && E.only.length) || (E.del && E.del.length)) {
      const hgrid = new Map(), key = (x, y) => Math.floor(x / tol) + ',' + Math.floor(y / tol);
      holes.forEach((h, i) => { const k = key(h.cx, h.cy); (hgrid.get(k) || hgrid.set(k, []).get(k)).push(i); });
      const match = (pts) => { const hit = new Set();
        for (const [x, y] of pts) { let found = -1, bd = tol; const gx = Math.floor(x / tol), gy = Math.floor(y / tol);
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const i of hgrid.get((gx + a) + ',' + (gy + b)) || []) { const d = Math.hypot(holes[i].cx - x, holes[i].cy - y); if (d <= bd) { bd = d; found = i; } }
          if (found < 0) editsUnmatched++; else hit.add(found); }
        return hit; };
      const only = E.only && E.only.length ? match(E.only) : null, del = match(E.del || []);
      const before = holes.length;
      holes = holes.filter((h, i) => (!only || only.has(i)) && !del.has(i));
      dropped.edited = before - holes.length;
    }
    // web / overlap: exact for circles, exact polyline distance otherwise
    const web = D.web || 0, cell = Math.max(holes.reduce((a, h) => Math.max(a, 2 * h.R), 0) + web, 0.5), map = new Map();
    holes.forEach((h, i) => { const k = Math.floor(h.cx / cell) + ',' + Math.floor(h.cy / cell); (map.get(k) || map.set(k, []).get(k)).push(i); });
    let minWeb = Infinity, webViol = 0, overlaps = 0, budget = opt.fast ? 0 : 4e6, truncated = false;
    holes.forEach((h, i) => {
      if (budget <= 0) { truncated = !opt.fast; return; }
      const gx = Math.floor(h.cx / cell), gy = Math.floor(h.cy / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const arr = map.get((gx + dx) + ',' + (gy + dy)); if (!arr) continue;
        for (const j of arr) { if (j <= i) continue; const o = holes[j], dc = Math.hypot(h.cx - o.cx, h.cy - o.cy);
          let gap = dc - h.R - o.R; budget--;
          if (gap < Math.max(web, 0) + 1e-9 && !(h.circ && o.circ)) { budget -= h.pts.length * o.pts.length; gap = polyGap(h.pts, o.pts); }
          if (gap < minWeb) minWeb = gap;
          if (gap < web || gap < 0.001) { const lvl = gap < 0.001 ? 2 : 1; h.viol = Math.max(h.viol, lvl); o.viol = Math.max(o.viol, lvl); webViol++; if (lvl === 2) { overlaps++; (h.hits ||= []).push(j); (o.hits ||= []).push(i); } }
        }
      }
    });
    const pArea = Math.abs(loopArea(outer)) - fixed.filter((f) => f.kind === 'cutout').reduce((a, f) => a + Math.abs(polyArea(f.pts)), 0);
    const full = holes.filter((h) => !h.partial);
    const holeArea = full.reduce((a, h) => a + h.area, 0) + fixed.filter((f) => f.kind === 'mount').reduce((a, f) => a + Math.PI * f.R * f.R, 0);
    return {
      plate, outer, holes, fixed, mounts: fixed.filter((f) => f.kind === 'mount'), pts: pts.length,
      stats: { count: holes.length, full: full.length, partial: holes.length - full.length, plateArea: pArea, openArea: holeArea, openPct: 100 * holeArea / pArea,
        minWeb: isFinite(minWeb) ? minWeb : null, webViol, overlaps, dropped, mountsDropped, capped, truncated, editsUnmatched, fast: !!opt.fast, ms: Date.now() - t0 },
      regions: regs,
    };
  }

  /* holes safe for solid export: complete holes only; greedy removal of overlaps (exact test) */
  function exportHoles(model) {
    const kept = [], drop = new Set(); let removed = 0;
    model.holes.forEach((h, i) => {
      if (h.partial) return;
      if (h.edgeMax != null && h.edgeMax > -0.01) { drop.add(i); removed++; return; } // touching the outline
      if (h.viol === 2 && (h.hits || []).some((j) => j < i && !drop.has(j) && !model.holes[j].partial)) { drop.add(i); removed++; return; }
      kept.push(h);
    });
    return { holes: kept, removed, partialSkipped: model.holes.filter((h) => h.partial).length };
  }

  /* ---------- SVG ---------- */
  const n4 = (x) => (Math.abs(x) < 5e-5 ? 0 : +x.toFixed(4));
  function loopPath(L) {
    const p0 = segStart(L[0]); let d = `M${n4(p0[0])} ${n4(p0[1])}`;
    for (const s of L) { const e = segEnd(s);
      if (s.t === 'l') d += `L${n4(e[0])} ${n4(e[1])}`;
      else d += `A${n4(s.r)} ${n4(s.r)} 0 ${Math.abs(s.a1 - s.a0) > Math.PI ? 1 : 0} ${s.a1 > s.a0 ? 1 : 0} ${n4(e[0])} ${n4(e[1])}`; }
    return d + 'Z';
  }
  function toSVG(model, opt = {}) {
    const ext = plateExtent(model.plate), w = ext.w, h = ext.h, pad = opt.pad ?? 2, fg = opt.color || '#000';
    const outerD = loopPath(model.outer), holesOnly = opt.holesOnly;
    const full = model.holes.filter((x) => !x.partial).map((x) => loopPath(x.loop)).join('');
    const part = model.holes.filter((x) => x.partial).map((x) => loopPath(x.loop)).join('');
    const fixedD = model.fixed.map((m) => loopPath(m.loop)).join('');
    let body;
    if (opt.style === 'fill') body = `<defs><clipPath id="plate"><path d="${outerD}"/></clipPath><mask id="cut"><path d="${outerD}" fill="#fff"/><path d="${full}${fixedD}" fill="#000"/>${part ? `<path d="${part}" fill="#000" clip-path="url(#plate)"/>` : ''}</mask></defs>
${holesOnly ? `<g fill="${fg}"><path d="${full}"/>${part ? `<path d="${part}" clip-path="url(#plate)"/>` : ''}</g>` : `<path d="${outerD}" fill="${fg}" mask="url(#cut)"/>`}`;
    else body = `<defs><clipPath id="plate"><path d="${outerD}"/></clipPath></defs>
<g fill="none" stroke="${fg}" stroke-width="${opt.stroke || 0.1}">
${holesOnly ? '' : `<path id="outline" d="${outerD}"/>`}
<path id="holes" d="${full}"/>
${fixedD && !holesOnly ? `<path id="fixed-features" d="${fixedD}"/>` : ''}
${part ? `<path id="partial-holes" d="${part}" clip-path="url(#plate)"/>` : ''}
</g>`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${n4(w + 2 * pad)}mm" height="${n4(h + 2 * pad)}mm" viewBox="${n4(-w / 2 - pad)} ${n4(-h / 2 - pad)} ${n4(w + 2 * pad)} ${n4(h + 2 * pad)}">
<!-- ParaVent export · units: mm · ${model.holes.length} holes -->
<g transform="scale(1,-1)">
${body}
</g>
</svg>`;
  }

  /* ---------- DXF (R12 ASCII, mm) ---------- */
  function toDXF(model, opt = {}) {
    const { holes } = exportHoles(model), o = [];
    const g = (c, v) => o.push(String(c), String(v));
    const deg = (a) => { let d = a * 180 / Math.PI % 360; if (d < 0) d += 360; return +d.toFixed(6); };
    g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'TABLES'); g(0, 'TABLE'); g(2, 'LAYER'); g(70, 4);
    [['OUTLINE', 7], ['HOLES', 1], ['MOUNTING', 5], ['CUTOUTS', 3]].forEach(([n, c]) => { g(0, 'LAYER'); g(2, n); g(70, 0); g(62, c); g(6, 'CONTINUOUS'); });
    g(0, 'ENDTAB'); g(0, 'ENDSEC'); g(0, 'SECTION'); g(2, 'ENTITIES');
    const emit = (L, layer) => {
      if (L.length === 2 && L[0].t === 'a' && L[1].t === 'a' && Math.abs(L[0].c[0] - L[1].c[0]) < 1e-9 && Math.abs(L[0].c[1] - L[1].c[1]) < 1e-9) { g(0, 'CIRCLE'); g(8, layer); g(10, n4(L[0].c[0])); g(20, n4(L[0].c[1])); g(30, 0); g(40, n4(L[0].r)); return; }
      for (const s of L) {
        if (s.t === 'l') { g(0, 'LINE'); g(8, layer); g(10, n4(s.a[0])); g(20, n4(s.a[1])); g(30, 0); g(11, n4(s.b[0])); g(21, n4(s.b[1])); g(31, 0); }
        else { const [st, en] = s.a1 > s.a0 ? [s.a0, s.a1] : [s.a1, s.a0]; g(0, 'ARC'); g(8, layer); g(10, n4(s.c[0])); g(20, n4(s.c[1])); g(30, 0); g(40, n4(s.r)); g(50, deg(st)); g(51, deg(en)); }
      }
    };
    if (!opt.holesOnly) emit(model.outer, 'OUTLINE');
    holes.forEach((h) => emit(h.loop, 'HOLES'));
    if (!opt.holesOnly) model.fixed.forEach((m) => emit(m.loop, m.kind === 'mount' ? 'MOUNTING' : 'CUTOUTS'));
    g(0, 'ENDSEC'); g(0, 'EOF');
    return o.join('\r\n') + '\r\n';
  }

  /* ---------- STEP AP214, manifold solid B-rep ---------- */
  function sn(x) { if (!isFinite(x) || Math.abs(x) < 1e-9) return '0.'; const s = x.toFixed(6).replace(/0+$/, ''); return s === '-0.' ? '0.' : s; }
  const ascii = (s) => String(s || '').replace(/[^\x20-\x7E]/g, '_').replace(/'/g, "''").replace(/\\/g, '/');
  function StepWriter() { this.rows = []; this.n = 0; this.dirs = new Map(); }
  StepWriter.prototype.e = function (s) { this.rows.push('#' + (++this.n) + '=' + s + ';'); return '#' + this.n; };
  StepWriter.prototype.pt = function (x, y, z) { return this.e(`CARTESIAN_POINT('',(${sn(x)},${sn(y)},${sn(z)}))`); };
  StepWriter.prototype.dir = function (x, y, z) { const k = `${sn(x)},${sn(y)},${sn(z)}`; if (this.dirs.has(k)) return this.dirs.get(k); const id = this.e(`DIRECTION('',(${k}))`); this.dirs.set(k, id); return id; };
  StepWriter.prototype.ax = function (p, z, x) { return this.e(`AXIS2_PLACEMENT_3D('',${p},${z},${x})`); };

  function brepSolid(W, outer, holes, z0, h, name) {
    const dZ = W.dir(0, 0, 1), dX = W.dir(1, 0, 0), faces = [];
    const OE = (e, s) => W.e(`ORIENTED_EDGE('',*,*,${e},${s ? '.T.' : '.F.'})`);
    const edgeFor = (s, z, va, vb, pa) => {
      if (s.t === 'l') { const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], len = Math.hypot(dx, dy);
        const ln = W.e(`LINE('',${pa},${W.e(`VECTOR('',${W.dir(dx / len, dy / len, 0)},${sn(len)})`)})`); return W.e(`EDGE_CURVE('',${va},${vb},${ln},.T.)`); }
      const ci = W.e(`CIRCLE('',${W.ax(W.pt(s.c[0], s.c[1], z), dZ, dX)},${sn(s.r)})`);
      return W.e(`EDGE_CURVE('',${va},${vb},${ci},${s.a1 > s.a0 ? '.T.' : '.F.'})`);
    };
    const loops = [outer, ...holes].map((L) => {
      const n = L.length, pb = [], pt = [], vb = [], vt = [], eb = [], et = [], ev = [];
      for (let i = 0; i < n; i++) { const p = segStart(L[i]);
        pb[i] = W.pt(p[0], p[1], z0); vb[i] = W.e(`VERTEX_POINT('',${pb[i]})`); pt[i] = W.pt(p[0], p[1], z0 + h); vt[i] = W.e(`VERTEX_POINT('',${pt[i]})`); }
      for (let i = 0; i < n; i++) { const ln = W.e(`LINE('',${pb[i]},${W.e(`VECTOR('',${dZ},${sn(h)})`)})`); ev[i] = W.e(`EDGE_CURVE('',${vb[i]},${vt[i]},${ln},.T.)`); }
      for (let i = 0; i < n; i++) {
        const s = L[i], j = (i + 1) % n;
        eb[i] = edgeFor(s, z0, vb[i], vb[j], pb[i]); et[i] = edgeFor(s, z0 + h, vt[i], vt[j], pt[i]);
        const el = W.e(`EDGE_LOOP('',(${OE(eb[i], 1)},${OE(ev[j], 1)},${OE(et[i], 0)},${OE(ev[i], 0)}))`);
        let surf, sense;
        if (s.t === 'l') { const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], len = Math.hypot(dx, dy);
          surf = W.e(`PLANE('',${W.ax(pb[i], W.dir(dy / len, -dx / len, 0), W.dir(dx / len, dy / len, 0))})`); sense = '.T.'; }
        else { surf = W.e(`CYLINDRICAL_SURFACE('',${W.ax(W.pt(s.c[0], s.c[1], z0), dZ, dX)},${sn(s.r)})`); sense = s.a1 > s.a0 ? '.T.' : '.F.'; }
        faces.push(W.e(`ADVANCED_FACE('',(${W.e(`FACE_OUTER_BOUND('',${el},.T.)`)}),${surf},${sense})`));
      }
      return { eb, et };
    });
    const top = loops.map((d, k) => W.e(`${k ? 'FACE_BOUND' : 'FACE_OUTER_BOUND'}('',${W.e(`EDGE_LOOP('',(${d.et.map((e) => OE(e, 1)).join(',')}))`)},.T.)`));
    faces.push(W.e(`ADVANCED_FACE('',(${top.join(',')}),${W.e(`PLANE('',${W.ax(W.pt(0, 0, z0 + h), dZ, dX)})`)},.T.)`));
    const bot = loops.map((d, k) => W.e(`${k ? 'FACE_BOUND' : 'FACE_OUTER_BOUND'}('',${W.e(`EDGE_LOOP('',(${d.eb.slice().reverse().map((e) => OE(e, 0)).join(',')}))`)},.T.)`));
    faces.push(W.e(`ADVANCED_FACE('',(${bot.join(',')}),${W.e(`PLANE('',${W.ax(W.pt(0, 0, z0), dZ, dX)})`)},.F.)`));
    return W.e(`MANIFOLD_SOLID_BREP('${ascii(name)}',${W.e(`CLOSED_SHELL('',(${faces.join(',')}))`)})`);
  }

  /* mode: 'plate'   one solid with through-holes
   *       'holes'   the hole pattern only: one solid per hole, exactly plate thickness, z = 0..t
   *       'cutters' one solid per hole, 0.5 mm proud each side, for boolean cuts in CAD */
  function toSTEP(model, opt = {}) {
    const mode = opt.mode || 'plate', t = Math.max(opt.thickness || 2, 0.01), name = ascii(opt.name || 'VentPlate');
    const { holes, removed, partialSkipped } = exportHoles(model);
    const W = new StepWriter();
    const lu = W.e(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`), au = W.e(`(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`), su = W.e(`(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())`);
    const unc = W.e(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),${lu},'distance_accuracy_value','confusion accuracy')`);
    const ctx = W.e(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${lu},${au},${su}))REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))`);
    const solids = [];
    const holeLoops = holes.map((h) => h.loop), fixedLoops = model.fixed.map((m) => m.loop);
    if (mode === 'plate') solids.push(brepSolid(W, model.outer, holeLoops.concat(fixedLoops), 0, t, name));
    else {
      const loops = opt.includeFixed ? holeLoops.concat(fixedLoops) : holeLoops;
      const z0 = mode === 'cutters' ? -0.5 : 0, hh = mode === 'cutters' ? t + 1 : t;
      loops.forEach((L, i) => solids.push(brepSolid(W, reverseLoop(L), [], z0, hh, `hole_${i + 1}`)));
    }
    const origin = W.ax(W.pt(0, 0, 0), W.dir(0, 0, 1), W.dir(1, 0, 0));
    const rep = W.e(`ADVANCED_BREP_SHAPE_REPRESENTATION('${name}',(${origin},${solids.join(',')}),${ctx})`);
    const appc = W.e(`APPLICATION_CONTEXT('core data for automotive mechanical design processes')`);
    W.e(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${appc})`);
    const pc = W.e(`PRODUCT_CONTEXT('',${appc},'mechanical')`), prod = W.e(`PRODUCT('${name}','${name}','Generated by ParaVent',(${pc}))`);
    W.e(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${prod}))`);
    const pdf = W.e(`PRODUCT_DEFINITION_FORMATION('','',${prod})`), pdc = W.e(`PRODUCT_DEFINITION_CONTEXT('part definition',${appc},'design')`);
    const pds = W.e(`PRODUCT_DEFINITION_SHAPE('','',${W.e(`PRODUCT_DEFINITION('design','',${pdf},${pdc})`)})`);
    W.e(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);
    const text = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ParaVent parametric perforation, mode=${mode}, thickness=${sn(t)} mm'),'2;1');
FILE_NAME('${name}.step','${new Date().toISOString().slice(0, 19)}',('${ascii(opt.author || '')}'),('${ascii(opt.org || '')}'),'ParaVent STEP writer','ParaVent 2.0','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
${W.rows.join('\n')}
ENDSEC;
END-ISO-10303-21;
`;
    return { text, solids: solids.length, holes: holeLoops.length, removed, partialSkipped, entities: W.n };
  }

  return { LIMIT, generate, regionPoly, catmullClosed, filletPoly, pointInPoly, resamplePair, toSVG, toDXF, toSTEP, exportHoles, plateLoop, plateSDF, plateExtent, segStart, segEnd, loopArea, flatten, unitShape,
    shapesFromSVG, normaliseShape, importPlate, selfIntersects, polyArea, TAU };
})();
if (typeof module !== 'undefined') module.exports = VF;
