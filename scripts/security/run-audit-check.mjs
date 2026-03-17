import { execFileSync } from "node:child_process";

const KNOWN_BASELINE = new Map([
  [
    "flatted",
    {
      severity: "high",
      advisories: ["1114526:high"],
      note: "Transitiv via eslint -> file-entry-cache -> flat-cache -> flatted",
    },
  ],
  [
    "undici",
    {
      severity: "high",
      advisories: [
        "1114591:high",
        "1114593:moderate",
        "1114637:high",
        "1114639:high",
        "1114641:moderate",
        "1114643:moderate",
      ],
      note: "Transitiv via jsdom i testmiljoet",
    },
  ],
]);

function runAudit() {
  try {
    return execFileSync("npm", ["audit", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const stdout = error?.stdout;
    if (typeof stdout === "string" && stdout.trim()) {
      return stdout;
    }
    throw error;
  }
}

function summarize(vulnerabilities) {
  return Object.entries(vulnerabilities).map(([name, vuln]) => ({
    name,
    severity: vuln.severity,
    advisories: Array.isArray(vuln.via)
      ? vuln.via
          .flatMap((entry) => {
            if (!entry || typeof entry !== "object") return [];
            const source = "source" in entry ? entry.source : null;
            const severity = typeof entry.severity === "string" ? entry.severity : null;
            return typeof source === "number" && severity ? [`${source}:${severity}`] : [];
          })
          .sort()
      : [],
  }));
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

const raw = runAudit();
const report = JSON.parse(raw);
const vulnerabilities = report.vulnerabilities ?? {};
const summary = summarize(vulnerabilities);

const unexpected = summary.filter((item) => {
  const known = KNOWN_BASELINE.get(item.name);
  return !known || known.severity !== item.severity || !arraysEqual(known.advisories, item.advisories);
});

if (summary.length === 0) {
  console.log("security:audit: Ingen sarbarheter funnet.");
  process.exit(0);
}

console.log("security:audit: Registrerte funn");
for (const item of summary) {
  const known = KNOWN_BASELINE.get(item.name);
  const status = known ? "baseline" : "ny";
  const note = known?.note ? ` - ${known.note}` : "";
  const advisorySummary = item.advisories.length > 0 ? ` [${item.advisories.join(", ")}]` : "";
  console.log(`- ${item.name} (${item.severity}, ${status})${advisorySummary}${note}`);
}

if (unexpected.length > 0) {
  console.error("security:audit: Nye eller endrede sarbarheter krever oppfolging.");
  process.exit(1);
}

console.log("security:audit: Kun kjente baseline-funn er til stede.");
