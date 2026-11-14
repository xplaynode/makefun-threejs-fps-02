// SLAGLINE — entry program for threejs-fps-02 (Node 22, standard library only).
//
// The game itself is the static site in game/: plain ES modules, three.js 0.187.0
// vendored under game/vendor/three/, no build step and no network. This program
// hands it in: it copies game/ and screenshots/ into the output directory and
// writes the dossier the judge reads, using the kit's own library
// (vendor/makefun-threejs.ts) with the scorer's caps, so the dossier on disk is
// byte for byte the one the gate rebuilds.
//
// Run locally:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Play locally: node serve.ts   (then http://localhost:8080)

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });
cpSync(join(repoDir, 'game'), join(outDir, 'game'), { recursive: true });

const shotsDir = join(repoDir, 'screenshots');
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(shotsDir)) {
  cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });
}

// The caps mirror the gate's: at most 4 screenshots of 256 KiB, at most 993
// entries and 48 MiB under game/, and the dossier text capped at 160 KiB.
const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
console.log(`SLAGLINE dossier written: ${join(outDir, 'dossier.json')} (${dossier.length} bytes)`);
