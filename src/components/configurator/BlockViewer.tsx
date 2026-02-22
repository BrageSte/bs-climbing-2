/**
 * BlockViewer — Fusion-lik 3D STL-viewer for crimp block preview.
 *
 * Orientering (STL-koordinater):
 *   X = bredde (~113mm), Y = dybde (~24mm), Z = høyde (~91-100mm).
 *   Åpningen (front) er på Y = max.  Kamera plasseres på +Y og ser
 *   inn i åpningen med Z opp.
 *
 * Fremtidig API-integrasjon:
 *   modelUrl kan byttes fra statisk "/models/…" til
 *   en dynamisk URL fra POST /api/preview-model, f.eks.
 *   `https://…storage…/previews/{hash}.stl`.  Komponenten håndterer
 *   URL-bytte med full dispose av gammel geometri.
 */
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { CameraControls, PerspectiveCamera, Environment } from "@react-three/drei";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import {
  mergeVertices,
  toCreasedNormals,
} from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as THREE from "three";
import type CameraControlsImpl from "camera-controls";
import AppErrorBoundary from "@/components/AppErrorBoundary";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlockViewerProps {
  /** URL to STL file. Either modelUrl or geometry must be provided. */
  modelUrl?: string;
  /** Direct BufferGeometry for parametric/live mode (no network). */
  geometry?: THREE.BufferGeometry;
  format?: "stl";
  variant?: "compact" | "long";
  /** Read-only overlay data – does NOT trigger STL reload. */
  configData?: {
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
    edgeMode: number;
    modelId?: string;
    depth?: number;
  };
  /** Optional loading text shown over the canvas. */
  loadingText?: string;
  className?: string;
}

type LoadState = "idle" | "loading" | "loaded" | "error";
type CameraPreset = "default" | "front" | "side" | "top" | "back";

interface ProcessedModel {
  geometry: THREE.BufferGeometry;
  edgeGeometry: THREE.BufferGeometry;
  boundingSphere: THREE.Sphere;
  boundingBox: THREE.Box3;
}

// ---------------------------------------------------------------------------
// Geometry processing (pure, no React)
// ---------------------------------------------------------------------------

function processSTLGeometry(raw: THREE.BufferGeometry): ProcessedModel {
  // 1. Merge duplicate vertices — STL has none; EdgesGeometry needs shared verts
  const merged = mergeVertices(raw, 1e-4);

  // 2. Compute edges from INDEXED geometry (before toCreasedNormals de-indexes)
  const edgeGeometry = new THREE.EdgesGeometry(merged, 30);

  // 3. Creased normals: smooth fillets, sharp creases at ~30°
  const creased = toCreasedNormals(merged, Math.PI / 6);

  // 4. Center both geometries on bounding box
  creased.center();
  creased.computeBoundingBox();
  creased.computeBoundingSphere();
  edgeGeometry.center();

  // Dispose intermediate indexed geometry (creased is a separate copy)
  merged.dispose();

  return {
    geometry: creased,
    edgeGeometry,
    boundingSphere: creased.boundingSphere!,
    boundingBox: creased.boundingBox!,
  };
}

// ---------------------------------------------------------------------------
// Scene internals (Canvas children)
// ---------------------------------------------------------------------------

function ClipController({ enabled }: { enabled: boolean }) {
  const { gl } = useThree();
  useEffect(() => {
    gl.localClippingEnabled = enabled;
  }, [gl, enabled]);
  return null;
}

function SceneLighting() {
  return (
    <>
      <Environment preset="studio" environmentIntensity={0.4} />
      <directionalLight position={[80, 60, 100]} intensity={1.5} />
      <directionalLight position={[-60, 30, 40]} intensity={0.6} />
      <directionalLight position={[0, -40, -60]} intensity={0.3} />
      <ambientLight intensity={0.3} />
    </>
  );
}

function ShadowPlane({ bottomZ }: { bottomZ: number }) {
  return (
    <mesh position={[0, 0, bottomZ - 0.5]} receiveShadow>
      <circleGeometry args={[80, 64]} />
      <meshBasicMaterial color="#000000" transparent opacity={0.12} />
    </mesh>
  );
}

function BlockModel({
  url,
  showEdges,
  xray,
  clipEnabled,
  clipValue,
  onModelReady,
  onLoadState,
}: {
  url: string;
  showEdges: boolean;
  xray: boolean;
  clipEnabled: boolean;
  clipValue: number;
  onModelReady: (m: ProcessedModel) => void;
  onLoadState: (s: LoadState) => void;
}) {
  const [model, setModel] = useState<ProcessedModel | null>(null);
  const geoRef = useRef<THREE.BufferGeometry | null>(null);
  const edgeRef = useRef<THREE.BufferGeometry | null>(null);

  // Stable clipping plane
  const clipPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
    [],
  );

  // ---- Load STL ----
  useEffect(() => {
    let active = true;
    const loader = new STLLoader();

    onLoadState("loading");
    setModel(null);

    loader.load(
      url,
      (rawGeo) => {
        if (!active) { rawGeo.dispose(); return; }
        try {
          const processed = processSTLGeometry(rawGeo);
          rawGeo.dispose();

          geoRef.current?.dispose();
          edgeRef.current?.dispose();
          geoRef.current = processed.geometry;
          edgeRef.current = processed.edgeGeometry;

          setModel(processed);
          onModelReady(processed);
          onLoadState("loaded");
        } catch (err) {
          console.error("[BlockViewer] geometry processing error:", err);
          onLoadState("error");
        }
      },
      undefined,
      (err) => {
        if (!active) return;
        console.error("[BlockViewer] STL load error:", { url, err });
        onLoadState("error");
      },
    );

    return () => {
      active = false;
      geoRef.current?.dispose();
      edgeRef.current?.dispose();
      geoRef.current = null;
      edgeRef.current = null;
    };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Update clip constant from slider ----
  useEffect(() => {
    if (!model) return;
    const bb = model.boundingBox;
    // 0 = no clip, 100 = full clip
    clipPlane.constant = bb.max.y - (clipValue / 100) * (bb.max.y - bb.min.y);
  }, [clipValue, model, clipPlane]);

  // ---- Mesh material (stable, reactively patched) ----
  const meshMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#9ca3af",
        roughness: 0.45,
        metalness: 0.05,
        side: THREE.DoubleSide,
      }),
    [],
  );

  useEffect(() => {
    meshMat.transparent = xray;
    meshMat.opacity = xray ? 0.35 : 1.0;
    meshMat.depthWrite = !xray;
    meshMat.needsUpdate = true;
  }, [xray, meshMat]);

  useEffect(() => {
    meshMat.clippingPlanes = clipEnabled ? [clipPlane] : [];
    meshMat.needsUpdate = true;
  }, [clipEnabled, clipPlane, meshMat]);

  useEffect(() => () => meshMat.dispose(), [meshMat]);

  // ---- Edge material ----
  const edgeMat = useMemo(
    () => new THREE.LineBasicMaterial({ color: "#1e293b" }),
    [],
  );

  useEffect(() => {
    edgeMat.clippingPlanes = clipEnabled ? [clipPlane] : [];
    edgeMat.needsUpdate = true;
  }, [clipEnabled, clipPlane, edgeMat]);

  useEffect(() => () => edgeMat.dispose(), [edgeMat]);

  if (!model) return null;

  return (
    <group>
      <mesh geometry={model.geometry} material={meshMat} castShadow receiveShadow />
      {showEdges && (
        <lineSegments geometry={model.edgeGeometry} material={edgeMat} />
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Parametric model (direct geometry, no loading)
// ---------------------------------------------------------------------------

function ParametricModel({
  geometry,
  showEdges,
  xray,
  clipEnabled,
  clipValue,
  onModelReady,
  onLoadState,
}: {
  geometry: THREE.BufferGeometry;
  showEdges: boolean;
  xray: boolean;
  clipEnabled: boolean;
  clipValue: number;
  onModelReady: (m: ProcessedModel) => void;
  onLoadState: (s: LoadState) => void;
}) {
  const edgeGeo = (geometry.userData?.edgeGeometry as THREE.BufferGeometry) ?? null;
  const prevGeoRef = useRef<THREE.BufferGeometry | null>(null);

  const clipPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
    [],
  );

  // Signal model ready whenever geometry changes
  useEffect(() => {
    if (!geometry) return;
    // Only recompute if geometry actually changed
    if (prevGeoRef.current === geometry) return;
    prevGeoRef.current = geometry;

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const model: ProcessedModel = {
      geometry,
      edgeGeometry: edgeGeo ?? new THREE.EdgesGeometry(geometry, 30),
      boundingSphere: geometry.boundingSphere!,
      boundingBox: geometry.boundingBox!,
    };
    onModelReady(model);
    onLoadState("loaded");
  }, [geometry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update clip constant from slider
  useEffect(() => {
    if (!geometry.boundingBox) return;
    const bb = geometry.boundingBox;
    clipPlane.constant = bb.max.y - (clipValue / 100) * (bb.max.y - bb.min.y);
  }, [clipValue, geometry, clipPlane]);

  // Mesh material
  const meshMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#9ca3af",
        roughness: 0.45,
        metalness: 0.05,
        side: THREE.DoubleSide,
      }),
    [],
  );

  useEffect(() => {
    meshMat.transparent = xray;
    meshMat.opacity = xray ? 0.35 : 1.0;
    meshMat.depthWrite = !xray;
    meshMat.needsUpdate = true;
  }, [xray, meshMat]);

  useEffect(() => {
    meshMat.clippingPlanes = clipEnabled ? [clipPlane] : [];
    meshMat.needsUpdate = true;
  }, [clipEnabled, clipPlane, meshMat]);

  useEffect(() => () => meshMat.dispose(), [meshMat]);

  // Edge material
  const edgeMat = useMemo(
    () => new THREE.LineBasicMaterial({ color: "#1e293b" }),
    [],
  );

  useEffect(() => {
    edgeMat.clippingPlanes = clipEnabled ? [clipPlane] : [];
    edgeMat.needsUpdate = true;
  }, [clipEnabled, clipPlane, edgeMat]);

  useEffect(() => () => edgeMat.dispose(), [edgeMat]);

  return (
    <group>
      <mesh geometry={geometry} material={meshMat} castShadow receiveShadow />
      {showEdges && edgeGeo && (
        <lineSegments geometry={edgeGeo} material={edgeMat} />
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Camera presets
// ---------------------------------------------------------------------------

function presetLookAt(
  preset: CameraPreset,
  r: number,
): { pos: [number, number, number]; target: [number, number, number] } {
  const d = r * 2.5;
  const t: [number, number, number] = [0, 0, 0];
  switch (preset) {
    case "front":  return { pos: [0, d, d * 0.06], target: t };
    case "side":   return { pos: [d, 0, d * 0.06], target: t };
    case "top":    return { pos: [0, d * 0.02, d], target: t };
    case "back":   return { pos: [0, -d, d * 0.06], target: t };
    case "default":
    default:       return { pos: [d * 0.35, d * 0.6, d * 0.35], target: t };
  }
}

// ---------------------------------------------------------------------------
// HTML overlays
// ---------------------------------------------------------------------------

function LoadingOverlay({ state, text }: { state: LoadState; text?: string }) {
  if (state === "loading") {
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
          <span className="text-xs text-muted-foreground">
            {text ?? "Laster 3D-modell\u2026"}
          </span>
        </div>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
        <div className="flex flex-col items-center gap-2 px-4 text-center">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive/20">
            <span className="text-sm font-bold text-destructive">!</span>
          </div>
          <span className="text-xs text-muted-foreground">
            Kunne ikke laste modellen. Sjekk at STL-filen finnes.
          </span>
        </div>
      </div>
    );
  }
  return null;
}

function ViewerToolbar({
  showEdges, onToggleEdges,
  xray, onToggleXray,
  clipEnabled, clipValue, onToggleClip, onClipChange,
  onPreset,
}: {
  showEdges: boolean;  onToggleEdges: (v: boolean) => void;
  xray: boolean;       onToggleXray: (v: boolean) => void;
  clipEnabled: boolean; clipValue: number;
  onToggleClip: (v: boolean) => void; onClipChange: (v: number) => void;
  onPreset: (p: CameraPreset) => void;
}) {
  return (
    <div className="absolute bottom-2 left-2 right-2 z-20 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-card/90 px-3 py-2 backdrop-blur-sm">
      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
        <Switch checked={showEdges} onCheckedChange={onToggleEdges} className="scale-75" />
        <span>Kanter</span>
      </label>

      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
        <Switch checked={xray} onCheckedChange={onToggleXray} className="scale-75" />
        <span>X-ray</span>
      </label>

      <div className="h-4 w-px bg-border" />

      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
        <Switch checked={clipEnabled} onCheckedChange={onToggleClip} className="scale-75" />
        <span>Snitt</span>
      </label>
      {clipEnabled && (
        <Slider
          value={[clipValue]}
          onValueChange={([v]) => onClipChange(v)}
          min={0} max={100} step={1}
          className="w-20 sm:w-28"
        />
      )}

      <div className="flex-1" />

      <div className="flex gap-0.5">
        {([
          ["default", "3/4"],
          ["front", "Front"],
          ["side", "Side"],
          ["top", "Topp"],
          ["back", "Bak"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => onPreset(key)}
            className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:bg-primary/15 hover:text-foreground"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function InfoOverlay({ configData }: { configData?: BlockViewerProps["configData"] }) {
  if (!configData) return null;
  const { widths: w, heights: h, edgeMode, modelId, depth } = configData;

  return (
    <div className="absolute left-2 top-2 z-20 space-y-0.5 rounded-lg border border-border bg-card/90 px-3 py-2 backdrop-blur-sm">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-foreground">
        Konfigurasjon
      </div>
      <Row label="Bredde" value={`${w.lillefinger}/${w.ringfinger}/${w.langfinger}/${w.pekefinger} mm`} />
      <Row label="Høyde" value={`${h.lillefinger}/${h.ringfinger}/${h.langfinger}/${h.pekefinger} mm`} />
      <Row label="Mode" value={edgeMode === 0 ? "Compact" : "Long Edge"} />
      {depth != null && <Row label="Dybde" value={`${depth} mm`} />}
      {modelId && <Row label="ID" value={modelId} mono />}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="text-[11px] text-muted-foreground">
      <span className="text-muted-foreground/60">{label}:</span>{" "}
      <span className={mono ? "font-mono" : ""}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

const CanvasFallback = () => (
  <div className="flex h-full w-full items-center justify-center text-center text-xs text-muted-foreground">
    3D-forhåndsvisning er midlertidig utilgjengelig.
  </div>
);

export default function BlockViewer({
  modelUrl,
  geometry,
  configData,
  loadingText,
  className,
}: BlockViewerProps) {
  const [showEdges, setShowEdges] = useState(true);
  const [xray, setXray] = useState(false);
  const [clipEnabled, setClipEnabled] = useState(false);
  const [clipValue, setClipValue] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("idle");

  const ccRef = useRef<CameraControlsImpl>(null);
  const radiusRef = useRef(60);

  const handleModelReady = useCallback((m: ProcessedModel) => {
    radiusRef.current = m.boundingSphere.radius;
    const cc = ccRef.current;
    if (!cc) return;
    const { pos, target } = presetLookAt("default", m.boundingSphere.radius);
    cc.setLookAt(pos[0], pos[1], pos[2], target[0], target[1], target[2], false);
  }, []);

  const handlePreset = useCallback((p: CameraPreset) => {
    const cc = ccRef.current;
    if (!cc) return;
    const { pos, target } = presetLookAt(p, radiusRef.current);
    cc.setLookAt(pos[0], pos[1], pos[2], target[0], target[1], target[2], true);
  }, []);

  const handleToggleClip = useCallback((v: boolean) => {
    setClipEnabled(v);
    if (!v) setClipValue(0);
  }, []);

  return (
    <div
      className={`relative h-[400px] w-full overflow-hidden rounded-xl bg-gradient-to-br from-muted/30 to-muted/60 sm:h-[500px] ${className ?? ""}`}
      style={{ touchAction: "none" }}
    >
      <AppErrorBoundary boundaryName="block-viewer" fallback={<CanvasFallback />}>
        <Canvas
          shadows
          dpr={[1, 2]}
          gl={{ antialias: true, localClippingEnabled: true }}
          style={{ touchAction: "none" }}
        >
          <PerspectiveCamera
            makeDefault
            position={[60, 100, 50]}
            fov={35}
            near={0.1}
            far={10000}
            up={[0, 0, 1]}
          />
          <CameraControls ref={ccRef} makeDefault minDistance={30} maxDistance={500} />

          <ClipController enabled={clipEnabled} />
          <SceneLighting />

          {geometry ? (
            <ParametricModel
              geometry={geometry}
              showEdges={showEdges}
              xray={xray}
              clipEnabled={clipEnabled}
              clipValue={clipValue}
              onModelReady={handleModelReady}
              onLoadState={setLoadState}
            />
          ) : modelUrl ? (
            <BlockModel
              url={modelUrl}
              showEdges={showEdges}
              xray={xray}
              clipEnabled={clipEnabled}
              clipValue={clipValue}
              onModelReady={handleModelReady}
              onLoadState={setLoadState}
            />
          ) : null}

          <ShadowPlane bottomZ={-50} />
        </Canvas>
      </AppErrorBoundary>

      <LoadingOverlay state={loadState} text={loadingText} />
      <InfoOverlay configData={configData} />
      <ViewerToolbar
        showEdges={showEdges}
        onToggleEdges={setShowEdges}
        xray={xray}
        onToggleXray={setXray}
        clipEnabled={clipEnabled}
        clipValue={clipValue}
        onToggleClip={handleToggleClip}
        onClipChange={setClipValue}
        onPreset={handlePreset}
      />
    </div>
  );
}
