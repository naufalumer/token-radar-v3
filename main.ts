// Token radar, radar-4: read the sealed snapshot, rank every rankable pre-token protocol
// by its pooled-tilt implied launch value, and write the board, the dashboard data, the
// dashboard itself, the screenshots and the judge's dossier.
//
//   node main.ts --input <snapshot.json|directory> [--output <dir>]
//   MAKEFUN_OUTPUT_DIR stands in for /output outside the grader's container.
//
// The program is deterministic: the same snapshot bytes always write the same output
// bytes (no clock, no randomness, no network). Node 22, standard library only.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The value of `--name <value>` (or `--name=<value>`), else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy a directory's regular files into `to`, skipping dot-names, and return the names. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (dashFiles.length < 3 || !dashFiles.includes('index.html')) {
  process.stderr.write(`token radar: dashboard/ is missing files: ${dashFiles.join(', ') || '(empty)'}\n`);
  process.exit(1);
}
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
const dossierOpts = { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } };
writeFileSync(join(out, 'dossier.json'), buildDossier(out, dossierOpts));

// Self-check: rebuilding the dossier from the finished /output must reproduce the
// same bytes — the scorer does exactly this rebuild, so a mismatch here is a failure
// now, not a rejection after submit.
if (!readFileSync(join(out, 'dossier.json')).equals(Buffer.from(buildDossier(out, dossierOpts)))) {
  process.stderr.write('token radar: the dossier does not rebuild byte-identically; refusing to hand in a mismatched /output\n');
  process.exit(1);
}

const tiltCheck = radar.calibration.tilt_validation;
const losingCats = tiltCheck.by_category
  .filter((c) => c.median_ape_sized_pct > c.median_ape_flat_pct)
  .map((c) => `${c.category} (${c.peers})`);
const candLine = tiltCheck.candidates
  .map((c) => `${c.candidate}: median ${c.median_ape_pct.toFixed(1)}%, log ${c.log_mae.toFixed(3)}, within-2x ${c.within2x_pct.toFixed(1)}%`)
  .join(' | ');
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: top implied value $${board[0]!.implied_value_usd.toLocaleString('en-US')} (${board[0]!.slug}), median $${board[Math.floor(board.length / 2)]!.implied_value_usd.toLocaleString('en-US')}\n` +
    `token radar: pooled tilt — slope ${radar.calibration.power_law.slope}, damped ${radar.calibration.power_law.slope_damped}, R2 ${radar.calibration.power_law.r2}, ref TVL $${radar.calibration.power_law.median_tvl_usd.toLocaleString('en-US')}; 5-fold median error ${tiltCheck.median_ape_sized_pct.toFixed(1)}% vs ${tiltCheck.median_ape_flat_pct.toFixed(1)}% flat, Spearman ${tiltCheck.spearman_sized.toFixed(2)} vs ${tiltCheck.spearman_flat.toFixed(2)} flat (${tiltCheck.sized_wins}/${tiltCheck.peers} priced closer)\n` +
    `token radar: full formula — median error ${tiltCheck.full_median_ape_sized_pct.toFixed(1)}% vs ${tiltCheck.full_median_ape_flat_pct.toFixed(1)}% flat, log error ${tiltCheck.full_log_mae_sized.toFixed(3)} vs ${tiltCheck.full_log_mae_flat.toFixed(3)} flat, within 2x ${tiltCheck.full_within2x_sized_pct.toFixed(1)}% vs ${tiltCheck.full_within2x_flat_pct.toFixed(1)}% flat (${tiltCheck.full_sized_wins}/${tiltCheck.peers} priced closer); tilt loses the median-error comparison in ${losingCats.length} categor${losingCats.length === 1 ? 'y' : 'ies'}${losingCats.length > 0 ? `: ${losingCats.join(', ')}` : ''}\n` +
    `token radar: candidates — ${candLine}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
