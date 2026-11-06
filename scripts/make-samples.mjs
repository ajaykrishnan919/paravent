// Generates a set of demanding sample patterns as STEP / DXF / SVG plus expected volumes,
// used by test/validate_step.py to check every solid in OpenCascade.  Usage: node scripts/make-samples.mjs out
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const VF = require('../src/core.js');
const out = process.argv[2] || 'out';
fs.mkdirSync(out, { recursive: true });
const F = (o = {}) => Object.assign({ type: 'uniform', angle: 0, cx: 0, cy: 0, radius: 60, gamma: 1, invert: false, base: 0, controls: [], noiseScale: 25, seed: 1, noise: { amt: 0, kind: 'smooth', scale: 15, seed: 1 } }, o);
const base = () => ({
  plate: { shape: 'rect', w: 120, h: 80, r: 6, d: 100, sides: 6, rot: 0, t: 2 },
  layout: { type: 'hex', pitch: 6, pitchY: 6, rot: 0, ox: 0, oy: 0, ringStep: 6, center: true, stagger: true, seed: 3 },
  hole: { shape: 'circle', sides: 6, starK: 0.5, slotW: 0.4, aspect: 1, d: 4, sx: 1, sy: 1, rot: 0, rotMode: 'fixed', jitter: 1, seed: 7, spin: 0, spinBy: 'row' },
  grad: {
    size: { on: true, min: 1.5, max: 4.8, field: F({ type: 'radial', radius: 60, invert: true }) },
    spacing: { on: false, min: 0.8, max: 1.4, field: F({ type: 'linear' }) },
    angle: { on: false, min: 0, max: 90, field: F({ type: 'linear' }) },
    shape: { on: false, min: 0, max: 1, steps: 0, res: 48, target: { shape: 'star', sides: 5, starK: 0.5 }, field: F({ type: 'linear' }) },
  },
  dfm: { edge: 3, web: 0.6, minFeat: 0.8, clip: false },
  mounts: { enabled: true, mode: 'auto', d: 3.4, inset: 6, clear: 2, count: 4, list: [] },
  keepouts: [{ x: -30, y: 0, r: 8 }],
});
const custom = VF.normaliseShape([[0, 1], [0.35, 0.2], [1, 0.1], [0.4, -0.3], [0.6, -1], [0, -0.55], [-0.6, -1], [-0.4, -0.3], [-1, 0.1], [-0.35, 0.2]]);
const plateSVG = `<svg><path d="M0 0 H160 V90 H120 A20 20 0 0 1 80 90 H0 Z"/><rect x="20" y="20" width="30" height="15"/><circle cx="130" cy="40" r="10"/></svg>`;
const cases = {
  jitter_dropout_fillet_morph: (p) => { p.layout.jitter = 0.35; p.layout.dropout = 0.15; p.layout.jseed = 9; p.layout.pitch = 8; p.hole.shape = 'polygon'; p.hole.sides = 6; p.hole.fillet = 0.6; p.hole.d = 5; p.grad.size.on = false;
    p.grad.shape.on = true; p.grad.shape.target = { shape: 'star', sides: 5, starK: 0.5, fillet: 0.4 }; p.dfm.web = 0.5; return p; },
  smooth_jitter_square_fillet: (p) => { p.layout.jitter = 0.5; p.layout.jkind = 'smooth'; p.layout.jscale = 25; p.layout.type = 'grid'; p.layout.pitch = 9; p.layout.pitchY = 9; p.hole.shape = 'rect'; p.hole.aspect = 1; p.hole.fillet = 1; p.hole.d = 6; p.grad.size.on = false; return p; },
  g2_fillet_square_to_star_area: (p) => { p.hole.shape = 'polygon'; p.hole.sides = 4; p.hole.fillet = 0.5; p.grad.size.on = false; p.hole.d = 5.5; p.layout.pitch = 8; p.grad.shape.on = true; p.grad.shape.keep = 'area'; p.grad.shape.target = { shape: 'star', sides: 5, starK: 0.45 }; return p; },
  random_morph_steps_fillet_regions: (p) => { p.hole.shape = 'polygon'; p.hole.sides = 6; p.hole.fillet = 0.4; p.hole.d = 5; p.layout.pitch = 7.5; p.grad.size.on = false; p.grad.shape.on = true; p.grad.shape.steps = 3;
    p.grad.shape.field = F({ type: 'random', seed: 5 }); p.keepouts = []; p.regions = [{ kind: 'spline', pts: [[-50, -25], [0, -38], [50, -25], [40, 30], [-40, 30]], closed: true, mode: 'keep', gap: 0.6 }, { kind: 'circle', x: 0, y: 0, r: 12, mode: 'cut', gap: 0.6 }]; return p; },
  edits_delete_and_rect_cut: (p) => { p.grad.size.on = false; p.hole.d = 4; p.regions = [{ kind: 'rect', x: 30, y: 10, w: 25, h: 20, rot: 25, mode: 'cut', gap: 0.5 }]; p.edits = { del: [[0, 0], [6, 0], [-6, 0]], only: [] }; return p; },
  morph_circle_to_star: (p) => { p.grad.shape.on = true; p.grad.shape.field = F({ type: 'linear' }); return p; },
  morph_stepped_hex_to_circle_noise: (p) => { p.hole.shape = 'polygon'; p.grad.shape.on = true; p.grad.shape.steps = 5; p.grad.shape.target = { shape: 'circle' };
    p.grad.shape.field = F({ type: 'radial', radius: 55, noise: { amt: 0.25, kind: 'smooth', scale: 12, seed: 4 } }); p.grad.size.field.noise = { amt: 0.2, kind: 'random', seed: 9 }; return p; },
  custom_shape_angle_grad: (p) => { p.hole.shape = 'custom'; p.hole.custom = custom; p.grad.angle.on = true; p.grad.angle.max = 180; p.grad.size.max = 5.4; return p; },
  stretched_slot_spin: (p) => { p.hole.shape = 'slot'; p.hole.sx = 1; p.hole.sy = 1.6; p.hole.spin = 90; p.hole.spinBy = 'checker'; p.layout.type = 'grid'; p.layout.pitchY = 8; p.layout.pitch = 9; p.grad.size.on = false; p.hole.d = 6; return p; },
  spacing_gradient_controls: (p) => { p.grad.spacing.on = true; p.grad.spacing.field = F({ type: 'controls', base: 0, controls: [{ k: 'point', x: 20, y: 0, r: 50, s: 1, fall: 'smooth' }, { k: 'line', x: -50, y: -30, x2: 50, y2: 30, r: 15, s: 0.6, fall: 'linear' }] }); return p; },
  custom_plate_cutouts_spiral: (p) => { p.plate = Object.assign(p.plate, { shape: 'custom', w: 160, custom: VF.importPlate(plateSVG) }); p.layout.type = 'spiral'; p.layout.ringStep = 6; p.mounts.mode = 'manual'; p.mounts.list = [{ x: -70, y: -35 }, { x: 70, y: -35 }]; p.keepouts = []; return p; },
  rect_morph_to_polygon_stretch_ellipse: (p) => { p.hole.shape = 'rect'; p.hole.aspect = 0.5; p.hole.sx = 1.3; p.grad.shape.on = true; p.grad.shape.target = { shape: 'polygon', sides: 8 }; p.layout.type = 'fibonacci'; p.plate.shape = 'circle'; p.plate.d = 110; return p; },
  overlap_stress: (p) => { p.dfm.edge = 0; p.dfm.web = 0; p.grad.size.on = false; p.hole.d = 7.5; p.hole.shape = 'star'; p.layout.type = 'poisson'; p.layout.pitch = 5; return p; },
};
const summary = {};
for (const [name, f] of Object.entries(cases)) {
  const m = VF.generate(f(base()));
  const ex = VF.exportHoles(m);
  const holeA = ex.holes.reduce((a, h) => a + Math.abs(VF.loopArea(h.loop)), 0), fixA = m.fixed.reduce((a, q) => a + Math.abs(VF.loopArea(q.loop)), 0);
  const plateA = Math.abs(VF.loopArea(m.outer));
  for (const mode of ['plate', 'holes', 'cutters']) {
    const r = VF.toSTEP(m, { mode, thickness: 2, name });
    fs.writeFileSync(`${out}/${name}__${mode}.step`, r.text);
    summary[`${name}__${mode}.step`] = { solids: r.solids, expVol: mode === 'plate' ? 2 * (plateA - holeA - fixA) : mode === 'holes' ? 2 * holeA : 3 * holeA };
  }
  fs.writeFileSync(`${out}/${name}.svg`, VF.toSVG(m));
  fs.writeFileSync(`${out}/${name}.dxf`, VF.toDXF(m));
  console.log(name.padEnd(40), 'holes', m.stats.count, 'exported', ex.holes.length, 'removed', ex.removed, 'overlaps', m.stats.overlaps, 'minWeb', m.stats.minWeb?.toFixed(3), 'open%', m.stats.openPct.toFixed(1), m.stats.ms + 'ms');
}
fs.writeFileSync(`${out}/expected.json`, JSON.stringify(summary, null, 1));
