// Minimal JSON Schema draft-07 validator used by the schema tests (no dependencies).
// Supports: $ref (local + relative file refs), type, enum, const, required, properties, patternProperties,
// additionalProperties, propertyNames, min/maxProperties, items (schema or tuple), min/maxItems, min/maxLength,
// pattern, minimum/maximum/exclusiveMinimum/exclusiveMaximum, allOf, anyOf, oneOf, not, if/then/else.
import fs from 'node:fs';
import path from 'node:path';

export type Schema = Record<string, any> | boolean;

export interface ValidationError {
  path: string;
  message: string;
}

export class SchemaStore {
  private cache = new Map<string, any>();
  constructor(readonly dir: string) {}

  load(file: string): any {
    const full = path.resolve(this.dir, file);
    let s = this.cache.get(full);
    if (!s) {
      s = JSON.parse(fs.readFileSync(full, 'utf8'));
      this.cache.set(full, s);
    }
    return s;
  }

  /** Resolve a $ref relative to `baseFile`. Returns the target schema and the file it lives in. */
  resolve(refStr: string, baseFile: string): { schema: Schema; file: string } {
    const [filePart, pointer = ''] = refStr.split('#');
    const file = filePart ? path.join(path.dirname(baseFile), filePart) : baseFile;
    let node = this.load(file);
    for (const seg of pointer.split('/').filter(Boolean)) {
      const key = decodeURIComponent(seg.replace(/~1/g, '/').replace(/~0/g, '~'));
      node = node?.[key];
      if (node === undefined) throw new Error(`Unresolvable $ref ${refStr} from ${baseFile}`);
    }
    return { schema: node, file };
  }
}

const typeOf = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v;

function matchesType(v: unknown, t: string): boolean {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return actual === t;
}

const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const regexCache = new Map<string, RegExp>();
const re = (p: string) => {
  let r = regexCache.get(p);
  if (!r) regexCache.set(p, (r = new RegExp(p, 'u')));
  return r;
};

export function validate(store: SchemaStore, schema: Schema, value: unknown, file: string, at = '$'): ValidationError[] {
  if (schema === true) return [];
  if (schema === false) return [{ path: at, message: 'false schema' }];
  const s = schema as Record<string, any>;
  const errors: ValidationError[] = [];
  const err = (message: string, p = at) => errors.push({ path: p, message });

  if (s.$ref) {
    const r = store.resolve(s.$ref, file);
    errors.push(...validate(store, r.schema, value, r.file, at));
  }
  if (s.type !== undefined) {
    const types: string[] = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => matchesType(value, t))) err(`expected ${types.join('|')}, got ${typeOf(value)}`);
  }
  if (s.enum && !s.enum.some((e: unknown) => deepEqual(e, value))) err(`not in enum (${JSON.stringify(value)})`);
  if ('const' in s && !deepEqual(s.const, value)) err(`expected const ${JSON.stringify(s.const)}`);

  if (typeof value === 'string') {
    if (s.pattern && !re(s.pattern).test(value)) err(`"${value}" does not match ${s.pattern}`);
    if (s.minLength !== undefined && [...value].length < s.minLength) err('too short');
    if (s.maxLength !== undefined && [...value].length > s.maxLength) err('too long');
  }
  if (typeof value === 'number') {
    if (s.minimum !== undefined && value < s.minimum) err(`< minimum ${s.minimum}`);
    if (s.maximum !== undefined && value > s.maximum) err(`> maximum ${s.maximum}`);
    if (s.exclusiveMinimum !== undefined && value <= s.exclusiveMinimum) err(`<= exclusiveMinimum`);
    if (s.exclusiveMaximum !== undefined && value >= s.exclusiveMaximum) err(`>= exclusiveMaximum`);
  }
  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems) err(`fewer than ${s.minItems} items`);
    if (s.maxItems !== undefined && value.length > s.maxItems) err(`more than ${s.maxItems} items`);
    if (Array.isArray(s.items)) {
      s.items.forEach((it: Schema, i: number) => i < value.length && errors.push(...validate(store, it, value[i], file, `${at}[${i}]`)));
      if (s.additionalItems !== undefined)
        for (let i = s.items.length; i < value.length; i++) errors.push(...validate(store, s.additionalItems, value[i], file, `${at}[${i}]`));
    } else if (s.items !== undefined) {
      value.forEach((v, i) => errors.push(...validate(store, s.items, v, file, `${at}[${i}]`)));
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o);
    for (const r of s.required ?? []) if (!(r in o)) err(`missing required "${r}"`);
    if (s.minProperties !== undefined && keys.length < s.minProperties) err('too few properties');
    if (s.maxProperties !== undefined && keys.length > s.maxProperties) err('too many properties');
    for (const k of keys) {
      const p = `${at}.${k}`;
      let matched = false;
      if (s.properties && k in s.properties) {
        matched = true;
        errors.push(...validate(store, s.properties[k], o[k], file, p));
      }
      for (const [pat, ps] of Object.entries<Schema>(s.patternProperties ?? {})) {
        if (re(pat).test(k)) {
          matched = true;
          errors.push(...validate(store, ps, o[k], file, p));
        }
      }
      if (!matched && s.additionalProperties !== undefined) errors.push(...validate(store, s.additionalProperties, o[k], file, p));
      if (s.propertyNames !== undefined) {
        const e = validate(store, s.propertyNames, k, file, p);
        if (e.length) err(`invalid property name "${k}"`, p);
      }
    }
  }
  for (const sub of s.allOf ?? []) errors.push(...validate(store, sub, value, file, at));
  if (s.anyOf) {
    const results = s.anyOf.map((sub: Schema) => validate(store, sub, value, file, at));
    if (!results.some((r: ValidationError[]) => r.length === 0)) {
      const best = results.reduce((a: ValidationError[], b: ValidationError[]) => (b.length < a.length ? b : a));
      err(`no anyOf branch matched; closest: ${best.map((e: ValidationError) => `${e.path}: ${e.message}`).join('; ')}`);
    }
  }
  if (s.oneOf) {
    const ok = s.oneOf.filter((sub: Schema) => validate(store, sub, value, file, at).length === 0).length;
    if (ok !== 1) err(`oneOf matched ${ok} branches`);
  }
  if (s.not !== undefined && validate(store, s.not, value, file, at).length === 0) err('matches "not" schema');
  if (s.if !== undefined) {
    const pass = validate(store, s.if, value, file, at).length === 0;
    if (pass && s.then !== undefined) errors.push(...validate(store, s.then, value, file, at));
    if (!pass && s.else !== undefined) errors.push(...validate(store, s.else, value, file, at));
  }
  return errors;
}

/** Walks a schema tree and returns every $ref that can't be resolved. */
export function findBrokenRefs(store: SchemaStore, file: string): string[] {
  const broken: string[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (typeof n.$ref === 'string') {
      try {
        store.resolve(n.$ref, path.resolve(store.dir, file));
      } catch (e) {
        broken.push(`${file}: ${n.$ref}`);
      }
    }
    for (const v of Object.values(n)) walk(v);
  };
  walk(store.load(file));
  return broken;
}
