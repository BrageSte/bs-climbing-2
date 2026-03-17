/* eslint security/detect-non-literal-fs-filename: "off" */
// This scanner intentionally walks the repo tree to inspect tracked text files.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const IGNORE_DIRS = new Set([
  ".git",
  "dist",
  "node_modules",
  ".lovable",
  "coverage",
]);

const ALLOWLIST = new Set([
  ".env.example",
  "scripts/supabase/new-project.secrets.env.example",
  "src/integrations/supabase/publicEnv.ts",
]);

const ALLOWLIST_PREFIXES = [".env", ".env."];

const PATTERNS = [
  { name: "Stripe live secret", regex: /\bsk_live_[A-Za-z0-9]+\b/g },
  { name: "Stripe webhook secret", regex: /\bwhsec_[A-Za-z0-9]+\b/g },
  { name: "Supabase secret key", regex: /\bsb_secret_[A-Za-z0-9_-]+\b/g },
  { name: "Supabase service role JWT", regex: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9_-]+\b/g },
  { name: "OpenAI API key", regex: /\bsk-proj-[A-Za-z0-9_-]+\b/g },
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const relativePath = path.relative(ROOT, fullPath);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      if (!IGNORE_DIRS.has(entry)) {
        walk(fullPath, files);
      }
      continue;
    }

    files.push(relativePath);
  }

  return files;
}

function isTextFile(contents) {
  return !contents.includes("\u0000");
}

const matches = [];

for (const relativePath of walk(ROOT)) {
  if (ALLOWLIST.has(relativePath) || ALLOWLIST_PREFIXES.some((prefix) => relativePath === prefix || relativePath.startsWith(prefix))) {
    continue;
  }

  let contents;
  try {
    contents = readFileSync(path.join(ROOT, relativePath), "utf8");
  } catch {
    continue;
  }

  if (!isTextFile(contents)) {
    continue;
  }

  for (const pattern of PATTERNS) {
    if (pattern.regex.test(contents)) {
      matches.push({ file: relativePath, pattern: pattern.name });
    }
    pattern.regex.lastIndex = 0;
  }
}

if (matches.length > 0) {
  console.error("security:secrets: Mulige hemmeligheter funnet i repoet:");
  for (const match of matches) {
    console.error(`- ${match.file}: ${match.pattern}`);
  }
  process.exit(1);
}

console.log("security:secrets: Ingen uventede hemmeligheter funnet.");
