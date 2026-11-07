// Fuzzy matching for "did you mean" suggestions. Pure module.

/** Levenshtein distance with an optional early-exit bound (returns bound+1 when exceeded). */
export function levenshtein(a: string, b: string, bound = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > bound) return bound + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > bound) return bound + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

const splitId = (id: string): [string, string] => {
  const i = id.indexOf(':');
  return i >= 0 ? [id.slice(0, i), id.slice(i + 1)] : ['minecraft', id];
};

/**
 * Closest candidates to `value` ("ns:path"), best first. Considers the path alone (namespace typos and
 * missing namespaces are cheap) and simple word-order / plural mistakes.
 */
export function closestMatches(value: string, candidates: Iterable<string>, limit = 3): string[] {
  const [ns, path] = splitId(value);
  const maxDist = Math.max(2, Math.floor(path.length * 0.4));
  const scored: [number, string][] = [];
  const words = new Set(path.split(/[_/]/).filter(Boolean));
  for (const c of candidates) {
    const [cns, cpath] = splitId(c);
    const nsPenalty = cns === ns ? 0 : 1.5;
    let d = levenshtein(path, cpath, maxDist);
    if (d > maxDist) {
      // Same words in another order ("block_ruby" vs "ruby_block") or a missing folder prefix.
      const cw = cpath.split(/[_/]/).filter(Boolean);
      if (cw.length === words.size && cw.every((w) => words.has(w))) d = 1;
      else if (cpath.endsWith(`/${path}`) || path.endsWith(`/${cpath}`)) d = 1.5;
      else continue;
    }
    scored.push([d + nsPenalty, c]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length || a[1].localeCompare(b[1]));
  return scored.slice(0, limit).map((s) => s[1]);
}
