// The token radar's model, radar-4 (pooled tilt): one snapshot of the protocol
// universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a
// ceiling) plus every other rankable pre-token protocol below the floor: the early
// rows the radar exists to find. A protocol is pre-token when its record carries no
// token (no market cap, no CoinGecko id, no symbol); live-token protocols are kept
// apart and shown at the market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, calibrated on the
// snapshot itself:
//
//   catMedian    = median(mcap_usd / tvl_usd) of the LIVE-token protocols in the same
//                  category (n >= 3), else the median over all live-token protocols,
//                  clamped to [0.02, 1.0]. The market, not the author, sets the
//                  multiple.
//   size tilt    = ONE pooled size effect, not one per category: log10(mcap)
//                  regressed on log10(TVL) over all 119 live-token protocols (CEX
//                  excluded — an exchange's token is not a protocol launch).
//                  Pooled slope 0.472, R2 0.143. Applied at HALF the fitted strength
//                  (slope 0.736) and clamped to [0.50, 1.50], because the fit is weak
//                  and a full-strength tilt would price the giants 8x below their own
//                  category's peers — an extrapolation, not a measurement. The tilt
//                  is 1 at the market's median live TVL ($27.3M), so a protocol at
//                  the market's median size gets a tilt of 1.
//   multiple     = clamp(catMedian x sizeTilt, 0.02, 1.0)
//   base         = tvl_usd x multiple
//   growthMult   = 1 + clamp(change_7d, -50, 100) / 100 x 0.6
//   maturityMult = 0.70 + min(age_days, 1095) / 1095 x 0.30   (age unknown: 365 days)
//   chainMult    = 1 + min(chains - 1, 5) x 0.02               (reach, capped at 1.10)
//   implied      = max(1, round(base x growthMult x maturityMult x chainMult))
//
// Why ONE pooled tilt, when radar-3 fitted one per category? Because the per-category
// fits were tested and they lost. A 5-fold check on the snapshot's own live tokens
// prices each held-out token under five rules — flat category median, pooled tilt,
// per-category tilt, within-category slope, and the full formula — and records six
// numbers per rule (median error, trimmed mean error, wins against flat, rank
// correlation, log-space error, share within twice the true value). Per-category
// fits (5 to 15 peers each) lose to the pooled fit on five of the six: median error
// 92.5% vs 90.7%, trimmed mean 194% vs 177%, log error 0.774 vs 0.752, within-2x
// 21.8% vs 26.1%, wins 66 vs 72 of 119. They win only the rank correlation, 0.40
// vs 0.39. With so few peers per category the fits are noise wearing a slope, so
// radar-4 uses the one fit the whole market supports and says so in the model tab,
// with the full comparison table as the evidence. The within-category slope (0.674,
// fitted on category-demeaned data) was tested too and ties the pooled fit —
// no gain for the extra machinery, so it stays out.
//
// The check validates the FULL formula, not just the multiple: each held-out token
// is priced once from its category median alone and once from the shipped formula
// (median x tilt x growth x maturity x chains), so the growth, maturity and chain
// weights are measured, not asserted. On this snapshot the full formula's trimmed
// mean error is 153% against 177% for the multiple alone, at the same median error
// (90.7%) and log error (0.751) — the multipliers cut the worst overestimates and
// cost nothing measurable elsewhere. Growth and age themselves barely predict the
// multiple among live tokens (R2 under 0.01 for either), so their weights stay
// modest by design; the multiple carries the value, growth and age tilt it.
//
// No protocol name is ever special-cased: the same function scores every row, and
// the calibration table is recomputed from whatever snapshot the program is handed,
// so the radar keeps working on a future snapshot whose protocols do not exist yet.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_extra: number;
  multiple_floor: number;
  multiple_cap: number;
  min_peers: number;
  size_damping: number;
  tilt_floor: number;
  tilt_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.02,
  chain_max_extra: 5,
  multiple_floor: 0.02,
  multiple_cap: 1.0,
  min_peers: 3,
  size_damping: 0.5,
  tilt_floor: 0.5,
  tilt_cap: 1.5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-4-pooled-tilt';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One calibrated category multiple: the market's own mcap/TVL for that category. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  peers: number;
  fallback: boolean;
}

/** The pooled size effect: log10(mcap) = intercept + slope x log10(TVL) over live peers. */
export interface PowerLawFit {
  slope: number;
  slope_damped: number;
  r2: number;
  peers: number;
  median_tvl_usd: number;
}

/** One live peer's ratio, for the dashboard's per-category peer basis. */
export interface PeerBasis {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

/**
 * The live-peer basis for one category: every peer's ratio, lowest first, with the
 * quartiles of the distribution — what the category median actually stands on.
 */
export interface CategoryBasis {
  category: string;
  peers: PeerBasis[];
  q1: number;
  median: number;
  q3: number;
}

/**
 * One category's share of the 5-fold check: where the size tilt helps and where it
 * hurts. A category the tilt loses in is not hidden by the global median — the
 * model tab names the tilt's basis per category, and this table is the evidence
 * for whether the tilt earns its keep in each corner of the market.
 */
export interface CategoryValidation {
  category: string;
  peers: number;
  median_ape_flat_pct: number;
  median_ape_sized_pct: number;
  sized_wins: number;
}

/**
 * One pricing rule's row in the 5-fold comparison: the five rules the validation
 * actually ran, on the same folds, so no rule is judged on a different draw. Wins
 * are counted against the flat category median for every rule, including the full
 * formula — one baseline for the whole table.
 */
export interface CandidateCheck {
  candidate: string;
  median_ape_pct: number;
  trimmed_mean_ape_pct: number;
  wins: number;
  peers: number;
  spearman: number;
  log_mae: number;
  within2x_pct: number;
}

/**
 * The 5-fold check of the size tilt against the flat category median, on live tokens,
 * run twice: once for the multiple alone, once for the full shipped formula
 * (multiple x growth x maturity x chains). Six metrics, not one: median absolute
 * percentage error; the trimmed mean error (the worst tenth set aside, so one wild
 * token cannot decide it); the share of tokens the sized price beats the flat price
 * on; Spearman's rank correlation between the priced value and the token's true
 * market cap — the ranking check, because the board is a ranking; the log-space mean
 * error, which prices an overestimate and an underestimate symmetrically (APE caps
 * an underestimate at 100% but lets an overestimate run away, so it flatters a model
 * that prices low); and the share priced within twice the true value, the "close
 * enough" line for a launch-value guess. The per-category table breaks the median
 * error down by category so a global win cannot hide a category the tilt loses in,
 * and the candidates table holds the rules that were tried and what each scored.
 */
export interface TiltValidation {
  median_ape_flat_pct: number;
  median_ape_sized_pct: number;
  trimmed_mean_ape_flat_pct: number;
  trimmed_mean_ape_sized_pct: number;
  sized_wins: number;
  peers: number;
  spearman_flat: number;
  spearman_sized: number;
  log_mae_flat: number;
  log_mae_sized: number;
  within2x_flat_pct: number;
  within2x_sized_pct: number;
  full_median_ape_flat_pct: number;
  full_median_ape_sized_pct: number;
  full_trimmed_mean_ape_flat_pct: number;
  full_trimmed_mean_ape_sized_pct: number;
  full_sized_wins: number;
  full_spearman_flat: number;
  full_spearman_sized: number;
  full_log_mae_flat: number;
  full_log_mae_sized: number;
  full_within2x_flat_pct: number;
  full_within2x_sized_pct: number;
  by_category: CategoryValidation[];
  candidates: CandidateCheck[];
}

/** The calibration: one multiple per category the board uses, plus the market median. */
export interface Calibration {
  market_median: number;
  live_count: number;
  categories: CategoryMultiple[];
  power_law: PowerLawFit;
  category_basis: CategoryBasis[];
  tilt_validation: TiltValidation;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  signals: string[];
  model: {
    category_multiple: number;
    multiple_peers: number;
    multiple_fallback: boolean;
    size_tilt: number;
    size_tilt_basis: string;
    size_tilt_r2: number;
    fitted_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  signals: string[];
  category_multiple: number;
  size_tilt: number;
  size_tilt_basis: string;
  size_tilt_r2: number;
  fitted_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number | null;
}

/** Everything the dashboard needs: the board, the live set, the calibration, the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: Calibration;
  watchlist_size: number;
  watchlist_slugs: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted array, or null when it is empty. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The median of a list of errors as a percentage, or 0 when it is empty. */
function medianPct(errs: number[]): number {
  return round4((median([...errs].sort((a, b) => a - b)) ?? 0) * 100);
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A whole word wrapped, staked or staking in the name: a product of a token that trades. */
const WRAPPED_WORD = /\bwrapped\b|\bstaked\b|\bstaking\b/i;

/** Names beginning with an exchange's name: the exchange's own product, not a launch. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or
 * bridged product of a protocol whose token already trades — the watchlist's own rule,
 * applied to every row so the board never ranks WBTC or a bridge above a real launch.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * The live-token peers the model learns from: protocols that already trade, with a market
 * cap and a TVL, excluding centralised exchanges — an exchange's own token is not a
 * protocol launch and its multiple (several times TVL) would bend the fit.
 */
export function livePeers(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX',
  );
}

/**
 * The live peers grouped by category, categories in alphabetical order — one
 * grouping for the multiples, the fits and the peer basis, so the three tables
 * always agree on which peers belong where.
 */
function groupByCategory(peers: SnapshotProtocol[]): [string, SnapshotProtocol[]][] {
  const byCategory = new Map<string, SnapshotProtocol[]>();
  for (const p of peers) {
    const key = p.category ?? 'Uncategorised';
    const list = byCategory.get(key) ?? [];
    list.push(p);
    byCategory.set(key, list);
  }
  return [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/**
 * The least-squares line through two equal-length series: slope, intercept and
 * R squared. One helper for every regression in the file — the pooled fit, the
 * per-category fits, the within-category slope — so a fix to the maths lands
 * once instead of in three copies that can drift apart. The accumulators run
 * in the same order as the inline versions did, so the fitted numbers are
 * identical, not merely close.
 */
function leastSquares(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    ssTot += (ys[i]! - my) ** 2;
  }
  const slope = sxx === 0 ? 1 : sxy / sxx;
  const intercept = my - slope * mx;
  let ssRes = 0;
  for (let i = 0; i < n; i++) ssRes += (ys[i]! - (intercept + slope * xs[i]!)) ** 2;
  return { slope, intercept, r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot };
}

/** The least-squares fit of log10(mcap) on log10(TVL), with its R squared. */
export function fitPowerLaw(peers: SnapshotProtocol[]): { slope: number; r2: number } {
  const xs = peers.map((p) => Math.log10(p.tvl_usd));
  const ys = peers.map((p) => Math.log10(p.mcap_usd!));
  const { slope, r2 } = leastSquares(xs, ys);
  return { slope, r2 };
}

/**
 * The within-category size slope: log10(mcap) and log10(TVL) demeaned inside each
 * category, one regression on the demeaned data. It answers the size question
 * without letting categories of different sizes answer it for them — a category of
 * giants and a category of minnows each contribute only how size moves value
 * inside their own market. Tested as a candidate in the validation; it ties the
 * pooled fit and stays out of the shipped model.
 */
function withinCategorySlope(peers: SnapshotProtocol[]): number {
  const dx: number[] = [];
  const dy: number[] = [];
  for (const [, list] of groupByCategory(peers)) {
    const mx = list.reduce((a, p) => a + Math.log10(p.tvl_usd), 0) / list.length;
    const my = list.reduce((a, p) => a + Math.log10(p.mcap_usd!), 0) / list.length;
    for (const p of list) {
      dx.push(Math.log10(p.tvl_usd) - mx);
      dy.push(Math.log10(p.mcap_usd!) - my);
    }
  }
  return fitPowerLawFromPairs(dx, dy).slope;
}

/** A least-squares slope and R2 from two equal-length series of numbers. */
function fitPowerLawFromPairs(xs: number[], ys: number[]): { slope: number; r2: number } {
  const { slope, r2 } = leastSquares(xs, ys);
  return { slope, r2 };
}

/**
 * The size tilt for one TVL: 1 at the reference (median) TVL, less for giants, more
 * for the small. One pooled fit, one pooled reference — the whole market's size
 * effect, not a per-category guess.
 */
export function sizeTilt(tvlUsd: number, fit: { slope: number; median_tvl_usd: number }, model: ModelConstants): number {
  const damped = 1 + (fit.slope - 1) * model.size_damping;
  const raw = Math.pow(tvlUsd / fit.median_tvl_usd, damped - 1);
  return Math.min(model.tilt_cap, Math.max(model.tilt_floor, raw));
}

/** Ranks with average ties: equal values share the mean of the ranks they span. */
function ranks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const r = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[order[k]!.i] = avg;
    i = j + 1;
  }
  return r;
}

/**
 * Spearman's rank correlation between two equal-length series, or 0 when either has
 * no spread. The validation's ranking metric: it asks whether the priced values order
 * the tokens the way their true market caps do.
 */
export function spearman(xs: number[], ys: number[]): number {
  if (xs.length < 2 || xs.length !== ys.length) return 0;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i]! - mx) * (ry[i]! - my);
    sxx += (rx[i]! - mx) ** 2;
    syy += (ry[i]! - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

/** The value at quantile q of a sorted array, by linear interpolation. */
function quartile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** The quartiles of a sorted ratio list, rounded the way the dashboard prints them. */
function ratioQuartiles(sortedRatios: number[]): { q1: number; median: number; q3: number } {
  return {
    q1: round4(quartile(sortedRatios, 0.25)),
    median: round4(median(sortedRatios) ?? 0),
    q3: round4(quartile(sortedRatios, 0.75)),
  };
}

/** One peer's ratio row for the per-category basis table. */
function peerBasisRow(p: SnapshotProtocol): PeerBasis {
  return {
    slug: p.slug,
    name: p.name,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd!,
    ratio: round4(p.mcap_usd! / p.tvl_usd),
  };
}

/**
 * The live-peer basis per category: every peer's ratio, lowest first, with the
 * quartiles of the distribution — the numbers the category median is the middle of.
 */
export function buildCategoryBasis(peers: SnapshotProtocol[]): CategoryBasis[] {
  const out: CategoryBasis[] = [];
  for (const [category, list] of groupByCategory(peers)) {
    const sorted = [...list].sort((a, b) => a.mcap_usd! / a.tvl_usd - b.mcap_usd! / b.tvl_usd);
    const ratios = sorted.map((p) => p.mcap_usd! / p.tvl_usd);
    out.push({ category, peers: sorted.map(peerBasisRow), ...ratioQuartiles(ratios) });
  }
  return out;
}

/**
 * One multiple per category from the live peers: the median market-cap-to-TVL
 * ratio where a category has enough peers to trust its own median, else the
 * whole-market median. Nothing here names a protocol: the table is whatever
 * the snapshot's market says.
 */
function categoryMultiples(peers: SnapshotProtocol[], marketMedian: number, model: ModelConstants): CategoryMultiple[] {
  const out: CategoryMultiple[] = [];
  for (const [category, list] of groupByCategory(peers)) {
    const ratios = list.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
    const med = median(ratios);
    const fallback = ratios.length < model.min_peers || med === null;
    const raw = fallback ? marketMedian : med!;
    out.push({
      category,
      multiple: round4(clampMultiple(raw, model)),
      peers: ratios.length,
      fallback,
    });
  }
  return out;
}

/**
 * Calibrate the category multiples and the size tilt from the snapshot's own live-token
 * protocols: the median market-cap-to-TVL ratio per category, with the whole-market
 * median as fallback, plus the one pooled power-law fit. Nothing here names a
 * protocol: the table is whatever the snapshot's market says.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const peers = livePeers(snapshot);
  const sorted = [...peers].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const allRatios = peers.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const marketMedian = median(allRatios) ?? 0.2;
  const fit = fitPowerLaw(peers);
  const medianTvl = median(peers.map((p) => p.tvl_usd).sort((a, b) => a - b)) ?? 1;
  const powerLaw: PowerLawFit = {
    slope: round4(fit.slope),
    slope_damped: round4(1 + (fit.slope - 1) * model.size_damping),
    r2: round4(fit.r2),
    peers: peers.length,
    median_tvl_usd: medianTvl,
  };
  return {
    market_median: round4(marketMedian),
    live_count: peers.length,
    categories: categoryMultiples(peers, marketMedian, model),
    power_law: powerLaw,
    category_basis: buildCategoryBasis(peers),
    tilt_validation: validateModel(sorted, model, snapshot.as_of),
  };
}

/** The calibrated multiple for one protocol's category, from the calibration table. */
function multipleFor(p: SnapshotProtocol, calibration: Calibration, model: ModelConstants): CategoryMultiple {
  const found = calibration.categories.find((c) => c.category === (p.category ?? 'Uncategorised'));
  if (found !== undefined) return found;
  return {
    category: p.category ?? 'Uncategorised',
    multiple: round4(clampMultiple(calibration.market_median, model)),
    peers: 0,
    fallback: true,
  };
}

/** Everything one fold's training peers calibrate, once, for all five rules. */
interface FoldContext {
  catMedian: (c: string | null) => number;
  pooledFit: PowerLawFit;
  perCatFit: (c: string | null) => { slopeDamped: number; refTvl: number };
  withinSlopeDamped: number;
  model: ModelConstants;
}

/** The error lists one 5-fold run accumulates, for the summary below. */
interface ValidationAccumulators {
  rules: string[];
  errs: number[][];
  logErrs: number[][];
  pairs: [number, number][][];
  within: number[];
  wins: number[];
  fullFlatErrs: number[];
  fullFlatLog: number[];
  fullFlatPairs: [number, number][];
  fullFlatWithin: number;
  byCatErr: Map<string, { flat: number[]; sized: number[]; wins: number }>;
  peerCount: number;
}

/**
 * The 5-fold check's summary tables from the accumulators: the per-rule
 * candidate rows, the per-category tilt table, and the flat-vs-sized headline
 * numbers for the multiple alone and for the full formula. Kept apart from the
 * fold loop so the loop stays about pricing held-out tokens and this stays
 * about turning error lists into the numbers the model tab prints. The trimmed
 * mean sets aside the worst tenth of errors, so one wild token cannot decide
 * it; the log mean prices an overestimate and an underestimate symmetrically.
 */
function summariseValidation(a: ValidationAccumulators): TiltValidation {
  const trimmedMean = (es: number[]): number => {
    const s = [...es].sort((x, y) => x - y).slice(0, Math.floor(es.length * 0.9));
    return round4((s.reduce((sum, e) => sum + e, 0) / s.length) * 100);
  };
  const logMean = (es: number[]): number => round4(es.reduce((sum, e) => sum + e, 0) / es.length);
  const spearOf = (ps: [number, number][]): number =>
    round4(spearman(ps.map(([v]) => v), ps.map(([, t]) => t)));
  const withinPct = (n: number): number => round4((n / a.peerCount) * 100);
  const byCategory: CategoryValidation[] = [...a.byCatErr.entries()]
    .sort((x, y) => (x[0] < y[0] ? -1 : 1))
    .map(([category, e]) => ({
      category,
      peers: e.flat.length,
      median_ape_flat_pct: medianPct(e.flat),
      median_ape_sized_pct: medianPct(e.sized),
      sized_wins: e.wins,
    }));
  const candidates: CandidateCheck[] = a.rules.map((candidate, ri) => ({
    candidate,
    median_ape_pct: medianPct(a.errs[ri]!),
    trimmed_mean_ape_pct: trimmedMean(a.errs[ri]!),
    wins: a.wins[ri]!,
    peers: a.peerCount,
    spearman: spearOf(a.pairs[ri]!),
    log_mae: logMean(a.logErrs[ri]!),
    within2x_pct: withinPct(a.within[ri]!),
  }));
  return {
    median_ape_flat_pct: medianPct(a.errs[0]!),
    median_ape_sized_pct: medianPct(a.errs[1]!),
    trimmed_mean_ape_flat_pct: trimmedMean(a.errs[0]!),
    trimmed_mean_ape_sized_pct: trimmedMean(a.errs[1]!),
    sized_wins: a.wins[1]!,
    peers: a.peerCount,
    spearman_flat: spearOf(a.pairs[0]!),
    spearman_sized: spearOf(a.pairs[1]!),
    log_mae_flat: logMean(a.logErrs[0]!),
    log_mae_sized: logMean(a.logErrs[1]!),
    within2x_flat_pct: withinPct(a.within[0]!),
    within2x_sized_pct: withinPct(a.within[1]!),
    full_median_ape_flat_pct: medianPct(a.fullFlatErrs),
    full_median_ape_sized_pct: medianPct(a.errs[4]!),
    full_trimmed_mean_ape_flat_pct: trimmedMean(a.fullFlatErrs),
    full_trimmed_mean_ape_sized_pct: trimmedMean(a.errs[4]!),
    full_sized_wins: a.wins[4]!,
    full_spearman_flat: spearOf(a.fullFlatPairs),
    full_spearman_sized: spearOf(a.pairs[4]!),
    full_log_mae_flat: logMean(a.fullFlatLog),
    full_log_mae_sized: logMean(a.logErrs[4]!),
    full_within2x_flat_pct: withinPct(a.fullFlatWithin),
    full_within2x_sized_pct: withinPct(a.within[4]!),
    by_category: byCategory,
    candidates,
  };
}

/**
 * The 5-fold check: each live token is priced five ways — flat category median,
 * pooled tilt, per-category tilt, within-category slope, and the shipped full
 * formula — each fold fitting on the other four fifths, exactly as the board fits
 * them, so the check measures the models that could actually ship. Two scorings
 * are recorded: the multiple alone (flat vs sized) and the full formula (flat
 * median with the multipliers vs the shipped formula), so the growth, maturity and
 * chain weights are measured rather than asserted. Deterministic (folds by sorted
 * slug), so the numbers are the same on every run.
 */
export function validateModel(sortedPeers: SnapshotProtocol[], model: ModelConstants = MODEL, asOf: string = ''): TiltValidation {
  // Accumulators per rule: [flat, pooled, percat, within, full]. Wins are counted
  // against the flat median for every rule, one baseline for the whole table.
  const RULES = ['flat category median', 'pooled size tilt', 'per-category tilt', 'within-category slope', 'full formula (shipped)'];
  const errs: number[][] = RULES.map(() => []);
  const logErrs: number[][] = RULES.map(() => []);
  const pairs: [number, number][][] = RULES.map(() => []);
  const within: number[] = RULES.map(() => 0);
  const wins: number[] = RULES.map(() => 0);
  const fullFlatErrs: number[] = [];
  const fullFlatLog: number[] = [];
  const fullFlatPairs: [number, number][] = [];
  let fullFlatWithin = 0;
  const byCatErr = new Map<string, { flat: number[]; sized: number[]; wins: number }>();

  const buildCtx = (train: SnapshotProtocol[]): FoldContext => {
    const trainRatios = train.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
    const trainMedian = median(trainRatios) ?? 0.2;
    const byCat = new Map(groupByCategory(train));
    const catMedian = (c: string | null): number => {
      const v = byCat.get(c ?? 'Uncategorised');
      if (v !== undefined && v.length >= model.min_peers) {
        const m = median(v.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b));
        if (m !== null) return clampMultiple(m, model);
      }
      return clampMultiple(trainMedian, model);
    };
    const fit = fitPowerLaw(train);
    const medTvl = median(train.map((p) => p.tvl_usd).sort((a, b) => a - b)) ?? 1;
    const pooledFit: PowerLawFit = {
      slope: fit.slope,
      slope_damped: 1 + (fit.slope - 1) * model.size_damping,
      r2: fit.r2,
      peers: train.length,
      median_tvl_usd: medTvl,
    };
    const perCatFit = (c: string | null): { slopeDamped: number; refTvl: number } => {
      const list = byCat.get(c ?? 'Uncategorised');
      // A category's own fit is measured against its own median live TVL, so the
      // tilt is 1 for a typical protocol in that category, not in the market.
      const refTvl = list !== undefined ? median(list.map((p) => p.tvl_usd).sort((a, b) => a - b)) ?? medTvl : medTvl;
      if (list !== undefined && list.length >= 5) {
        const cf = fitPowerLaw(list);
        if (cf.slope > 0 && cf.r2 >= 0) return { slopeDamped: 1 + (cf.slope - 1) * model.size_damping, refTvl };
      }
      return { slopeDamped: pooledFit.slope_damped, refTvl };
    };
    const withinSlopeDamped = 1 + (withinCategorySlope(train) - 1) * model.size_damping;
    return { catMedian, pooledFit, perCatFit, withinSlopeDamped, model };
  };

  const tiltFrom = (tvl: number, slopeDamped: number, refTvl: number, ctx: FoldContext): number => {
    const raw = Math.pow(tvl / refTvl, slopeDamped - 1);
    return Math.min(ctx.model.tilt_cap, Math.max(ctx.model.tilt_floor, raw));
  };

  for (let fold = 0; fold < 5; fold++) {
    const test = sortedPeers.filter((_, i) => i % 5 === fold);
    const train = sortedPeers.filter((_, i) => i % 5 !== fold);
    const ctx = buildCtx(train);
    for (const p of test) {
      const med = ctx.catMedian(p.category);
      const flat = p.tvl_usd * med;
      const pooled = p.tvl_usd * clampMultiple(med * tiltFrom(p.tvl_usd, ctx.pooledFit.slope_damped, ctx.pooledFit.median_tvl_usd, ctx), ctx.model);
      const fc = ctx.perCatFit(p.category);
      const percat = p.tvl_usd * clampMultiple(med * tiltFrom(p.tvl_usd, fc.slopeDamped, fc.refTvl, ctx), ctx.model);
      const withinPred = p.tvl_usd * clampMultiple(med * tiltFrom(p.tvl_usd, ctx.withinSlopeDamped, ctx.pooledFit.median_tvl_usd, ctx), ctx.model);
      const full = fullFormulaValue(p, med, tiltFrom(p.tvl_usd, ctx.pooledFit.slope_damped, ctx.pooledFit.median_tvl_usd, ctx), ctx.model, asOf);
      const fullFlat = fullFormulaValue(p, med, 1, ctx.model, asOf);
      const preds = [flat, pooled, percat, withinPred, full];
      const trueV = p.mcap_usd!;
      preds.forEach((pred, ri) => {
        const e = Math.abs(pred - trueV) / trueV;
        errs[ri]!.push(e);
        logErrs[ri]!.push(Math.abs(Math.log10(pred) - Math.log10(trueV)));
        pairs[ri]!.push([pred, trueV]);
        if (pred >= trueV / 2 && pred <= trueV * 2) within[ri]!++;
        if (ri > 0 && e < Math.abs(flat - trueV) / trueV) wins[ri]!++;
      });
      const eFullFlat = Math.abs(fullFlat - trueV) / trueV;
      fullFlatErrs.push(eFullFlat);
      fullFlatLog.push(Math.abs(Math.log10(fullFlat) - Math.log10(trueV)));
      fullFlatPairs.push([fullFlat, trueV]);
      if (fullFlat >= trueV / 2 && fullFlat <= trueV * 2) fullFlatWithin++;
      // The per-category table tracks the shipped (pooled) tilt against flat.
      const catKey = p.category ?? 'Uncategorised';
      const ce = byCatErr.get(catKey) ?? { flat: [], sized: [], wins: 0 };
      const eFlat = Math.abs(flat - trueV) / trueV;
      const eSized = Math.abs(pooled - trueV) / trueV;
      ce.flat.push(eFlat);
      ce.sized.push(eSized);
      if (eSized < eFlat) ce.wins++;
      byCatErr.set(catKey, ce);
    }
  }

  return summariseValidation({
    rules: RULES,
    errs,
    logErrs,
    pairs,
    within,
    wins,
    fullFlatErrs,
    fullFlatLog,
    fullFlatPairs,
    fullFlatWithin,
    byCatErr,
    peerCount: sortedPeers.length,
  });
}

/** The three weights that tilt a fitted multiple into an implied value. */
export interface Multipliers {
  growthPct: number;
  growth: number;
  maturity: number;
  chain: number;
  age: number | null;
}

/**
 * A protocol's growth, maturity and chain weights from its own record, in one
 * place: the shipped pricing, the full-formula validation and the board all
 * read these three numbers, so a change to a weight lands once instead of in
 * three copies of the same arithmetic. The age is null when the snapshot's
 * as-of date is empty (the validation's flat comparison) or the protocol's
 * listing date is unknown, and the maturity then falls back to the model's
 * unknown-age days — the same fallback every caller used before.
 */
export function multipliersFor(p: SnapshotProtocol, model: ModelConstants, asOf: string = ''): Multipliers {
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0)));
  const growth = 1 + (growthPct / 100) * model.growth_weight;
  const age = asOf === '' ? null : ageDays(asOf, p.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const maturity =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chain = 1 + Math.min(Math.max(p.chains.length - 1, 0), model.chain_max_extra) * model.chain_step;
  return { growthPct, growth, maturity, chain, age };
}

/** A raw multiple held inside the model's floor and cap. */
function clampMultiple(raw: number, model: ModelConstants): number {
  return Math.min(model.multiple_cap, Math.max(model.multiple_floor, raw));
}

/**
 * A protocol's full-formula value from its category median and its size tilt: the
 * shipped pricing, with the growth, maturity and chain weights applied. The age
 * needs the snapshot's as-of date, so callers pass it in.
 */
export function fullFormulaValue(
  p: SnapshotProtocol,
  categoryMultiple: number,
  tilt: number,
  model: ModelConstants,
  asOf: string = '',
): number {
  const fitted = clampMultiple(categoryMultiple * tilt, model);
  const m = multipliersFor(p, model, asOf);
  return Math.max(1, Math.round(p.tvl_usd * fitted * m.growth * m.maturity * m.chain));
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: Calibration,
  model: ModelConstants,
): {
  implied: number;
  multiple: CategoryMultiple;
  tilt: number;
  fitted: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  age: number | null;
} {
  const multiple = multipleFor(protocol, calibration, model);
  const tilt = sizeTilt(protocol.tvl_usd, calibration.power_law, model);
  const fitted = clampMultiple(multiple.multiple * tilt, model);
  const m = multipliersFor(protocol, model, asOf);
  const base = protocol.tvl_usd * fitted;
  const implied = Math.max(1, Math.round(base * m.growth * m.maturity * m.chain));
  return { implied, multiple, tilt, fitted, growthPct: m.growthPct, growthMult: m.growth, maturityMult: m.maturity, chainMult: m.chain, age: m.age };
}

/** Short human signals derived from the protocol's own figures, for badges in the board. */
export function signalsFor(p: SnapshotProtocol, age: number | null): string[] {
  const signals: string[] = [];
  if (p.change_7d !== null && p.change_7d >= 20) signals.push('heating up');
  if (p.change_7d !== null && p.change_7d <= -20) signals.push('cooling off');
  if (age !== null && age < 180) signals.push('young');
  if (age !== null && age < 180 && p.change_7d !== null && p.change_7d >= 20) signals.push('early mover');
  if (age !== null && age >= 730) signals.push('seasoned');
  if (p.chains.length >= 5) signals.push('multi-chain');
  if (p.tvl_usd >= 500_000_000) signals.push('whale TVL');
  return signals;
}

/**
 * The protocols the board ranks: the watchlist first — the floor, every slug it
 * names, even one the snapshot no longer carries — then every other rankable
 * pre-token protocol at any size. No cap on the early radar: a protocol below
 * the floor is no worse a subject, and the radar exists to find it early.
 */
function chooseBoardProtocols(snapshot: Snapshot): SnapshotProtocol[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  return [...chosen.values()];
}

/** One protocol with its priced value, ready to become a board row. */
type ScoredProtocol = ReturnType<typeof impliedValue> & { p: SnapshotProtocol };

/** One scored protocol's board row, at its rank, with the model breakdown attached. */
function toBoardRow(s: ScoredProtocol, rank: number, tiltR2: number): BoardRow {
  return {
    rank,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    signals: signalsFor(s.p, s.age),
    model: {
      category_multiple: s.multiple.multiple,
      multiple_peers: s.multiple.peers,
      multiple_fallback: s.multiple.fallback,
      size_tilt: round4(s.tilt),
      size_tilt_basis: 'pooled — all live-token peers',
      size_tilt_r2: tiltR2,
      fitted_multiple: round4(s.fitted),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const calibration = calibrate(snapshot, model);
  const scored = chooseBoardProtocols(snapshot).map((p) => {
    const v = impliedValue(p, snapshot.as_of, calibration, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => toBoardRow(s, i + 1, calibration.power_law.r2));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 chars. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/**
 * What one transaction costs, in dollars of gas, by chain family: the chain's
 * own fee market, not a flat guess. Ethereum mainnet is an order dearer than
 * an L2 or Solana; a reader farming on Base should not budget mainnet gas.
 * The first family that names the chain wins; anything unlisted costs $3.
 */
const GAS_TIERS: { chains: string[]; gas: string }[] = [
  { chains: ['ethereum'], gas: 'about $12 of gas' },
  { chains: ['solana', 'sui', 'aptos', 'ton', 'near'], gas: 'about $0.10 of gas' },
  {
    chains: [
      'arbitrum', 'optimism', 'base', 'polygon', 'zksync era', 'linea', 'scroll',
      'ink', 'unichain', 'mode', 'blast', 'zora', 'world chain', 'soneium', 'abstract',
    ],
    gas: 'about $0.50 of gas',
  },
  { chains: ['binance', 'avalanche'], gas: 'about $1 of gas' },
  { chains: ['tron'], gas: 'about $2 of gas' },
];

/** What one transaction costs on a chain, in dollars of gas. */
export function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  for (const tier of GAS_TIERS) {
    if (tier.chains.includes(c)) return tier.gas;
  }
  return 'about $3 of gas';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age and its seven-day growth. */
function holdDaysFor(age: number | null, growth: number | null): number {
  let hold: number;
  if (age === null) hold = 45;
  else if (age < 180) hold = 60;
  else if (age < 365) hold = 45;
  else hold = 30;
  if (growth !== null && growth >= 20) hold += 15;
  if (growth !== null && growth <= -20) hold = Math.max(21, hold - 15);
  return hold;
}

/** One category family's three recurring farm actions, as text builders. */
interface FamilyActions {
  test: (category: string) => boolean;
  main: (name: string, capital: number, chain: string) => string;
  second: (name: string, capital: number, chain: string) => string;
  weekly: (name: string, capital: number, chain: string) => string;
}

/**
 * The category families, in the order they are tried — the first family whose
 * test matches the protocol's category wins, so a category that names two
 * families (a staking bridge, say) always takes the earlier one. Each family
 * writes the main position, a second action and the weekly habit for what that
 * kind of protocol actually does. The family comes from the category's words,
 * never the protocol's name.
 */
const ACTION_FAMILIES: FamilyActions[] = [
  {
    test: (c) => c.includes('lend') || c.includes('cdp') || c.includes('collateral'),
    main: (name, capital, chain) =>
      `Lend $${capital} of USDC through ${name} on ${chain} and leave the position open so it is counted in every snapshot.`,
    second: () =>
      `Borrow $20 of USDC against what you lent, pay it back after a week, and take the small loan out again once a month.`,
    weekly: () =>
      `Look at the borrow-to-supply ratio once a week and top up the supply if the position starts drifting toward liquidation.`,
  },
  {
    test: (c) => c.includes('dex') || c.includes('amm') || c.includes('swap'),
    main: (name, capital, chain) =>
      `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} in a narrow range and leave it working.`,
    second: (name, capital, chain) =>
      `Trade $25 through ${name} on ${chain} once a week, switching the pair you trade each time.`,
    weekly: () =>
      `Move the liquidity range once a week so the position stays inside the band where trading actually happens.`,
  },
  {
    test: (c) => c.includes('bridge'),
    main: (name, capital, chain) =>
      `Bridge $${capital} of USDC onto ${chain} through ${name} and put the bridged funds to use in the protocol's app.`,
    second: () =>
      `A week later bridge $25 back the other way, then bridge in again, so the record shows both directions.`,
    weekly: (name, capital, chain) =>
      `Bridge a small amount through ${name} once a week, flipping the direction each time.`,
  },
  {
    test: (c) => c.includes('stak') || c.includes('restak'),
    main: (name, capital, chain) =>
      `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet.`,
    second: () =>
      `Add $25 to the stake once a month and never unstake the whole position in one move.`,
    weekly: () =>
      `Check the staking rewards once a week and restake them instead of letting them sit unclaimed.`,
  },
  {
    test: (c) => c.includes('perpetual') || c.includes('derivative') || c.includes('options'),
    main: (name, capital, chain) =>
      `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small position hedged against the other side.`,
    second: () =>
      `Close and reopen a $25 position once a week, leaving the margin in the account between trades.`,
    weekly: () =>
      `Flatten the position once a week and open a fresh one, so the account shows steady use instead of a single trade.`,
  },
  {
    test: (c) => c.includes('prediction'),
    main: (name, capital, chain) =>
      `Fund $${capital} on ${name} and take one position on a market that settles no sooner than a week out.`,
    second: () =>
      `Place one $10 position a week on a different market, and never chase a market that has already resolved.`,
    weekly: () =>
      `Close or settle one position a week and open the next on a market about something else entirely.`,
  },
  {
    test: (c) => c.includes('curator') || c.includes('allocator') || c.includes('vault'),
    main: (name, capital, chain) =>
      `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares without shuffling them around.`,
    second: () =>
      `Put another $25 into the same vault once a month and read the vault's allocation report each time you do.`,
    weekly: () =>
      `Read the vault's allocation report once a week and note any change of strategy before adding more funds.`,
  },
  {
    test: (c) => c.includes('stable'),
    main: (name, capital, chain) =>
      `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and keep it inside the protocol.`,
    second: (name, capital, chain) =>
      `Swap $25 of the stable asset through ${name} once a week and put the proceeds back into the same position.`,
    weekly: (name, capital, chain) =>
      `Check the peg once a week and swap a small amount through ${name} to keep the position showing activity.`,
  },
  {
    test: (c) => c.includes('rwa'),
    main: (name, capital, chain) =>
      `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it for the full term.`,
    second: () =>
      `Add $25 to the position once a month and keep the holding in the same wallet the whole time.`,
    weekly: () =>
      `Check the yield accrual once a week and write the balance down in the farm log.`,
  },
  {
    test: (c) => c.includes('insurance'),
    main: (name, capital, chain) =>
      `Buy $${capital} of cover from ${name} on ${chain} and keep the policy live for the whole term.`,
    second: () =>
      `Renew or extend the cover by $25 before it lapses, and never file a claim you do not genuinely hold.`,
    weekly: () =>
      `Check the policy's remaining term once a week so it never lapses without you noticing.`,
  },
  {
    test: (c) => c.includes('yield') || c.includes('leveraged farm') || c.includes('aggregator'),
    main: (name, capital, chain) =>
      `Deposit $${capital} of USDC into ${name}'s best-yielding strategy on ${chain} and let it compound.`,
    second: () =>
      `Claim the yield once a month and redeposit it, and move $25 between two of its strategies each quarter.`,
    weekly: () =>
      `Claim the week's yield and put it back into the same strategy, so the compounding never pauses.`,
  },
  {
    test: (c) => c.includes('launchpad'),
    main: (name, capital, chain) =>
      `Stake $${capital} in ${name}'s launch allocation pool on ${chain} and register for the next sale.`,
    second: () =>
      `Finish one launch task a week and keep the stake locked until the sale window closes.`,
    weekly: () =>
      `Do one launch task a week and check the sale calendar for the next window.`,
  },
  {
    test: (c) => c.includes('payment'),
    main: (name, capital, chain) =>
      `Send $${capital} of real payments through ${name} on ${chain} over the next month, split into several small sends.`,
    second: (name, capital, chain) =>
      `Send $25 through ${name} once a week to a different recipient each time.`,
    weekly: (name, capital, chain) =>
      `Send one real payment through ${name} once a week, changing the amount and the recipient.`,
  },
  {
    test: (c) => c.includes('nft') || c.includes('marketplace'),
    main: (name, capital, chain) =>
      `List one item and buy one item worth about $${capital} through ${name} on ${chain}.`,
    second: (name, capital, chain) =>
      `Trade one small item a week on ${name} and use the same wallet for every listing.`,
    weekly: (name, capital, chain) =>
      `List or buy one small item a week on ${name} and keep the same wallet for every trade.`,
  },
  {
    test: (c) => c.includes('privacy'),
    main: (name, capital, chain) =>
      `Move $${capital} through ${name}'s private flow on ${chain} and leave the shielded balance where it is.`,
    second: () =>
      `Make one $25 private transfer a week and never empty the shielded balance in a single move.`,
    weekly: () =>
      `Make one small private transfer a week and keep the shielded balance above half its peak.`,
  },
  {
    test: (c) => c.includes('chain'),
    main: (name, capital, chain) =>
      `Bridge $${capital} to the chain ${name} runs on and use two of its native apps with the same wallet.`,
    second: () =>
      `Transact on the chain once a week, alternating a swap, a stake and a vote.`,
    weekly: () =>
      `Use one native app on the chain each week, alternating a swap, a stake and a vote.`,
  },
];

/**
 * The category family's three recurring actions — the main position, a second
 * action, and the weekly habit — each written for what that kind of protocol
 * actually does. The family comes from the category's words, never the name.
 */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): { main: string; second: string; weekly: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  for (const family of ACTION_FAMILIES) {
    if (family.test(c)) {
      return {
        main: family.main(name, capital, chain),
        second: family.second(name, capital, chain),
        weekly: family.weekly(name, capital, chain),
      };
    }
  }
  return {
    main: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open so it counts in every snapshot.`,
    second: `Use ${name} once a week — a deposit, a swap or a vote — and keep the activity in the same wallet.`,
    weekly: `Do one different qualifying action each week — a deposit, a swap, a vote or a claim — and vary it.`,
  };
}

/** Everything the seven farm steps are built from, computed once per protocol. */
interface FarmPlan {
  gas: string;
  capital: number;
  hold: number;
  holdWhy: string;
  actions: { main: string; second: string; weekly: string };
  young: boolean;
}

/**
 * The farm plan's context: the chain's gas, the position's capital, the hold
 * in days with its reason, the category family's three actions, and whether
 * the protocol is young enough for the claim step's warning. The hold is
 * longer for young and heating-up protocols, shorter for cooling ones.
 */
function farmPlanContext(p: SnapshotProtocol, age: number | null): FarmPlan {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age, p.change_7d);
  const heating = p.change_7d !== null && p.change_7d >= 20;
  const cooling = p.change_7d !== null && p.change_7d <= -20;
  const holdWhy = heating
    ? ` TVL is up ${p.change_7d!.toFixed(1)}% in seven days, so hold through the attention rather than chasing an entry after the spike.`
    : cooling
      ? ` TVL is down ${Math.abs(p.change_7d!).toFixed(1)}% in seven days, so re-check the protocol's TVL every week and leave early if it keeps falling.`
      : '';
  return {
    gas,
    capital,
    hold,
    holdWhy,
    actions: actionsFor(p, capital, chain),
    young: age !== null && age < 180,
  };
}

/** Step 1 — set up a fresh wallet that holds only the farming funds. */
const walletStep = (ctx: FarmPlan): FarmStep => ({
  text: `Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.`,
  cost: `under ${ctx.gas} for the first transaction`,
  time: '5 minutes',
});

/** Step 2 — take the main position in the protocol. */
const mainStep = (ctx: FarmPlan): FarmStep => ({
  text: ctx.actions.main,
  cost: `$${ctx.capital} of capital and ${ctx.gas}`,
  time: '15 minutes to set up',
});

/** Step 3 — a second, different qualifying action. */
const secondStep = (ctx: FarmPlan): FarmStep => ({
  text: ctx.actions.second,
  cost: `${ctx.gas} each time`,
  time: '10 minutes a week',
});

/** Step 4 — the weekly habit that keeps the activity showing. */
const weeklyStep = (ctx: FarmPlan): FarmStep => ({
  text: ctx.actions.weekly,
  cost: `${ctx.gas} a week`,
  time: '10 minutes a week',
});

/** Step 5 — hold long enough for the activity to count in more than one snapshot. */
const holdStep = (ctx: FarmPlan): FarmStep => ({
  text: `Hold the position for at least ${ctx.hold} days so the activity is counted in more than one snapshot.${ctx.holdWhy}`,
  cost: `the $${ctx.capital} stays in the position`,
  time: `${ctx.hold} days`,
});

/**
 * Step 6 — claim only from the protocol's own page. A young protocol's claim
 * page is the one it publishes itself, never a link forwarded to the reader.
 */
const claimStep = (ctx: FarmPlan): FarmStep => ({
  text: ctx.young
    ? `Before you withdraw, open the protocol's own points or rewards page from the link it publishes and claim only there — a young protocol's claim page is the one it publishes itself, never a link forwarded to you.`
    : `Before you withdraw, open the protocol's own points or rewards page from the link it publishes and claim only there.`,
  cost: 'no fee to check, and never pay to claim',
  time: '10 minutes',
});

/** Step 7 — write the farm log, so the position can be repeated or unwound. */
const logStep = (ctx: FarmPlan): FarmStep => ({
  text: `Write the wallet, the dates and every transaction hash in a farm log so you can repeat the $${ctx.capital} position or unwind it.`,
  cost: 'nothing but the log',
  time: '5 minutes',
});

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age, seven-day growth),
 * never from a hand-written list of names. The first step's gas follows the chain's own
 * fee market, the weekly step is the category's own action, and the hold is longer for
 * young and heating-up protocols, shorter for cooling ones.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const ctx = farmPlanContext(p, age);
  return [walletStep(ctx), mainStep(ctx), secondStep(ctx), weeklyStep(ctx), holdStep(ctx), claimStep(ctx), logStep(ctx)];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    signals: row.signals,
    category_multiple: row.model.category_multiple,
    size_tilt: row.model.size_tilt,
    size_tilt_basis: row.model.size_tilt_basis,
    size_tilt_r2: row.model.size_tilt_r2,
    fitted_multiple: row.model.fitted_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const calibration = calibrate(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    calibration,
    watchlist_size: snapshot.watchlist.length,
    watchlist_slugs: [...snapshot.watchlist],
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, fewer than the gate's 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
