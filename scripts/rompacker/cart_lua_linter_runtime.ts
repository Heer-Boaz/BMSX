import { type LuaExpression as Expression, type LuaFunctionDeclarationStatement as FunctionDeclarationStatement, type LuaFunctionExpression as CartFunctionExpression, type LuaLocalFunctionStatement as LocalFunctionStatement, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind } from '../../src/bmsx/lua/syntax/ast';
import { LuaSyntaxError as ParserSyntaxError } from '../../src/bmsx/lua/errors';
import { LuaLexer as Lexer } from '../../src/bmsx/lua/syntax/lexer';
import { LuaParser as Parser } from '../../src/bmsx/lua/syntax/parser';
import { type FunctionUsageInfo } from '../lint/function_usage';
import { type LintRuleName } from '../lint/rule';
import { type CartLintIssue } from '../lint/lua_rule';
import { lintAstEmptyStringConditionPattern } from '../lint/rules/common/empty_string_condition_pattern';
import { lintAstEmptyStringFallbackPattern } from '../lint/rules/common/empty_string_fallback_pattern';
import { lintAstExplicitTruthyComparisonPattern } from '../lint/rules/common/explicit_truthy_comparison_pattern';
import { lintAstOrNilFallbackPattern } from '../lint/rules/common/or_nil_fallback_pattern';
import { lintCallNewlineNormalizationPattern } from '../lint/rules/code_quality/newline_normalization_pattern';
import { lintForbiddenMathFloorPattern } from '../lint/rules/lua_cart/forbidden_math_floor_pattern';
import { lintForbiddenRenderWrapperCall } from '../lint/rules/lua_cart/forbidden_render_wrapper_call_pattern';
import { lintLocalFunctionConstPattern } from '../lint/rules/lua_cart/local_function_const_pattern';
import { lintRequireCall } from '../lint/rules/lua_cart/require_lua_extension_pattern';
import { lintUppercaseCode } from '../lint/rules/lua_cart/uppercase_code_pattern';
import { readFile } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import { collectCartSourceFiles } from './cart_source_files';
import { lintActionTriggeredBoolChainPattern } from '../lint/rules/lua_cart/action_triggered_bool_chain_pattern';
import { lintBool01DuplicatePattern } from '../lint/rules/lua_cart/bool01_duplicate_pattern';
import { lintBranchUninitializedLocalPattern } from '../lint/rules/lua_cart/branch_uninitialized_local_pattern';
import { lintBtIdLabelPattern } from '../lint/rules/lua_cart/bt_id_label_pattern';
import { lintBuiltinRecreationPattern } from '../lint/rules/lua_cart/builtin_recreation_pattern';
import { lintComparisonWrapperGetterPattern } from '../lint/rules/lua_cart/comparison_wrapper_getter_pattern';
import { lintContiguousMultiEmitPattern } from '../lint/rules/lua_cart/contiguous_multi_emit_pattern';
import { lintCreateServiceIdAddonPattern } from '../lint/rules/lua_cart/create_service_id_addon_pattern';
import { lintCrossFileLocalGlobalConstantPattern } from '../lint/rules/lua_cart/cross_file_local_global_constant_pattern';
import { lintCrossObjectStateEventRelayPattern } from '../lint/rules/lua_cart/cross_object_state_event_relay_pattern';
import { lintDefineFactoryTickEnabledAndSpaceIdPattern } from '../lint/rules/lua_cart/define_factory_tick_enabled_pattern';
import { lintDefineServiceIdPattern } from '../lint/rules/lua_cart/define_service_id_pattern';
import { lintDispatchFanoutLoopPattern } from '../lint/rules/lua_cart/dispatch_fanout_loop_pattern';
import { lintEventHandlerDispatchPattern } from '../lint/rules/lua_cart/event_handler_dispatch_pattern';
import { lintForbiddenDispatchPattern } from '../lint/rules/lua_cart/forbidden_dispatch_pattern';
import { lintForbiddenRandomHelperPattern } from '../lint/rules/lua_cart/forbidden_random_helper_pattern';
import { lintForbiddenStateCalls } from '../lint/rules/lua_cart/forbidden_transition_to_pattern';
import { lintGetterSetterPattern } from '../lint/rules/lua_cart/getter_setter_pattern';
import { lintHandlerIdentityDispatchPattern } from '../lint/rules/lua_cart/handler_identity_dispatch_pattern';
import { lintImgIdFallbackPattern } from '../lint/rules/lua_cart/imgid_fallback_pattern';
import { lintFsmEnteringStateVisualSetupPattern } from '../lint/rules/lua_cart/fsm_entering_state_visual_setup_pattern';
import { lintFsmIdLabelPattern } from '../lint/rules/lua_cart/fsm_id_label_pattern';
import { lintFsmStateNameMirrorAssignmentPattern } from '../lint/rules/lua_cart/fsm_state_name_mirror_assignment_pattern';
import { lintSpriteImgIdAssignmentPattern } from '../lint/rules/lua_cart/imgid_assignment_pattern';
import { lintInjectedServiceIdPropertyAssignmentTarget } from '../lint/rules/lua_cart/injected_service_id_property_pattern';
import { lintMultiHasTagPattern, lintSplitNestedIfHasTagPattern } from '../lint/rules/lua_cart/multi_has_tag_pattern';
import { lintPureCopyFunctionPattern } from '../lint/rules/lua_cart/pure_copy_function_pattern';
import { lintSelfImgIdAssignmentPattern } from '../lint/rules/lua_cart/self_imgid_assignment_pattern';
import { lintLocalAssignment } from '../lint/rules/lua_cart/self_property_local_alias_pattern';
import { lintServiceDefinitionSuffixPattern } from '../lint/rules/lua_cart/service_definition_suffix_pattern';
import { lintSetSpaceRoundtripPattern } from '../lint/rules/lua_cart/set_space_roundtrip_pattern';
import { lintSinglePropertyOptionsParameter } from '../lint/rules/common/single_property_options_parameter_pattern';
import { lintSplitLocalTableInitPattern } from '../lint/rules/lua_cart/split_local_table_init_pattern';
import { lintStagedExportLocalCallPattern } from '../lint/rules/lua_cart/staged_export_local_call_pattern';
import { lintStagedExportLocalTablePattern } from '../lint/rules/lua_cart/staged_export_local_table_pattern';
import { lintSyntaxError } from '../lint/rules/lua_cart/syntax_error_pattern';
import { lintUselessAssertPattern } from '../lint/rules/lua_cart/useless_assert_pattern';
import { lintVisualUpdatePattern } from '../lint/rules/lua_cart/visual_update_pattern';
import { lintEnsureLocalAliasPattern } from '../lint/rules/lua_cart/ensure_local_alias_pattern';
import { lintStringOrChainComparisonPattern } from '../lint/rules/common/string_or_chain_comparison_pattern';
import { collectTopLevelLocalStringConstants } from '../lint/rules/lua_cart/impl/support/bindings';
import { matchesEnsurePattern } from '../lint/rules/lua_cart/impl/support/cart_patterns';
import { lintConstLocalPattern } from '../lint/rules/lua_cart/impl/support/const_local';
import { lintConstantCopyPattern } from '../lint/rules/lua_cart/impl/support/constant_copy';
import { lintDuplicateInitializerPattern } from '../lint/rules/lua_cart/impl/support/duplicate_initializers';
import { lintForeignObjectInternalMutationPattern } from '../lint/rules/lua_cart/impl/support/foreign_object';
import { lintFsmDirectStateHandlerShorthandPattern } from '../lint/rules/lua_cart/impl/support/fsm_core';
import { lintFsmEventReemitHandlerPattern, lintFsmLifecycleWrapperPattern } from '../lint/rules/lua_cart/impl/support/fsm_events';
import { lintFsmForbiddenLegacyFieldsPattern, lintFsmProcessInputPollingTransitionPattern, lintFsmRunChecksInputTransitionPattern, lintFsmTickCounterTransitionPattern } from '../lint/rules/lua_cart/impl/support/fsm_transitions';
import { collectCartFunctionUsageCounts, isAllowedBySingleLineMethodUsage } from '../lint/rules/lua_cart/impl/support/function_usage';
import { getFunctionDisplayName, isMethodLikeFunctionDeclaration } from '../lint/rules/lua_cart/impl/support/functions';
import { isAllowedSingleLineMethodName, matchesMeaninglessSingleLineMethodPattern } from '../lint/rules/lua_cart/impl/support/general';
import { lintShadowedRequireAliasPattern } from '../lint/rules/lua_cart/impl/support/require_aliases';
import { lintRuntimeTagTableAccessPattern } from '../lint/rules/lua_cart/impl/support/runtime_tag';
import { lintSingleUseHasTagPattern } from '../lint/rules/lua_cart/impl/support/single_use_has_tag';
import { lintSingleUseLocalPattern } from '../lint/rules/lua_cart/impl/support/single_use_local';
import { lintInlineStaticLookupTablePattern, lintTableField } from '../lint/rules/lua_cart/impl/support/table_fields';
import { CartLintOptions, CartLintProfile, CartLintSuppressionRange, TopLevelLocalStringConstant } from '../lint/rules/lua_cart/impl/support/types';
import { lintUnusedInitValuesInFunctionBody } from '../lint/rules/lua_cart/impl/support/unused_init';
import { clearSuppressedLineRanges, pushIssue, pushIssueAt, setActiveLintRules, setSuppressedLineRanges } from '../lint/rules/lua_cart/impl/support/lint_context';

const CART_LINT_RULES: readonly LintRuleName[] = [
	'action_triggered_bool_chain_pattern',
	'bool01_duplicate_pattern',
	'branch_uninitialized_local_pattern',
	'bt_id_label_pattern',
	'builtin_recreation_pattern',
	'comparison_wrapper_getter_pattern',
	'consecutive_duplicate_statement_pattern',
	'constant_copy_pattern',
	'contiguous_multi_emit_pattern',
	'create_service_id_addon_pattern',
	'cross_file_local_global_constant_pattern',
	'cross_object_state_event_relay_pattern',
	'define_factory_space_id_pattern',
	'define_factory_tick_enabled_pattern',
	'define_service_id_pattern',
	'dispatch_fanout_loop_pattern',
	'duplicate_initializer_pattern',
	'empty_catch_pattern',
	'empty_container_fallback_pattern',
	'empty_string_condition_pattern',
	'empty_string_fallback_pattern',
	'ensure_local_alias_pattern',
	'ensure_pattern',
	'event_handler_dispatch_pattern',
	'event_handler_flag_proxy_pattern',
	'event_handler_state_dispatch_pattern',
	'explicit_truthy_comparison_pattern',
	'forbidden_dispatch_pattern',
	'forbidden_matches_state_path_pattern',
	'forbidden_math_floor_pattern',
	'forbidden_random_helper_pattern',
	'forbidden_render_layer_string_pattern',
	'forbidden_render_module_require_pattern',
	'forbidden_render_wrapper_call_pattern',
	'forbidden_transition_to_pattern',
	'foreign_object_internal_mutation_pattern',
	'fsm_direct_state_handler_shorthand_pattern',
	'fsm_entering_state_visual_setup_pattern',
	'fsm_event_reemit_handler_pattern',
	'fsm_forbidden_legacy_fields_pattern',
	'fsm_id_label_pattern',
	'fsm_lifecycle_wrapper_pattern',
	'fsm_process_input_polling_transition_pattern',
	'fsm_run_checks_input_transition_pattern',
	'fsm_state_name_mirror_assignment_pattern',
	'fsm_tick_counter_transition_pattern',
	'getter_setter_pattern',
	'handler_identity_dispatch_pattern',
	'imgid_assignment_pattern',
	'imgid_fallback_pattern',
	'injected_service_id_property_pattern',
	'inline_static_lookup_table_pattern',
	'local_const_pattern',
	'local_function_const_pattern',
	'multi_has_tag_pattern',
	'newline_normalization_pattern',
	'or_nil_fallback_pattern',
	'pure_copy_function_pattern',
	'repeated_statement_sequence_pattern',
	'require_lua_extension_pattern',
	'runtime_tag_table_access_pattern',
	'self_imgid_assignment_pattern',
	'self_property_local_alias_pattern',
	'service_definition_suffix_pattern',
	'set_space_roundtrip_pattern',
	'shadowed_require_alias_pattern',
	'silent_catch_fallback_pattern',
	'single_line_method_pattern',
	'single_property_options_parameter_pattern',
	'single_use_has_tag_pattern',
	'single_use_local_pattern',
	'split_join_roundtrip_pattern',
	'split_local_table_init_pattern',
	'staged_export_local_call_pattern',
	'staged_export_local_table_pattern',
	'string_or_chain_comparison_pattern',
	'string_switch_chain_pattern',
	'syntax_error_pattern',
	'tick_flag_polling_pattern',
	'tick_input_check_pattern',
	'unused_init_value_pattern',
	'uppercase_code_pattern',
	'useless_assert_pattern',
	'useless_catch_pattern',
	'useless_terminal_return_pattern',
	'visual_update_pattern',
];

setActiveLintRules(new Set(CART_LINT_RULES));

export const LINT_SUPPRESSION_DISABLE = 'disable';

export const LINT_SUPPRESSION_ENABLE = 'enable';

export const BIOS_PROFILE_DISABLED_RULES = new Set<LintRuleName>([
	'visual_update_pattern',
	'bool01_duplicate_pattern',
	'pure_copy_function_pattern',
	'imgid_assignment_pattern',
	'self_imgid_assignment_pattern',
	'imgid_fallback_pattern',
	'forbidden_transition_to_pattern',
	'forbidden_matches_state_path_pattern',
	'forbidden_dispatch_pattern',
	'event_handler_dispatch_pattern',
	'event_handler_state_dispatch_pattern',
	'event_handler_flag_proxy_pattern',
	'contiguous_multi_emit_pattern',
	'dispatch_fanout_loop_pattern',
	'tick_flag_polling_pattern',
	'tick_input_check_pattern',
	'action_triggered_bool_chain_pattern',
	'set_space_roundtrip_pattern',
	'cross_object_state_event_relay_pattern',
	'foreign_object_internal_mutation_pattern',
	'runtime_tag_table_access_pattern',
	'fsm_state_name_mirror_assignment_pattern',
	'multi_has_tag_pattern',
	'single_use_has_tag_pattern',
	'self_property_local_alias_pattern',
	'handler_identity_dispatch_pattern',
	'getter_setter_pattern',
	'single_line_method_pattern',
	'useless_assert_pattern',
	'define_service_id_pattern',
	'define_factory_tick_enabled_pattern',
	'define_factory_space_id_pattern',
	'fsm_entering_state_visual_setup_pattern',
	'fsm_direct_state_handler_shorthand_pattern',
	'fsm_event_reemit_handler_pattern',
	'fsm_process_input_polling_transition_pattern',
	'fsm_run_checks_input_transition_pattern',
	'fsm_lifecycle_wrapper_pattern',
	'fsm_tick_counter_transition_pattern',
	'fsm_id_label_pattern',
	'bt_id_label_pattern',
	'injected_service_id_property_pattern',
]);

export function resolveEnabledRules(profile: CartLintProfile): ReadonlySet<LintRuleName> {
	if (profile === 'cart') {
		return new Set(CART_LINT_RULES);
	}
	const enabled = new Set(CART_LINT_RULES);
	for (const rule of BIOS_PROFILE_DISABLED_RULES) {
		enabled.delete(rule);
	}
	return enabled;
}

export function collectSuppressedLineRanges(source: string): CartLintSuppressionRange[] {
	const ranges: CartLintSuppressionRange[] = [];
	// disable-next-line newline_normalization_pattern -- cart Lua suppression comments are parsed by logical source line.
	const lines = source.split(/\r?\n/);
	let activeStartLine = 0;
	for (let index = 0; index < lines.length; index += 1) {
		const lineNumber = index + 1;
		const commentStart = lines[index].indexOf('--');
		if (commentStart < 0) {
			continue;
		}
		const commentText = lines[index].slice(commentStart + 2).trimStart();
		const commandEnd = commentText.search(/\s/);
		const command = commandEnd === -1 ? commentText : commentText.slice(0, commandEnd);
		const hasOpen = command === LINT_SUPPRESSION_DISABLE;
		const hasClose = command === LINT_SUPPRESSION_ENABLE;
		if (activeStartLine === 0) {
			if (!hasOpen) {
				continue;
			}
			activeStartLine = lineNumber;
			if (hasClose) {
				ranges.push({ startLine: activeStartLine, endLine: lineNumber });
				activeStartLine = 0;
			}
			continue;
		}
		if (!hasClose) {
			continue;
		}
		ranges.push({ startLine: activeStartLine, endLine: lineNumber });
		activeStartLine = 0;
	}
	if (activeStartLine !== 0) {
		ranges.push({ startLine: activeStartLine, endLine: lines.length });
	}
	return ranges;
}

export function normalizeWorkspacePath(input: string): string {
	const normalized = input.replace(/\\/g, '/');
	if (normalized.length === 0) {
		return '';
	}
	const parts = normalized.split('/');
	const stack: string[] = [];
	for (const part of parts) {
		if (!part || part === '.') {
			continue;
		}
		if (part === '..') {
			if (stack.length > 0) {
				stack.pop();
			}
			continue;
		}
		stack.push(part);
	}
	return stack.join('/');
}

export function toWorkspaceRelativePath(absolutePath: string): string {
	const rel = relative(process.cwd(), absolutePath);
	return normalizeWorkspacePath(rel.split(sep).join('/'));
}

export async function collectCartFiles(roots: ReadonlyArray<string>): Promise<string[]> {
	return collectCartSourceFiles(roots);
}

export function lintFunctionBody(
	functionName: string,
	functionExpression: CartFunctionExpression,
	issues: CartLintIssue[],
	options: { readonly isMethodDeclaration: boolean; readonly usageInfo?: FunctionUsageInfo; },
): void {
	const isNamedFunction = functionName !== '<anonymous>';
	lintSinglePropertyOptionsParameter(functionExpression, issues);
	const isVisualUpdateLike = lintVisualUpdatePattern(functionName, functionExpression, issues);
	const isGetterOrSetter = lintGetterSetterPattern(functionName, functionExpression, issues);
	const isBuiltinRecreation = lintBuiltinRecreationPattern(functionName, functionExpression, issues);
	lintComparisonWrapperGetterPattern(functionName, functionExpression, issues);
	lintForbiddenRandomHelperPattern(functionName, functionExpression, isBuiltinRecreation, issues);
	lintBool01DuplicatePattern(functionName, functionExpression, issues);
	lintPureCopyFunctionPattern(functionName, functionExpression, issues);
	if (
		isNamedFunction
		&& options.isMethodDeclaration
		&& !isGetterOrSetter
		&& !isVisualUpdateLike
		&& !isAllowedSingleLineMethodName(functionName)
		&& matchesMeaninglessSingleLineMethodPattern(functionExpression)
		&& !isAllowedBySingleLineMethodUsage(functionName, options.usageInfo)
	) {
		pushIssue(
			issues,
			'single_line_method_pattern',
			functionExpression,
			`Meaningless single-line method is forbidden ("${functionName}").`,
		);
	}
	if (matchesEnsurePattern(functionExpression)) {
		pushIssue(
			issues,
			'ensure_pattern',
			functionExpression,
			`Ensure-style lazy initialization pattern is forbidden ("${functionName}").`,
		);
	}
	lintEnsureLocalAliasPattern(functionName, functionExpression, issues);
	if (isNamedFunction) {
		lintInlineStaticLookupTablePattern(functionName, functionExpression, issues);
	}
	lintHandlerIdentityDispatchPattern(functionName, functionExpression, issues);
}

export function lintExpression(expression: Expression | null, issues: CartLintIssue[], topLevel = true): void {
	if (!expression) {
		return;
	}
	lintAstEmptyStringConditionPattern(expression, issues, pushIssue);
	lintAstEmptyStringFallbackPattern(expression, issues, pushIssue);
	lintAstOrNilFallbackPattern(expression, issues, pushIssue);
	lintAstExplicitTruthyComparisonPattern(expression, issues, pushIssue);
	lintForbiddenMathFloorPattern(expression, issues, pushIssue);
	lintStringOrChainComparisonPattern(expression, issues);
	lintActionTriggeredBoolChainPattern(expression, issues);
	if (topLevel) {
		lintMultiHasTagPattern(expression, issues);
	}
	switch (expression.kind) {
		case SyntaxKind.CallExpression:
			lintRequireCall(expression, issues, pushIssue);
			lintForbiddenRenderWrapperCall(expression, issues, pushIssue);
			lintForbiddenStateCalls(expression, issues);
			lintForbiddenDispatchPattern(expression, issues);
			lintEventHandlerDispatchPattern(expression, issues);
			lintCrossObjectStateEventRelayPattern(expression, issues);
			lintSetSpaceRoundtripPattern(expression, issues);
			lintServiceDefinitionSuffixPattern(expression, issues);
			lintCreateServiceIdAddonPattern(expression, issues);
			lintDefineServiceIdPattern(expression, issues);
			lintDefineFactoryTickEnabledAndSpaceIdPattern(expression, issues);
			lintCallNewlineNormalizationPattern(expression, issues, pushIssue);
			lintFsmDirectStateHandlerShorthandPattern(expression, issues);
			lintFsmEventReemitHandlerPattern(expression, issues);
			lintFsmForbiddenLegacyFieldsPattern(expression, issues);
			lintFsmProcessInputPollingTransitionPattern(expression, issues);
			lintFsmRunChecksInputTransitionPattern(expression, issues);
			lintFsmLifecycleWrapperPattern(expression, issues);
			lintFsmTickCounterTransitionPattern(expression, issues);
			lintFsmIdLabelPattern(expression, issues);
			lintFsmStateNameMirrorAssignmentPattern(expression, issues);
			lintBtIdLabelPattern(expression, issues);
			lintExpression(expression.callee, issues, false);
			for (const arg of expression.arguments) {
				lintExpression(arg, issues, false);
			}
			return;
		case SyntaxKind.MemberExpression:
			lintExpression(expression.base, issues, false);
			return;
		case SyntaxKind.IndexExpression:
			lintExpression(expression.base, issues, false);
			lintExpression(expression.index, issues, false);
			return;
		case SyntaxKind.BinaryExpression:
			lintExpression(expression.left, issues, false);
			lintExpression(expression.right, issues, false);
			return;
		case SyntaxKind.UnaryExpression:
			lintExpression(expression.operand, issues, false);
			return;
		case SyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				lintTableField(field, issues);
			}
			return;
		case SyntaxKind.FunctionExpression:
			lintFunctionBody('<anonymous>', expression, issues, { isMethodDeclaration: false });
			lintStatements(expression.body.body, issues);
			return;
		default:
			return;
	}
}

export function lintStatements(statements: ReadonlyArray<Statement>, issues: CartLintIssue[]): void {
	lintBranchUninitializedLocalPattern(statements, issues);
	lintContiguousMultiEmitPattern(statements, issues);
	const functionUsageInfo = collectCartFunctionUsageCounts(statements);
	for (const statement of statements) {
		switch (statement.kind) {
			case SyntaxKind.LocalAssignmentStatement:
				lintLocalAssignment(statement, issues);
				for (let index = 0; index < statement.values.length; index += 1) {
					const value = statement.values[index];
					if (index < statement.names.length && value.kind === SyntaxKind.FunctionExpression) {
						lintFunctionBody(statement.names[index].name, value, issues, {
							isMethodDeclaration: false,
							usageInfo: functionUsageInfo,
						});
						lintStatements(value.body.body, issues);
						continue;
					}
					lintExpression(value, issues);
				}
				break;
			case SyntaxKind.AssignmentStatement:
				for (const left of statement.left) {
					lintExpression(left, issues);
				}
				for (let index = 0; index < statement.left.length; index += 1) {
					const left = statement.left[index];
					const right = statement.right[index];
					lintSpriteImgIdAssignmentPattern(left, issues);
					lintSelfImgIdAssignmentPattern(left, right, issues);
					lintInjectedServiceIdPropertyAssignmentTarget(left, issues);
				}
				for (const right of statement.right) {
					lintExpression(right, issues);
				}
				break;
			case SyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LocalFunctionStatement;
				lintLocalFunctionConstPattern(localFunction, issues, pushIssue);
				lintFunctionBody(getFunctionDisplayName(localFunction), localFunction.functionExpression, issues, {
					isMethodDeclaration: false,
					usageInfo: functionUsageInfo,
				});
				lintStatements(localFunction.functionExpression.body.body, issues);
				break;
			}
			case SyntaxKind.FunctionDeclarationStatement: {
				const declaration = statement as FunctionDeclarationStatement;
				lintFunctionBody(
					getFunctionDisplayName(declaration),
					declaration.functionExpression,
					issues,
					{
						isMethodDeclaration: isMethodLikeFunctionDeclaration(declaration),
						usageInfo: functionUsageInfo,
					},
				);
				lintStatements(declaration.functionExpression.body.body, issues);
				break;
			}
			case SyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintExpression(expression, issues);
				}
				break;
			case SyntaxKind.IfStatement:
				lintUselessAssertPattern(statement, issues);
				lintImgIdFallbackPattern(statement, issues);
				lintSplitNestedIfHasTagPattern(statement, issues);
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintExpression(clause.condition, issues);
					}
					lintStatements(clause.block.body, issues);
				}
				break;
			case SyntaxKind.WhileStatement:
				lintExpression(statement.condition, issues);
				lintStatements(statement.block.body, issues);
				break;
			case SyntaxKind.RepeatStatement:
				lintStatements(statement.block.body, issues);
				lintExpression(statement.condition, issues);
				break;
			case SyntaxKind.ForNumericStatement:
				lintDispatchFanoutLoopPattern(statement, issues);
				lintExpression(statement.start, issues);
				lintExpression(statement.limit, issues);
				lintExpression(statement.step, issues);
				lintStatements(statement.block.body, issues);
				break;
			case SyntaxKind.ForGenericStatement:
				lintDispatchFanoutLoopPattern(statement, issues);
				for (const iterator of statement.iterators) {
					lintExpression(iterator, issues);
				}
				lintStatements(statement.block.body, issues);
				break;
			case SyntaxKind.DoStatement:
				lintStatements(statement.block.body, issues);
				break;
			case SyntaxKind.CallStatement:
				lintExpression(statement.expression, issues);
				break;
			case SyntaxKind.BreakStatement:
			case SyntaxKind.GotoStatement:
			case SyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
}

export function formatIssues(issues: CartLintIssue[], profile: CartLintProfile): string {
	const sorted = [...issues].sort((a, b) => {
		if (a.path !== b.path) return a.path.localeCompare(b.path);
		if (a.line !== b.line) return a.line - b.line;
		if (a.column !== b.column) return a.column - b.column;
		return a.rule.localeCompare(b.rule);
	});
	const lines = sorted.map(issue => `${issue.path}:${issue.line}:${issue.column}: ${issue.message}`);
	const profileLabel = profile === 'bios' ? 'Lua BIOS Lint' : 'Lua Cart Lint';
	return `[${profileLabel}] ${sorted.length} violation(s):\n${lines.join('\n')}`;
}

export async function lintCartSources(options: CartLintOptions): Promise<void> {
	const profile = options.profile ?? 'cart';
	setActiveLintRules(resolveEnabledRules(profile));
	const files = await collectCartFiles(options.roots);
	if (files.length === 0) {
		setActiveLintRules(new Set(CART_LINT_RULES));
		return;
	}

	const issues: CartLintIssue[] = [];
	const topLevelLocalStringConstants: TopLevelLocalStringConstant[] = [];
	clearSuppressedLineRanges();
	try {
		for (const absolutePath of files) {
			const source = await readFile(absolutePath, 'utf8');
			const workspacePath = toWorkspaceRelativePath(absolutePath);
			setSuppressedLineRanges(workspacePath, collectSuppressedLineRanges(source));
			const lexer = new Lexer(source, workspacePath);
			const lexed = lexer.scanTokensWithRecovery();
			const tokens = lexed.tokens;
			lintUppercaseCode(workspacePath, tokens, issues, pushIssueAt);
			if (lintSyntaxError(lexed.syntaxError, issues)) {
				continue;
			}
			const parser = new Parser(tokens, workspacePath, source);
			let parsed: ReturnType<Parser['parseChunkWithRecovery']>;
			try {
				parsed = parser.parseChunkWithRecovery();
			} catch (error) {
				if (error instanceof ParserSyntaxError) {
					lintSyntaxError(error, issues);
					continue;
				}
				throw error;
			}
			if (lintSyntaxError(parsed.syntaxError, issues)) {
				continue;
			}
			const chunk = parsed.path;
			topLevelLocalStringConstants.push(...collectTopLevelLocalStringConstants(workspacePath, chunk.body));
			lintSplitLocalTableInitPattern(chunk.body, issues);
			lintDuplicateInitializerPattern(chunk.body, issues);
			lintStagedExportLocalCallPattern(chunk.body, issues);
			lintStagedExportLocalTablePattern(chunk.body, issues);
			lintUnusedInitValuesInFunctionBody(chunk.body, issues, []);
			lintForeignObjectInternalMutationPattern(chunk.body, issues);
			lintRuntimeTagTableAccessPattern(chunk.body, issues);
			lintFsmEnteringStateVisualSetupPattern(chunk.body, issues);
			lintConstLocalPattern(chunk.body, issues);
			lintConstantCopyPattern(chunk.body, issues);
			lintShadowedRequireAliasPattern(chunk.body, issues);
			lintStatements(chunk.body, issues);
			lintSingleUseHasTagPattern(chunk.body, issues);
			lintSingleUseLocalPattern(chunk.body, issues);
		}
		lintCrossFileLocalGlobalConstantPattern(topLevelLocalStringConstants, issues);
	} finally {
		setActiveLintRules(new Set(CART_LINT_RULES));
		clearSuppressedLineRanges();
	}

	if (issues.length > 0) {
		throw new Error(formatIssues(issues, profile));
	}
}
