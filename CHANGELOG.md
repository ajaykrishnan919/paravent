# Changelog

## 1.0.0 (2026-11-07)

First public release.

- Plates: rounded rectangle, circle, regular polygon, custom SVG outline with inner cutouts.
- Layouts: hex, diamond/staggered, square grid, concentric rings, Fibonacci, Archimedean spiral, blue noise, random scatter; rotation, offset, cross-row spin; position jitter (random or smooth) and random removal.
- Hole shapes: circle, polygon, star, rectangle, slot, custom (editor with mirroring, SVG import); independent stretch.
- Gradient channels for size, spacing, angle and shape morph, each with constant, linear, radial, point and line controllers, noise, random-per-hole and image sources, plus gamma, invert and added noise.
- Shape morphing with corner-preserving correspondence, continuous or stepped, and size modes: keep open area, keep outer diameter, scale.
- Curvature-continuous (G2) corner fillets per shape, blended through morphs.
- Regions (circle, rectangle, polygon, closed spline) that delete holes inside or keep only holes inside; click and Shift-click hole selection with Delete and Keep only.
- Manufacturability checks: edge margin, minimum web, minimum hole size, overlaps, hole size vs. thickness.
- Export: STEP AP214 (plate solid, hole pattern only, cutter bodies), DXF R12, SVG; presets as JSON; undo/redo; measuring tool.
