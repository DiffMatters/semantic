/** Masking of secrets that live inside values rather than in the changed path itself. */
import { describe, expect, it } from 'vitest';
import { compare } from '../src/index.js';

describe('masking inside values', () => {
  it('redacts nested secret keys in whole added containers and URL credentials', () => {
    const r = compare({
      left: { text: '{"a": 1}', format: 'json' },
      right: {
        text: 'integrations:\n  stripe:\n    api_key: sk-live-x\n    region: eu\nDATABASE_URL: postgres://u:hunter2@db:5432/x\n',
        format: 'yaml',
      },
    });
    const out = JSON.stringify(r);
    expect(out).not.toContain('sk-live-x');
    expect(out).not.toContain('hunter2');
    expect(out).toContain('eu');
    expect(out).toContain('postgres://u:');
  });

  it('leaves values alone when masking is off', () => {
    const r = compare({
      left: { text: '{}', format: 'json' },
      right: { text: 'DATABASE_URL: postgres://u:hunter2@db/x\n', format: 'yaml' },
      options: { mask: { enabled: false } },
    });
    expect(JSON.stringify(r)).toContain('hunter2');
  });
});
