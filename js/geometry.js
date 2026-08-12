// ============================================================
// geometry.js — ports the logic of CustomNameKeychainGenerator_100Fonts.scad
// into browser-native geometry: opentype.js for letterforms,
// ClipperLib for the same offset()/union()/difference() operations
// OpenSCAD itself uses under the hood, and three.js for the 3D mesh.
//
// Requires (loaded as globals via <script> tags in index.html):
//   window.opentype   (opentype.js)
//   window.ClipperLib  (clipper-lib)
// And ES module imports of three.js passed in.
// ============================================================

import { googleFontsCssUrl, EMOJI_FONT_DESCRIPTOR } from "./fonts.js";

const CLIPPER_SCALE = 2000; // mm -> integer clipper units (0.5 micron resolution)
const CURVE_STEPS = 20; // bezier flattening resolution (higher = smoother letterforms)

// ---------------- Font loading ----------------

const fontCache = new Map(); // key: descriptor|charset -> opentype.Font
let woff2Decompress = null;

async function getWoff2Decompressor() {
  if (!woff2Decompress) {
    try {
      const mod = await import(
        "https://cdn.jsdelivr.net/npm/woff2-encoder@1.0.2/+esm"
      );
      woff2Decompress = mod.decompress;
    } catch (err) {
      throw new Error("couldn't load the font decompression library — check your internet connection");
    }
  }
  return woff2Decompress;
}

export async function loadFont(descriptor, text) {
  const charset = Array.from(new Set(Array.from(text || "TEXT"))).sort().join("");
  const key = descriptor + "|" + charset;
  if (fontCache.has(key)) return fontCache.get(key);

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error(`you're offline — can't load the "${descriptor}" font`);
  }

  const cssUrl = googleFontsCssUrl(descriptor, text);
  let cssRes;
  try {
    cssRes = await fetch(cssUrl);
  } catch (err) {
    throw new Error(`couldn't reach Google Fonts for "${descriptor}" — check your internet connection`);
  }
  if (!cssRes.ok) throw new Error(`Google Fonts couldn't find "${descriptor}" (it may have been renamed or removed)`);
  const css = await cssRes.text();
  const match = css.match(/url\(([^)]+)\)\s*format\('woff2'\)/);
  if (!match) throw new Error(`no font file found for "${descriptor}"`);
  const fontUrl = match[1].replace(/['"]/g, "");

  let fontRes;
  try {
    fontRes = await fetch(fontUrl);
  } catch (err) {
    throw new Error(`couldn't download the "${descriptor}" font file — check your internet connection`);
  }
  if (!fontRes.ok) throw new Error(`couldn't download the "${descriptor}" font file (server returned an error)`);
  const woff2Buf = new Uint8Array(await fontRes.arrayBuffer());

  const decompress = await getWoff2Decompressor();
  const ttfBuf = await decompress(woff2Buf);

  let font;
  try {
    font = window.opentype.parse(ttfBuf.buffer.slice(
      ttfBuf.byteOffset,
      ttfBuf.byteOffset + ttfBuf.byteLength
    ));
  } catch (err) {
    throw new Error(`the "${descriptor}" font file appears to be corrupted or unsupported`);
  }
  fontCache.set(key, font);
  return font;
}

// ---------------- Bezier flattening: opentype Path -> polygon contours ----------------

function flattenOpentypePath(path) {
  const contours = [];
  let current = [];
  let cur = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };

  const pushPoint = (p) => current.push([p.x, p.y]);

  for (const cmd of path.commands) {
    if (cmd.type === "M") {
      if (current.length > 1) contours.push(current);
      current = [];
      cur = { x: cmd.x, y: cmd.y };
      start = { ...cur };
      pushPoint(cur);
    } else if (cmd.type === "L") {
      cur = { x: cmd.x, y: cmd.y };
      pushPoint(cur);
    } else if (cmd.type === "Q") {
      const p0 = cur, p1 = { x: cmd.x1, y: cmd.y1 }, p2 = { x: cmd.x, y: cmd.y };
      for (let i = 1; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS;
        const mt = 1 - t;
        const x = mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x;
        const y = mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y;
        pushPoint({ x, y });
      }
      cur = p2;
    } else if (cmd.type === "C") {
      const p0 = cur, p1 = { x: cmd.x1, y: cmd.y1 }, p2 = { x: cmd.x2, y: cmd.y2 }, p3 = { x: cmd.x, y: cmd.y };
      for (let i = 1; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS;
        const mt = 1 - t;
        const x = mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x;
        const y = mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y;
        pushPoint({ x, y });
      }
      cur = p3;
    } else if (cmd.type === "Z") {
      pushPoint(start);
      if (current.length > 1) contours.push(current);
      current = [];
    }
  }
  if (current.length > 1) contours.push(current);
  return contours;
}

// ---------------- Clipper helpers ----------------

function toClipperPath(points) {
  return points.map(([x, y]) => ({ X: Math.round(x * CLIPPER_SCALE), Y: Math.round(y * CLIPPER_SCALE) }));
}
function fromClipperPath(path) {
  return path.map((p) => [p.X / CLIPPER_SCALE, p.Y / CLIPPER_SCALE]);
}

function clipperUnion(pathsArr) {
  const C = window.ClipperLib;
  const cpr = new C.Clipper();
  cpr.AddPaths(pathsArr, C.PolyType.ptSubject, true);
  const solution = new C.Paths();
  cpr.Execute(C.ClipType.ctUnion, solution, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return solution;
}

function clipperDifference(subjectPaths, clipPaths) {
  const C = window.ClipperLib;
  const cpr = new C.Clipper();
  cpr.AddPaths(subjectPaths, C.PolyType.ptSubject, true);
  cpr.AddPaths(clipPaths, C.PolyType.ptClip, true);
  const solution = new C.Paths();
  cpr.Execute(C.ClipType.ctDifference, solution, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return solution;
}

function clipperOffset(pathsArr, deltaMm) {
  const C = window.ClipperLib;
  // fine arc tolerance (0.02mm) = smooth rounded corners instead of chunky facets
  const co = new C.ClipperOffset(2, 0.02 * CLIPPER_SCALE);
  co.AddPaths(pathsArr, C.JoinType.jtRound, C.EndType.etClosedPolygon);
  const solution = new C.Paths();
  co.Execute(solution, deltaMm * CLIPPER_SCALE);
  return solution;
}

function circlePolygon(cx, cy, r, segments = 96) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

// ---------------- Text layout (mirrors text_shape_2d / multiline setup) ----------------
// Builds one "paint unit" per character (skipping whitespace, which has
// no glyph) instead of a single fused block, so each letter can later be
// extruded with its own color in Paint Mode. Each line can have its own
// font + size — lines are stacked top-to-bottom, each within a vertical
// slot sized to its own textSize, then the whole stack is centered on
// y=0 (this generalizes the old uniform-lineHeight formula exactly:
// when every line shares one size, it reduces to the same math). Each
// line is also independently centered horizontally (not left-aligned),
// and a filled "bridge" strip is added between any two lines that don't
// already touch, so multi-line text always reads as one connected piece
// regardless of line spacing.

function translateClipperPaths(paths, dx, dy) {
  return paths.map((p) => fromClipperPath(p).map(([x, y]) => [x + dx, y + dy])).map(toClipperPath);
}

async function buildTextUnits(params) {
  const { lineConfigs, lineSpacingPct, boldMm } = params;
  // lineConfigs: [{ text, descriptor, size }, ...] — already caller-filtered
  // to non-empty lines, with a guaranteed single-line "TEXT" fallback if
  // every line was empty.
  const numLines = lineConfigs.length;

  const fonts = await Promise.all(
    lineConfigs.map((lc) => loadFont(lc.descriptor, lc.text))
  );

  const heights = lineConfigs.map((lc) => lc.size * (lineSpacingPct / 100));
  const totalHeight = heights.reduce((a, b) => a + b, 0);
  let cursorY = totalHeight / 2;
  const lineCenters = [];
  for (let i = 0; i < numLines; i++) {
    cursorY -= heights[i] / 2;
    lineCenters.push(cursorY);
    cursorY -= heights[i] / 2;
  }

  const units = [];
  for (let i = 0; i < numLines; i++) {
    const font = fonts[i];
    const { text, size } = lineConfigs[i];
    const unitsPerEm = font.unitsPerEm;
    const centerOffset = ((font.ascender + font.descender) / 2 / unitsPerEm) * size;
    const baselineY = lineCenters[i] - centerOffset;

    let xCursor = 0;
    const chars = Array.from(text);
    const lineUnits = [];
    for (let ci = 0; ci < chars.length; ci++) {
      const ch = chars[ci];
      const path = font.getPath(ch, xCursor, -baselineY, size);
      const contours = flattenOpentypePath(path).map((c) => c.map(([x, y]) => [x, -y]));
      if (contours.length) {
        let clipperPaths = contours.map(toClipperPath);
        if (boldMm > 0) clipperPaths = clipperOffset(clipperPaths, boldMm);
        lineUnits.push({ key: `${i}-${ci}`, char: ch, contours: clipperPaths });
      }
      xCursor += font.getAdvanceWidth(ch, size);
    }

    // center this line horizontally on its own — every line shares the
    // same center X, not the same left edge
    if (lineUnits.length) {
      const lineContours = lineUnits.flatMap((u) => u.contours);
      const lineBBox = bboxFromClipperContours(lineContours, null);
      if (lineBBox) {
        const centerX = (lineBBox.minX + lineBBox.maxX) / 2;
        for (const u of lineUnits) u.contours = translateClipperPaths(u.contours, -centerX, 0);
      }
    }
    units.push(...lineUnits);
  }

  // bridge the gap between consecutive lines, if any, so multi-line
  // text always reads/prints as one connected shape
  const overlap = 0.3; // mm the bridge pushes into each line, past its edge
  for (let i = 0; i < numLines - 1; i++) {
    const upperContours = units.filter((u) => u.key.startsWith(`${i}-`)).flatMap((u) => u.contours);
    const lowerContours = units.filter((u) => u.key.startsWith(`${i + 1}-`)).flatMap((u) => u.contours);
    const upperBBox = bboxFromClipperContours(upperContours, { minX: 0, maxX: 0, minY: lineCenters[i], maxY: lineCenters[i] });
    const lowerBBox = bboxFromClipperContours(lowerContours, { minX: 0, maxX: 0, minY: lineCenters[i + 1], maxY: lineCenters[i + 1] });

    const gapTop = upperBBox.minY; // bottom edge of the line above
    const gapBottom = lowerBBox.maxY; // top edge of the line below
    if (gapTop <= gapBottom) continue; // already touching/overlapping — nothing to bridge

    const upperWidth = upperBBox.maxX - upperBBox.minX;
    const lowerWidth = lowerBBox.maxX - lowerBBox.minX;
    const halfW = Math.max(Math.min(upperWidth, lowerWidth) / 2, 0.5);
    const y0 = gapBottom - overlap;
    const y1 = gapTop + overlap;
    const bridgeMm = [[-halfW, y0], [halfW, y0], [halfW, y1], [-halfW, y1]];
    units.push({ key: `bridge-${i}`, char: null, contours: [toClipperPath(bridgeMm)] });
  }

  return units;
}

// ---------------- Icon (single glyph, placed beside the text) ----------------

// Emoji variation selectors (U+FE0E / U+FE0F) have no visible glyph in most
// fonts; asking a font to render them produces a "tofu" box. We only want
// the icon's shape, so they're stripped before font lookup or rendering.
function stripVariationSelectors(str) {
  return str.replace(/[\uFE0E\uFE0F]/g, "");
}

// Returns clipper paths for one icon glyph, scaled to targetHeightMm tall
// and centered on (0,0) — the caller positions it from there.
async function buildIconContours(iconChar, targetHeightMm) {
  const clean = stripVariationSelectors(iconChar);
  if (!clean) return { paths: [], width: 0 };

  const font = await loadFont(EMOJI_FONT_DESCRIPTOR, clean);
  const probeSize = 200;
  const path = font.getPath(clean, 0, 0, probeSize);
  const contours = flattenOpentypePath(path).map((c) => c.map(([x, y]) => [x, -y]));
  const pts = contours.flat();
  if (!pts.length) return { paths: [], width: 0 };

  const minX = Math.min(...pts.map((p) => p[0]));
  const maxX = Math.max(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1]));
  const maxY = Math.max(...pts.map((p) => p[1]));
  const glyphH = Math.max(maxY - minY, 0.001);
  const scale = targetHeightMm / glyphH;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const scaled = contours.map((c) => c.map(([x, y]) => [(x - cx) * scale, (y - cy) * scale]));
  const paths = clipperUnion(scaled.map(toClipperPath));
  return { paths, width: (maxX - minX) * scale };
}

// ---------------- Nesting: group clipper paths into outer/hole shapes ----------------

function signedArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const intersect =
      yi > pt[1] !== yj > pt[1] &&
      pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Convert a flat list of clipper paths (mm-space contours, any winding)
// into an array of THREE.Shape objects (outer boundary + nested holes).
export function pathsToShapes(THREE, clipperPaths) {
  const contours = clipperPaths
    .map(fromClipperPath)
    .filter((c) => c.length >= 3)
    .map((c) => ({ points: c, area: signedArea(c) }))
    .sort((a, b) => Math.abs(b.area) - Math.abs(a.area));

  const nodes = contours.map((c) => ({ ...c, depth: 0, parent: null }));
  for (let i = 0; i < nodes.length; i++) {
    let depth = 0;
    let parent = null;
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      if (Math.abs(nodes[j].area) <= Math.abs(nodes[i].area)) continue;
      if (pointInPolygon(nodes[i].points[0], nodes[j].points)) {
        depth++;
        if (!parent || Math.abs(nodes[j].area) < Math.abs(parent.area)) parent = nodes[j];
      }
    }
    nodes[i].depth = depth;
    nodes[i].parent = parent;
  }

  const shapes = [];
  for (const n of nodes) {
    if (n.depth % 2 === 0) {
      const shape = new THREE.Shape(n.points.map(([x, y]) => new THREE.Vector2(x, y)));
      shape.userData = { node: n };
      shapes.push(shape);
    }
  }
  for (const n of nodes) {
    if (n.depth % 2 === 1 && n.parent) {
      const holder = shapes.find((s) => s.userData.node === n.parent);
      if (holder) {
        holder.holes.push(new THREE.Path(n.points.map(([x, y]) => new THREE.Vector2(x, y))));
      }
    }
  }
  return shapes;
}

function bboxFromClipperContours(clipperContours, fallback) {
  const pts = clipperContours.flatMap(fromClipperPath);
  if (!pts.length) return fallback;
  return pts.reduce(
    (b, [x, y]) => ({
      minX: Math.min(b.minX, x),
      maxX: Math.max(b.maxX, x),
      minY: Math.min(b.minY, y),
      maxY: Math.max(b.maxY, y),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  );
}

// ---------------- Full model build ----------------
// Returns { group: THREE.Group, plateColor, textColor } ready to add to a scene,
// and also exposes the raw meshes for STL export.

export async function buildKeychainModel(THREE, p) {
  const outlineMargin = p.outlineMarginX10 / 10;
  const iconOutlineMargin = (p.iconOutlineMarginX10 != null ? p.iconOutlineMarginX10 : p.outlineMarginX10) / 10;
  const holeDia = p.holeDiameterX10 / 10;
  const ringThickness = p.ringThicknessX10 / 10;
  const bold = p.boldX10 / 10;
  const textDepth = p.textDepthX10 / 10;
  const plateThick = p.plateThick;

  const holeR = holeDia / 2;
  const connectorR = holeR + ringThickness;

  const DEFAULT_BBOX = { minX: -5, maxX: 5, minY: -5, maxY: 5 };
  let allUnits; // [{ key, char, contours }] — one per paintable letter/icon
  let bridgeContours = []; // fills gaps in the flat plate only — never rendered as its own raised/engraved shape
  let textOnlyContours = []; // text-only (no icon) — used to give text and icon separate plate margins
  let iconClipperContours = null; // icon-only, positioned — null if no icon attached

  if (p.keychainType === "icon") {
    // Icon Keychain: the whole design is one big icon, no text at all.
    const { paths: soloPaths } = await buildIconContours(p.soloIconChar, p.iconOnlySize);
    allUnits = soloPaths.length ? [{ key: "icon", char: p.soloIconChar, contours: soloPaths }] : [];
  } else {
    // Text Keychain: one or more lines of text, each with its own font
    // and size, plus an optional icon snugged against its left or right
    // edge. Each character becomes its own paint unit so Paint Mode can
    // color them individually.
    const rawLines = [
      { text: p.line1, descriptor: p.lineDescriptors[0], size: p.lineSizes[0] },
      { text: p.line2, descriptor: p.lineDescriptors[1], size: p.lineSizes[1] },
    ];
    const nonEmpty = rawLines.filter((l) => l.text.length > 0);
    const lineConfigs = nonEmpty.length > 0 ? nonEmpty : [{ text: "TEXT", descriptor: p.lineDescriptors[0], size: p.lineSizes[0] }];
    const avgSize = lineConfigs.reduce((s, l) => s + l.size, 0) / lineConfigs.length;

    const rawTextUnits = await buildTextUnits({
      lineConfigs,
      lineSpacingPct: p.lineSpacingPct,
      boldMm: bold,
    });
    // bridges only need to keep the flat plate connected — pulling them
    // out here means they never get extruded as their own raised block
    // or engraved pocket, just folded into the plate outline later
    const textUnits = rawTextUnits.filter((u) => !u.key.startsWith("bridge-"));
    bridgeContours = rawTextUnits.filter((u) => u.key.startsWith("bridge-")).flatMap((u) => u.contours);

    textOnlyContours = textUnits.flatMap((u) => u.contours);
    const textBBox = bboxFromClipperContours(textOnlyContours, DEFAULT_BBOX);

    allUnits = textUnits;
    if (p.iconChar) {
      const iconHeight = Math.max(textBBox.maxY - textBBox.minY, avgSize);
      const { paths: iconPaths, width: iconWidth } = await buildIconContours(p.iconChar, iconHeight);
      if (iconPaths.length) {
        const gap = avgSize * 0.12; // tight gap so icon and text read as one connected shape
        const iconCenterY = (textBBox.minY + textBBox.maxY) / 2;
        const iconCenterX =
          (p.iconPosition === "left"
            ? textBBox.minX - gap - iconWidth / 2
            : textBBox.maxX + gap + iconWidth / 2) + (p.iconOffsetX || 0);
        const iconMm = iconPaths.map(fromClipperPath).map((poly) =>
          poly.map(([x, y]) => [x + iconCenterX, y + iconCenterY])
        );
        iconClipperContours = iconMm.map(toClipperPath);
        allUnits = [...textUnits, { key: "icon", char: p.iconChar, contours: iconClipperContours }];
      }
    }
  }

  const textClipperContours = allUnits.flatMap((u) => u.contours);

  // bbox of the final shape (text, text+icon, or solo icon) — drives
  // keyring placement
  const bbox = bboxFromClipperContours(textClipperContours, DEFAULT_BBOX);

  // The keyring hole itself must never eat into the shape — only the
  // surrounding ring material is allowed to overlap (that's what fuses
  // it to the plate). holeSafetyMargin keeps the hole's edge just
  // outside the shape regardless of ring thickness; whatever ring
  // thickness remains beyond that automatically becomes the fusion
  // overlap, so a thin ring still connects but never lets the hole in.
  const holeSafetyMargin = 0.15;
  const edgeGap = holeR + holeSafetyMargin; // center-to-edge distance for a "touching" placement
  const midX = (bbox.minX + bbox.maxX) / 2;
  const midY = (bbox.minY + bbox.maxY) / 2;

  const preset = p.keyringPreset || "auto";
  let connectorX, connectorY;
  switch (preset) {
    case "top":
      connectorX = midX;
      connectorY = bbox.maxY + edgeGap;
      break;
    case "bottom":
      connectorX = midX;
      connectorY = bbox.minY - edgeGap;
      break;
    case "left":
      connectorX = bbox.minX - edgeGap;
      connectorY = midY;
      break;
    case "right":
      connectorX = bbox.maxX + edgeGap;
      connectorY = midY;
      break;
    case "top-left":
      connectorX = bbox.minX + connectorR;
      connectorY = bbox.maxY + edgeGap;
      break;
    case "top-right":
      connectorX = bbox.maxX - connectorR;
      connectorY = bbox.maxY + edgeGap;
      break;
    case "bottom-left":
      connectorX = bbox.minX + connectorR;
      connectorY = bbox.minY - edgeGap;
      break;
    case "bottom-right":
      connectorX = bbox.maxX - connectorR;
      connectorY = bbox.minY - edgeGap;
      break;
    default: // "auto" — the original per-type default: top-center for Icon Keychain, far-left for Text Keychain
      if (p.keychainType === "icon") {
        connectorX = midX;
        connectorY = bbox.maxY + edgeGap;
      } else {
        connectorX = bbox.minX - edgeGap;
        connectorY = midY;
      }
  }
  // manual nudge still layers on top of whichever preset (or auto) is active
  connectorX += p.keyringOffsetX || 0;
  connectorY += p.keyringOffsetY || 0;

  const connectorPath = toClipperPath(circlePolygon(connectorX, connectorY, connectorR));
  const holePath = toClipperPath(circlePolygon(connectorX, connectorY, holeR));

  let plateOutline;
  if (iconClipperContours) {
    // Icon and text can each have their own plate margin, and with
    // position presets the keyring can now end up anywhere around the
    // shape — not just the far left — so which side it's actually
    // adjacent to has to be measured, not assumed, or it'd offset the
    // wrong group and leave a disconnected blob near the real
    // connection point.
    const textBBoxOnly = bboxFromClipperContours(textOnlyContours, DEFAULT_BBOX);
    const iconBBoxOnly = bboxFromClipperContours(iconClipperContours, DEFAULT_BBOX);
    const distToBBox = (px, py, b) => {
      const dx = Math.max(b.minX - px, 0, px - b.maxX);
      const dy = Math.max(b.minY - py, 0, py - b.maxY);
      return Math.sqrt(dx * dx + dy * dy);
    };
    const iconIsAdjacent = distToBBox(connectorX, connectorY, iconBBoxOnly) <= distToBBox(connectorX, connectorY, textBBoxOnly);
    const textGroupPaths = iconIsAdjacent
      ? [...textOnlyContours, ...bridgeContours]
      : [...textOnlyContours, ...bridgeContours, connectorPath];
    const iconGroupPaths = iconIsAdjacent ? [...iconClipperContours, connectorPath] : [...iconClipperContours];

    const textPlate = clipperOffset(clipperUnion(textGroupPaths), outlineMargin);
    const iconPlate = clipperOffset(clipperUnion(iconGroupPaths), iconOutlineMargin);
    plateOutline = clipperUnion([...textPlate, ...iconPlate]);
  } else {
    const unionedWithConnector = clipperUnion([...textClipperContours, ...bridgeContours, connectorPath]);
    plateOutline = clipperOffset(unionedWithConnector, outlineMargin);
  }

  const plateWithHole = clipperDifference(plateOutline, [holePath]);

  const plateShapes = pathsToShapes(THREE, plateWithHole);

  const group = new THREE.Group();
  const meshes = [];

  const plateMat = new THREE.MeshStandardMaterial({ color: p.plateColorHex, roughness: 0.55, metalness: 0.05 });

  // one material per distinct color actually in use, shared across
  // letters — avoids creating dozens of near-identical materials
  const letterColors = p.letterColors || {};
  const matCache = new Map();
  function materialFor(hex) {
    if (!matCache.has(hex)) {
      matCache.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.45, metalness: 0.05 }));
    }
    return matCache.get(hex);
  }

  if (p.style === "raised") {
    for (const shape of plateShapes) {
      const geo = new THREE.ExtrudeGeometry(shape, { depth: plateThick, bevelEnabled: false, curveSegments: 24 });
      const mesh = new THREE.Mesh(geo, plateMat);
      group.add(mesh);
      meshes.push(mesh);
    }
    for (const unit of allUnits) {
      const shapes = pathsToShapes(THREE, unit.contours);
      const mat = materialFor(letterColors[unit.key] || p.textColorHex);
      for (const shape of shapes) {
        const geo = new THREE.ExtrudeGeometry(shape, { depth: textDepth, bevelEnabled: false, curveSegments: 24 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.z = plateThick;
        group.add(mesh);
        meshes.push(mesh);
      }
    }
  } else {
    // engraved: bottom solid layer + top layer with text pockets cut out.
    // Pockets are cut from the single plate color — Paint Mode only
    // applies to raised style, since an engraved recess has no separate
    // colored material of its own to paint.
    const bottomH = Math.max(plateThick - textDepth, 0.05);
    for (const shape of plateShapes) {
      const geo = new THREE.ExtrudeGeometry(shape, { depth: bottomH, bevelEnabled: false, curveSegments: 24 });
      const mesh = new THREE.Mesh(geo, plateMat);
      group.add(mesh);
      meshes.push(mesh);
    }
    const topWithPockets = clipperDifference(plateWithHole, textClipperContours);
    const topShapes = pathsToShapes(THREE, topWithPockets);
    for (const shape of topShapes) {
      const geo = new THREE.ExtrudeGeometry(shape, { depth: textDepth, bevelEnabled: false, curveSegments: 24 });
      const mesh = new THREE.Mesh(geo, plateMat);
      mesh.position.z = bottomH;
      group.add(mesh);
      meshes.push(mesh);
    }
  }

  // exposed so the UI can render a Paint Mode list matching exactly
  // what was actually built, without a second (async, font-loading)
  // pass over the text
  const paintUnits = allUnits
    .filter((u) => !u.key.startsWith("bridge-")) // bridges are structural, not letters — don't clutter the Paint Mode list
    .map((u) => ({ key: u.key, char: u.char }));

  return { group, meshes, paintUnits };
}
