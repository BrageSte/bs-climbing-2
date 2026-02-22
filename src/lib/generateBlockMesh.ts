/**
 * generateBlockMesh — Parametric crimp block geometry generator.
 *
 * Builds a THREE.BufferGeometry from configurator parameters using
 * 10 merged BoxGeometry pieces.  No CSG required.
 *
 * Coordinate system (matches STL / BlockViewer):
 *   X = width (right+), Y = depth (front+), Z = height (up+)
 *
 * Finger order left→right: lille, ring, lang, peke  (index 0-3)
 *
 * Edge geometry is stored as `geometry.userData.edgeGeometry`.
 */
import * as THREE from "three";
import {
  mergeGeometries,
  mergeVertices,
  toCreasedNormals,
} from "three/examples/jsm/utils/BufferGeometryUtils.js";

// ---------------------------------------------------------------------------
// Physical constants (mm) — derived from Fusion 360 model
// ---------------------------------------------------------------------------
const WALL_THICK = 9;         // side walls
const INTER_WALL = 4;         // walls between fingers
const BACK_THICK = 4;         // back wall thickness (Y = 0..BACK_THICK)
const DEFAULT_DEPTH = 24;     // total Y depth
const SHORT_EDGE_OFFSET = 9.5;
const TOP_HEIGHT_LONG = 40;   // fixed top height for longedge

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface BlockParams {
  edgeMode: 0 | 1;                          // 0 = shortedge, 1 = longedge
  widths: [number, number, number, number];  // [lille, ring, lang, peke] mm
  heights: [number, number, number, number]; // [lille, ring, lang, peke] mm
  depth?: number;                            // default 24
}

/**
 * Generate a complete crimp block BufferGeometry from parameters.
 * The returned geometry is centered and has creased normals.
 * Edge geometry for wireframe overlay is stored in `geometry.userData.edgeGeometry`.
 */
export function generateBlockMesh(params: BlockParams): THREE.BufferGeometry {
  const { edgeMode, widths, heights, depth: depthParam } = params;
  const depth = depthParam ?? DEFAULT_DEPTH;

  // --- Derived dimensions ---
  const maxH = Math.max(...heights);
  const topHeight =
    edgeMode === 0
      ? maxH + SHORT_EDGE_OFFSET - heights[0]   // shortedge formula
      : TOP_HEIGHT_LONG;                          // longedge: fixed 40mm

  const totalWidth =
    widths[0] + widths[1] + widths[2] + widths[3] +
    2 * WALL_THICK + 3 * INTER_WALL;             // fingerWidths + 30

  // --- Finger X positions ---
  const fingerX: number[] = [];
  let cx = WALL_THICK;
  for (let i = 0; i < 4; i++) {
    fingerX[i] = cx;
    cx += widths[i];
    if (i < 3) cx += INTER_WALL;
  }

  // --- Helper: create positioned box ---
  const boxes: THREE.BoxGeometry[] = [];

  function addBox(
    w: number, d: number, h: number,
    centerX: number, centerY: number, centerZ: number,
  ) {
    const box = new THREE.BoxGeometry(w, d, h);
    box.translate(centerX, centerY, centerZ);
    boxes.push(box);
  }

  // --- 1. Left side wall ---
  addBox(
    WALL_THICK, depth, topHeight,
    WALL_THICK / 2, depth / 2, topHeight / 2,
  );

  // --- 2. Right side wall ---
  addBox(
    WALL_THICK, depth, topHeight,
    totalWidth - WALL_THICK / 2, depth / 2, topHeight / 2,
  );

  // --- 3-5. Inter-finger walls ---
  for (let i = 0; i < 3; i++) {
    const wallX = fingerX[i] + widths[i] + INTER_WALL / 2;
    addBox(
      INTER_WALL, depth, topHeight,
      wallX, depth / 2, topHeight / 2,
    );
  }

  // --- 6. Back wall (full width, Y = 0..BACK_THICK) ---
  addBox(
    totalWidth, BACK_THICK, topHeight,
    totalWidth / 2, BACK_THICK / 2, topHeight / 2,
  );

  // --- 7-10. Finger step blocks (front open: Y = BACK_THICK..depth) ---
  const slotDepth = depth - BACK_THICK;
  const slotCenterY = BACK_THICK + slotDepth / 2;

  for (let i = 0; i < 4; i++) {
    addBox(
      widths[i], slotDepth, heights[i],
      fingerX[i] + widths[i] / 2, slotCenterY, heights[i] / 2,
    );
  }

  // --- Merge all boxes ---
  const merged = mergeGeometries(boxes, false);
  boxes.forEach((b) => b.dispose());

  if (!merged) {
    // Fallback: return empty geometry (should never happen)
    return new THREE.BufferGeometry();
  }

  // --- Process: same pipeline as BlockViewer's processSTLGeometry ---
  // 1. Merge duplicate vertices (needed for EdgesGeometry)
  const indexed = mergeVertices(merged, 1e-4);
  merged.dispose();

  // 2. Compute edges from indexed geometry (before toCreasedNormals de-indexes)
  const edgeGeometry = new THREE.EdgesGeometry(indexed, 30);

  // 3. Creased normals: smooth at < 30°, sharp crease at > 30°
  const creased = toCreasedNormals(indexed, Math.PI / 6);
  indexed.dispose();

  // 4. Center and compute bounds
  creased.center();
  edgeGeometry.center();
  creased.computeBoundingBox();
  creased.computeBoundingSphere();

  // Store edge geometry for BlockViewer to pick up
  creased.userData.edgeGeometry = edgeGeometry;

  return creased;
}
