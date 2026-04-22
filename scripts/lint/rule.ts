export type LintRuleDomain = 'code_quality' | 'common' | 'lua_cart' | 'shared';

export type LintRuleName = string;

export type LintRuleDefinition<TName extends string = string> = {
	readonly domain: LintRuleDomain;
	readonly name: TName;
};

export type LintRuleNames<TRules extends readonly LintRuleDefinition[]> = {
	readonly [TIndex in keyof TRules]: TRules[TIndex] extends LintRuleDefinition<infer TName> ? TName : never;
};

export function defineLintRule<const TName extends string>(
	domain: LintRuleDomain,
	name: TName,
): LintRuleDefinition<TName> {
	return { domain, name };
}

export function ruleNames<const TRules extends readonly LintRuleDefinition[]>(
	rules: TRules,
): LintRuleNames<TRules> {
	return rules.map(rule => rule.name) as LintRuleNames<TRules>;
}
