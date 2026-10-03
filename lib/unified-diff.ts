import { detectFormat, parseConfig } from './parsers';
import { checkDrift, DriftResult } from './drift-checker';

/**
 * A unified interface to compare two configuration strings.
 * Auto-detects formats (JSON, YAML, .env), parses them,
 * and returns a semantic drift analysis.
 */
export function compareConfigs(leftContent: string, rightContent: string): DriftResult[] {
  // 1. Detect and parse left side
  const leftFormat = detectFormat(leftContent);
  const leftObj = parseConfig(leftContent, leftFormat);

  // 2. Detect and parse right side
  const rightFormat = detectFormat(rightContent);
  const rightObj = parseConfig(rightContent, rightFormat);

  // 3. Compute drift (this internally handles canonicalization and semantic diffing)
  return checkDrift(leftObj, rightObj);
}

/**
 * Returns the detected formats for both inputs.
 * Useful for the UI to show what it think the files are.
 */
export function detectFormats(leftContent: string, rightContent: string) {
  return {
    left: detectFormat(leftContent),
    right: detectFormat(rightContent)
  };
}
