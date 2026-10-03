# Test fixtures

Fixtures for the config comparison engine. Each entry states what the file
exercises and what a correct tool must report. "Loose" and "strict" refer to the
planned comparison modes (loose = cross-format coercion and key-style folding on;
strict = exact types and keys).

Nothing in `realistic/` or `edge/` is secret: all keys, passwords and tokens are
invented placeholders.

## Original fixtures (root of this directory)

| File | Purpose |
|---|---|
| `config.json`, `config.yaml` | Same small config in two formats. Must be equal in both modes. |
| `config_reordered.yaml` | Same content, different key order, with a comment. Equal in both modes. |
| `config_modified.json` | `version`, `settings.debug`, `settings.timeout` changed; `features[2]` removed. |
| `env.txt` | Flat env translation with `DEBUG`/`TIMEOUT`/`RETRY` not nested under `settings`. Shows the limits of leaf-name matching; `realistic/app.prod.env` uses explicit `__` nesting instead. |

## `realistic/`: one service, three environments, three formats

| File | Purpose |
|---|---|
| `app.base.json` | Baseline. ~70 leaves: nested objects, arrays of objects (`services`), empty string / array / object, `null`, floats, exponent, unicode, a literal dotted key `legacy.setting`, numeric-looking strings (`"0755"`, `"02134"`, `"1.10"`), secrets. |
| `app.staging.yaml` | Semantically identical to the baseline. Reordered keys, anchors + alias, a `<<` merge key, YAML 1.1 booleans (`yes`/`no`/`on`/`off`), unquoted `1.10` / `2024-01-15` / `0755` / `02134` / `1e3`, block scalar. Expected loose: equal, with coercion rows for the bool spellings and a warning if the parser does not apply merge keys. Expected strict: type mismatches on `version`, `file_mode`, `zip_code`, `server.tls`, `features.*`. |
| `app.prod.yaml` | Production. The header comment lists every intended change by category: changed, type-changed, removed, added, reordered, array shrink. Drift policy against the baseline must flag the removed keys as errors and additions as warnings. |
| `app.prod.env` | Env translation of `app.prod.yaml` using `__` nesting and `SERVICES__0__NAME` index keys. Includes `export`, single and double quotes, an inline comment after a single-quoted value, an empty value, comma lists, and a block of flat keys (`DEBUG`, `NODE_ENV`, `PORT`, `DATABASE_URL`, `AWS_SECRET_ACCESS_KEY`, `JWT_SECRET`) that must be reported as extra and masked. Loose vs `app.prod.yaml`: equal apart from the extra block and (depending on the array option) the comma lists. |

## `edge/`: valid inputs that break naive implementations

| File | Purpose |
|---|---|
| `types.yaml` / `types.json` | 55 matching keys covering every scalar typing trap: underscores and hex/octal ints, big ints beyond 2^53, exponent floats, `.inf`/`.nan`, `-0`, `yes`/`on`/`y`, `~`/empty/`"null"`, version-like `1.10`, dates, sexagesimal-looking `12:30:45`, leading-zero zip, quoting styles, block scalars, numeric and boolean keys, a literal dotted key, anchors, aliases, merge key, empty containers, flow collections. The YAML comments record what js-yaml 5.4.2 actually produces and what the comparison should report. |
| `parser-dependent.yaml` / `.json` | `!!binary`, `!!set`, `!!omap`, a custom `!mytag`, and a complex sequence key. js-yaml 5 rejects these outright. Expected: parse with `UNKNOWN_TAG` warnings and keep the raw scalar; never throw. |
| `env-tricky.env` | Every dotenv quoting rule: single/double/backtick quotes, escaped quotes, `#` inside and outside quotes, inline comments, `\n` escapes, multi-line quoted values including a PEM key, `export`, indentation, lowercase/dotted/dashed keys, spaces around `=`, `__` nesting with leading/trailing/triple separators, values containing `=`, URLs, JSON and YAML-looking values, comma lists, booleans/numbers as strings, `${VAR}` interpolation left literal, Windows paths, a duplicate key. |
| `falsy.a.json` / `falsy.b.yaml` | `0`, `false`, `""`, `null`, `{}`, `[]` at top level, nested, and inside an array. Side b swaps each falsy value for a different falsy value (all `type-changed`), keeps the nested block identical (all `equal`), and has keys present on only one side whose value is null/0/false (must be `removed`/`added`, never hidden). |
| `servers.a.yaml` / `servers.b.yaml` | Arrays of objects for the three array strategies. `servers` reordered with one field change, one removal and one addition: keyed-by-`name` must give three precise rows, positional diffing gives a mess. `unkeyed` has no key field, `duplicates` has two items with the same key, `tags` has a repeated element (`[a,a,b,c]` vs `[a,b,c]` is one removal under multiset semantics), `ordered_steps` is a pure reorder. |
| `collisions.a.json` / `collisions.b.env` | Literal key `"a.b"` next to nested `a.b`; `maxRetries` / `max_retries` / `max-retries` / `MAX_RETRIES` in one object (style folding collision); `Timeout` vs `timeout`; index-key objects that are and are not arrays (`sparse`, `not_an_array`); keys with spaces, brackets, quotes, empty key, unicode; `__proto__` and `constructor` as data. The env side adds `A=` after `A__B=`, a scalar colliding with an object path. |
| `duplicate-keys.json` | Duplicate keys in JSON. `JSON.parse` accepts this silently (last wins). Expected: parse, last wins, `DUPLICATE_KEY` warning with line numbers. |
| `jsonc.json` | Comments and trailing commas (tsconfig style). Strict JSON rejects it. Expected: parse with a `NON_STANDARD_JSON` warning. |
| `multi-doc.yaml` | Three-document stream; the third document is empty. Expected: compare document 1 with a `MULTI_DOCUMENT` warning; selectable by option. |
| `empty.json` | Zero bytes. Expected: a clear "empty document" parse error, not a crash and not an empty diff. |
| `comments-only.yaml` | Only comments and blank lines. js-yaml throws "expected a document". Expected: treat as empty document (null root) with a warning. |
| `scalar-root.yaml` | Root is a plain string, not a mapping. Comparing against an object must yield one `type-changed` at the root path. |
| `array-root.json` | Root is an array with mixed element types. |
| `deep-nesting.json` | 60 levels deep. Recursion and path rendering must cope. |
| `large-array.a.json` / `large-array.b.json` | 1500 objects each. Side b removes item 1200, flips one boolean, appends one item, and moves one item from index 900 to index 3. Must finish quickly and report exactly four differences (plus a move) under the ordered strategy. |
| `bom.json` | UTF-8 byte order mark before `{`. Must be stripped; line numbers unaffected. |
| `crlf.env`, `crlf.yaml` | Windows line endings. Values must not carry a trailing `\r`. Protected by `.gitattributes`. |

## `malformed/`: inputs that must fail cleanly

Each must produce a parse error with a line and column where possible, exit
code 2 on the CLI, and an inline message in the web UI. None may crash or hang.

| File | Defect |
|---|---|
| `trailing-comma.json` | Trailing commas (valid only as JSONC). |
| `unquoted-keys.json` | Unquoted key, single-quoted string, line comment. |
| `truncated.json` | File ends mid-object (upload cut off). |
| `two-roots.json` | Two concatenated JSON documents. |
| `trailing-garbage.json` | Valid object followed by text. |
| `html-error-page.json` | An HTML 502 page saved with a `.json` extension. Format detection must not guess YAML and "succeed". |
| `tab-indent.yaml` | Tabs used for indentation. |
| `bad-indent.yaml` | Inconsistent indentation inside a mapping. |
| `unclosed-flow.yaml` | `[` never closed. |
| `unknown-anchor.yaml` | Alias to an anchor that does not exist. |
| `duplicate-keys.yaml` | Duplicate mapping keys at two levels. js-yaml throws; the `yaml` package can be told to warn instead. Decide and test. |
| `mixed-seq-map.yaml` | A sequence entry inside a mapping. |
| `unterminated-string.yaml` | Double-quoted scalar never closed. |
| `bad-lines.env` | Line without `=`, line starting with `=`, key starting with a digit, key with spaces, stray quote in value. Expected: warnings per bad line, valid lines still parsed. |
| `unterminated-quote.env` | Double-quoted value never closed: swallows the rest of the file. |
| `unterminated-single-quote.env` | Same with single quotes. |
| `junk-after-quote.env` | Text after a closing quote. |
| `bom.env` | BOM before the first key: `KEY` must not become `﻿KEY`. |
| `mixed-formats.txt` | YAML, JSON and env lines in one file. Format detection must pick one and fail loudly, not partially succeed. |
| `binary-garbage.bin` | Non-UTF-8 bytes. Must be rejected before parsing. |

## Verified so far

With the parsers currently in the repo (`JSON.parse`, js-yaml 5.4.2): every
file in `realistic/` and `edge/` that is meant to be valid parses, except
`comments-only.yaml` and `parser-dependent.yaml`, whose documented purpose is
exactly that they do not. Every file in `malformed/` is rejected. The env files
have not been machine-verified because no env parser is kept.
