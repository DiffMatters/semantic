/** config-diff CLI entry point: read files, call core.compare, render, set the exit code. */
import { readFile } from 'node:fs/promises';
import {
  compare,
  exitCode,
  OptionsError,
  ParseError,
  toGithubAnnotations,
  toJson,
  toMarkdown,
  toTable,
  type Policy,
  type Report,
} from '@config-diff/core';
import { HELP, parseCli, UsageError, type CliArgs } from './args.js';

declare const __VERSION__: string;
const PRESETS = new Set(['drift', 'equivalence', 'strict-ci']);

async function readSide(path: string): Promise<string> {
  if (path === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  }
  try {
    return await readFile(path, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new UsageError(code === 'ENOENT' ? `${path}: no such file` : `${path}: ${(e as Error).message}`);
  }
}

async function loadPolicy(spec: string): Promise<'drift' | 'equivalence' | 'strict-ci' | Partial<Policy>> {
  if (PRESETS.has(spec)) return spec as 'drift' | 'equivalence' | 'strict-ci';
  const text = await readSide(spec);
  try {
    return JSON.parse(text) as Partial<Policy>;
  } catch (e) {
    throw new UsageError(`${spec}: policy file is not valid JSON (${(e as Error).message})`);
  }
}

function render(report: Report, args: CliArgs): string {
  switch (args.output) {
    case 'json':
      return toJson(report, { pretty: true });
    case 'markdown':
      return toMarkdown(report, { show: args.show });
    case 'github':
      return toGithubAnnotations(report);
    case 'table':
      return toTable(report, {
        show: args.show,
        color: args.color ?? (process.stdout.isTTY === true && !process.env.NO_COLOR),
        width: process.stdout.columns,
      });
  }
}

function printDiagnostics(report: Report): void {
  for (const side of [report.left, report.right]) {
    for (const d of side.diagnostics) {
      const where = [side.name ?? '<input>', d.loc?.line, d.loc?.col].filter((p) => p !== undefined).join(':');
      process.stderr.write(`${where}: ${d.severity}: ${d.message} [${d.code}]\n`);
    }
  }
  for (const d of report.diagnostics) {
    const line = d.loc ? ` (line ${d.loc.line})` : '';
    process.stderr.write(`comparison: ${d.severity}: ${d.message}${line} [${d.code}]\n`);
  }
}

export async function run(argv: string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseCli(argv);
    if (args.help) {
      process.stdout.write(HELP);
      return 0;
    }
    if (args.version) {
      process.stdout.write(`${typeof __VERSION__ === 'string' ? __VERSION__ : 'dev'}\n`);
      return 0;
    }
    const [leftText, rightText, policy] = await Promise.all([readSide(args.left), readSide(args.right), loadPolicy(args.policy)]);
    const report = compare({
      left: { text: leftText, format: args.leftFormat, name: args.left === '-' ? '<stdin>' : args.left },
      right: { text: rightText, format: args.rightFormat, name: args.right === '-' ? '<stdin>' : args.right },
      options: args.options,
      policy,
      parse: args.parse,
    });
    if (args.output !== 'json') printDiagnostics(report);
    const out = render(report, args);
    if (out) process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
    return exitCode(report, args.failOn);
  } catch (e) {
    if (e instanceof ParseError) {
      process.stderr.write(`${e.toString()}\n`);
      return 2;
    }
    if (e instanceof UsageError || e instanceof OptionsError) {
      process.stderr.write(`config-diff: ${e.message}\nRun "config-diff --help" for usage.\n`);
      return 2;
    }
    throw e;
  }
}

run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`config-diff: internal error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exitCode = 2;
  },
);
