# config-diff

Semantic comparison of configuration files across JSON, YAML and `.env`.
It answers three questions:

- **Same service, two environments.** What really differs between `staging.yaml` and `prod.yaml`, ignoring key order, formatting and comments?
- **Cross-format equivalence.** Does `config.json` say the same thing as its `.env` or YAML translation, where `"8080"` and `8080` or `SERVER__PORT` and `server.port` mean the same?
- **Drift against a baseline.** Which keys are missing, extra or of the wrong type compared to a reference config, and should that fail CI?

The same core library powers a CLI and a web page.

## How it works

1. **Parse into a typed tree.** Every value keeps its type, its exact source text and its line and column. So `version: 1.10` is still reported as `1.10`, not `1.1`, and every change points at a line.
2. **Normalize under explicit rules.**
   - **Strict mode** compares types and keys exactly.
   - **Loose mode** folds key spelling, so `maxRetries` matches `MAX_RETRIES`. It also treats `"true"` and `true`, `"30"` and `30`, `"a,b"` and `[a, b]`, and `SERVICES__0__NAME` and `services[0].name` as equal. Each forgiven difference is recorded as *equal after coercion*, never hidden.
3. **Diff the trees.** Array matching is chosen per path:
   - **ordered** detects moves.
   - **set** ignores order.
   - **keyed** matches items by a field, e.g. `services[name=payments].timeout_ms`.
4. **Evaluate a policy.** A policy decides which changes are errors or warnings. The exit code follows from that.
5. **Mask secrets.** Values under keys like `password`, `token` and `api_key`, and credentials inside URLs, are masked in all output. Masked values are still compared.

## CLI

```
npm install
npm run build
node packages/cli/dist/main.js <left> <right> [options]     # Node >= 22.4
```

```
config-diff app.base.json app.prod.yaml --array services=keyed:name
config-diff app.prod.yaml app.prod.env --mode loose -o markdown
config-diff baseline.yaml live.yaml --policy strict-ci --fail-on warn -o github
cat live.json | config-diff baseline.yaml -
```

| Option | Meaning |
|---|---|
| `--mode strict\|loose` | Loose is the default. |
| `--format`, `--left-format`, `--right-format` | Override format detection. |
| `--env-separator __\|none` | Nesting separator for `.env` keys. |
| `--array <pattern>=ordered\|set\|keyed:<field>` | Array matching per path. Repeatable. |
| `--ignore <pattern>` | Skip paths. Repeatable. Patterns support `*`, `**` and `[n]`. |
| `--policy drift\|equivalence\|strict-ci\|file.json` | Map changes to errors and warnings. |
| `--fail-on error\|warn\|any\|never` | Exit 1 threshold. |
| `-o table\|json\|markdown\|github` | Output format. |
| `--show diff\|all` | Include equal rows. |
| `--[no-]mask` | Secret masking. On by default. |

Exit codes: `0` clean, `1` findings at the `--fail-on` level, `2` usage or parse error. Errors are printed as `file:line:col: message`.

## Web

```
npm run dev        # builds core, then starts Next on http://localhost:3000
```

One page with two panes. Paste or drop a file into each, pick strict or loose and a scenario preset, and read the change list. Clicking a row jumps to the line in both panes. Comparison runs in the browser; nothing is uploaded.

## Layout

| Path | Contents |
|---|---|
| `packages/core` | Parsers, normalization, diff, policy, renderers. Pure TypeScript, no DOM or Node APIs. |
| `packages/cli` | The `config-diff` command, bundled with tsup. |
| `apps/web` | Next.js 16 app. |
| `packages/core/test/fixtures` | Realistic, edge-case and malformed inputs. Their README states the expected result for each file. |

## Development

```
npm test           # core unit and golden tests, CLI smoke tests, web view helpers
npm run typecheck
npm run lint
npm run build
```
