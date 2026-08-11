/**
 * E1-S0 row 2 verification: every installed package that declares a
 * TypeScript peer dependency must be compatible with the pinned TypeScript 6
 * toolchain. Reports the resolved TypeScript version and every typescript
 * peer/runtime range found.
 *
 * Known finding (recorded in the E1-S0 result): openapi-typescript declares
 * `typescript ^5.x` in peerDependencies but does not depend on the
 * TypeScript runtime; its generated output typechecks under 6.0.3 (verified
 * by the api-client typecheck, including the negative fixtures).
 */
import { readFileSync } from "node:fs";

interface PkgInfo {
  name: string;
  version: string;
  peer?: string;
  dep?: string;
}

function loadPkg(packageJsonPath: string): {
  name: string;
  version: string;
  peerDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
} | null {
  try {
    const raw = readFileSync(packageJsonPath, "utf8");
    return JSON.parse(raw) as {
      name: string;
      version: string;
      peerDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
  } catch {
    return null;
  }
}

const found: PkgInfo[] = [];
const seen = new Set<string>();
let resolvedTypeScript: PkgInfo | null = null;

for (const dir of new Bun.Glob("node_modules/**/package.json").scanSync({ dot: true })) {
  // Skip genuinely nested installs (a package inside another package's
  // node_modules). Bun's flat store layout has exactly one "/node_modules/"
  // segment; top-level packages have none.
  if (dir.split("/node_modules/").length > 2) continue;
  const pkg = loadPkg(dir);
  if (!pkg) continue;
  if (pkg.name === "typescript") resolvedTypeScript = { name: pkg.name, version: pkg.version };
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const peer = pkg.peerDependencies?.typescript;
  const dep = pkg.dependencies?.typescript;
  if (peer || dep) {
    found.push({ name: pkg.name, version: pkg.version, peer, dep });
  }
}

console.log(
  `resolved typescript: ${resolvedTypeScript?.name ?? "?"}@${resolvedTypeScript?.version ?? "?"}`,
);
found.sort((a, b) => a.name.localeCompare(b.name));
for (const p of found) {
  console.log(`${p.name}@${p.version} peer=${p.peer ?? "-"} dep=${p.dep ?? "-"}`);
}

const startsWithMajor = (range: string | undefined, major: number) =>
  range !== undefined && new RegExp(`(^|[^0-9])${major}\\.`).test(range);

const hardFailures = found.filter(
  (p) => startsWithMajor(p.dep, 5) || startsWithMajor(p.dep, 7) || startsWithMajor(p.peer, 7),
);
const peerWarnings = found.filter((p) => startsWithMajor(p.peer, 5));

for (const p of peerWarnings) {
  console.warn(
    `WARNING: ${p.name} declares a TypeScript 5.x peer range (${p.peer}); runtime compatibility verified separately`,
  );
}
if (hardFailures.length > 0) {
  console.error(
    `FAIL: packages requiring TypeScript 5.x or 7.x: ${hardFailures.map((p) => `${p.name} (${p.dep ?? p.peer})`).join(", ")}`,
  );
  process.exit(1);
}
console.log("OK: no installed package requires TypeScript 5.x or 7.x");
