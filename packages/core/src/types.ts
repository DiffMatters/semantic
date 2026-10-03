/**
 * Core contract shared by parsers, normalizer, diff engine, policy and renderers.
 * Everything here is plain data so a Report can be serialized and sent anywhere.
 */

export type Format = 'json' | 'yaml' | 'env';
export const FORMATS: readonly Format[] = ['json', 'yaml', 'env'];

/** Source position. line/col are 1-based; offset is a 0-based index into Document.source. */
export interface Loc {
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  offset: number;
  length: number;
}

export type ScalarType = 'string' | 'number' | 'boolean' | 'null';
export type ScalarValue = string | number | boolean | null;

interface NodeBase {
  /** null for synthesized nodes (for example env nesting intermediates). */
  loc: Loc | null;
  /** Exact source slice for this node; '' when synthesized. */
  raw: string;
}

export interface ObjectEntry {
  /** Canonical key used for matching. Equals sourceKey until the normalizer folds it. */
  key: string;
  /** The key exactly as written in the source. */
  sourceKey: string;
  keyLoc: Loc | null;
  value: Node;
}

export interface ObjectNode extends NodeBase {
  kind: 'object';
  /** Source order is preserved. Keys are unique after parsing (last wins, with a diagnostic). */
  entries: ObjectEntry[];
}

export interface ArrayNode extends NodeBase {
  kind: 'array';
  items: Node[];
}

export interface ScalarNode extends NodeBase {
  kind: 'scalar';
  type: ScalarType;
  /** Parsed value. Non-finite YAML numbers (.inf, .nan) are numbers here; raw keeps the text. */
  value: ScalarValue;
  /** True when the source quoted the value (JSON strings, YAML quoted or block scalars, env quotes). */
  quoted: boolean;
}

export type Node = ObjectNode | ArrayNode | ScalarNode;
export type NodeKind = Node['kind'];

export type DiagnosticCode =
  | 'DUPLICATE_KEY'
  | 'KEY_COLLISION'
  | 'MULTI_DOCUMENT'
  | 'UNKNOWN_TAG'
  | 'MALFORMED_LINE'
  | 'NON_STANDARD_JSON'
  | 'MERGE_KEY'
  | 'EMPTY_DOCUMENT'
  | 'EMPTY_SEGMENT'
  | 'LCS_FALLBACK'
  | 'YAML_WARNING';

export interface Diagnostic {
  severity: 'warning' | 'error';
  code: DiagnosticCode;
  message: string;
  loc: Loc | null;
}

export interface Document {
  format: Format;
  name?: string;
  source: string;
  root: Node;
  diagnostics: Diagnostic[];
  /** YAML streams: number of documents found in the source. */
  documentCount?: number;
}

export interface ParseOptions {
  /** Omit to auto-detect from name and content. */
  format?: Format;
  name?: string;
  env?: {
    /** Key separator that creates nesting. Default '__'. null disables nesting. */
    separator?: string | null;
  };
  yaml?: {
    /** Which document of a multi-document stream to use (0-based), or 'error' to refuse streams. Default 0. */
    document?: number | 'error';
    /** Apply YAML 1.1 `<<` merge keys. Default true. */
    merge?: boolean;
  };
}

export type ArrayStrategy = 'ordered' | 'set' | { keyedBy: string };

export interface NormalizeOptions {
  mode: 'strict' | 'loose';
  keys: {
    caseInsensitive: boolean;
    /** Treat snake_case, camelCase, kebab-case and SCREAMING_CASE spellings as the same key. */
    styleInsensitive: boolean;
  };
  coerce: {
    /** "true"/"false" (any case) equals a boolean. */
    booleans: boolean;
    /** A numeric string without a leading zero equals a number. */
    numbers: boolean;
    /** "null" or "~" equals null. */
    nulls: boolean;
    /** "" equals null. */
    emptyStringIsNull: boolean;
    /** "a,b,c" equals an array of scalars. */
    commaLists: boolean;
    /** An object whose keys are exactly "0".."n-1" equals an array. */
    indexKeyObjects: boolean;
    /** yes/no/on/off equal booleans. */
    legacyYamlBooleans: boolean;
  };
  arrays: {
    default: ArrayStrategy;
    /** First matching pattern wins. Patterns use the path pattern syntax (see pathPattern.ts). */
    rules: Array<{ pattern: string; strategy: ArrayStrategy }>;
  };
  /** Path patterns whose subtrees are reported as 'ignored'. */
  ignore: string[];
  mask: {
    enabled: boolean;
    /** Any path segment (object key) matching this masks the value. Stored as source so options stay serializable. */
    keyPattern: string;
    replacement: string;
  };
}

export type PathSegment = string | number;

export type ChangeKind =
  | 'added'
  | 'removed'
  | 'changed'
  | 'type-changed'
  | 'moved'
  | 'equal'
  | 'equal-coerced'
  | 'ignored';

export interface Coercion {
  from: ScalarType | 'array' | 'object';
  to: ScalarType | 'array' | 'object';
  /** Which NormalizeOptions.coerce rule (or 'numeric', 'raw') made the values equal. */
  rule: string;
}

export interface Change {
  kind: ChangeKind;
  /** Canonical path. For arrays, the left index when a left node exists, otherwise the right index. */
  path: PathSegment[];
  /** Human-readable path: settings.timeout, features[2], servers[name=web].port, ["a.b"]. */
  pathText: string;
  left?: Node;
  right?: Node;
  /** Set when the left/right location differs from path (moved items, set and keyed arrays). */
  leftPath?: PathSegment[];
  rightPath?: PathSegment[];
  coercion?: Coercion;
  masked?: boolean;
}

export type Severity = 'error' | 'warn' | 'ignore';

export interface PolicyLevels {
  /** 'removed': present in left (baseline), absent in right. */
  missingKeys: Severity;
  /** 'added': absent in left, present in right. */
  extraKeys: Severity;
  typeMismatch: Severity;
  valueChange: Severity;
  reorder: Severity;
  coerced: Severity;
}

export interface Policy extends PolicyLevels {
  /** Per-path overrides; first matching pattern wins. */
  rules: Array<{ pattern: string; override: Partial<PolicyLevels> }>;
}

export type FindingCode =
  | 'MISSING_KEY'
  | 'EXTRA_KEY'
  | 'TYPE_MISMATCH'
  | 'VALUE_CHANGE'
  | 'REORDER'
  | 'COERCED';

export interface Finding {
  severity: 'error' | 'warn';
  code: FindingCode;
  change: Change;
  message: string;
}

export interface Summary {
  /** Number of leaf comparisons (scalars and empty containers) plus container add/remove records. */
  total: number;
  added: number;
  removed: number;
  changed: number;
  typeChanged: number;
  moved: number;
  equal: number;
  equalCoerced: number;
  ignored: number;
  errors: number;
  warnings: number;
}

export type DocumentInfo = Omit<Document, 'root' | 'source'>;

export interface Report {
  left: DocumentInfo;
  right: DocumentInfo;
  options: NormalizeOptions;
  policy: Policy;
  changes: Change[];
  findings: Finding[];
  summary: Summary;
  /** No added/removed/changed/type-changed/moved changes. Coerced equality still counts as identical. */
  identical: boolean;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer _U> ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};
