// Packs the built library as @one-serve/sileo for OneServe: dist, README and NOTICE plus a package.json without scripts
// and devDependencies, under a fixed version. The archive goes to packages/sileo/pack/; its file list, the commit it was
// built from and its SHA-256 go next to it (pack/<name>.json), so OneServe can name exactly what it uses.
// The workspace keeps the name "sileo", so the fork's website and CI stay as upstream has them.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.1.6-oneserve.1";
const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
if (!existsSync(join(packageDir, "dist", "index.mjs"))) throw new Error("dist missing: run bun run build first");

const git = (...args) => execFileSync("git", args, { cwd: packageDir, encoding: "utf8" }).trim();
const commit = git("rev-parse", "HEAD");
const dirty = git("status", "--porcelain", "--", ".") !== "";

const stage = mkdtempSync(join(tmpdir(), "oneserve-sileo-"));
try {
  cpSync(join(packageDir, "dist"), join(stage, "dist"), { recursive: true });
  for (const file of ["README.md", "NOTICE"]) cpSync(join(packageDir, file), join(stage, file));
  const manifest = {
    name: "@one-serve/sileo",
    version: VERSION,
    description: source.description,
    license: source.license,
    repository: { type: "git", url: "https://github.com/GerritHillebrecht/sileo.git", directory: "packages/sileo" },
    files: ["dist", "NOTICE"],
    main: source.main,
    types: source.types,
    exports: source.exports,
    sideEffects: ["**/*.css", "./dist/index.js", "./dist/index.mjs"],
    peerDependencies: source.peerDependencies,
  };
  writeFileSync(join(stage, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const out = join(packageDir, "pack");
  mkdirSync(out, { recursive: true });
  const result = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", out], { cwd: stage, encoding: "utf8", shell: process.platform === "win32" }));
  const archive = join(out, result[0].filename);
  const sha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");
  const record = { name: manifest.name, version: VERSION, archive: result[0].filename, sha256, commit, workingTreeChanged: dirty, files: result[0].files.map((file) => file.path).sort() };
  writeFileSync(join(out, `${result[0].filename}.json`), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`${result[0].filename} sha256=${sha256} commit=${commit}${dirty ? " (working tree changed)" : ""}`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
