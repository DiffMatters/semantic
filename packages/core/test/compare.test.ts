/** End-to-end tests of compare() on the realistic fixtures: the three target scenarios. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compare, exitCode, type CompareSide, type Report } from '../src/index.js';

const dir = fileURLToPath(new URL('./fixtures/', import.meta.url));
const side = (rel: string): CompareSide => ({ text: readFileSync(dir + rel, 'utf8'), name: rel });

const DIFF_KINDS = new Set(['added', 'removed', 'changed', 'type-changed', 'moved']);
const diffs = (r: Report) => r.changes.filter((c) => DIFF_KINDS.has(c.kind));
const byPath = (r: Report) => new Map(r.changes.map((c) => [c.pathText, c]));
const kindOf = (r: Report, p: string) => byPath(r).get(p)?.kind;

describe('original fixtures', () => {
  it('same config in JSON and reordered YAML is identical even in strict mode', () => {
    const r = compare({ left: side('config.json'), right: side('config_reordered.yaml'), options: { mode: 'strict' } });
    expect(diffs(r)).toEqual([]);
    expect(r.identical).toBe(true);
    expect(r.summary.equal).toBeGreaterThan(0);
  });

  it('modified config reports exactly the four changes', () => {
    const r = compare({ left: side('config.json'), right: side('config_modified.json') });
    expect(diffs(r).map((c) => `${c.kind} ${c.pathText}`).sort()).toEqual(
      ['changed settings.debug', 'changed settings.timeout', 'changed version', 'removed features[2]'].sort(),
    );
    expect(exitCode(r, 'error')).toBe(1); // a removed key is an error under the drift policy
  });
});

describe('scenario 1: same service, two environments', () => {
  it('base JSON and staging YAML are equal in loose mode apart from the anchor holder', () => {
    const r = compare({ left: side('realistic/app.base.json'), right: side('realistic/app.staging.yaml') });
    expect(diffs(r).map((c) => `${c.kind} ${c.pathText}`)).toEqual(['added defaults']);
    for (const p of ['version', 'server.tls', 'server.cors.enabled', 'features.new_checkout', 'features.beta_search', 'file_mode', 'zip_code']) {
      expect(kindOf(r, p), p).toBe('equal-coerced');
    }
    expect(kindOf(r, 'database.pool.min')).toBe('equal'); // merge key applied
    expect(kindOf(r, 'notes')).toBe('equal'); // block scalar vs escaped string
    expect(kindOf(r, 'scale.scale_factor')).toBe('equal'); // 1e3 vs 1e3
    expect(exitCode(r, 'error')).toBe(0);
  });

  it('strict mode surfaces every YAML typing difference', () => {
    const r = compare({ left: side('realistic/app.base.json'), right: side('realistic/app.staging.yaml'), options: { mode: 'strict' } });
    for (const p of ['version', 'server.tls', 'features.new_checkout', 'file_mode', 'zip_code']) {
      expect(kindOf(r, p), p).toBe('type-changed');
    }
  });

  it('base vs prod reports the documented drift', () => {
    const r = compare({
      left: side('realistic/app.base.json'),
      right: side('realistic/app.prod.yaml'),
      options: { arrays: { rules: [{ pattern: 'services', strategy: { keyedBy: 'name' } }] } },
    });
    const k = (p: string) => kindOf(r, p);
    expect(k('environment')).toBe('changed');
    expect(k('logging.file')).toBe('removed');
    expect(k('features.beta_search')).toBe('removed');
    expect(k('redis.ttl_s')).toBe('removed');
    expect(k('["legacy.setting"]')).toBe('removed');
    expect(k('server.cors.max_age_s')).toBe('added');
    expect(k('features.ai_recs')).toBe('added');
    expect(k('features.dark_mode')).toBe('type-changed');
    expect(k('maintenance_window')).toBe('type-changed');
    expect(k('server.port')).toBe('equal-coerced'); // 8080 vs "8080" forgiven in loose mode
    expect(k('services[name=payments].timeout_ms')).toBe('changed');
    expect(k('services[name=notifications]')).toBe('removed');
    expect(k('services[name=search]')).toBe('added');
    expect(k('services[name=inventory].retries')).toBe('equal');
    // passwords and API keys still diff, but never leak
    const pw = byPath(r).get('database.password');
    expect(pw?.kind).toBe('changed');
    expect(pw?.masked).toBe(true);
    expect(JSON.stringify(r)).not.toContain('Pr0d-P@ssw0rd!');
    expect(exitCode(r, 'error')).toBe(1);
  });
});

describe('scenario 2: cross-format equivalence', () => {
  it('prod YAML and prod .env agree in loose mode except for env-only keys and absent empties', () => {
    const r = compare({
      left: side('realistic/app.prod.yaml'),
      right: side('realistic/app.prod.env'),
      options: { arrays: { rules: [{ pattern: 'services', strategy: { keyedBy: 'name' } }] } },
    });
    const got = diffs(r).map((c) => `${c.kind} ${c.pathText}`).sort();
    expect(got).toEqual(
      [
        'added DEBUG',
        'added NODE_ENV',
        'added PORT',
        'added DATABASE_URL',
        'added AWS_SECRET_ACCESS_KEY',
        'added JWT_SECRET',
        // .env cannot express these:
        'removed tags',
        'removed metadata',
        'type-changed maintenance_window',
      ].sort(),
    );
    expect(kindOf(r, 'server.cors.allowed_origins')).toBe('equal-coerced'); // comma list
    expect(kindOf(r, 'server.port')).toBe('equal'); // both sides are strings
  });

  it('emptyStringIsNull forgives the empty env value', () => {
    const r = compare({
      left: side('realistic/app.prod.yaml'),
      right: side('realistic/app.prod.env'),
      options: { coerce: { emptyStringIsNull: true } },
    });
    expect(kindOf(r, 'maintenance_window')).toBe('equal-coerced');
  });

  it('strict mode refuses to match env keys to structured keys', () => {
    const r = compare({ left: side('realistic/app.prod.yaml'), right: side('realistic/app.prod.env'), options: { mode: 'strict' } });
    expect(kindOf(r, 'server')).toBe('removed');
    expect(kindOf(r, 'SERVER')).toBe('added');
  });
});

describe('scenario 3: drift against a baseline', () => {
  it('policy levels change errors and exit codes, not the changes', () => {
    const args = { left: side('config.json'), right: side('config_modified.json') } as const;
    const drift = compare({ ...args, policy: 'drift' });
    const relaxed = compare({ ...args, policy: { missingKeys: 'warn', valueChange: 'ignore' } });
    expect(drift.changes).toEqual(relaxed.changes);
    expect(drift.summary.errors).toBe(1);
    expect(relaxed.summary.errors).toBe(0);
    expect(exitCode(relaxed, 'error')).toBe(0);
    expect(exitCode(relaxed, 'warn')).toBe(1);
  });

  it('per-path rules override the preset', () => {
    const r = compare({
      left: side('config.json'),
      right: side('config_modified.json'),
      policy: { rules: [{ pattern: 'features', override: { missingKeys: 'ignore' } }, { pattern: 'features.**', override: { missingKeys: 'ignore' } }] },
    });
    expect(r.summary.errors).toBe(0);
  });
});

describe('arrays', () => {
  it('large arrays with a move, removal, flip and append diff quickly', () => {
    const t = performance.now();
    const r = compare({
      left: side('edge/large-array.a.json'),
      right: side('edge/large-array.b.json'),
      options: { arrays: { rules: [{ pattern: 'items', strategy: { keyedBy: 'id' } }] } },
    });
    expect(performance.now() - t).toBeLessThan(2000);
    const got = diffs(r).map((c) => `${c.kind} ${c.pathText}`);
    expect(got).toContain('removed items[id=1200]');
    expect(got).toContain('added items[id=1500]');
    expect(got).toContain('changed items[id=17].enabled');
    expect(got).toHaveLength(3); // keyed matching makes the move invisible
  });

  it('servers fixture: keyed vs ordered', () => {
    const keyed = compare({
      left: side('edge/servers.a.yaml'),
      right: side('edge/servers.b.yaml'),
      options: { arrays: { rules: [{ pattern: 'servers', strategy: { keyedBy: 'name' } }] } },
    });
    expect(kindOf(keyed, 'servers[name=web].port')).toBe('changed');
    expect(kindOf(keyed, 'servers[name=worker]')).toBe('removed');
    expect(kindOf(keyed, 'servers[name=db]')).toBe('added');
    const set = compare({
      left: side('edge/servers.a.yaml'),
      right: side('edge/servers.b.yaml'),
      options: { arrays: { rules: [{ pattern: 'tags', strategy: 'set' }, { pattern: 'ordered_steps', strategy: 'set' }] } },
    });
    expect(diffs(set).filter((c) => c.pathText.startsWith('tags'))).toHaveLength(1);
    expect(diffs(set).filter((c) => c.pathText.startsWith('ordered_steps'))).toHaveLength(0);
  });
});

describe('falsy values', () => {
  it('never confuses falsy with missing', () => {
    const r = compare({ left: side('edge/falsy.a.json'), right: side('edge/falsy.b.yaml'), options: { mode: 'strict' } });
    for (const p of ['zero', 'false', 'empty_string', 'null', 'empty_object', 'empty_array']) {
      expect(kindOf(r, p), p).toBe('type-changed');
    }
    expect(diffs(r).filter((c) => c.pathText.startsWith('nested') || c.pathText.startsWith('array_of_falsy'))).toEqual([]);
    expect(kindOf(r, 'present_in_a_only_null')).toBe('removed');
    expect(kindOf(r, 'present_in_a_only_zero')).toBe('removed');
    expect(kindOf(r, 'present_in_b_only_false')).toBe('added');
  });
});
