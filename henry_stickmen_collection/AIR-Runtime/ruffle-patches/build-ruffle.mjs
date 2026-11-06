#!/usr/bin/env node
// Rebuilds the patched Ruffle in AIR-Runtime/vendor/ruffle/ from source.
//
//   node AIR-Runtime/ruffle-patches/build-ruffle.mjs [--workdir <dir>] [--commit <sha>]
//
// What it does:
//   1. clones ruffle-rs/ruffle at the pinned commit below (or reuses --workdir)
//   2. applies henry-web.patch (lazy shape tessellation + AIR file APIs)
//   3. runs Ruffle's own web build (ruffle-core + ruffle-selfhosted)
//   4. copies ruffle.js + the .wasm files into AIR-Runtime/vendor/ruffle/
//
// Requirements (see Ruffle's web/README.md for details):
//   - git, Node 20+
//   - Rust (rustup) with:  rustup target add wasm32-unknown-unknown
//     On Windows use the MSVC host toolchain (needs Visual Studio Build Tools with C++).
//   - wasm-bindgen-cli at the exact version Ruffle pins (0.2.127 for this commit):
//       cargo install wasm-bindgen-cli --version 0.2.127
//   - Java 17+ on PATH (Ruffle compiles its ActionScript globals with it)
//   - optional: binaryen's wasm-opt on PATH (smaller, faster output)
//
// Windows: keep --workdir short (e.g. C:\rb). Cargo's git checkouts break past
// the 260-character path limit.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const vendor = path.resolve(here, "..", "vendor", "ruffle");
const patch = path.join(here, "henry-web.patch");
const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);

const COMMIT = opt("--commit", fs.readFileSync(path.join(here, "RUFFLE_COMMIT"), "utf8").trim());
const workdir = path.resolve(opt("--workdir", path.join(here, ".ruffle-src")));
const win = process.platform === "win32";
const run = (cmd, argv, cwd) => {
  console.log(`> ${cmd} ${argv.join(" ")}`);
  execFileSync(win && cmd === "npm" ? "npm.cmd" : cmd, argv, { cwd, stdio: "inherit", shell: win && cmd === "npm" });
};

if (!fs.existsSync(path.join(workdir, ".git"))) {
  run("git", ["clone", "--filter=blob:none", "https://github.com/ruffle-rs/ruffle.git", workdir]);
}
run("git", ["checkout", "--force", COMMIT], workdir);
run("git", ["clean", "-fdq", "core/src"], workdir);
run("git", ["apply", "--whitespace=nowarn", patch], workdir);

const web = path.join(workdir, "web");
run("npm", ["install", "--no-audit", "--no-fund"], web);
run("npm", ["run", "build", "--workspace=ruffle-core"], web);
run("npm", ["run", "build", "--workspace=ruffle-selfhosted"], web);

const dist = path.join(web, "packages", "selfhosted", "dist");
fs.mkdirSync(vendor, { recursive: true });
for (const f of fs.readdirSync(vendor)) {
  if (/^ruffle.*\.(js|wasm|map)$/.test(f)) fs.rmSync(path.join(vendor, f));
}
for (const f of fs.readdirSync(dist)) {
  if (/\.(js|wasm)$/.test(f)) fs.copyFileSync(path.join(dist, f), path.join(vendor, f));
}
for (const f of ["LICENSE.md"]) {
  if (fs.existsSync(path.join(workdir, f))) fs.copyFileSync(path.join(workdir, f), path.join(vendor, f));
}
fs.writeFileSync(path.join(vendor, "BUILD_INFO.txt"),
  `Ruffle ${COMMIT} + ruffle-patches/henry-web.patch\nBuilt ${new Date().toISOString()}\n`);
console.log(`\nDone - patched Ruffle copied to ${vendor}`);
