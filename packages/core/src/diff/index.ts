/**
 * Recursive tree diff producing a flat Change[]. One record per leaf comparison (scalars, empty
 * containers), one record per whole added/removed/ignored/type-changed subtree.
 * Arrays are delegated to arrays.ts according to the strategy rules.
 */
import { compareScalars } from '../normalize/coerce.js';
import { canonicalKey } from '../normalize/keys.js';
import { compilePattern, matchPath, type PathMatcher } from '../normalize/pathPattern.js';
import type {
  ArrayStrategy,
  Change,
  ChangeKind,
  Coercion,
  Diagnostic,
  Node,
  NormalizeOptions,
  ObjectEntry,
  ObjectNode,
  PathSegment,
  ScalarNode,
} from '../types.js';
import { diffArrays, type Item } from './arrays.js';
import { fingerprint, indexKeyItems } from './fingerprint.js';
import { pathToText, type DisplaySegment } from './path.js';

export interface DiffResult {
  changes: Change[];
  diagnostics: Diagnostic[];
}

/** Where a comparison happens: left-based canonical path, right-side path, and display segments. */
export interface Ctx {
  path: PathSegment[];
  rightPath: PathSegment[];
  display: DisplaySegment[];
}

export function childCtx(ctx: Ctx, left: PathSegment, right: PathSegment, display: DisplaySegment = left): Ctx {
  return { path: [...ctx.path, left], rightPath: [...ctx.rightPath, right], display: [...ctx.display, display] };
}

export class Differ {
  readonly changes: Change[] = [];
  readonly diagnostics: Diagnostic[] = [];
  private readonly ignore: PathMatcher[];
  private readonly arrayRules: Array<{ matcher: PathMatcher; strategy: ArrayStrategy }>;
  private readonly fpCache = new WeakMap<Node, string>();

  constructor(readonly opts: NormalizeOptions) {
    this.ignore = opts.ignore.map(compilePattern);
    this.arrayRules = opts.arrays.rules.map((r) => ({ matcher: compilePattern(r.pattern), strategy: r.strategy }));
  }

  fp(node: Node): string {
    return fingerprint(node, this.opts, this.fpCache);
  }

  canon(key: string): string {
    return canonicalKey(key, this.opts.keys);
  }

  strategyFor(path: PathSegment[]): ArrayStrategy {
    for (const r of this.arrayRules) if (matchPath(r.matcher, path, this.opts.keys)) return r.strategy;
    return this.opts.arrays.default;
  }

  private isIgnored(path: PathSegment[]): boolean {
    return this.ignore.some((m) => matchPath(m, path, this.opts.keys));
  }

  private samePath(a: PathSegment[], b: PathSegment[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((s, i) => {
      const t = b[i]!;
      if (typeof s === 'number' || typeof t === 'number') return s === t;
      return this.canon(s) === this.canon(t);
    });
  }

  emit(kind: ChangeKind, ctx: Ctx, left: Node | undefined, right: Node | undefined, coercion?: Coercion): void {
    const c: Change = { kind, path: ctx.path, pathText: pathToText(ctx.display) };
    if (left) c.left = left;
    if (right) c.right = right;
    if (kind === 'moved' || (left && right && !this.samePath(ctx.path, ctx.rightPath))) {
      c.leftPath = ctx.path;
      c.rightPath = ctx.rightPath;
    } else if (!left && right && !this.samePath(ctx.path, ctx.rightPath)) {
      c.rightPath = ctx.rightPath;
    }
    if (coercion) c.coercion = coercion;
    this.changes.push(c);
  }

  removed(node: Node, ctx: Ctx): void {
    this.emit(this.isIgnored(ctx.path) ? 'ignored' : 'removed', ctx, node, undefined);
  }

  added(node: Node, ctx: Ctx): void {
    this.emit(this.isIgnored(ctx.path) ? 'ignored' : 'added', ctx, undefined, node);
  }

  warn(code: Diagnostic['code'], message: string, loc: Diagnostic['loc']): void {
    this.diagnostics.push({ severity: 'warning', code, message, loc });
  }

  /** True when l and r compare as equal (possibly coerced). Leaves no records behind. */
  equivalent(l: Node, r: Node, ctx: Ctx): boolean {
    const nc = this.changes.length;
    const nd = this.diagnostics.length;
    this.visit(l, r, ctx);
    const ok = this.changes.slice(nc).every((c) => c.kind === 'equal' || c.kind === 'equal-coerced' || c.kind === 'ignored');
    this.changes.length = nc;
    this.diagnostics.length = nd;
    return ok;
  }

  visit(l: Node, r: Node, ctx: Ctx): void {
    if (this.isIgnored(ctx.path)) return this.emit('ignored', ctx, l, r);

    if (l.kind === 'scalar' && r.kind === 'scalar') {
      const res = compareScalars(l, r, this.opts);
      return this.emit(res.kind, ctx, l, r, res.coercion);
    }
    if (l.kind === 'object' && r.kind === 'object') return this.objects(l, r, ctx);
    if (l.kind === 'array' && r.kind === 'array') {
      return diffArrays(this, toItems(l.items), toItems(r.items), ctx, l, r);
    }

    // Kind mismatch.
    if (this.opts.coerce.commaLists && this.commaList(l, r, ctx)) return;
    if (this.opts.coerce.indexKeyObjects) {
      const li = l.kind === 'array' ? l.items : indexKeyItems(l);
      const ri = r.kind === 'array' ? r.items : indexKeyItems(r);
      if (li && ri) return diffArrays(this, toItems(li), toItems(ri), ctx, l, r);
    }
    this.emit('type-changed', ctx, l, r);
  }

  /** string vs array of scalars: split on ',' and compare element-wise. Returns false when not applicable. */
  private commaList(l: Node, r: Node, ctx: Ctx): boolean {
    const isList = (n: Node): n is Node & { kind: 'array'; items: ScalarNode[] } =>
      n.kind === 'array' && n.items.every((i) => i.kind === 'scalar');
    const isStr = (n: Node): n is ScalarNode => n.kind === 'scalar' && n.type === 'string';
    let str: ScalarNode;
    let list: ScalarNode[];
    if (isStr(l) && isList(r)) [str, list] = [l, r.items];
    else if (isList(l) && isStr(r)) [str, list] = [r, l.items];
    else return false;

    const parts = (str.value as string).split(',').map((p) => p.trim());
    if (parts[parts.length - 1] === '') parts.pop();
    let equal = parts.length === list.length;
    for (let i = 0; equal && i < parts.length; i++) {
      const part: ScalarNode = { kind: 'scalar', type: 'string', value: parts[i]!, raw: parts[i]!, quoted: true, loc: null };
      const item = list[i]!;
      const res = str === l ? compareScalars(part, item, this.opts) : compareScalars(item, part, this.opts);
      equal = res.kind === 'equal' || res.kind === 'equal-coerced';
    }
    const coercion: Coercion = { from: str === l ? 'string' : 'array', to: str === l ? 'array' : 'string', rule: 'commaLists' };
    this.emit(equal ? 'equal-coerced' : 'changed', ctx, l, r, coercion);
    return true;
  }

  /** Canonical key -> entry, in source order; colliding keys warn and the last one wins. */
  private indexEntries(node: ObjectNode, ctx: Ctx, side: 'left' | 'right'): Map<string, ObjectEntry> {
    const map = new Map<string, ObjectEntry>();
    for (const e of node.entries) {
      const k = this.canon(e.key);
      const prev = map.get(k);
      if (prev) {
        this.warn(
          'KEY_COLLISION',
          `Keys ${JSON.stringify(prev.sourceKey)} and ${JSON.stringify(e.sourceKey)} at ${pathToText(ctx.display)} (${side}) are the same key after folding; the last one wins`,
          e.keyLoc ?? e.value.loc,
        );
        map.delete(k);
      }
      map.set(k, e);
    }
    return map;
  }

  private objects(l: ObjectNode, r: ObjectNode, ctx: Ctx): void {
    if (l.entries.length === 0 && r.entries.length === 0) return this.emit('equal', ctx, l, r);
    const L = this.indexEntries(l, ctx, 'left');
    const R = this.indexEntries(r, ctx, 'right');
    for (const [k, le] of L) {
      const re = R.get(k);
      if (re) this.visit(le.value, re.value, childCtx(ctx, le.sourceKey, re.sourceKey));
      else this.removed(le.value, childCtx(ctx, le.sourceKey, le.sourceKey));
    }
    for (const [k, re] of R) {
      if (!L.has(k)) this.added(re.value, childCtx(ctx, re.sourceKey, re.sourceKey));
    }
  }
}

function toItems(nodes: Node[]): Item[] {
  return nodes.map((node, index) => ({ node, index }));
}

export function diffNodes(left: Node, right: Node, opts: NormalizeOptions): DiffResult {
  const d = new Differ(opts);
  d.visit(left, right, { path: [], rightPath: [], display: [] });
  return { changes: d.changes, diagnostics: d.diagnostics };
}
