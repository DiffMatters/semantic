import * as yaml from 'js-yaml';

export type ConfigFormat = 'json' | 'yaml' | 'env';

/**
 * Detects the configuration format of a given string.
 */
export function detectFormat(content: string): ConfigFormat {
  const trimmed = content.trim();
  if (!trimmed) return 'json';

  // 1. Try JSON
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch (e) {
      // Not valid JSON, move to next
    }
  }

  // 2. Try .env (look for KEY=VALUE patterns)
  const lines = trimmed.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
  if (lines.length > 0 && lines.every(line => line.includes('='))) {
    return 'env';
  }

  // 3. Fallback to YAML
  return 'yaml';
}

/**
 * Parses a string as JSON, YAML, or .env and returns a JS object.
 */
export function parseConfig(content: string, format: ConfigFormat): any {
  if (!content.trim()) return {};

  switch (format) {
    case 'json':
      try {
        return JSON.parse(content);
      } catch (e) {
        throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      }
    case 'yaml':
      try {
        return yaml.load(content);
      } catch (e) {
        throw new Error(`Invalid YAML: ${e instanceof Error ? e.message : String(e)}`);
      }
    case 'env':
      return parseEnv(content);
    default:
      throw new Error('Unsupported format');
  }
}

/**
 * Simple .env parser: converts KEY=VALUE lines into an object.
 */
function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const firstEqual = trimmed.indexOf('=');
    if (firstEqual === -1) continue;

    const key = trimmed.substring(0, firstEqual).trim();
    const value = trimmed.substring(firstEqual + 1).trim();

    // Remove optional surrounding quotes from value
    const sanitizedValue = value.replace(/^['"](.*)['"]$/, '$1');
    result[key] = sanitizedValue;
  }

  return result;
}
