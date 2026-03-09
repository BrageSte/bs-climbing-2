import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const vendorThreeBudgetBytes = 1_100_000;
const stlGzipBudgetBytes = 220_000;

const distAssetsDir = path.resolve(process.cwd(), "dist/assets");
const modelsDir = path.resolve(process.cwd(), "public/models");

async function checkVendorThreeBudget(issues) {
  const files = await readdir(distAssetsDir);
  const vendorThreeFile = files.find((file) => file.startsWith("vendor-three-") && file.endsWith(".js"));
  if (!vendorThreeFile) {
    issues.push("Missing vendor-three chunk in dist/assets.");
    return;
  }

  const filePath = path.join(distAssetsDir, vendorThreeFile);
  const fileStats = await stat(filePath);
  if (fileStats.size > vendorThreeBudgetBytes) {
    issues.push(
      `vendor-three chunk is ${fileStats.size} bytes (budget: ${vendorThreeBudgetBytes}).`,
    );
    return;
  }

  console.log(`[bundle-budget] vendor-three OK: ${fileStats.size} bytes.`);
}

async function checkCompressedStlAssets(issues) {
  const files = await readdir(modelsDir);
  const stlFiles = files.filter((file) => file.endsWith(".stl"));
  if (stlFiles.length === 0) {
    console.log("[bundle-budget] No STL assets found.");
    return;
  }

  for (const stlFile of stlFiles) {
    const sourcePath = path.join(modelsDir, stlFile);
    const compressedPath = `${sourcePath}.gz`;
    const sourceStats = await stat(sourcePath);
    let compressedStats;
    try {
      compressedStats = await stat(compressedPath);
    } catch {
      issues.push(`Missing compressed STL asset: ${path.basename(compressedPath)}.`);
      continue;
    }

    if (compressedStats.size >= sourceStats.size) {
      issues.push(`${path.basename(compressedPath)} is not smaller than ${stlFile}.`);
      continue;
    }

    if (compressedStats.size > stlGzipBudgetBytes) {
      issues.push(
        `${path.basename(compressedPath)} is ${compressedStats.size} bytes (budget: ${stlGzipBudgetBytes}).`,
      );
      continue;
    }

    console.log(
      `[bundle-budget] ${path.basename(compressedPath)} OK: ${compressedStats.size} bytes (source ${sourceStats.size}).`,
    );
  }
}

async function run() {
  const issues = [];

  await checkVendorThreeBudget(issues);
  await checkCompressedStlAssets(issues);

  if (issues.length > 0) {
    console.error("[bundle-budget] Budget check failed:");
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log("[bundle-budget] All checks passed.");
}

run().catch((error) => {
  console.error("[bundle-budget] Failed to evaluate budgets:", error);
  process.exit(1);
});
