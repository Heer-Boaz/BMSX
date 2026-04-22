import { COMMON_LANGUAGE_LINT_RULES } from './rules/common';
import { CODE_QUALITY_ONLY_LINT_RULES } from './rules/code_quality';
import { CART_ONLY_LINT_RULES } from './rules/lua_cart';

export { COMMON_LANGUAGE_LINT_RULES } from './rules/common';
export { CODE_QUALITY_ONLY_LINT_RULES } from './rules/code_quality';
export { CART_ONLY_LINT_RULES } from './rules/lua_cart';
export { SHARED_LINT_RULES } from './rules/shared';
export type { LintRuleDefinition, LintRuleDomain } from './rule';

export const CODE_QUALITY_LINT_RULES = [
	...COMMON_LANGUAGE_LINT_RULES,
	...CODE_QUALITY_ONLY_LINT_RULES,
] as const;

export const CART_LINT_RULES = [
	...COMMON_LANGUAGE_LINT_RULES,
	...CART_ONLY_LINT_RULES,
] as const;

export type CommonLanguageLintRule = typeof COMMON_LANGUAGE_LINT_RULES[number];
export type CodeQualityOnlyLintRule = typeof CODE_QUALITY_ONLY_LINT_RULES[number];
export type CodeQualityLintRule = typeof CODE_QUALITY_LINT_RULES[number];
export type CartOnlyLintRule = typeof CART_ONLY_LINT_RULES[number];
export type CartLintRule = typeof CART_LINT_RULES[number];
