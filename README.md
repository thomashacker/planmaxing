# planmaxing

Small 2D planning tool in the browser, to the millimetre. Sketch a part of a room
(walls as lines), drop in objects (countertop, legs, fridge, cabinet, …) and push them
around until everything fits.

```bash
npm install
npm run dev
```

## What it does

- Infinite canvas: scroll to pan, ⌘/Ctrl + scroll or pinch to zoom, `0` fits everything
- Lines (`L`): click, click, click … `Esc`. Type a number + `Enter` while drawing for an exact length in cm
- Tape measure (`M`): drag, or click twice, between any two points (snaps to corners and endpoints)
- Rectangles (`R`) or the presets on the left; edit name, size, height, position and colour on the right
- Snapping to grid, corners, endpoints and edges of other objects (`⌥` turns it off, `⇧` locks 45°)
- Free space to the nearest neighbour in every direction is shown for the selection
- Overlapping objects are hatched red
- Number fields understand `85,5` and simple maths like `200-60`
- Undo/redo, duplicate, copy/paste, align, lock, z-order
- Saved automatically in `localStorage`; export/import as JSON

All lengths are stored in mm and shown in cm.
