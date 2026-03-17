/* eslint security/detect-non-literal-fs-filename: "off" */
// This script only reads and writes repo-controlled model assets under process.cwd().
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const modelsDir = path.resolve(process.cwd(), "public/models");

async function compressModels() {
  const entries = await readdir(modelsDir, { withFileTypes: true });
  const stlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".stl"))
    .map((entry) => entry.name);

  if (stlFiles.length === 0) {
    console.log("[compress-model-assets] No STL files found.");
    return;
  }

  for (const fileName of stlFiles) {
    const sourcePath = path.join(modelsDir, fileName);
    const targetPath = `${sourcePath}.gz`;
    const sourceBuffer = await readFile(sourcePath);
    const compressed = gzipSync(sourceBuffer, { level: 9 });

    let shouldWrite = true;
    try {
      const [sourceStats, targetStats] = await Promise.all([stat(sourcePath), stat(targetPath)]);
      shouldWrite = sourceStats.mtimeMs > targetStats.mtimeMs || targetStats.size !== compressed.length;
    } catch {
      shouldWrite = true;
    }

    if (shouldWrite) {
      await writeFile(targetPath, compressed);
      console.log(`[compress-model-assets] Wrote ${path.basename(targetPath)} (${compressed.length} bytes).`);
    } else {
      console.log(`[compress-model-assets] Up to date: ${path.basename(targetPath)}.`);
    }
  }
}

compressModels().catch((error) => {
  console.error("[compress-model-assets] Failed:", error);
  process.exit(1);
});
