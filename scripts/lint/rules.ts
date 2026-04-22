import { COMMON_LANGUAGE_LINT_RULES } from './rules/common';
import { CODE_QUALITY_ONLY_LINT_RULES } from './rules/code_quality';
import { LUA_CART_ONLY_LINT_RULES } from './rules/lua_cart';

export { COMMON_LANGUAGE_LINT_RULES } from './rules/common';
export { CODE_QUALITY_ONLY_LINT_RULES } from './rules/code_quality';
export { LUA_CART_ONLY_LINT_RULES } from './rules/lua_cart';
export { SHARED_LINT_RULES } from './rules/shared';
export type { LintRuleDefinition, LintRuleDomain } from './rule';

export const CODE_QUALITY_LINT_RULES = [
	...COMMON_LANGUAGE_LINT_RULES,
	...CODE_QUALITY_ONLY_LINT_RULES,
] as const;

export const LUA_CART_LINT_RULES = [
	...COMMON_LANGUAGE_LINT_RULES,
	...LUA_CART_ONLY_LINT_RULES,
] as const;

export type CommonLanguageLintRule = typeof COMMON_LANGUAGE_LINT_RULES[number];
export type CodeQualityOnlyLintRule = typeof CODE_QUALITY_ONLY_LINT_RULES[number];
export type CodeQualityLintRule = typeof CODE_QUALITY_LINT_RULES[number];
export type LuaCartOnlyLintRule = typeof LUA_CART_ONLY_LINT_RULES[number];
export type LuaCartLintRule = typeof LUA_CART_LINT_RULES[number];
