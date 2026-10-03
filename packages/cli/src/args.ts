/** Command-line parsing for config-diff. Pure: no I/O, throws UsageError on bad input. */
import { parseArgs } from 'node:util';
import type { ArrayStrategy, DeepPartial, Format, NormalizeOptions, ParseOptions } from '@config-diff/core';

export class UsageError extends Error {
  override readonly name = 'UsageError';
}

export type Output = 'table' | 'json' | 'markdown' | 'github';
export type FailOn = 'error' | 'warn' | 'any' | 'never';

export interface CliArgs {
  help: boolean;
  version: boolean;
  left: string;
  right: string;
  leftFormat?: Format;
  rightFormat?: Format;
  options: DeepPartial<NormalizeOptions>;
  /** Preset name, or a path to a JSON policy file (resolved by main). */
  policy: string;
  parse: Pick<ParseOptions, 'env' | 'yaml'>;
  output: Output;
  show: 'diff' | 'all';
  failOn: FailOn;
  color: boolean | undefined;
}

const FORMATS = ['json', 'yaml', 'env'] as const;

function oneOf<T extends string>(flag: string, value: string | undefined, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new UsageError(`--${flag} must be one of ${allowed.join(', ')} (got "${value}")`);
}

function parseStrategy(spec: string): { pattern: string; strategy: ArrayStrategy } {
  const eq = spec.lastIndexOf('=');
  if (eq <= 0) throw new UsageError(`--array expects <pattern>=ordered|set|keyed:<field> (got "${spec}")`);
  const pattern = spec.slice(0, eq);
  const s = spec.slice(eq + 1);
  if (s === 'ordered' || s === 'set') return { pattern, strategy: s };
  if (s.startsWith('keyed:') && s.length > 'keyed:'.length) return { pattern, strategy: { keyedBy: s.slice('keyed:'.length) } };
  throw new UsageError(`--array strategy must be ordered, set or keyed:<field> (got "${s}")`);
}

export function parseCli(argv: string[]): CliArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      allowNegative: true,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        mode: { type: 'string', short: 'm' },
        format: { type: 'string' },
        'left-format': { type: 'string' },
        'right-format': { type: 'string' },
        'env-separator': { type: 'string' },
        array: { type: 'string', multiple: true },
        ignore: { type: 'string', multiple: true },
        mask: { type: 'boolean' },
        'mask-pattern': { type: 'string' },
        policy: { type: 'string', short: 'p' },
        'yaml-doc': { type: 'string' },
        output: { type: 'string', short: 'o' },
        show: { type: 'string' },
        'fail-on': { type: 'string' },
        color: { type: 'boolean' },
      },
    });
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }
  const v = parsed.values;
  const help = v.help ?? false;
  const version = v.version ?? false;
  const [left, right, ...extra] = parsed.positionals;
  if (!help && !version) {
    if (left === undefined || right === undefined) throw new UsageError('expected two files: config-diff <left> <right>');
    if (extra.length > 0) throw new UsageError(`unexpected argument "${extra[0]}"`);
    if (left === '-' && right === '-') throw new UsageError('only one side can read from stdin');
  }

  const both = oneOf('format', v.format, FORMATS);
  const mode = oneOf('mode', v.mode, ['strict', 'loose'] as const);

  const options: DeepPartial<NormalizeOptions> = {};
  if (mode) options.mode = mode;
  if (v.array?.length) options.arrays = { rules: v.array.map(parseStrategy) };
  if (v.ignore?.length) options.ignore = v.ignore;
  if (v.mask !== undefined || v['mask-pattern'] !== undefined) {
    options.mask = {};
    if (v.mask !== undefined) options.mask.enabled = v.mask;
    if (v['mask-pattern'] !== undefined) options.mask.keyPattern = v['mask-pattern'];
  }

  const parse: Pick<ParseOptions, 'env' | 'yaml'> = {};
  const sep = v['env-separator'];
  if (sep !== undefined) parse.env = { separator: sep === 'none' || sep === '' ? null : sep };
  const doc = v['yaml-doc'];
  if (doc !== undefined) {
    if (doc === 'error') parse.yaml = { document: 'error' };
    else if (/^\d+$/.test(doc)) parse.yaml = { document: Number(doc) };
    else throw new UsageError(`--yaml-doc must be a 0-based index or "error" (got "${doc}")`);
  }

  return {
    help,
    version,
    left: left ?? '',
    right: right ?? '',
    leftFormat: oneOf('left-format', v['left-format'], FORMATS) ?? both,
    rightFormat: oneOf('right-format', v['right-format'], FORMATS) ?? both,
    options,
    policy: v.policy ?? 'drift',
    parse,
    output: oneOf('output', v.output, ['table', 'json', 'markdown', 'github'] as const) ?? 'table',
    show: oneOf('show', v.show, ['diff', 'all'] as const) ?? 'diff',
    failOn: oneOf('fail-on', v['fail-on'], ['error', 'warn', 'any', 'never'] as const) ?? 'error',
    color: v.color,
  };
}

export const HELP = `config-diff - semantic diff for JSON, YAML and .env configs

Usage:
  config-diff <left> <right> [options]      use "-" for stdin on one side

Comparison:
  -m, --mode strict|loose        loose (default) coerces "true"/true, "30"/30, comma lists,
                                 and folds key case and style (maxRetries = MAX_RETRIES)
      --format json|yaml|env     force the format of both sides (default: detect)
      --left-format, --right-format
      --env-separator <s>|none   nesting separator for .env keys (default "__")
      --array <pattern>=ordered|set|keyed:<field>
                                 array matching per path, repeatable
                                 e.g. --array services=keyed:name --array "**.tags=set"
      --ignore <pattern>         ignore a path, repeatable (e.g. "metadata.**")
      --[no-]mask                mask secret-looking keys in output (default on)
      --mask-pattern <regex>     override the secret key pattern
      --yaml-doc <n>|error       which document of a YAML stream to use (default 0)

Policy and exit code:
  -p, --policy drift|equivalence|strict-ci|<file.json>
                                 how changes map to errors and warnings (default drift)
      --fail-on error|warn|any|never
                                 exit 1 when findings reach this level (default error)

Output:
  -o, --output table|json|markdown|github   (default table)
      --show diff|all            include equal rows (default diff)
      --[no-]color               ANSI colors (default: when stdout is a TTY)

Exit codes: 0 no findings at the fail-on level, 1 findings, 2 usage or parse error.
`;
