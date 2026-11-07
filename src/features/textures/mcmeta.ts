// .png.mcmeta animation helpers. Pure (no 'vscode'): shared with the webviews and unit tested.

export interface AnimationFrameEntry {
  index: number;
  time?: number;
}

export interface AnimationSettings {
  frametime: number;
  interpolate: boolean;
  /** Explicit frame order (undefined = 0..count-1). */
  frames?: AnimationFrameEntry[];
  width?: number;
  height?: number;
}

/** The "animation" section of a parsed .mcmeta (or undefined when the file has none). */
export function parseAnimation(mcmeta: unknown): AnimationSettings | undefined {
  const anim = (mcmeta as any)?.animation;
  if (!anim || typeof anim !== 'object') return undefined;
  const frametime = typeof anim.frametime === 'number' && anim.frametime > 0 ? Math.round(anim.frametime) : 1;
  let frames: AnimationFrameEntry[] | undefined;
  if (Array.isArray(anim.frames)) {
    frames = [];
    for (const f of anim.frames) {
      if (typeof f === 'number') frames.push({ index: f });
      else if (f && typeof f === 'object' && typeof f.index === 'number')
        frames.push(typeof f.time === 'number' ? { index: f.index, time: f.time } : { index: f.index });
    }
  }
  return {
    frametime,
    interpolate: anim.interpolate === true,
    frames,
    width: typeof anim.width === 'number' ? anim.width : undefined,
    height: typeof anim.height === 'number' ? anim.height : undefined,
  };
}

/**
 * Write animation settings into an mcmeta object, keeping other sections (e.g. "texture", "gui", "villager").
 * Defaults are omitted (frametime 1, interpolate false) to match vanilla files.
 */
export function writeAnimation(mcmeta: unknown, a: AnimationSettings | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = mcmeta && typeof mcmeta === 'object' ? { ...(mcmeta as object) } : {};
  if (!a) {
    delete out.animation;
    return out;
  }
  const anim: Record<string, unknown> = { ...((out.animation as object) ?? {}) };
  delete anim.frametime;
  delete anim.interpolate;
  delete anim.frames;
  delete anim.width;
  delete anim.height;
  if (a.interpolate) anim.interpolate = true;
  if (a.width) anim.width = a.width;
  if (a.height) anim.height = a.height;
  if (a.frametime && a.frametime !== 1) anim.frametime = a.frametime;
  if (a.frames?.length) anim.frames = a.frames.map((f) => (f.time !== undefined ? { index: f.index, time: f.time } : f.index));
  out.animation = anim;
  return out;
}

export interface TimelineStep {
  frame: number;
  /** Duration in game ticks (1 tick = 50 ms). */
  ticks: number;
}

/** Playback order with durations for `count` frames. Invalid frame indices are dropped. */
export function animationTimeline(a: AnimationSettings | undefined, count: number): TimelineStep[] {
  const ft = a?.frametime ?? 1;
  const list = a?.frames?.length ? a.frames : Array.from({ length: count }, (_, i) => ({ index: i }) as AnimationFrameEntry);
  return list.filter((f) => f.index >= 0 && f.index < count).map((f) => ({ frame: f.index, ticks: Math.max(1, f.time ?? ft) }));
}

/** Total animation length in ticks. */
export function animationLength(a: AnimationSettings | undefined, count: number): number {
  return animationTimeline(a, count).reduce((s, x) => s + x.ticks, 0);
}

/** Step + progress (0..1 inside the step, for interpolation) at a given tick. */
export function stepAt(timeline: TimelineStep[], tick: number): { step: number; progress: number } {
  const total = timeline.reduce((s, x) => s + x.ticks, 0);
  if (!total) return { step: 0, progress: 0 };
  let t = ((tick % total) + total) % total;
  for (let i = 0; i < timeline.length; i++) {
    if (t < timeline[i].ticks) return { step: i, progress: t / timeline[i].ticks };
    t -= timeline[i].ticks;
  }
  return { step: timeline.length - 1, progress: 0 };
}

/** "0, 1, 2:10, 1" → frames list (index or index:time). Returns undefined for an empty string. */
export function parseFrameList(text: string): AnimationFrameEntry[] | undefined {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (!parts.length) return undefined;
  const out: AnimationFrameEntry[] = [];
  for (const p of parts) {
    const m = /^(\d+)(?:[:x*](\d+))?$/.exec(p);
    if (!m) throw new Error(`Invalid frame "${p}"`);
    out.push(m[2] !== undefined ? { index: Number(m[1]), time: Number(m[2]) } : { index: Number(m[1]) });
  }
  return out;
}

export function formatFrameList(frames: AnimationFrameEntry[] | undefined): string {
  return (frames ?? []).map((f) => (f.time !== undefined ? `${f.index}:${f.time}` : String(f.index))).join(', ');
}

/** After removing frame `removed`, fix explicit frame indices. */
export function framesAfterRemoval(frames: AnimationFrameEntry[] | undefined, removed: number): AnimationFrameEntry[] | undefined {
  if (!frames) return undefined;
  const out = frames.filter((f) => f.index !== removed).map((f) => (f.index > removed ? { ...f, index: f.index - 1 } : f));
  return out.length ? out : undefined;
}
