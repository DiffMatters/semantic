/** Public surface of @config-diff/core. */
export * from './types.js';
export { ParseError, OptionsError } from './errors.js';
export { detectFormat } from './format.js';
export { parse, parseJson, parseYaml, parseEnv } from './parsers/index.js';
export { STRICT, LOOSE, DEFAULT_MASK_PATTERN, resolveOptions } from './options.js';
export { canonicalKey } from './normalize/keys.js';
export { compilePattern, matchPath } from './normalize/pathPattern.js';
export { compareScalars } from './normalize/coerce.js';
export { diffNodes } from './diff/index.js';
export { pathToText } from './diff/path.js';
export { maskChanges } from './mask.js';
export { POLICIES, resolvePolicy, evaluate, summarize, exitCode, type PolicyName } from './policy/index.js';
export { toJson, toMarkdown, toTable, toGithubAnnotations } from './render/index.js';
export { fromJS, toJS, nodeTypeName } from './node-utils.js';
export { compare, compareDocuments, type CompareArgs, type CompareSide } from './compare.js';
