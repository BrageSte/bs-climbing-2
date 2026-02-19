import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import AppErrorBoundary from "@/components/AppErrorBoundary";
import type { BlockVariant } from "./StlViewer";

interface ParametricBlockPreviewProps {
  widths: {
    lillefinger: number;
    ringfinger: number;
    langfinger: number;
    pekefinger: number;
  };
  heights: {
    lillefinger: number;
    ringfinger: number;
    langfinger: number;
    pekefinger: number;
  };
  depth: number;
  blockVariant: BlockVariant;
}

const DEPTH_SCALE: Record<BlockVariant, number> = {
  shortedge: 1.0,
  longedge: 1.25,
};

const SCALE = 0.04; // mm -> Three.js units
const SIDE_PAD = 4; // mm side wall
const INTER_PAD = 2.67; // mm between fingers ((16 - 2*4) / 3)

function sanitizeDimension(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Build a 2D step profile (front view) of the block in mm.
 * X = width (left to right), Y = height (bottom to top).
 * Finger order left-to-right: lille, ring, lang, peke.
 */
function buildStepProfile(
  widths: { lillefinger: number; ringfinger: number; langfinger: number; pekefinger: number },
  heights: { lillefinger: number; ringfinger: number; langfinger: number; pekefinger: number },
  totalWidth: number
): THREE.Shape {
  const fingers = [
    { width: widths.lillefinger, height: heights.lillefinger },
    { width: widths.ringfinger, height: heights.ringfinger },
    { width: widths.langfinger, height: heights.langfinger },
    { width: widths.pekefinger, height: heights.pekefinger },
  ];

  // Compute X boundaries for each finger zone
  const fingerStarts: number[] = [];
  const fingerEnds: number[] = [];
  let cx = SIDE_PAD;
  for (let i = 0; i < fingers.length; i++) {
    fingerStarts.push(cx);
    cx += fingers[i].width;
    fingerEnds.push(cx);
    if (i < fingers.length - 1) cx += INTER_PAD;
  }

  // Step transition X positions (midpoint between adjacent finger zones)
  const stepX: number[] = [];
  for (let i = 0; i < fingers.length - 1; i++) {
    stepX.push((fingerEnds[i] + fingerStarts[i + 1]) / 2);
  }

  const shape = new THREE.Shape();

  // Bottom-left
  shape.moveTo(0, 0);
  // Bottom-right
  shape.lineTo(totalWidth, 0);
  // Right side up to peke height
  shape.lineTo(totalWidth, fingers[3].height);
  // Step from right to left: peke -> lang -> ring -> lille
  shape.lineTo(stepX[2], fingers[3].height);
  shape.lineTo(stepX[2], fingers[2].height);
  shape.lineTo(stepX[1], fingers[2].height);
  shape.lineTo(stepX[1], fingers[1].height);
  shape.lineTo(stepX[0], fingers[1].height);
  shape.lineTo(stepX[0], fingers[0].height);
  // Left side down
  shape.lineTo(0, fingers[0].height);
  shape.lineTo(0, 0);

  return shape;
}

function UnifiedBlock({
  widths,
  heights,
  depth,
  blockVariant,
}: {
  widths: ParametricBlockPreviewProps["widths"];
  heights: ParametricBlockPreviewProps["heights"];
  depth: number;
  blockVariant: BlockVariant;
}) {
  const totalWidth = widths.lillefinger + widths.ringfinger + widths.langfinger + widths.pekefinger + 16;
  const effectiveDepth = depth * DEPTH_SCALE[blockVariant];

  const geometry = useMemo(() => {
    const shape = buildStepProfile(widths, heights, totalWidth);

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: effectiveDepth,
      bevelEnabled: true,
      bevelSize: 0.5,
      bevelThickness: 0.5,
      bevelSegments: 3,
      curveSegments: 1,
    });

    // Scale from mm to Three.js units
    geo.scale(SCALE, SCALE, SCALE);

    // Center X and Z, bottom at Y=0
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (bb) {
      geo.translate(
        -(bb.min.x + bb.max.x) / 2,
        -bb.min.y,
        -(bb.min.z + bb.max.z) / 2
      );
    }

    geo.computeVertexNormals();
    return geo;
  }, [
    widths.lillefinger, widths.ringfinger, widths.langfinger, widths.pekefinger,
    heights.lillefinger, heights.ringfinger, heights.langfinger, heights.pekefinger,
    totalWidth, effectiveDepth,
  ]);

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color="#6b7280" roughness={0.4} metalness={0.1} />
    </mesh>
  );
}

function BlockScene({ widths, heights, depth, blockVariant }: ParametricBlockPreviewProps) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={1} castShadow />
      <directionalLight position={[-3, 5, -5]} intensity={0.3} />

      <mesh receiveShadow position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[8, 4]} />
        <meshStandardMaterial color="#1a1a2e" roughness={0.8} />
      </mesh>

      <UnifiedBlock
        widths={widths}
        heights={heights}
        depth={depth}
        blockVariant={blockVariant}
      />

      <OrbitControls
        enablePan={false}
        enableZoom={true}
        minDistance={2}
        maxDistance={8}
        target={[0, 0.4, 0]}
      />
    </>
  );
}

const CanvasFallback = () => (
  <div className="flex h-full w-full items-center justify-center px-3 text-center text-xs text-muted-foreground">
    3D-forhandsvisning er midlertidig utilgjengelig.
  </div>
);

export default function ParametricBlockPreview({ widths, heights, depth, blockVariant }: ParametricBlockPreviewProps) {
  const safeWidths = {
    lillefinger: sanitizeDimension(widths.lillefinger, 10, 40, 21),
    ringfinger: sanitizeDimension(widths.ringfinger, 10, 40, 20),
    langfinger: sanitizeDimension(widths.langfinger, 10, 40, 20),
    pekefinger: sanitizeDimension(widths.pekefinger, 10, 40, 22),
  };
  const safeHeights = {
    lillefinger: sanitizeDimension(heights.lillefinger, 1, 40, 10),
    ringfinger: sanitizeDimension(heights.ringfinger, 1, 40, 15),
    langfinger: sanitizeDimension(heights.langfinger, 1, 40, 20),
    pekefinger: sanitizeDimension(heights.pekefinger, 1, 40, 17),
  };
  const safeDepth = sanitizeDimension(depth, 10, 40, 20);

  return (
    <div className="h-56 w-full overflow-hidden rounded-xl bg-surface-light sm:h-64" style={{ touchAction: "pan-y" }}>
      <AppErrorBoundary boundaryName="parametric-block-preview" fallback={<CanvasFallback />}>
        <Canvas
          shadows
          camera={{ position: [0, 1.5, 4], fov: 40 }}
          gl={{ antialias: true }}
          style={{ touchAction: "pan-y" }}
        >
          <BlockScene
            widths={safeWidths}
            heights={safeHeights}
            depth={safeDepth}
            blockVariant={blockVariant}
          />
        </Canvas>
      </AppErrorBoundary>
    </div>
  );
}
