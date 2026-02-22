/**
 * Browser-side STL export using THREE.js STLExporter.
 * Generates a binary STL file and triggers a download.
 */
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

export function exportGeometryAsSTL(
  geometry: THREE.BufferGeometry,
  filename = "block.stl",
): void {
  const mesh = new THREE.Mesh(geometry);
  const exporter = new STLExporter();
  const result = exporter.parse(mesh, { binary: true });
  const blob = new Blob([result], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
