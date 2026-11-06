// Unit tests for the geometry core. Run with: npm test   (Node 18+, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const VF = createRequire(import.meta.url)('../src/core.js');

const F = (o = {}) => ({ type: 'uniform', level: 1, angle: 0, cx: 0, cy: 0, radius: 60, gamma: 1, invert: false, base: 0, controls: [], noiseScale: 25, seed: 1,
  noise: { amt: 0, kind: 'random', scale: 15, seed: 1 }, ...o });
const params = (o = {}) => {
  const p = {
    plate: { shape: 'rect', w: 140, h: 90, r: 5, d: 100, sides: 6, rot: 0, t: 2 },
    layout: { type: 'hex', pitch: 8, pitchY: 8, rot: 0, ox: 0, oy: 0, ringStep: 8, center: true, stagger: true, seed: 3, jitter: 0, jkind: 'random', jscale: 20, dropout: 0, jseed: 1 },
    hole: { shape: 'circle', sides: 6, starK: 0.5, slotW: 0.35, aspect: 1, fillet: 0, d: 5, sx: 1, sy: 1, rot: 0, rotMode: 'fixed', jitter: 1, seed: 7, spin: 0, spinBy: 'row' },
    grad: {
      size: { on: false, min: 2, max: 5, field: F() },
      spacing: { on: false, min: 0.9, max: 1.4, field: F() },
      angle: { on: false, min: 0, max: 90, field: F() },
      shape: { on: false, min: 0, max: 1, steps: 0, res: 48, keep: 'area', scaleAt: 0.7, target: { shape: 'star', sides: 5, starK: 0.5, fillet: 0 }, field: F({ type: 'linear' }) },
    },
    dfm: { edge: 4, web: 0.6, minFeat: 1, clip: false },
    mounts: { enabled: false, mode: 'auto', d: 3.4, inset: 6, clear: 2, count: 4, list: [] },
    keepouts: [], regions: [], edits: { del: [], only: [] },
  };
  return o(p) || p;
};
const curvature = (p, v, q) => { const a = Math.hypot(v[0] - p[0], v[1] - p[1]), b = Math.hypot(q[0] - v[0], q[1] - v[1]), c = Math.hypot(q[0] - p[0], q[1] - p[1]);
  return 2 * Math.abs((v[0] - p[0]) * (q[1] - p[1]) - (q[0] - p[0]) * (v[1] - p[1])) / (a * b * c); };

test('generates a hex pattern with the expected spacing and no overlaps', () => {
  const m = VF.generate(params((p) => p));
  assert.ok(m.holes.length > 100);
  assert.equal(m.stats.overlaps, 0);
  assert.ok(Math.abs(m.stats.minWeb - (8 - 5)) < 1e-6, `min web ${m.stats.minWeb}`);
});

test('G2 fillet: curvature is zero where the blend meets the straight edge', () => {
  const f = VF.filletPoly([[-5, -5], [5, -5], [5, 5], [-5, 5]], 1.5), n = f.length, quarter = f.slice(0, n / 4);
  const k = quarter.map((v, i) => curvature(f[(i - 1 + n) % n], v, f[(i + 1) % n]));
  // discrete curvature at the joins must be ~0 (< 1 % of the peak); a circular (G1) fillet would show ~45 % here
  const peak = Math.max(...k);
  assert.ok(k[0] < 0.01 * peak && k[k.length - 1] < 0.01 * peak, `join curvature ${k[0]} vs peak ${peak}`);
  for (let i = 1; i < k.length; i++) assert.ok(Math.abs(k[i] - k[i - 1]) < 0.15, 'curvature must change gradually');
});

test('fillet reaches across short segments (morphed / imported outlines)', () => {
  const sq = [[-5, -5], [5, -5], [5, 5], [-5, 5]], dense = [];
  sq.forEach((p, i) => { const q = sq[(i + 1) % 4]; for (let k = 0; k < 20; k++) dense.push([p[0] + (q[0] - p[0]) * k / 20, p[1] + (q[1] - p[1]) * k / 20]); });
  const g = VF.filletPoly(dense, 1.5), reach = Math.min(...g.map((p) => Math.hypot(p[0] - 5, p[1] - 5)));
  assert.ok(reach > 0.5, `corner set back only ${reach} mm`);
});

test('morph "keep open area" holds hole area constant', () => {
  const m = VF.generate(params((p) => { p.grad.shape.on = true; }));
  const A = m.holes.map((h) => h.area), spread = (Math.max(...A) - Math.min(...A)) / Math.max(...A);
  assert.ok(spread < 0.01, `area spread ${spread}`);
});

test('random morph source with steps picks between discrete shapes', () => {
  const m = VF.generate(params((p) => { p.grad.shape.on = true; p.grad.shape.steps = 3; p.grad.shape.field = F({ type: 'random', seed: 4 }); }));
  const ts = new Set(m.holes.map((h) => h.t.toFixed(3)));
  assert.deepEqual([...ts].sort(), ['0.000', '0.500', '1.000']);
});

test('regions: cut deletes, keep retains only holes fully inside, open splines are ignored', () => {
  const n0 = VF.generate(params((p) => p)).holes.length;
  const cut = VF.generate(params((p) => { p.regions = [{ kind: 'circle', x: 0, y: 0, r: 20, mode: 'cut', gap: 0.6 }]; })).holes.length;
  const keep = VF.generate(params((p) => { p.regions = [{ kind: 'spline', pts: [[-40, -20], [0, -35], [40, -20], [30, 25], [-30, 25]], closed: true, mode: 'keep', gap: 0.6 }]; }));
  const open = VF.generate(params((p) => { p.regions = [{ kind: 'spline', pts: [[-40, -20], [0, -35], [40, -20]], closed: false, mode: 'keep' }]; })).holes.length;
  assert.ok(cut < n0 && keep.holes.length < n0 && open === n0);
  const poly = VF.regionPoly({ kind: 'spline', pts: [[-40, -20], [0, -35], [40, -20], [30, 25], [-30, 25]], closed: true });
  for (const h of keep.holes) for (const v of h.pts) assert.ok(VF.pointInPoly(v[0], v[1], poly), 'kept hole leaves the keep region');
});

test('selection edits: delete and keep-only are matched by position', () => {
  const all = VF.generate(params((p) => p)).holes;
  const del = VF.generate(params((p) => { p.edits.del = [[all[5].cx, all[5].cy], [all[6].cx, all[6].cy]]; })).holes.length;
  const only = VF.generate(params((p) => { p.edits.only = [[all[1].cx, all[1].cy], [all[2].cx, all[2].cy], [all[3].cx, all[3].cy]]; })).holes.length;
  assert.equal(del, all.length - 2);
  assert.equal(only, 3);
});

test('layout randomness is deterministic for a given seed', () => {
  const run = (seed) => VF.generate(params((p) => { p.layout.jitter = 0.4; p.layout.dropout = 0.2; p.layout.jseed = seed; })).holes.map((h) => h.cx.toFixed(4)).join();
  assert.equal(run(5), run(5));
  assert.notEqual(run(5), run(6));
});

test('custom plate from SVG: outline plus inner cutouts', () => {
  const rec = VF.importPlate('<svg><path d="M0 0 H160 V90 H0 Z"/><rect x="20" y="20" width="30" height="15"/></svg>');
  assert.equal(rec.inner.length, 1);
  const m = VF.generate(params((p) => { p.plate = { ...p.plate, shape: 'custom', w: 160, custom: rec }; }));
  assert.equal(m.fixed.filter((f) => f.kind === 'cutout').length, 1);
});

test('normaliseShape rejects self-intersecting outlines', () => {
  assert.throws(() => VF.normaliseShape([[0, 0], [10, 10], [10, 0], [0, 10]]), /crosses itself/);
});

test('STEP export: AP214 header, one solid per hole in hole-only mode', () => {
  const m = VF.generate(params((p) => p));
  const plate = VF.toSTEP(m, { mode: 'plate', thickness: 2 }), holes = VF.toSTEP(m, { mode: 'holes', thickness: 2 });
  assert.match(plate.text, /FILE_SCHEMA\(\('AUTOMOTIVE_DESIGN/);
  assert.equal(plate.solids, 1);
  assert.equal(holes.solids, m.holes.length);
  assert.equal((holes.text.match(/MANIFOLD_SOLID_BREP/g) || []).length, m.holes.length);
});

test('DXF and SVG exports are well formed', () => {
  const m = VF.generate(params((p) => p));
  const dxf = VF.toDXF(m), svg = VF.toSVG(m);
  assert.ok(dxf.startsWith('0\r\nSECTION') && dxf.trimEnd().endsWith('EOF'));
  assert.equal((dxf.match(/\r\nCIRCLE\r\n/g) || []).length, m.holes.length);
  assert.match(svg, /<svg[^>]+width="[\d.]+mm"/);
});

test('pattern size is capped to keep the editor responsive', () => {
  const m = VF.generate(params((p) => { p.layout.pitch = 0.3; p.hole.d = 0.2; p.dfm.minFeat = 0.1; p.dfm.web = 0; }));
  assert.ok(m.stats.capped);
  assert.ok(m.holes.length <= VF.LIMIT);
});
