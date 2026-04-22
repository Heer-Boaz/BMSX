import { ruleNames } from '../../rule';
import { ensurePatternRule } from '../shared/ensure_pattern';
import { hotPathObjectLiteralPatternRule } from './hot_path_object_literal_pattern';
import { hotPathClosureArgumentPatternRule } from './hot_path_closure_argument_pattern';
import { nullishNullNormalizationPatternRule } from './nullish_null_normalization_pattern';
import { nullishReturnGuardPatternRule } from './nullish_return_guard_pattern';
import { nullishCounterIncrementPatternRule } from './nullish_counter_increment_pattern';
import { ensureLazyInitPatternRule } from './ensure_lazy_init_pattern';
import { lookupAliasReturnPatternRule } from './lookup_alias_return_pattern';
import { defensiveOptionalChainPatternRule } from './defensive_optional_chain_pattern';
import { defensiveTypeofFunctionPatternRule } from './defensive_typeof_function_pattern';
import { legacySentinelStringPatternRule } from './legacy_sentinel_string_pattern';
import { eagerValueOrFallbackPatternRule } from './eager_value_or_fallback_pattern';
import { optionalValueOrFallbackPatternRule } from './optional_value_or_fallback_pattern';
import { allocationFallbackPatternRule } from './allocation_fallback_pattern';
import { numericDefensiveSanitizationPatternRule } from './numeric_defensive_sanitization_pattern';
import { contractNumericDefensiveSanitizationPatternRule } from './contract_numeric_defensive_sanitization_pattern';
import { redundantNumericSanitizationPatternRule } from './redundant_numeric_sanitization_pattern';
import { repeatedExpressionPatternRule } from './repeated_expression_pattern';
import { repeatedAccessChainPatternRule } from './repeated_access_chain_pattern';
import { redundantConditionalPatternRule } from './redundant_conditional_pattern';
import { semanticRepeatedExpressionPatternRule } from './semantic_repeated_expression_pattern';
import { semanticNormalizedBodyDuplicatePatternRule } from './semantic_normalized_body_duplicate_pattern';
import { facadeModuleDensityPatternRule } from './facade_module_density_pattern';
import { normalizedAstDuplicatePatternRule } from './normalized_ast_duplicate_pattern';
import { crossLayerImportPatternRule } from './cross_layer_import_pattern';
import { duplicateExportedTypeNamePatternRule } from './duplicate_exported_type_name_pattern';

export { ensurePatternRule };
export { hotPathObjectLiteralPatternRule };
export { hotPathClosureArgumentPatternRule };
export { nullishNullNormalizationPatternRule };
export { nullishReturnGuardPatternRule };
export { nullishCounterIncrementPatternRule };
export { ensureLazyInitPatternRule };
export { lookupAliasReturnPatternRule };
export { defensiveOptionalChainPatternRule };
export { defensiveTypeofFunctionPatternRule };
export { legacySentinelStringPatternRule };
export { eagerValueOrFallbackPatternRule };
export { optionalValueOrFallbackPatternRule };
export { allocationFallbackPatternRule };
export { numericDefensiveSanitizationPatternRule };
export { contractNumericDefensiveSanitizationPatternRule };
export { redundantNumericSanitizationPatternRule };
export { repeatedExpressionPatternRule };
export { repeatedAccessChainPatternRule };
export { redundantConditionalPatternRule };
export { semanticRepeatedExpressionPatternRule };
export { semanticNormalizedBodyDuplicatePatternRule };
export { facadeModuleDensityPatternRule };
export { normalizedAstDuplicatePatternRule };
export { crossLayerImportPatternRule };
export { duplicateExportedTypeNamePatternRule };

export const CODE_QUALITY_ONLY_LINT_RULES_DEFINITIONS = [
	ensurePatternRule,
	hotPathObjectLiteralPatternRule,
	hotPathClosureArgumentPatternRule,
	nullishNullNormalizationPatternRule,
	nullishReturnGuardPatternRule,
	nullishCounterIncrementPatternRule,
	ensureLazyInitPatternRule,
	lookupAliasReturnPatternRule,
	defensiveOptionalChainPatternRule,
	defensiveTypeofFunctionPatternRule,
	legacySentinelStringPatternRule,
	eagerValueOrFallbackPatternRule,
	optionalValueOrFallbackPatternRule,
	allocationFallbackPatternRule,
	numericDefensiveSanitizationPatternRule,
	contractNumericDefensiveSanitizationPatternRule,
	redundantNumericSanitizationPatternRule,
	repeatedExpressionPatternRule,
	repeatedAccessChainPatternRule,
	redundantConditionalPatternRule,
	semanticRepeatedExpressionPatternRule,
	semanticNormalizedBodyDuplicatePatternRule,
	facadeModuleDensityPatternRule,
	normalizedAstDuplicatePatternRule,
	crossLayerImportPatternRule,
	duplicateExportedTypeNamePatternRule,
] as const;
export const CODE_QUALITY_ONLY_LINT_RULES = ruleNames(CODE_QUALITY_ONLY_LINT_RULES_DEFINITIONS);
