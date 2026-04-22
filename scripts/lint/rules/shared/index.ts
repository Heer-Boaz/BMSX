import { ruleNames } from '../../rule';
import { ensurePatternRule } from './ensure_pattern';

export { ensurePatternRule };

export const SHARED_LINT_RULES_DEFINITIONS = [
	ensurePatternRule,
] as const;
export const SHARED_LINT_RULES = ruleNames(SHARED_LINT_RULES_DEFINITIONS);
