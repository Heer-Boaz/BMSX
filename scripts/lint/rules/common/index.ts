import { ruleNames } from '../../rule';
import { localConstPatternRule } from './local_const_pattern';
import { singleUseLocalPatternRule } from './single_use_local_pattern';
import { emptyStringConditionPatternRule } from './empty_string_condition_pattern';
import { emptyStringFallbackPatternRule } from './empty_string_fallback_pattern';
import { emptyContainerFallbackPatternRule } from './empty_container_fallback_pattern';
import { emptyCatchPatternRule } from './empty_catch_pattern';
import { uselessCatchPatternRule } from './useless_catch_pattern';
import { silentCatchFallbackPatternRule } from './silent_catch_fallback_pattern';
import { orNilFallbackPatternRule } from './or_nil_fallback_pattern';
import { explicitTruthyComparisonPatternRule } from './explicit_truthy_comparison_pattern';
import { stringOrChainComparisonPatternRule } from './string_or_chain_comparison_pattern';
import { stringSwitchChainPatternRule } from './string_switch_chain_pattern';
import { splitJoinRoundtripPatternRule } from './split_join_roundtrip_pattern';
import { singlePropertyOptionsParameterPatternRule } from './single_property_options_parameter_pattern';
import { singleLineMethodPatternRule } from './single_line_method_pattern';
import { uselessTerminalReturnPatternRule } from './useless_terminal_return_pattern';
import { consecutiveDuplicateStatementPatternRule } from './consecutive_duplicate_statement_pattern';
import { repeatedStatementSequencePatternRule } from './repeated_statement_sequence_pattern';

export { localConstPatternRule };
export { singleUseLocalPatternRule };
export { emptyStringConditionPatternRule };
export { emptyStringFallbackPatternRule };
export { emptyContainerFallbackPatternRule };
export { emptyCatchPatternRule };
export { uselessCatchPatternRule };
export { silentCatchFallbackPatternRule };
export { orNilFallbackPatternRule };
export { explicitTruthyComparisonPatternRule };
export { stringOrChainComparisonPatternRule };
export { stringSwitchChainPatternRule };
export { splitJoinRoundtripPatternRule };
export { singlePropertyOptionsParameterPatternRule };
export { singleLineMethodPatternRule };
export { uselessTerminalReturnPatternRule };
export { consecutiveDuplicateStatementPatternRule };
export { repeatedStatementSequencePatternRule };

export const COMMON_LANGUAGE_LINT_RULES_DEFINITIONS = [
	localConstPatternRule,
	singleUseLocalPatternRule,
	emptyStringConditionPatternRule,
	emptyStringFallbackPatternRule,
	emptyContainerFallbackPatternRule,
	emptyCatchPatternRule,
	uselessCatchPatternRule,
	silentCatchFallbackPatternRule,
	orNilFallbackPatternRule,
	explicitTruthyComparisonPatternRule,
	stringOrChainComparisonPatternRule,
	stringSwitchChainPatternRule,
	splitJoinRoundtripPatternRule,
	singlePropertyOptionsParameterPatternRule,
	singleLineMethodPatternRule,
	uselessTerminalReturnPatternRule,
	consecutiveDuplicateStatementPatternRule,
	repeatedStatementSequencePatternRule,
] as const;
export const COMMON_LANGUAGE_LINT_RULES = ruleNames(COMMON_LANGUAGE_LINT_RULES_DEFINITIONS);
