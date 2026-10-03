/** Smoke tests that execute the built bin (run `npm run build` in packages/cli first). */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const BIN = fileURLToPath(new URL('../dist/main.js', import.meta.url));
const F = fileURLToPath(new URL('../../core/test/fixtures/', import.meta.url));

function run(args: string[], input?: string) {
  const r = spawnSync(process.execPath, [BIN, ...args], { input, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe('config-diff CLI', () => {
  it('is built', () => {
    expect(existsSync(BIN)).toBe(true);
  });

  it('prints help and version', () => {
    expect(run(['--help'])).toMatchObject({ code: 0 });
    expect(run(['--help']).out).toContain('Usage:');
    expect(run(['--version']).out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exits 2 on usage errors', () => {
    expect(run([]).code).toBe(2);
    expect(run(['a.json']).code).toBe(2);
    expect(run([`${F}config.json`, `${F}config.yaml`, '--mode', 'fuzzy']).code).toBe(2);
    const missing = run(['nope.json', `${F}config.json`]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain('nope.json: no such file');
  });

  it('reports identical configs across formats and key order', () => {
    const r = run([`${F}config.json`, `${F}config_reordered.yaml`, '--mode', 'strict']);
    expect(r.code).toBe(0);
    expect(r.out.toLowerCase()).toContain('identical');
  });

  it('fails on drift and reports each change', () => {
    const r = run([`${F}config.json`, `${F}config_modified.json`]);
    expect(r.code).toBe(1);
    for (const p of ['version', 'settings.debug', 'settings.timeout', 'features[2]']) expect(r.out).toContain(p);
    expect(run([`${F}config.json`, `${F}config_modified.json`, '--fail-on', 'never']).code).toBe(0);
  });

  it('emits parseable JSON', () => {
    const r = run([`${F}config.json`, `${F}config_modified.json`, '-o', 'json']);
    const report = JSON.parse(r.out) as { identical: boolean; summary: { changed: number } };
    expect(report.identical).toBe(false);
    expect(report.summary.changed).toBeGreaterThanOrEqual(3);
  });

  it('emits markdown and github annotations', () => {
    expect(run([`${F}config.json`, `${F}config_modified.json`, '-o', 'markdown']).out).toContain('| Path |');
    expect(run([`${F}config.json`, `${F}config_modified.json`, '-o', 'github']).out).toMatch(/^::(error|warning) /m);
  });

  it('reads one side from stdin', () => {
    const r = run(['-', `${F}config.json`, '--left-format', 'yaml', '--fail-on', 'warn'], 'app_name: config-diff-app\n');
    expect(r.code).toBe(1);
    expect(r.out).toContain('settings');
  });

  it('matches keyed arrays precisely', () => {
    const r = run([`${F}edge/servers.a.yaml`, `${F}edge/servers.b.yaml`, '--array', 'servers=keyed:name', '--show', 'diff']);
    expect(r.out).toContain('servers[name=web].port');
    expect(r.out).toContain('servers[name=worker]');
    expect(r.out).toContain('servers[name=db]');
  });

  it('masks secrets in output', () => {
    const r = run([`${F}realistic/app.base.json`, `${F}realistic/app.prod.yaml`, '--show', 'all']);
    expect(r.out).not.toContain('Pr0d-P@ssw0rd!');
    expect(r.out).not.toContain('s3cr3t-staging-pw');
    const unmasked = run([`${F}realistic/app.base.json`, `${F}realistic/app.prod.yaml`, '--no-mask']);
    expect(unmasked.out).toContain('Pr0d-P@ssw0rd!');
  });

  it('exits 2 with file:line:col on malformed input', () => {
    const r = run([`${F}malformed/truncated.json`, `${F}config.json`]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/truncated\.json:\d+:\d+: /);
  });

  it('compares a nested .env against YAML in loose mode', () => {
    const r = run([`${F}realistic/app.prod.yaml`, `${F}realistic/app.prod.env`, '--array', 'services=keyed:name', '-o', 'json']);
    const report = JSON.parse(r.out) as { summary: { removed: number; changed: number; typeChanged: number; added: number } };
    expect(report.summary.removed).toBe(2); // tags: [] and metadata: {} cannot be written in .env
    expect(report.summary.changed).toBe(0);
    expect(report.summary.typeChanged).toBe(1); // maintenance_window: null vs empty string
    // DEBUG, NODE_ENV, PORT, DATABASE_URL, AWS_SECRET_ACCESS_KEY, JWT_SECRET
    expect(report.summary.added).toBe(6);
  });
});
