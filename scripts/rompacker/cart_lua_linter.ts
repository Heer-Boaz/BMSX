import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';

import { LuaLexer } from '../../src/bmsx/lua/syntax/lexer';
import { LuaParser } from '../../src/bmsx/lua/syntax/parser';
import type { LuaToken } from '../../src/bmsx/lua/syntax/token';
import { LuaTokenType } from '../../src/bmsx/lua/syntax/token';
import {
	LuaAssignmentOperator,
	LuaBinaryOperator,
	LuaSyntaxKind,
	LuaTableFieldKind,
	LuaUnaryOperator,
} from '../../src/bmsx/lua/syntax/ast';
import type {
	LuaAssignmentStatement,
	LuaBooleanLiteralExpression,
	LuaCallExpression,
	LuaExpression,
	LuaFunctionDeclarationStatement,
	LuaFunctionExpression,
	LuaIdentifierExpression,
	LuaIfStatement,
	LuaIndexExpression,
	LuaLocalAssignmentStatement,
	LuaLocalFunctionStatement,
	LuaMemberExpression,
	LuaNumericLiteralExpression,
	LuaStatement,
	LuaStringLiteralExpression,
	LuaTableField,
} from '../../src/bmsx/lua/syntax/ast';

type LuaLintIssueRule =
	'syntax_error_pattern' |
	'uppercase_code_pattern' |
	'comparison_wrapper_getter_pattern' |
	'visual_update_pattern' |
	'bool01_duplicate_pattern' |
	'pure_copy_function_pattern' |
	'useless_assert_pattern' |
	'empty_string_condition_pattern' |
	'empty_string_fallback_pattern' |
	'or_nil_fallback_pattern' |
	'explicit_truthy_comparison_pattern' |
	'string_or_chain_comparison_pattern' |
	'cross_file_local_global_constant_pattern' |
	'shadowed_require_alias_pattern' |
	'unused_init_value_pattern' |
	'getter_setter_pattern' |
	'single_line_method_pattern' |
	'builtin_recreation_pattern' |
	'forbidden_math_floor_pattern' |
	'forbidden_random_helper_pattern' |
	'local_function_const_pattern' |
	'local_const_pattern' |
	'multi_has_tag_pattern' |
	'single_use_has_tag_pattern' |
	'single_use_local_pattern' |
	'self_property_local_alias_pattern' |
	'imgid_assignment_pattern' |
	'self_imgid_assignment_pattern' |
	'imgid_fallback_pattern' |
	'forbidden_transition_to_pattern' |
	'forbidden_matches_state_path_pattern' |
	'forbidden_dispatch_pattern' |
	'event_handler_dispatch_pattern' |
	'event_handler_state_dispatch_pattern' |
	'event_handler_flag_proxy_pattern' |
	'contiguous_multi_emit_pattern' |
	'dispatch_fanout_loop_pattern' |
	'tick_flag_polling_pattern' |
	'tick_input_check_pattern' |
	'action_triggered_bool_chain_pattern' |
	'set_space_roundtrip_pattern' |
	'cross_object_state_event_relay_pattern' |
	'foreign_object_internal_mutation_pattern' |
	'runtime_tag_table_access_pattern' |
	'fsm_state_name_mirror_assignment_pattern' |
	'constant_copy_pattern' |
	'split_local_table_init_pattern' |
	'duplicate_initializer_pattern' |
	'handler_identity_dispatch_pattern' |
	'ensure_local_alias_pattern' |
	'service_definition_suffix_pattern' |
	'define_factory_tick_enabled_pattern' |
	'define_factory_space_id_pattern' |
	'create_service_id_addon_pattern' |
	'define_service_id_pattern' |
	'fsm_entering_state_visual_setup_pattern' |
	'fsm_direct_state_handler_shorthand_pattern' |
	'fsm_event_reemit_handler_pattern' |
	'fsm_forbidden_legacy_fields_pattern' |
	'fsm_process_input_polling_transition_pattern' |
	'fsm_run_checks_input_transition_pattern' |
	'fsm_lifecycle_wrapper_pattern' |
	'fsm_tick_counter_transition_pattern' |
	'fsm_id_label_pattern' |
	'bt_id_label_pattern' |
	'injected_service_id_property_pattern' |
	'inline_static_lookup_table_pattern' |
	'staged_export_local_call_pattern' |
	'staged_export_local_table_pattern' |
	'require_lua_extension_pattern' |
	'branch_uninitialized_local_pattern' |
	'ensure_pattern' |
	'forbidden_render_wrapper_call_pattern' |
	'forbidden_render_module_require_pattern' |
	'forbidden_render_layer_string_pattern';

type LuaLintProfile = 'cart' | 'bios';

type LuaLintIssue = {
	readonly rule: LuaLintIssueRule;
	readonly path: string;
	readonly line: number;
	readonly column: number;
	readonly message: string;
};

type LuaLintSuppressionRange = {
	readonly startLine: number;
	readonly endLine: number;
};

type UnusedInitValueBinding = {
	readonly declaration: LuaIdentifierExpression;
	pendingInitValue: boolean;
};

type UnusedInitValueScope = {
	readonly names: string[];
};

type UnusedInitValueContext = {
	readonly issues: LuaLintIssue[];
	readonly bindingStacksByName: Map<string, UnusedInitValueBinding[]>;
	readonly scopeStack: UnusedInitValueScope[];
};

type SingleUseHasTagBinding = {
	readonly declaration: LuaIdentifierExpression;
	pendingReadCount: number;
};

type SingleUseHasTagContext = {
	readonly issues: LuaLintIssue[];
	readonly bindingStacksByName: Map<string, SingleUseHasTagBinding[]>;
	readonly scopeStack: UnusedInitValueScope[];
};

type SingleUseLocalReportKind =
	'call_result' |
	'small_helper';

type SingleUseLocalBinding = {
	readonly declaration: LuaIdentifierExpression;
	readonly reportKind: SingleUseLocalReportKind | null;
	readCount: number;
	callReadCount: number;
};

type SingleUseLocalContext = {
	readonly issues: LuaLintIssue[];
	readonly bindingStacksByName: Map<string, SingleUseLocalBinding[]>;
	readonly scopeStack: UnusedInitValueScope[];
};

type ConstLocalBinding = {
	readonly declaration: LuaIdentifierExpression;
	shouldReport: boolean;
	writeCountAfterDeclaration: number;
};

type ConstLocalScope = {
	readonly names: string[];
};

type ConstLocalContext = {
	readonly issues: LuaLintIssue[];
	readonly bindingStacksByName: Map<string, ConstLocalBinding[]>;
	readonly scopeStack: ConstLocalScope[];
};

type ConstantCopyBinding = {
	isConstantSource: boolean;
};

type ConstantCopyScope = {
	readonly names: string[];
};

type ConstantCopyContext = {
	readonly issues: LuaLintIssue[];
	readonly bindingStacksByName: Map<string, ConstantCopyBinding[]>;
	readonly scopeStack: ConstantCopyScope[];
};

type ShadowedRequireAliasBinding = {
	readonly declaration: LuaIdentifierExpression;
	readonly requiredModulePath: string | null;
};

type ShadowedRequireAliasScope = {
	readonly names: string[];
};

type ShadowedRequireAliasContext = {
	readonly issues: LuaLintIssue[];
	readonly bindingStacksByName: Map<string, ShadowedRequireAliasBinding[]>;
	readonly scopeStack: ShadowedRequireAliasScope[];
};

type DuplicateInitializerBinding = {
	readonly declaration: LuaIdentifierExpression;
	initializerSignature: string;
};

type DuplicateInitializerScope = {
	readonly names: string[];
};

type DuplicateInitializerContext = {
	readonly issues: LuaLintIssue[];
	readonly bindingStacksByName: Map<string, DuplicateInitializerBinding[]>;
	readonly scopeStack: DuplicateInitializerScope[];
};

type ForeignObjectAliasBinding = {
	readonly declaration: LuaIdentifierExpression;
};

type ForeignObjectAliasScope = {
	readonly names: string[];
};

type ForeignObjectMutationContext = {
	readonly issues: LuaLintIssue[];
	readonly bindingStacksByName: Map<string, Array<ForeignObjectAliasBinding | null>>;
	readonly scopeStack: ForeignObjectAliasScope[];
};

type RuntimeTagLookupBinding = {
	readonly declaration: LuaIdentifierExpression;
};

type RuntimeTagLookupScope = {
	readonly names: string[];
};

type RuntimeTagLookupContext = {
	readonly issues: LuaLintIssue[];
	readonly bindingStacksByName: Map<string, Array<RuntimeTagLookupBinding | null>>;
	readonly scopeStack: RuntimeTagLookupScope[];
};

type LuaCartLintOptions = {
	readonly roots: ReadonlyArray<string>;
	readonly profile?: LuaLintProfile;
};

type TopLevelLocalStringConstant = {
	readonly path: string;
	readonly name: string;
	readonly value: string;
	readonly declaration: LuaIdentifierExpression;
};

const SKIPPED_DIRECTORY_NAMES = new Set<string>([
	'.git',
	'.svn',
	'.hg',
	'.bmsx',
	'node_modules',
	'_ignore',
	'test',
]);
const BUILTIN_GLOBAL_FUNCTIONS = new Set<string>([
	'assert',
	'error',
	'getmetatable',
	'ipairs',
	'next',
	'pairs',
	'pcall',
	'print',
	'rawequal',
	'rawget',
	'rawlen',
	'rawset',
	'select',
	'setmetatable',
	'tonumber',
	'tostring',
	'type',
	'xpcall',
]);
const BUILTIN_TABLE_NAMES = new Set<string>([
	'math',
	'string',
	'table',
	'coroutine',
	'utf8',
	'bit32',
	'os',
	'io',
	'debug',
	'package',
]);
const FORBIDDEN_RENDER_WRAPPER_CALLS = new Set<string>([
	'cls',
	'blit_rect',
	'fill_rect',
	'fill_rect_color',
	'blit_poly',
	'blit_glyphs',
	'blit_text',
	'blit_text_color',
	'blit_text_with_font',
	'blit_text_inline_with_font',
	'blit_text_inline_span_with_font',
]);
const FORBIDDEN_RENDER_MODULE_REQUIRES = new Set<string>([
	'vdp_firmware',
	'textflow',
]);
const FORBIDDEN_RENDER_LAYER_STRINGS = new Set<string>([
	'world',
	'ui',
	'ide',
]);
const FORBIDDEN_RANDOM_HELPER_NAME_PATTERN = /^(?:random|rand)(?:[_-]?(?:int|integer|range|between|index|idx)\d*)?$/i;
const FORBIDDEN_STATE_CALL_RECEIVERS = new Set<string>([
	'sc',
	'worldobject',
]);
const SINGLE_USE_LOCAL_SMALL_HELPER_MAX_LINES = 7;
const LINT_SUPPRESSION_OPEN_MARKER = '-- bmsx-lint:disable';
const LINT_SUPPRESSION_CLOSE_MARKER = '-- bmsx-lint:enable';
const suppressedLineRangesByPath = new Map<string, ReadonlyArray<LuaLintSuppressionRange>>();
const ALL_LUA_LINT_RULES: ReadonlyArray<LuaLintIssueRule> = [
	'syntax_error_pattern',
	'uppercase_code_pattern',
	'comparison_wrapper_getter_pattern',
	'visual_update_pattern',
	'bool01_duplicate_pattern',
	'pure_copy_function_pattern',
	'useless_assert_pattern',
	'empty_string_condition_pattern',
	'empty_string_fallback_pattern',
	'or_nil_fallback_pattern',
	'explicit_truthy_comparison_pattern',
	'string_or_chain_comparison_pattern',
	'cross_file_local_global_constant_pattern',
	'shadowed_require_alias_pattern',
	'unused_init_value_pattern',
	'getter_setter_pattern',
	'single_line_method_pattern',
	'builtin_recreation_pattern',
	'forbidden_math_floor_pattern',
	'forbidden_random_helper_pattern',
	'local_function_const_pattern',
	'local_const_pattern',
	'multi_has_tag_pattern',
	'single_use_has_tag_pattern',
	'single_use_local_pattern',
	'self_property_local_alias_pattern',
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
	'constant_copy_pattern',
	'split_local_table_init_pattern',
	'duplicate_initializer_pattern',
	'handler_identity_dispatch_pattern',
	'ensure_local_alias_pattern',
	'service_definition_suffix_pattern',
	'define_factory_tick_enabled_pattern',
	'define_factory_space_id_pattern',
	'create_service_id_addon_pattern',
	'define_service_id_pattern',
	'fsm_entering_state_visual_setup_pattern',
	'fsm_direct_state_handler_shorthand_pattern',
	'fsm_event_reemit_handler_pattern',
	'fsm_forbidden_legacy_fields_pattern',
	'fsm_process_input_polling_transition_pattern',
	'fsm_run_checks_input_transition_pattern',
	'fsm_lifecycle_wrapper_pattern',
	'fsm_tick_counter_transition_pattern',
	'fsm_id_label_pattern',
	'bt_id_label_pattern',
	'injected_service_id_property_pattern',
	'inline_static_lookup_table_pattern',
	'staged_export_local_call_pattern',
	'staged_export_local_table_pattern',
	'require_lua_extension_pattern',
	'branch_uninitialized_local_pattern',
	'ensure_pattern',
	'forbidden_render_wrapper_call_pattern',
	'forbidden_render_module_require_pattern',
	'forbidden_render_layer_string_pattern',
];
const BIOS_PROFILE_DISABLED_RULES = new Set<LuaLintIssueRule>([
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
let activeLintRules: ReadonlySet<LuaLintIssueRule> = new Set(ALL_LUA_LINT_RULES);

function resolveEnabledRules(profile: LuaLintProfile): ReadonlySet<LuaLintIssueRule> {
	if (profile === 'cart') {
		return new Set(ALL_LUA_LINT_RULES);
	}
	const enabled = new Set(ALL_LUA_LINT_RULES);
	for (const rule of BIOS_PROFILE_DISABLED_RULES) {
		enabled.delete(rule);
	}
	return enabled;
}

// STRICT FORBIDDEN: do not add lint suppression comments in cart code.
function collectSuppressedLineRanges(source: string): LuaLintSuppressionRange[] {
	const ranges: LuaLintSuppressionRange[] = [];
	const lines = source.split(/\r?\n/);
	let activeStartLine = 0;
	for (let index = 0; index < lines.length; index += 1) {
		const lineNumber = index + 1;
		const commentStart = lines[index].indexOf('--');
		if (commentStart < 0) {
			continue;
		}
		const commentPart = lines[index].slice(commentStart);
		const hasOpen = commentPart.includes(LINT_SUPPRESSION_OPEN_MARKER);
		const hasClose = commentPart.includes(LINT_SUPPRESSION_CLOSE_MARKER);
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

function isLineSuppressed(path: string, line: number): boolean {
	const ranges = suppressedLineRangesByPath.get(path);
	if (!ranges || ranges.length === 0) {
		return false;
	}
	for (const range of ranges) {
		if (line < range.startLine) {
			return false;
		}
		if (line <= range.endLine) {
			return true;
		}
	}
	return false;
}

function normalizeWorkspacePath(input: string): string {
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

function toWorkspaceRelativePath(absolutePath: string): string {
	const rel = relative(process.cwd(), absolutePath);
	return normalizeWorkspacePath(rel.split(sep).join('/'));
}

async function collectLuaFilesFromRoot(rootPath: string, output: string[]): Promise<void> {
	const entries = await readdir(rootPath, { withFileTypes: true });
	for (const entry of entries) {
		if (SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
			continue;
		}
		const absolutePath = resolve(join(rootPath, entry.name));
		if (entry.isDirectory()) {
			await collectLuaFilesFromRoot(absolutePath, output);
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}
		if (extname(entry.name).toLowerCase() !== '.lua') {
			continue;
		}
		output.push(absolutePath);
	}
}

async function collectLuaFiles(roots: ReadonlyArray<string>): Promise<string[]> {
	const files: string[] = [];
	const visited = new Set<string>();
	for (const root of roots) {
		if (!root || root.length === 0) {
			continue;
		}
		const absoluteRoot = resolve(root);
		if (visited.has(absoluteRoot)) {
			continue;
		}
		visited.add(absoluteRoot);
		await collectLuaFilesFromRoot(absoluteRoot, files);
	}
	return Array.from(new Set(files)).sort();
}

function pushIssue(issues: LuaLintIssue[], rule: LuaLintIssueRule, node: { readonly range: { readonly path: string; readonly start: { readonly line: number; readonly column: number; }; }; }, message: string): void {
	if (!activeLintRules.has(rule)) {
		return;
	}
	if (isLineSuppressed(node.range.path, node.range.start.line)) {
		return;
	}
	issues.push({
		rule,
		path: node.range.path,
		line: node.range.start.line,
		column: node.range.start.column,
		message,
	});
}

function pushIssueAt(issues: LuaLintIssue[], rule: LuaLintIssueRule, path: string, line: number, column: number, message: string): void {
	if (!activeLintRules.has(rule)) {
		return;
	}
	if (isLineSuppressed(path, line)) {
		return;
	}
	issues.push({
		rule,
		path,
		line,
		column,
		message,
	});
}

function findFirstUppercaseIndex(text: string): number {
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (code >= 65 && code <= 90) {
			return index;
		}
	}
	return -1;
}

function lintUppercaseCode(path: string, tokens: ReadonlyArray<LuaToken>, issues: LuaLintIssue[]): void {
	for (const token of tokens) {
		if (token.type === LuaTokenType.String || token.type === LuaTokenType.Eof) {
			continue;
		}
		const uppercaseIndex = findFirstUppercaseIndex(token.lexeme);
		if (uppercaseIndex === -1) {
			continue;
		}
		pushIssueAt(
			issues,
			'uppercase_code_pattern',
			path,
			token.line,
			token.column + uppercaseIndex,
			'Upper-case code is forbidden outside strings/comments.',
		);
	}
}

function isIdentifier(expression: LuaExpression, name: string): boolean {
	return expression.kind === LuaSyntaxKind.IdentifierExpression && expression.name === name;
}

function isNilExpression(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.NilLiteralExpression;
}

function isEmptyStringLiteral(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.StringLiteralExpression && expression.value === '';
}

function matchesEmptyStringConditionPattern(expression: LuaExpression): boolean {
	if (expression.kind !== LuaSyntaxKind.BinaryExpression) {
		return false;
	}
	if (expression.operator !== LuaBinaryOperator.Equal && expression.operator !== LuaBinaryOperator.NotEqual) {
		return false;
	}
	return isEmptyStringLiteral(expression.left) || isEmptyStringLiteral(expression.right);
}

function lintEmptyStringConditionPattern(expression: LuaExpression, issues: LuaLintIssue[]): void {
	if (!matchesEmptyStringConditionPattern(expression)) {
		return;
	}
	pushIssue(
		issues,
		'empty_string_condition_pattern',
		expression,
		'Empty-string condition pattern is forbidden. Prefer truthy checks, and do not define empty strings as default/start/empty values.',
	);
}

function matchesEmptyStringFallbackPattern(expression: LuaExpression): boolean {
	if (expression.kind !== LuaSyntaxKind.BinaryExpression || expression.operator !== LuaBinaryOperator.Or) {
		return false;
	}
	return isEmptyStringLiteral(expression.left) || isEmptyStringLiteral(expression.right);
}

function lintEmptyStringFallbackPattern(expression: LuaExpression, issues: LuaLintIssue[]): void {
	if (!matchesEmptyStringFallbackPattern(expression)) {
		return;
	}
	pushIssue(
		issues,
		'empty_string_fallback_pattern',
		expression,
		'Empty-string fallback via "or \'\'" is forbidden. Do not use empty strings as fallback/default values; keep string truthy-check semantics intact.',
	);
}

function matchesOrNilFallbackPattern(expression: LuaExpression): boolean {
	if (expression.kind !== LuaSyntaxKind.BinaryExpression || expression.operator !== LuaBinaryOperator.Or) {
		return false;
	}
	return isNilExpression(expression.left) || isNilExpression(expression.right);
}

function lintOrNilFallbackPattern(expression: LuaExpression, issues: LuaLintIssue[]): void {
	if (!matchesOrNilFallbackPattern(expression)) {
		return;
	}
	pushIssue(
		issues,
		'or_nil_fallback_pattern',
		expression,
		'"or nil" fallback pattern is forbidden. Lua has no undefined; remove JS-style nil normalization. If you mean "only compute/use this when a source value exists", guard on that value directly (for example "tracks and compile_tracks(tracks)"). If you truly need an explicit nil branch, use a real if/else.',
	);
}

function isBooleanLiteralExpression(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.BooleanLiteralExpression;
}

function matchesExplicitTruthyComparisonPattern(expression: LuaExpression): boolean {
	if (expression.kind !== LuaSyntaxKind.BinaryExpression) {
		return false;
	}
	if (expression.operator !== LuaBinaryOperator.Equal && expression.operator !== LuaBinaryOperator.NotEqual) {
		return false;
	}
	const leftBoolean = isBooleanLiteralExpression(expression.left);
	const rightBoolean = isBooleanLiteralExpression(expression.right);
	if (!leftBoolean && !rightBoolean) {
		return false;
	}
	return !(leftBoolean && rightBoolean);
}

function lintExplicitTruthyComparisonPattern(expression: LuaExpression, issues: LuaLintIssue[]): void {
	if (!matchesExplicitTruthyComparisonPattern(expression)) {
		return;
	}
	pushIssue(
		issues,
		'explicit_truthy_comparison_pattern',
		expression,
		'Explicit boolean literal comparison is forbidden. Use truthy/falsy checks instead.',
	);
}

function lintForbiddenMathFloorPattern(expression: LuaExpression, issues: LuaLintIssue[]): void {
	if (getExpressionReferenceName(expression) !== 'math.floor') {
		return;
	}
	pushIssue(
		issues,
		'forbidden_math_floor_pattern',
		expression,
		'math.floor is forbidden. Use // instead of floor-based rounding or truncation.',
	);
}

function expressionsEquivalentForLint(left: LuaExpression, right: LuaExpression): boolean {
	if (left.kind !== right.kind) {
		return false;
	}
	switch (left.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			return left.name === (right as LuaIdentifierExpression).name;
		case LuaSyntaxKind.MemberExpression:
			return (left as LuaMemberExpression).identifier === (right as LuaMemberExpression).identifier && expressionsEquivalentForLint((left as LuaMemberExpression).base, (right as LuaMemberExpression).base);
		case LuaSyntaxKind.IndexExpression:
			return expressionsEquivalentForLint((left as LuaIndexExpression).base, (right as LuaIndexExpression).base) && expressionsEquivalentForLint((left as LuaIndexExpression).index, (right as LuaIndexExpression).index);
		case LuaSyntaxKind.StringLiteralExpression:
			return (left as LuaStringLiteralExpression).value === (right as LuaStringLiteralExpression).value;
		case LuaSyntaxKind.NumericLiteralExpression:
			return (left as LuaNumericLiteralExpression).value === (right as LuaNumericLiteralExpression).value;
		case LuaSyntaxKind.BooleanLiteralExpression:
			return (left as LuaBooleanLiteralExpression).value === (right as LuaBooleanLiteralExpression).value;
		case LuaSyntaxKind.NilLiteralExpression:
			return true;
		default:
			return false;
	}
}

function getStringComparisonOperand(expression: LuaExpression): LuaExpression | undefined {
	if (expression.kind !== LuaSyntaxKind.BinaryExpression || expression.operator !== LuaBinaryOperator.Equal) {
		return undefined;
	}
	if (expression.left.kind === LuaSyntaxKind.StringLiteralExpression && expression.right.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return expression.right;
	}
	if (expression.right.kind === LuaSyntaxKind.StringLiteralExpression && expression.left.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return expression.left;
	}
	return undefined;
}

function collectStringOrChainOperands(expression: LuaExpression, operands: LuaExpression[]): boolean {
	if (expression.kind === LuaSyntaxKind.BinaryExpression && expression.operator === LuaBinaryOperator.Or) {
		return collectStringOrChainOperands(expression.left, operands) && collectStringOrChainOperands(expression.right, operands);
	}
	const operand = getStringComparisonOperand(expression);
	if (!operand) {
		return false;
	}
	operands.push(operand);
	return true;
}

function matchesStringOrChainComparisonPattern(expression: LuaExpression): boolean {
	const operands: LuaExpression[] = [];
	if (!collectStringOrChainOperands(expression, operands)) {
		return false;
	}
	if (operands.length <= 1) {
		return false;
	}
	for (let index = 1; index < operands.length; index += 1) {
		if (!expressionsEquivalentForLint(operands[0], operands[index])) {
			return false;
		}
	}
	return true;
}

function lintStringOrChainComparisonPattern(expression: LuaExpression, issues: LuaLintIssue[]): void {
	if (!matchesStringOrChainComparisonPattern(expression)) {
		return;
	}
	pushIssue(
		issues,
		'string_or_chain_comparison_pattern',
		expression,
		'OR-chains that compare the same expression against multiple string literals are forbidden. Use lookup-based membership instead.',
	);
}

function isConstantModulePath(path: string): boolean {
	return path === 'constants' || path === 'globals' || path.endsWith('/constants') || path.endsWith('/globals');
}

function getRequiredModulePath(expression: LuaExpression): string | undefined {
	if (expression.kind !== LuaSyntaxKind.CallExpression) {
		return undefined;
	}
	if (expression.callee.kind !== LuaSyntaxKind.IdentifierExpression || expression.callee.name !== 'require') {
		return undefined;
	}
	if (expression.arguments.length === 0) {
		return undefined;
	}
	const firstArgument = expression.arguments[0];
	if (firstArgument.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return undefined;
	}
	return firstArgument.value;
}

function isConstantModuleRequireExpression(expression: LuaExpression): boolean {
	const requiredModulePath = getRequiredModulePath(expression);
	return requiredModulePath !== undefined && isConstantModulePath(requiredModulePath);
}

function createConstantCopyContext(issues: LuaLintIssue[]): ConstantCopyContext {
	return {
		issues,
		bindingStacksByName: new Map<string, ConstantCopyBinding[]>(),
		scopeStack: [],
	};
}

function createShadowedRequireAliasContext(issues: LuaLintIssue[]): ShadowedRequireAliasContext {
	return {
		issues,
		bindingStacksByName: new Map<string, ShadowedRequireAliasBinding[]>(),
		scopeStack: [],
	};
}

function enterShadowedRequireAliasScope(context: ShadowedRequireAliasContext): void {
	context.scopeStack.push({ names: [] });
}

function leaveShadowedRequireAliasScope(context: ShadowedRequireAliasContext): void {
	const scope = context.scopeStack.pop();
	if (!scope) {
		return;
	}
	for (let index = scope.names.length - 1; index >= 0; index -= 1) {
		const name = scope.names[index];
		const stack = context.bindingStacksByName.get(name);
		if (!stack || stack.length === 0) {
			continue;
		}
		stack.pop();
		if (stack.length === 0) {
			context.bindingStacksByName.delete(name);
		}
	}
}

function declareShadowedRequireAliasBinding(
	context: ShadowedRequireAliasContext,
	declaration: LuaIdentifierExpression,
	requiredModulePath: string | null,
): void {
	const name = declaration.name;
	if (name !== '_') {
		const stack = context.bindingStacksByName.get(name);
		if (stack) {
			for (let index = stack.length - 1; index >= 0; index -= 1) {
				const outer = stack[index];
				if (outer.requiredModulePath !== null) {
					pushIssue(
						context.issues,
						'shadowed_require_alias_pattern',
						declaration,
						`Local "${name}" shadows outer module alias from require('${outer.requiredModulePath}'). Rename the local; do not shadow imported module aliases.`,
					);
					break;
				}
			}
		}
	}
	const scope = context.scopeStack[context.scopeStack.length - 1];
	scope.names.push(name);
	let stack = context.bindingStacksByName.get(name);
	if (!stack) {
		stack = [];
		context.bindingStacksByName.set(name, stack);
	}
	stack.push({
		declaration,
		requiredModulePath,
	});
}

function lintShadowedRequireAliasExpression(expression: LuaExpression | null, context: ShadowedRequireAliasContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.CallExpression:
			lintShadowedRequireAliasExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintShadowedRequireAliasExpression(argument, context);
			}
			return;
		case LuaSyntaxKind.MemberExpression:
			lintShadowedRequireAliasExpression(expression.base, context);
			return;
		case LuaSyntaxKind.IndexExpression:
			lintShadowedRequireAliasExpression(expression.base, context);
			lintShadowedRequireAliasExpression(expression.index, context);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintShadowedRequireAliasExpression(expression.left, context);
			lintShadowedRequireAliasExpression(expression.right, context);
			return;
		case LuaSyntaxKind.UnaryExpression:
			lintShadowedRequireAliasExpression(expression.operand, context);
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					lintShadowedRequireAliasExpression(field.key, context);
				}
				lintShadowedRequireAliasExpression(field.value, context);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
			enterShadowedRequireAliasScope(context);
			for (const parameter of expression.parameters) {
				declareShadowedRequireAliasBinding(context, parameter, null);
			}
			lintShadowedRequireAliasStatements(expression.body.body, context);
			leaveShadowedRequireAliasScope(context);
			return;
		default:
			return;
	}
}

function lintShadowedRequireAliasStatements(
	statements: ReadonlyArray<LuaStatement>,
	context: ShadowedRequireAliasContext,
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement: {
				const valueCount = Math.min(statement.names.length, statement.values.length);
				for (let index = 0; index < statement.names.length; index += 1) {
					const requiredModulePath = index < valueCount ? getRequiredModulePath(statement.values[index]) ?? null : null;
					declareShadowedRequireAliasBinding(context, statement.names[index], requiredModulePath);
				}
				for (const value of statement.values) {
					lintShadowedRequireAliasExpression(value, context);
				}
				break;
			}
			case LuaSyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LuaLocalFunctionStatement;
				declareShadowedRequireAliasBinding(context, localFunction.name, null);
				enterShadowedRequireAliasScope(context);
				for (const parameter of localFunction.functionExpression.parameters) {
					declareShadowedRequireAliasBinding(context, parameter, null);
				}
				lintShadowedRequireAliasStatements(localFunction.functionExpression.body.body, context);
				leaveShadowedRequireAliasScope(context);
				break;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement:
				enterShadowedRequireAliasScope(context);
				for (const parameter of statement.functionExpression.parameters) {
					declareShadowedRequireAliasBinding(context, parameter, null);
				}
				lintShadowedRequireAliasStatements(statement.functionExpression.body.body, context);
				leaveShadowedRequireAliasScope(context);
				break;
			case LuaSyntaxKind.AssignmentStatement:
				for (const left of statement.left) {
					lintShadowedRequireAliasExpression(left, context);
				}
				for (const right of statement.right) {
					lintShadowedRequireAliasExpression(right, context);
				}
				break;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintShadowedRequireAliasExpression(expression, context);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintShadowedRequireAliasExpression(clause.condition, context);
					}
					enterShadowedRequireAliasScope(context);
					lintShadowedRequireAliasStatements(clause.block.body, context);
					leaveShadowedRequireAliasScope(context);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				lintShadowedRequireAliasExpression(statement.condition, context);
				enterShadowedRequireAliasScope(context);
				lintShadowedRequireAliasStatements(statement.block.body, context);
				leaveShadowedRequireAliasScope(context);
				break;
			case LuaSyntaxKind.RepeatStatement:
				enterShadowedRequireAliasScope(context);
				lintShadowedRequireAliasStatements(statement.block.body, context);
				lintShadowedRequireAliasExpression(statement.condition, context);
				leaveShadowedRequireAliasScope(context);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				lintShadowedRequireAliasExpression(statement.start, context);
				lintShadowedRequireAliasExpression(statement.limit, context);
				lintShadowedRequireAliasExpression(statement.step, context);
				enterShadowedRequireAliasScope(context);
				declareShadowedRequireAliasBinding(context, statement.variable, null);
				lintShadowedRequireAliasStatements(statement.block.body, context);
				leaveShadowedRequireAliasScope(context);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					lintShadowedRequireAliasExpression(iterator, context);
				}
				enterShadowedRequireAliasScope(context);
				for (const variable of statement.variables) {
					declareShadowedRequireAliasBinding(context, variable, null);
				}
				lintShadowedRequireAliasStatements(statement.block.body, context);
				leaveShadowedRequireAliasScope(context);
				break;
			case LuaSyntaxKind.DoStatement:
				enterShadowedRequireAliasScope(context);
				lintShadowedRequireAliasStatements(statement.block.body, context);
				leaveShadowedRequireAliasScope(context);
				break;
			case LuaSyntaxKind.CallStatement:
				lintShadowedRequireAliasExpression(statement.expression, context);
				break;
			default:
				break;
		}
	}
}

function lintShadowedRequireAliasPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	const context = createShadowedRequireAliasContext(issues);
	enterShadowedRequireAliasScope(context);
	lintShadowedRequireAliasStatements(statements, context);
	leaveShadowedRequireAliasScope(context);
}

function enterConstantCopyScope(context: ConstantCopyContext): void {
	context.scopeStack.push({ names: [] });
}

function leaveConstantCopyScope(context: ConstantCopyContext): void {
	const scope = context.scopeStack.pop();
	if (!scope) {
		return;
	}
	for (let index = scope.names.length - 1; index >= 0; index -= 1) {
		const name = scope.names[index];
		const stack = context.bindingStacksByName.get(name);
		if (!stack || stack.length === 0) {
			continue;
		}
		stack.pop();
		if (stack.length === 0) {
			context.bindingStacksByName.delete(name);
		}
	}
}

function declareConstantCopyBinding(
	context: ConstantCopyContext,
	declaration: LuaIdentifierExpression,
	isConstantSource: boolean,
): void {
	const scope = context.scopeStack[context.scopeStack.length - 1];
	scope.names.push(declaration.name);
	let stack = context.bindingStacksByName.get(declaration.name);
	if (!stack) {
		stack = [];
		context.bindingStacksByName.set(declaration.name, stack);
	}
	stack.push({ isConstantSource });
}

function setConstantCopyBindingByName(context: ConstantCopyContext, name: string, isConstantSource: boolean): void {
	const stack = context.bindingStacksByName.get(name);
	if (!stack || stack.length === 0) {
		return;
	}
	stack[stack.length - 1].isConstantSource = isConstantSource;
}

function getConstantCopyBinding(context: ConstantCopyContext, name: string): ConstantCopyBinding | undefined {
	const stack = context.bindingStacksByName.get(name);
	if (!stack || stack.length === 0) {
		return undefined;
	}
	return stack[stack.length - 1];
}

function isConstantSourceIdentifierName(name: string, context: ConstantCopyContext): boolean {
	const binding = getConstantCopyBinding(context, name);
	if (binding) {
		return binding.isConstantSource;
	}
	return name === 'constants';
}

function isConstantSourceExpression(expression: LuaExpression, context: ConstantCopyContext): boolean {
	if (isConstantModuleRequireExpression(expression)) {
		return true;
	}
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return isConstantSourceIdentifierName(expression.name, context);
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		return isConstantSourceExpression(expression.base, context);
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression) {
		return isConstantSourceExpression(expression.base, context);
	}
	return false;
}

function isForbiddenConstantCopyExpression(expression: LuaExpression, context: ConstantCopyContext): boolean {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return isConstantSourceIdentifierName(expression.name, context);
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		return isConstantSourceExpression(expression.base, context);
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression) {
		return isConstantSourceExpression(expression.base, context);
	}
	return false;
}

function evaluateTopLevelStringConstantExpression(
	expression: LuaExpression,
	knownValues: ReadonlyMap<string, string>,
): string | undefined {
	if (expression.kind === LuaSyntaxKind.StringLiteralExpression) {
		return expression.value;
	}
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return knownValues.get(expression.name);
	}
	if (expression.kind === LuaSyntaxKind.BinaryExpression && expression.operator === LuaBinaryOperator.Concat) {
		const left = evaluateTopLevelStringConstantExpression(expression.left, knownValues);
		if (left === undefined) {
			return undefined;
		}
		const right = evaluateTopLevelStringConstantExpression(expression.right, knownValues);
		if (right === undefined) {
			return undefined;
		}
		return left + right;
	}
	return undefined;
}

function collectTopLevelLocalStringConstants(
	path: string,
	statements: ReadonlyArray<LuaStatement>,
): TopLevelLocalStringConstant[] {
	const constants: TopLevelLocalStringConstant[] = [];
	const knownValues = new Map<string, string>();
	for (const statement of statements) {
		if (statement.kind !== LuaSyntaxKind.LocalAssignmentStatement) {
			continue;
		}
		const valueCount = Math.min(statement.names.length, statement.values.length);
		const resolvedValues: Array<string | undefined> = [];
		for (let index = 0; index < valueCount; index += 1) {
			resolvedValues[index] = evaluateTopLevelStringConstantExpression(statement.values[index], knownValues);
		}
		for (let index = 0; index < valueCount; index += 1) {
			const resolved = resolvedValues[index];
			if (resolved === undefined) {
				continue;
			}
			const name = statement.names[index];
			knownValues.set(name.name, resolved);
			constants.push({
				path,
				name: name.name,
				value: resolved,
				declaration: name,
			});
		}
	}
	return constants;
}

function lintCrossFileLocalGlobalConstantPattern(
	constants: ReadonlyArray<TopLevelLocalStringConstant>,
	issues: LuaLintIssue[],
): void {
	const constantsByName = new Map<string, TopLevelLocalStringConstant[]>();
	for (const constant of constants) {
		let entries = constantsByName.get(constant.name);
		if (!entries) {
			entries = [];
			constantsByName.set(constant.name, entries);
		}
		entries.push(constant);
	}
	for (const [name, entries] of constantsByName) {
		const paths = Array.from(new Set(entries.map(entry => entry.path))).sort();
		if (paths.length <= 1) {
			continue;
		}
		for (const entry of entries) {
			const otherPaths = paths.filter(path => path !== entry.path);
			pushIssue(
				issues,
				'cross_file_local_global_constant_pattern',
				entry.declaration,
				`Cross-file duplicated local "global constant" is forbidden ("${name}"). Define it once and reuse it. Also defined in: ${otherPaths.join(', ')}.`,
			);
		}
	}
}

function getFunctionDisplayName(statement: LuaStatement): string {
	if (statement.kind === LuaSyntaxKind.LocalFunctionStatement) {
		return statement.name.name;
	}
	const declaration = statement as LuaFunctionDeclarationStatement;
	const prefix = declaration.name.identifiers.join('.');
	if (declaration.name.methodName && declaration.name.methodName.length > 0) {
		return `${prefix}:${declaration.name.methodName}`;
	}
	return prefix;
}

function getFunctionParameterNames(functionExpression: LuaFunctionExpression): ReadonlyArray<string> {
	return functionExpression.parameters.map(parameter => parameter.name);
}

function getFunctionLeafName(functionName: string): string {
	const dotIndex = functionName.lastIndexOf('.');
	const colonIndex = functionName.lastIndexOf(':');
	const separatorIndex = Math.max(dotIndex, colonIndex);
	if (separatorIndex === -1) {
		return functionName;
	}
	return functionName.slice(separatorIndex + 1);
}

function incrementUsageCount(counts: Map<string, number>, name: string | undefined): void {
	if (!name || name.length === 0) {
		return;
	}
	counts.set(name, (counts.get(name) ?? 0) + 1);
}

type FunctionUsageInfo = {
	readonly totalCounts: ReadonlyMap<string, number>;
	readonly referenceCounts: ReadonlyMap<string, number>;
};

function getExpressionReferenceName(expression: LuaExpression): string | undefined {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.name;
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		const baseName = getExpressionReferenceName(expression.base);
		if (!baseName) {
			return undefined;
		}
		return `${baseName}.${expression.identifier}`;
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression) {
		const baseName = getExpressionReferenceName(expression.base);
		const keyName = getExpressionKeyName(expression.index);
		if (!baseName || !keyName) {
			return undefined;
		}
		return `${baseName}.${keyName}`;
	}
	return undefined;
}

function collectFunctionUsageCountsInExpression(
	expression: LuaExpression | null,
	totalCounts: Map<string, number>,
	referenceCounts: Map<string, number>,
	countAsFunctionReference: boolean,
): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			incrementUsageCount(totalCounts, expression.name);
			if (countAsFunctionReference) {
				incrementUsageCount(referenceCounts, expression.name);
			}
			return;
		case LuaSyntaxKind.MemberExpression:
			incrementUsageCount(totalCounts, getExpressionReferenceName(expression));
			if (countAsFunctionReference) {
				incrementUsageCount(referenceCounts, getExpressionReferenceName(expression));
			}
			collectFunctionUsageCountsInExpression(expression.base, totalCounts, referenceCounts, false);
			return;
		case LuaSyntaxKind.IndexExpression:
			incrementUsageCount(totalCounts, getExpressionReferenceName(expression));
			if (countAsFunctionReference) {
				incrementUsageCount(referenceCounts, getExpressionReferenceName(expression));
			}
			collectFunctionUsageCountsInExpression(expression.base, totalCounts, referenceCounts, false);
			collectFunctionUsageCountsInExpression(expression.index, totalCounts, referenceCounts, false);
			return;
		case LuaSyntaxKind.CallExpression:
			if (expression.methodName && expression.methodName.length > 0) {
				const calleeName = getExpressionReferenceName(expression.callee);
				if (calleeName) {
					incrementUsageCount(totalCounts, `${calleeName}:${expression.methodName}`);
				}
			}
			collectFunctionUsageCountsInExpression(expression.callee, totalCounts, referenceCounts, false);
			for (const argument of expression.arguments) {
				collectFunctionUsageCountsInExpression(argument, totalCounts, referenceCounts, true);
			}
			return;
		case LuaSyntaxKind.BinaryExpression:
			collectFunctionUsageCountsInExpression(expression.left, totalCounts, referenceCounts, false);
			collectFunctionUsageCountsInExpression(expression.right, totalCounts, referenceCounts, false);
			return;
		case LuaSyntaxKind.UnaryExpression:
			collectFunctionUsageCountsInExpression(expression.operand, totalCounts, referenceCounts, false);
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					collectFunctionUsageCountsInExpression(field.key, totalCounts, referenceCounts, false);
				}
				collectFunctionUsageCountsInExpression(field.value, totalCounts, referenceCounts, true);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
			collectFunctionUsageCountsInStatements(expression.body.body, totalCounts, referenceCounts);
			return;
		default:
			return;
	}
}

function collectFunctionUsageCountsInStatements(
	statements: ReadonlyArray<LuaStatement>,
	totalCounts: Map<string, number>,
	referenceCounts: Map<string, number>,
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					collectFunctionUsageCountsInExpression(value, totalCounts, referenceCounts, true);
				}
				break;
			case LuaSyntaxKind.AssignmentStatement:
				for (const right of statement.right) {
					collectFunctionUsageCountsInExpression(right, totalCounts, referenceCounts, true);
				}
				break;
			case LuaSyntaxKind.LocalFunctionStatement:
				collectFunctionUsageCountsInStatements(statement.functionExpression.body.body, totalCounts, referenceCounts);
				break;
			case LuaSyntaxKind.FunctionDeclarationStatement:
				collectFunctionUsageCountsInStatements(statement.functionExpression.body.body, totalCounts, referenceCounts);
				break;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					collectFunctionUsageCountsInExpression(expression, totalCounts, referenceCounts, true);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					collectFunctionUsageCountsInExpression(clause.condition, totalCounts, referenceCounts, false);
					collectFunctionUsageCountsInStatements(clause.block.body, totalCounts, referenceCounts);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				collectFunctionUsageCountsInExpression(statement.condition, totalCounts, referenceCounts, false);
				collectFunctionUsageCountsInStatements(statement.block.body, totalCounts, referenceCounts);
				break;
			case LuaSyntaxKind.RepeatStatement:
				collectFunctionUsageCountsInStatements(statement.block.body, totalCounts, referenceCounts);
				collectFunctionUsageCountsInExpression(statement.condition, totalCounts, referenceCounts, false);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				collectFunctionUsageCountsInExpression(statement.start, totalCounts, referenceCounts, false);
				collectFunctionUsageCountsInExpression(statement.limit, totalCounts, referenceCounts, false);
				collectFunctionUsageCountsInExpression(statement.step, totalCounts, referenceCounts, false);
				collectFunctionUsageCountsInStatements(statement.block.body, totalCounts, referenceCounts);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					collectFunctionUsageCountsInExpression(iterator, totalCounts, referenceCounts, false);
				}
				collectFunctionUsageCountsInStatements(statement.block.body, totalCounts, referenceCounts);
				break;
			case LuaSyntaxKind.DoStatement:
				collectFunctionUsageCountsInStatements(statement.block.body, totalCounts, referenceCounts);
				break;
			case LuaSyntaxKind.CallStatement:
				collectFunctionUsageCountsInExpression(statement.expression, totalCounts, referenceCounts, false);
				break;
			default:
				break;
		}
	}
}

function collectFunctionUsageCounts(statements: ReadonlyArray<LuaStatement>): FunctionUsageInfo {
	const totalCounts = new Map<string, number>();
	const referenceCounts = new Map<string, number>();
	collectFunctionUsageCountsInStatements(statements, totalCounts, referenceCounts);
	return {
		totalCounts,
		referenceCounts,
	};
}

function getSingleLineMethodUsageCount(functionName: string, usageCounts: ReadonlyMap<string, number>): number {
	const names = new Set<string>([functionName]);
	if (functionName.includes(':')) {
		names.add(functionName.replace(':', '.'));
	}
	let total = 0;
	for (const name of names) {
		total += usageCounts.get(name) ?? 0;
	}
	return total;
}

function isAllowedBySingleLineMethodUsage(functionName: string, usageInfo: FunctionUsageInfo | undefined): boolean {
	if (!usageInfo) {
		return false;
	}
	const totalUsageCount = getSingleLineMethodUsageCount(functionName, usageInfo.totalCounts);
	if (totalUsageCount >= 2) {
		return true;
	}
	const functionReferenceUsageCount = getSingleLineMethodUsageCount(functionName, usageInfo.referenceCounts);
	return functionReferenceUsageCount >= 1;
}

function isVisualUpdateLikeFunctionName(functionName: string): boolean {
	if (!functionName || functionName === '<anonymous>') {
		return false;
	}
	const leaf = getFunctionLeafName(functionName).toLowerCase();
	return /^update(?:_[a-z0-9]+)*_visual(?:_[a-z0-9]+)*$/.test(leaf)
		|| /^sync(?:_[a-z0-9]+)*_components(?:_[a-z0-9]+)*$/.test(leaf)
		|| /^apply(?:_[a-z0-9]+)*_pose(?:_[a-z0-9]+)*$/.test(leaf)
		|| /^refresh(?:_[a-z0-9]+)*_presentation(?:_[a-z0-9]+)*(?:_if_changed)?$/.test(leaf);
}

function isAllowedSingleLineMethodName(functionName: string): boolean {
	const leaf = getFunctionLeafName(functionName).toLowerCase();
	return leaf === 'ctor';
}

function isHasTagCall(expression: LuaExpression): boolean {
	if (expression.kind !== LuaSyntaxKind.CallExpression) {
		return false;
	}
	return getCallMethodName(expression) === 'has_tag';
}

function isTagsContainerExpression(expression: LuaExpression): boolean {
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		return expression.identifier === 'tags';
	}
	if (expression.kind !== LuaSyntaxKind.IndexExpression) {
		return false;
	}
	const keyName = getExpressionKeyName(expression.index);
	return keyName === 'tags';
}

function countHasTagCalls(expression: LuaExpression): number {
	if (!expression) {
		return 0;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.CallExpression: {
			let count = isHasTagCall(expression) ? 1 : 0;
			for (const argument of expression.arguments) {
				count += countHasTagCalls(argument);
			}
			count += countHasTagCalls(expression.callee as LuaExpression);
			return count;
		}
		case LuaSyntaxKind.MemberExpression:
			return countHasTagCalls(expression.base);
		case LuaSyntaxKind.IndexExpression:
			return countHasTagCalls(expression.base) + countHasTagCalls(expression.index);
		case LuaSyntaxKind.BinaryExpression:
			return countHasTagCalls(expression.left) + countHasTagCalls(expression.right);
		case LuaSyntaxKind.UnaryExpression:
			return countHasTagCalls(expression.operand);
		case LuaSyntaxKind.TableConstructorExpression: {
			let count = 0;
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					count += countHasTagCalls(field.key);
				}
				count += countHasTagCalls(field.value);
			}
			return count;
		}
		case LuaSyntaxKind.FunctionExpression:
			return 0;
		default:
			return 0;
	}
}

function countSplitNestedIfHasTagCalls(statement: LuaIfStatement): number {
	let total = 0;
	let depth = 0;
	let current: LuaIfStatement | null = statement;
	while (current) {
		if (current.clauses.length !== 1) {
			return 0;
		}
		const clause = current.clauses[0];
		if (!clause.condition) {
			return 0;
		}
		const conditionHasTagCount = countHasTagCalls(clause.condition);
		if (conditionHasTagCount > 1) {
			return 0;
		}
		total += conditionHasTagCount;
		depth += 1;
		if (clause.block.body.length !== 1) {
			break;
		}
		const nested = clause.block.body[0];
		if (nested.kind !== LuaSyntaxKind.IfStatement) {
			break;
		}
		current = nested;
	}
	if (depth <= 1 || total <= 1) {
		return 0;
	}
	return total;
}

function lintSplitNestedIfHasTagPattern(statement: LuaIfStatement, issues: LuaLintIssue[]): void {
	const hasTagCheckCount = countSplitNestedIfHasTagCalls(statement);
	if (hasTagCheckCount <= 1) {
		return;
	}
	pushIssue(
		issues,
		'multi_has_tag_pattern',
		statement,
		`Nested if-chain splits ${hasTagCheckCount} has_tag checks across multiple statements. This is a forbidden workaround for the multi has_tag rule. Use tag_groups, tag_derivations, or derived_tags instead.`,
	);
}

function lintContiguousMultiEmitPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	let firstEmitCall: LuaCallExpression | undefined;
	let emitCount = 0;

	const flush = (): void => {
		if (!firstEmitCall || emitCount <= 1) {
			firstEmitCall = undefined;
			emitCount = 0;
			return;
		}
		pushIssue(
			issues,
			'contiguous_multi_emit_pattern',
			firstEmitCall,
			`${emitCount} consecutive events:emit(...) calls in one straight-line block are forbidden. Emit one canonical event and let other systems react to it instead of alias/fanout event chains.`,
		);
		firstEmitCall = undefined;
		emitCount = 0;
	};

	for (const statement of statements) {
		if (statement.kind === LuaSyntaxKind.CallStatement && isEventsEmitCallExpression(statement.expression)) {
			if (!firstEmitCall) {
				firstEmitCall = statement.expression;
			}
			emitCount += 1;
			continue;
		}
		flush();
	}
	flush();
}

function isSelfExpressionRoot(expression: LuaExpression): boolean {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.name === 'self';
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression || expression.kind === LuaSyntaxKind.IndexExpression) {
		return isSelfExpressionRoot(expression.base);
	}
	return false;
}

function getSelfPropertyNameFromAliasExpression(expression: LuaExpression): string | undefined {
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		if (!isSelfExpressionRoot(expression.base)) {
			return undefined;
		}
		return expression.identifier;
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression) {
		if (!isSelfExpressionRoot(expression.base)) {
			return undefined;
		}
		return getExpressionKeyName(expression.index);
	}
	return undefined;
}

function isStateLikeAliasName(name: string): boolean {
	const lowered = name.toLowerCase();
	return lowered.includes('state') || lowered.includes('substate');
}

function isSelfImageIdAssignmentTarget(target: LuaExpression): boolean {
	if (target.kind === LuaSyntaxKind.MemberExpression) {
		return target.identifier === 'imgid' && isSelfExpressionRoot(target.base);
	}
	if (target.kind !== LuaSyntaxKind.IndexExpression) {
		return false;
	}
	if (!isSelfExpressionRoot(target.base)) {
		return false;
	}
	return (target.index.kind === LuaSyntaxKind.StringLiteralExpression && target.index.value === 'imgid')
		|| (target.index.kind === LuaSyntaxKind.IdentifierExpression && target.index.name === 'imgid');
}

function isImgIdIndex(index: LuaExpression): boolean {
	return (index.kind === LuaSyntaxKind.StringLiteralExpression && index.value === 'imgid')
		|| (index.kind === LuaSyntaxKind.IdentifierExpression && index.name === 'imgid');
}

function getRootIdentifier(expression: LuaExpression): string | undefined {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.name;
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression || expression.kind === LuaSyntaxKind.IndexExpression) {
		return getRootIdentifier(expression.base);
	}
	return undefined;
}

function looksLikeSpriteLikeTarget(expression: LuaExpression): boolean {
	const root = getRootIdentifier(expression);
	if (!root) {
		return false;
	}
	if (root === 'self') {
		return true;
	}
	const loweredRoot = root.toLowerCase();
	return loweredRoot.includes('sprite');
}

function isSpriteComponentImageIdAssignmentTarget(target: LuaExpression): boolean {
	if (target.kind === LuaSyntaxKind.MemberExpression) {
		if (target.identifier !== 'imgid') {
			return false;
		}
		return looksLikeSpriteLikeTarget(target.base);
	}
	if (target.kind !== LuaSyntaxKind.IndexExpression) {
		return false;
	}
	if (!isImgIdIndex(target.index)) {
		return false;
	}
	return looksLikeSpriteLikeTarget(target.base);
}

function lintSpriteImgIdAssignmentPattern(target: LuaExpression, issues: LuaLintIssue[]): void {
	if (!isSpriteComponentImageIdAssignmentTarget(target)) {
		return;
	}
	let targetExpr = '';
	let isSelfTarget = false;
	if (target.kind === LuaSyntaxKind.MemberExpression) {
		isSelfTarget = isSelfExpressionRoot(target.base);
		targetExpr = `${isSelfTarget ? 'self' : getRootIdentifier(target.base)}`;
	} else if (target.kind === LuaSyntaxKind.IndexExpression) {
		const root = getRootIdentifier(target.base);
		isSelfTarget = root === 'self';
		targetExpr = isSelfTarget ? 'self' : root;
	}
	const replacementBase = targetExpr || 'sprite_component';
	const message = isSelfTarget
		? 'Direct imgid assignment on sprite component is forbidden. Use self.gfx(<img>) instead.'
		: 'Direct imgid assignment on sprite component is forbidden. Use self.gfx(<img>) or <sprite_component>.gfx(<img>) instead.';
	pushIssue(
		issues,
		'imgid_assignment_pattern',
		target,
		`${message.replace('<sprite_component>', replacementBase)}`,
	);
}

function isSelfHasTagCall(expression: LuaExpression): boolean {
	if (expression.kind !== LuaSyntaxKind.CallExpression) {
		return false;
	}
	if (getCallMethodName(expression) !== 'has_tag') {
		return false;
	}
	if (expression.callee.kind === LuaSyntaxKind.MemberExpression) {
		return isSelfExpressionRoot(expression.callee.base);
	}
	if (expression.callee.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.callee.name === 'self';
	}
	return false;
}

function isRequireCallExpression(expression: LuaExpression | undefined): boolean {
	if (!expression || expression.kind !== LuaSyntaxKind.CallExpression) {
		return false;
	}
	return expression.callee.kind === LuaSyntaxKind.IdentifierExpression && expression.callee.name === 'require';
}

function isSingleUseLocalCandidateValue(expression: LuaExpression | undefined): boolean {
	if (!expression || expression.kind !== LuaSyntaxKind.CallExpression) {
		return false;
	}
	if (isRequireCallExpression(expression)) {
		return false;
	}
	if (isSelfHasTagCall(expression)) {
		return false;
	}
	return true;
}

function getRangeLineSpan(node: { readonly range: { readonly start: { readonly line: number; }; readonly end: { readonly line: number; }; }; }): number {
	const lineSpan = node.range.end.line - node.range.start.line + 1;
	if (lineSpan <= 0) {
		return 1;
	}
	return lineSpan;
}

function isTrivialSingleUseLocalHelperFunctionExpression(expression: LuaFunctionExpression): boolean {
	if (getRangeLineSpan(expression) > SINGLE_USE_LOCAL_SMALL_HELPER_MAX_LINES) {
		return false;
	}
	if (expression.parameters.length !== 0) {
		return false;
	}
	const bodyStatements = expression.body.body;
	if (bodyStatements.length !== 1) {
		return false;
	}
	const onlyStatement = bodyStatements[0];
	if (onlyStatement.kind !== LuaSyntaxKind.ReturnStatement) {
		return false;
	}
	if (onlyStatement.expressions.length !== 1) {
		return false;
	}
	return true;
}

function resolveSingleUseLocalReportKindForValue(expression: LuaExpression | undefined): SingleUseLocalReportKind | null {
	if (isSingleUseLocalCandidateValue(expression)) {
		return 'call_result';
	}
	if (expression && expression.kind === LuaSyntaxKind.FunctionExpression && isTrivialSingleUseLocalHelperFunctionExpression(expression)) {
		return 'small_helper';
	}
	return null;
}

function lintSelfImgIdAssignmentPattern(target: LuaExpression, value: LuaExpression | undefined, issues: LuaLintIssue[]): void {
	if (!isSelfImageIdAssignmentTarget(target) || !value) {
		return;
	}
	if (isSpriteComponentImageIdAssignmentTarget(target)) {
		return;
	}
	if (value.kind !== LuaSyntaxKind.StringLiteralExpression && value.kind !== LuaSyntaxKind.NilLiteralExpression) {
		return;
	}
	if (value.kind === LuaSyntaxKind.StringLiteralExpression && value.value !== '') {
		return;
	}
	pushIssue(
		issues,
		'self_imgid_assignment_pattern',
		target,
		'Forbidden self.*imgid assignment variant. Use self.visible=false / self.<non_standard_sprite_component>.enabled=false instead of setting imgid to empty string or nil.',
	);
}

function lintMultiHasTagPattern(expression: LuaExpression, issues: LuaLintIssue[]): void {
	const hasTagCheckCount = countHasTagCalls(expression);
	if (hasTagCheckCount <= 1) {
		return;
	}
	pushIssue(
		issues,
		'multi_has_tag_pattern',
		expression,
		`Statement contains ${hasTagCheckCount} has_tag checks. Use tag_groups, tag_derivations, or derived_tags instead.`,
	);
}

function isMethodLikeFunctionDeclaration(statement: LuaFunctionDeclarationStatement): boolean {
	return statement.name.identifiers.length > 1 || !!statement.name.methodName;
}

function isSimpleCallableExpression(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.IdentifierExpression
		|| expression.kind === LuaSyntaxKind.MemberExpression
		|| expression.kind === LuaSyntaxKind.IndexExpression;
}

function matchesForwardedArgumentList(argumentsList: ReadonlyArray<LuaExpression>, parameterNames: ReadonlyArray<string>): boolean {
	if (argumentsList.length !== parameterNames.length) {
		return false;
	}
	for (let index = 0; index < parameterNames.length; index += 1) {
		const argument = argumentsList[index];
		if (!isIdentifier(argument, parameterNames[index])) {
			return false;
		}
	}
	return true;
}

function matchesIndexLookupGetter(expression: LuaExpression, parameterNames: ReadonlyArray<string>): boolean {
	if (parameterNames.length !== 1 || expression.kind !== LuaSyntaxKind.IndexExpression) {
		return false;
	}
	return isIdentifier(expression.index, parameterNames[0]);
}

function isDirectValueGetterExpression(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.IdentifierExpression
		|| expression.kind === LuaSyntaxKind.MemberExpression
		|| expression.kind === LuaSyntaxKind.IndexExpression;
}

function isBuiltinCallExpression(expression: LuaCallExpression): boolean {
	if (expression.methodName && expression.callee.kind === LuaSyntaxKind.IdentifierExpression) {
		return BUILTIN_TABLE_NAMES.has(expression.callee.name);
	}
	if (expression.callee.kind === LuaSyntaxKind.IdentifierExpression) {
		return BUILTIN_GLOBAL_FUNCTIONS.has(expression.callee.name);
	}
	if (expression.callee.kind !== LuaSyntaxKind.MemberExpression) {
		return false;
	}
	if (expression.callee.base.kind !== LuaSyntaxKind.IdentifierExpression) {
		return false;
	}
	return BUILTIN_TABLE_NAMES.has(expression.callee.base.name);
}

function getTableFieldKey(field: LuaTableField): string {
	if (field.kind === LuaTableFieldKind.IdentifierKey) {
		return field.name;
	}
	if (field.kind !== LuaTableFieldKind.ExpressionKey) {
		return undefined;
	}
	if (field.key.kind === LuaSyntaxKind.StringLiteralExpression) {
		return field.key.value;
	}
	if (field.key.kind === LuaSyntaxKind.IdentifierExpression) {
		return field.key.name;
	}
	return undefined;
}

function getCopiedSourceKey(expression: LuaExpression, sourceIdentifier: string): string {
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		if (expression.base.kind !== LuaSyntaxKind.IdentifierExpression || expression.base.name !== sourceIdentifier) {
			return undefined;
		}
		return expression.identifier;
	}
	if (expression.kind !== LuaSyntaxKind.IndexExpression) {
		return undefined;
	}
	if (expression.base.kind !== LuaSyntaxKind.IdentifierExpression || expression.base.name !== sourceIdentifier) {
		return undefined;
	}
	if (expression.index.kind === LuaSyntaxKind.StringLiteralExpression) {
		return expression.index.value;
	}
	if (expression.index.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.index.name;
	}
	return undefined;
}

function matchesPureCopyFunctionPattern(functionExpression: LuaFunctionExpression): boolean {
	if (functionExpression.parameters.length !== 1) {
		return false;
	}
	const body = functionExpression.body.body;
	if (body.length !== 1) {
		return false;
	}
	const onlyStatement = body[0];
	if (onlyStatement.kind !== LuaSyntaxKind.ReturnStatement || onlyStatement.expressions.length !== 1) {
		return false;
	}
	const onlyExpression = onlyStatement.expressions[0];
	if (onlyExpression.kind !== LuaSyntaxKind.TableConstructorExpression || onlyExpression.fields.length === 0) {
		return false;
	}
	const sourceIdentifier = functionExpression.parameters[0].name;
	for (const field of onlyExpression.fields) {
		const fieldKey = getTableFieldKey(field);
		if (!fieldKey) {
			return false;
		}
		const copiedKey = getCopiedSourceKey(field.value, sourceIdentifier);
		if (!copiedKey || copiedKey !== fieldKey) {
			return false;
		}
	}
	return true;
}

function matchesCallDelegationGetter(expression: LuaExpression, parameterNames: ReadonlyArray<string>): boolean {
	if (expression.kind !== LuaSyntaxKind.CallExpression) {
		return false;
	}
	if (!isSimpleCallableExpression(expression.callee)) {
		return false;
	}
	if (isBuiltinCallExpression(expression)) {
		return false;
	}
	return matchesForwardedArgumentList(expression.arguments, parameterNames);
}

function matchesLocalAliasReturnWrapperPattern(functionExpression: LuaFunctionExpression): boolean {
	const body = functionExpression.body.body;
	if (body.length !== 2) {
		return false;
	}
	const localAssignment = body[0];
	const returnStatement = body[1];
	if (localAssignment.kind !== LuaSyntaxKind.LocalAssignmentStatement) {
		return false;
	}
	if (returnStatement.kind !== LuaSyntaxKind.ReturnStatement || returnStatement.expressions.length !== 1) {
		return false;
	}
	const assignment = localAssignment as LuaLocalAssignmentStatement;
	if (assignment.names.length !== 1 || assignment.values.length !== 1) {
		return false;
	}
	const returned = returnStatement.expressions[0];
	return returned.kind === LuaSyntaxKind.IdentifierExpression && returned.name === assignment.names[0].name;
}

function matchesGetterPattern(functionExpression: LuaFunctionExpression): boolean {
	const body = functionExpression.body.body;
	if (matchesLocalAliasReturnWrapperPattern(functionExpression)) {
		return true;
	}
	if (body.length !== 1) {
		return false;
	}
	const returnStatement = body[0];
	if (returnStatement.kind !== LuaSyntaxKind.ReturnStatement || returnStatement.expressions.length !== 1) {
		return false;
	}
	const expression = returnStatement.expressions[0];
	const parameterNames = getFunctionParameterNames(functionExpression);
	return isDirectValueGetterExpression(expression)
		|| matchesIndexLookupGetter(expression, parameterNames)
		|| matchesCallDelegationGetter(expression, parameterNames);
}

function isComparisonOperator(operator: LuaBinaryOperator): boolean {
	return operator === LuaBinaryOperator.Equal
		|| operator === LuaBinaryOperator.NotEqual
		|| operator === LuaBinaryOperator.LessThan
		|| operator === LuaBinaryOperator.LessEqual
		|| operator === LuaBinaryOperator.GreaterThan
		|| operator === LuaBinaryOperator.GreaterEqual;
}

function isComparisonWrapperProbeExpression(expression: LuaExpression): boolean {
	if (isDirectValueGetterExpression(expression)) {
		return true;
	}
	if (expression.kind !== LuaSyntaxKind.CallExpression) {
		return false;
	}
	if (isBuiltinCallExpression(expression)) {
		return false;
	}
	return isDelegationCallCandidate(expression);
}

function isSingleValueComparisonWrapperExpression(expression: LuaExpression): boolean {
	if (expression.kind !== LuaSyntaxKind.BinaryExpression || !isComparisonOperator(expression.operator)) {
		return false;
	}
	const leftLiteral = isPrimitiveLiteralExpression(expression.left);
	const rightLiteral = isPrimitiveLiteralExpression(expression.right);
	if (leftLiteral === rightLiteral) {
		return false;
	}
	const probe = leftLiteral ? expression.right : expression.left;
	return isComparisonWrapperProbeExpression(probe);
}

function matchesComparisonWrapperGetterPattern(functionExpression: LuaFunctionExpression): boolean {
	if (functionExpression.parameters.length !== 0 || functionExpression.hasVararg) {
		return false;
	}
	const body = functionExpression.body.body;
	if (body.length !== 1) {
		return false;
	}
	const statement = body[0];
	if (statement.kind !== LuaSyntaxKind.ReturnStatement || statement.expressions.length !== 1) {
		return false;
	}
	return isSingleValueComparisonWrapperExpression(statement.expressions[0]);
}

function isAssignableStorageExpression(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.IdentifierExpression
		|| expression.kind === LuaSyntaxKind.MemberExpression
		|| expression.kind === LuaSyntaxKind.IndexExpression;
}

function matchesSetterPattern(functionExpression: LuaFunctionExpression): boolean {
	const body = functionExpression.body.body;
	if (functionExpression.parameters.length < 1 || body.length !== 1) {
		return false;
	}
	const assignment = body[0];
	if (assignment.kind !== LuaSyntaxKind.AssignmentStatement) {
		return false;
	}
	if (assignment.operator !== LuaAssignmentOperator.Assign || assignment.left.length !== 1 || assignment.right.length !== 1) {
		return false;
	}
	const target = assignment.left[0];
	if (!isAssignableStorageExpression(target)) {
		return false;
	}
	const value = assignment.right[0];
	if (value.kind !== LuaSyntaxKind.IdentifierExpression) {
		return false;
	}
	const parameterNames = new Set<string>(getFunctionParameterNames(functionExpression));
	if (!parameterNames.has(value.name)) {
		return false;
	}
	return !(target.kind === LuaSyntaxKind.IdentifierExpression && target.name === value.name);
}

function matchesMeaninglessSingleLineMethodPattern(functionExpression: LuaFunctionExpression): boolean {
	const body = functionExpression.body.body;
	if (body.length !== 1) {
		return false;
	}
	const statement = body[0];
	if (statement.kind === LuaSyntaxKind.CallStatement) {
		return isDelegationCallCandidate(statement.expression);
	}
	if (statement.kind !== LuaSyntaxKind.ReturnStatement || statement.expressions.length !== 1) {
		return false;
	}
	const returnExpression = statement.expressions[0];
	return returnExpression.kind === LuaSyntaxKind.CallExpression && isDelegationCallCandidate(returnExpression);
}

function expressionContainsInlineTableOrFunction(expression: LuaExpression): boolean {
	switch (expression.kind) {
		case LuaSyntaxKind.TableConstructorExpression:
		case LuaSyntaxKind.FunctionExpression:
			return true;
		case LuaSyntaxKind.MemberExpression:
			return expressionContainsInlineTableOrFunction(expression.base);
		case LuaSyntaxKind.IndexExpression:
			return expressionContainsInlineTableOrFunction(expression.base)
				|| expressionContainsInlineTableOrFunction(expression.index);
		case LuaSyntaxKind.BinaryExpression:
			return expressionContainsInlineTableOrFunction(expression.left)
				|| expressionContainsInlineTableOrFunction(expression.right);
		case LuaSyntaxKind.UnaryExpression:
			return expressionContainsInlineTableOrFunction(expression.operand);
		case LuaSyntaxKind.CallExpression:
			if (expressionContainsInlineTableOrFunction(expression.callee)) {
				return true;
			}
			for (const argument of expression.arguments) {
				if (expressionContainsInlineTableOrFunction(argument)) {
					return true;
				}
			}
			return false;
		default:
			return false;
	}
}

function isDelegationCallCandidate(expression: LuaCallExpression): boolean {
	if (expressionContainsInlineTableOrFunction(expression.callee)) {
		return false;
	}
	for (const argument of expression.arguments) {
		if (expressionContainsInlineTableOrFunction(argument)) {
			return false;
		}
	}
	return true;
}

function matchesBuiltinRecreationPattern(functionExpression: LuaFunctionExpression): boolean {
	const body = functionExpression.body.body;
	if (body.length !== 1) {
		return false;
	}
	const statement = body[0];
	if (statement.kind !== LuaSyntaxKind.ReturnStatement || statement.expressions.length !== 1) {
		return false;
	}
	const expression = statement.expressions[0];
	if (expression.kind !== LuaSyntaxKind.CallExpression) {
		return false;
	}
	if (!isBuiltinCallExpression(expression)) {
		return false;
	}
	return matchesForwardedArgumentList(expression.arguments, getFunctionParameterNames(functionExpression));
}

function matchesForbiddenRandomHelperPattern(functionName: string): boolean {
	return FORBIDDEN_RANDOM_HELPER_NAME_PATTERN.test(getFunctionLeafName(functionName));
}

function getSingleReturnedStringValue(statement: LuaStatement): string {
	if (statement.kind !== LuaSyntaxKind.ReturnStatement || statement.expressions.length !== 1) {
		return undefined;
	}
	const returned = statement.expressions[0];
	if (returned.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return undefined;
	}
	return returned.value;
}

function isTruthyParamCondition(expression: LuaExpression, parameterName: string): boolean {
	return expression.kind === LuaSyntaxKind.IdentifierExpression && expression.name === parameterName;
}

function isFalsyParamCondition(expression: LuaExpression, parameterName: string): boolean {
	return expression.kind === LuaSyntaxKind.UnaryExpression
		&& expression.operator === LuaUnaryOperator.Not
		&& expression.operand.kind === LuaSyntaxKind.IdentifierExpression
		&& expression.operand.name === parameterName;
}

function returnsBool01Pair(whenTrue: string, whenFalse: string): boolean {
	return whenTrue === '1' && whenFalse === '0';
}

function matchesBool01DuplicatePattern(functionExpression: LuaFunctionExpression): boolean {
	if (functionExpression.parameters.length !== 1 || functionExpression.hasVararg) {
		return false;
	}
	const parameterName = functionExpression.parameters[0].name;
	const body = functionExpression.body.body;
	if (body.length === 2) {
		const firstStatement = body[0];
		const fallback = getSingleReturnedStringValue(body[1]);
		if (firstStatement.kind !== LuaSyntaxKind.IfStatement || !fallback || firstStatement.clauses.length !== 1) {
			return false;
		}
		const onlyClause = firstStatement.clauses[0];
		if (!onlyClause.condition || onlyClause.block.body.length !== 1) {
			return false;
		}
		const clauseReturn = getSingleReturnedStringValue(onlyClause.block.body[0]);
		if (!clauseReturn) {
			return false;
		}
		if (isTruthyParamCondition(onlyClause.condition, parameterName)) {
			return returnsBool01Pair(clauseReturn, fallback);
		}
		if (isFalsyParamCondition(onlyClause.condition, parameterName)) {
			return returnsBool01Pair(fallback, clauseReturn);
		}
		return false;
	}
	if (body.length === 1) {
		const onlyIf = body[0];
		if (onlyIf.kind !== LuaSyntaxKind.IfStatement || onlyIf.clauses.length !== 2) {
			return false;
		}
		const first = onlyIf.clauses[0];
		const second = onlyIf.clauses[1];
		if (!first.condition || second.condition || first.block.body.length !== 1 || second.block.body.length !== 1) {
			return false;
		}
		const firstReturn = getSingleReturnedStringValue(first.block.body[0]);
		const secondReturn = getSingleReturnedStringValue(second.block.body[0]);
		if (!firstReturn || !secondReturn) {
			return false;
		}
		if (isTruthyParamCondition(first.condition, parameterName)) {
			return returnsBool01Pair(firstReturn, secondReturn);
		}
		if (isFalsyParamCondition(first.condition, parameterName)) {
			return returnsBool01Pair(secondReturn, firstReturn);
		}
	}
	return false;
}

function getCallReceiverName(expression: LuaCallExpression): string {
	if (expression.methodName && expression.callee.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.callee.name;
	}
	if (expression.callee.kind === LuaSyntaxKind.MemberExpression && expression.callee.base.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.callee.base.name;
	}
	return undefined;
}

function getCallMethodName(expression: LuaCallExpression): string {
	if (expression.methodName && expression.methodName.length > 0) {
		return expression.methodName;
	}
	if (expression.callee.kind === LuaSyntaxKind.MemberExpression) {
		return expression.callee.identifier;
	}
	return undefined;
}

function getCallReceiverExpression(expression: LuaCallExpression): LuaExpression | undefined {
	if (expression.methodName && expression.methodName.length > 0) {
		return expression.callee;
	}
	if (expression.callee.kind === LuaSyntaxKind.MemberExpression) {
		return expression.callee.base;
	}
	return undefined;
}

function isErrorCallExpression(expression: LuaExpression): boolean {
	if (expression.kind !== LuaSyntaxKind.CallExpression) {
		return false;
	}
	const callExpression = expression as LuaCallExpression;
	return callExpression.callee.kind === LuaSyntaxKind.IdentifierExpression && callExpression.callee.name === 'error';
}

function isErrorTerminatingStatement(statement: LuaStatement): boolean {
	if (statement.kind === LuaSyntaxKind.CallStatement) {
		return isErrorCallExpression(statement.expression);
	}
	if (statement.kind === LuaSyntaxKind.ReturnStatement && statement.expressions.length === 1) {
		return isErrorCallExpression(statement.expressions[0]);
	}
	return false;
}

function matchesUselessAssertPattern(statement: LuaIfStatement): boolean {
	for (const clause of statement.clauses) {
		if (!clause.condition) {
			continue;
		}
		for (const clauseStatement of clause.block.body) {
			if (isErrorTerminatingStatement(clauseStatement)) {
				return true;
			}
		}
	}
	return false;
}

function lintForbiddenStateCalls(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	const receiverName = getCallReceiverName(expression);
	if (!receiverName || !FORBIDDEN_STATE_CALL_RECEIVERS.has(receiverName)) {
		return;
	}
	const methodName = getCallMethodName(expression);
	if (methodName === 'transition_to') {
		pushIssue(
			issues,
			'forbidden_transition_to_pattern',
			expression,
			`Use of "${receiverName}:transition_to" is forbidden.`,
		);
		return;
	}
	if (methodName === 'matches_state_path') {
		pushIssue(
			issues,
			'forbidden_matches_state_path_pattern',
			expression,
			`Use of "${receiverName}:matches_state_path" is forbidden.`,
		);
	}
}

function isEventsContainerExpression(expression: LuaExpression): boolean {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.name === 'events';
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		return expression.identifier === 'events';
	}
	if (expression.kind !== LuaSyntaxKind.IndexExpression) {
		return false;
	}
	if (expression.index.kind === LuaSyntaxKind.StringLiteralExpression) {
		return expression.index.value === 'events';
	}
	if (expression.index.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.index.name === 'events';
	}
	return false;
}

function isEventsOnCallExpression(expression: LuaCallExpression): boolean {
	const methodName = getCallMethodName(expression);
	if (methodName !== 'on') {
		return false;
	}
	let receiver: LuaExpression;
	if (expression.methodName && expression.methodName.length > 0) {
		receiver = expression.callee;
	} else if (expression.callee.kind === LuaSyntaxKind.MemberExpression) {
		receiver = expression.callee.base;
	} else {
		return false;
	}
	return isEventsContainerExpression(receiver);
}

function isEventsEmitCallExpression(expression: LuaExpression): expression is LuaCallExpression {
	if (expression.kind !== LuaSyntaxKind.CallExpression) {
		return false;
	}
	if (getCallMethodName(expression) !== 'emit') {
		return false;
	}
	const receiver = getCallReceiverExpression(expression);
	if (!receiver) {
		return false;
	}
	return isEventsContainerExpression(receiver);
}

function isStateControllerExpression(expression: LuaExpression): boolean {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.name === 'sc';
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		return expression.identifier === 'sc';
	}
	if (expression.kind !== LuaSyntaxKind.IndexExpression) {
		return false;
	}
	if (expression.index.kind === LuaSyntaxKind.StringLiteralExpression) {
		return expression.index.value === 'sc';
	}
	if (expression.index.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.index.name === 'sc';
	}
	return false;
}

function isStateControllerDispatchCallExpression(expression: LuaCallExpression): boolean {
	const methodName = getCallMethodName(expression);
	if (methodName !== 'dispatch') {
		return false;
	}
	const receiver = getCallReceiverExpression(expression);
	if (!receiver) {
		return false;
	}
	return isStateControllerExpression(receiver);
}

function isDispatchStateEventCallExpression(expression: LuaCallExpression): boolean {
	return getCallMethodName(expression) === 'dispatch_state_event';
}

function lintForbiddenDispatchPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	const dispatchStateEventCall = isDispatchStateEventCallExpression(expression);
	const stateControllerDispatchCall = isStateControllerDispatchCallExpression(expression);
	if (!dispatchStateEventCall && !stateControllerDispatchCall) {
		return;
	}
	pushIssue(
		issues,
		'forbidden_dispatch_pattern',
		expression,
		'State dispatch APIs are forbidden in cart code (dispatch_state_event(...) and sc:dispatch(...)). Do not replace one with the other; model transitions directly in FSM definitions (on/input/process_input/timelines).',
	);
}

function isCrossObjectDispatchStateEventCallExpression(expression: LuaCallExpression): boolean {
	if (!isDispatchStateEventCallExpression(expression)) {
		return false;
	}
	const receiver = getCallReceiverExpression(expression);
	if (!receiver) {
		return true;
	}
	return !isSelfExpressionRoot(receiver);
}

function findCallExpressionInExpression(
	expression: LuaExpression | null,
	predicate: (expression: LuaCallExpression) => boolean,
): LuaCallExpression | undefined {
	if (!expression) {
		return undefined;
	}
	if (expression.kind === LuaSyntaxKind.CallExpression && predicate(expression)) {
		return expression as LuaCallExpression;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.MemberExpression:
			return findCallExpressionInExpression(expression.base, predicate);
		case LuaSyntaxKind.IndexExpression:
			return findCallExpressionInExpression(expression.base, predicate)
				|| findCallExpressionInExpression(expression.index, predicate);
		case LuaSyntaxKind.BinaryExpression:
			return findCallExpressionInExpression(expression.left, predicate)
				|| findCallExpressionInExpression(expression.right, predicate);
		case LuaSyntaxKind.UnaryExpression:
			return findCallExpressionInExpression(expression.operand, predicate);
		case LuaSyntaxKind.CallExpression: {
			const fromCallee = findCallExpressionInExpression(expression.callee, predicate);
			if (fromCallee) {
				return fromCallee;
			}
			for (const argument of expression.arguments) {
				const fromArg = findCallExpressionInExpression(argument, predicate);
				if (fromArg) {
					return fromArg;
				}
			}
			return undefined;
		}
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					const fromKey = findCallExpressionInExpression(field.key, predicate);
					if (fromKey) {
						return fromKey;
					}
				}
				const fromValue = findCallExpressionInExpression(field.value, predicate);
				if (fromValue) {
					return fromValue;
				}
			}
			return undefined;
		case LuaSyntaxKind.FunctionExpression:
			return findCallExpressionInStatements(expression.body.body, predicate);
		default:
			return undefined;
	}
}

function visitCallExpressionsInExpression(
	expression: LuaExpression | null,
	visitor: (expression: LuaCallExpression) => void,
): void {
	if (!expression) {
		return;
	}
	if (expression.kind === LuaSyntaxKind.CallExpression) {
		visitor(expression);
	}
	switch (expression.kind) {
		case LuaSyntaxKind.MemberExpression:
			visitCallExpressionsInExpression(expression.base, visitor);
			return;
		case LuaSyntaxKind.IndexExpression:
			visitCallExpressionsInExpression(expression.base, visitor);
			visitCallExpressionsInExpression(expression.index, visitor);
			return;
		case LuaSyntaxKind.BinaryExpression:
			visitCallExpressionsInExpression(expression.left, visitor);
			visitCallExpressionsInExpression(expression.right, visitor);
			return;
		case LuaSyntaxKind.UnaryExpression:
			visitCallExpressionsInExpression(expression.operand, visitor);
			return;
		case LuaSyntaxKind.CallExpression:
			visitCallExpressionsInExpression(expression.callee, visitor);
			for (const argument of expression.arguments) {
				visitCallExpressionsInExpression(argument, visitor);
			}
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					visitCallExpressionsInExpression(field.key, visitor);
				}
				visitCallExpressionsInExpression(field.value, visitor);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
			visitCallExpressionsInStatements(expression.body.body, visitor);
			return;
		default:
			return;
	}
}

function findCallExpressionInStatements(
	statements: ReadonlyArray<LuaStatement>,
	predicate: (expression: LuaCallExpression) => boolean,
): LuaCallExpression | undefined {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					const fromValue = findCallExpressionInExpression(value, predicate);
					if (fromValue) {
						return fromValue;
					}
				}
				break;
			case LuaSyntaxKind.AssignmentStatement:
				for (const left of statement.left) {
					const fromLeft = findCallExpressionInExpression(left, predicate);
					if (fromLeft) {
						return fromLeft;
					}
				}
				for (const right of statement.right) {
					const fromRight = findCallExpressionInExpression(right, predicate);
					if (fromRight) {
						return fromRight;
					}
				}
				break;
			case LuaSyntaxKind.LocalFunctionStatement: {
				const fromFunction = findCallExpressionInStatements(statement.functionExpression.body.body, predicate);
				if (fromFunction) {
					return fromFunction;
				}
				break;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement: {
				const fromFunction = findCallExpressionInStatements(statement.functionExpression.body.body, predicate);
				if (fromFunction) {
					return fromFunction;
				}
				break;
			}
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					const fromExpression = findCallExpressionInExpression(expression, predicate);
					if (fromExpression) {
						return fromExpression;
					}
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					const fromCondition = findCallExpressionInExpression(clause.condition, predicate);
					if (fromCondition) {
						return fromCondition;
					}
					const fromBlock = findCallExpressionInStatements(clause.block.body, predicate);
					if (fromBlock) {
						return fromBlock;
					}
				}
				break;
			case LuaSyntaxKind.WhileStatement: {
				const fromCondition = findCallExpressionInExpression(statement.condition, predicate);
				if (fromCondition) {
					return fromCondition;
				}
				const fromBlock = findCallExpressionInStatements(statement.block.body, predicate);
				if (fromBlock) {
					return fromBlock;
				}
				break;
			}
			case LuaSyntaxKind.RepeatStatement: {
				const fromBlock = findCallExpressionInStatements(statement.block.body, predicate);
				if (fromBlock) {
					return fromBlock;
				}
				const fromCondition = findCallExpressionInExpression(statement.condition, predicate);
				if (fromCondition) {
					return fromCondition;
				}
				break;
			}
			case LuaSyntaxKind.ForNumericStatement: {
				const fromStart = findCallExpressionInExpression(statement.start, predicate);
				if (fromStart) {
					return fromStart;
				}
				const fromLimit = findCallExpressionInExpression(statement.limit, predicate);
				if (fromLimit) {
					return fromLimit;
				}
				const fromStep = findCallExpressionInExpression(statement.step, predicate);
				if (fromStep) {
					return fromStep;
				}
				const fromBlock = findCallExpressionInStatements(statement.block.body, predicate);
				if (fromBlock) {
					return fromBlock;
				}
				break;
			}
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					const fromIterator = findCallExpressionInExpression(iterator, predicate);
					if (fromIterator) {
						return fromIterator;
					}
				}
				{
					const fromBlock = findCallExpressionInStatements(statement.block.body, predicate);
					if (fromBlock) {
						return fromBlock;
					}
				}
				break;
			case LuaSyntaxKind.DoStatement: {
				const fromBlock = findCallExpressionInStatements(statement.block.body, predicate);
				if (fromBlock) {
					return fromBlock;
				}
				break;
			}
			case LuaSyntaxKind.CallStatement: {
				const fromCall = findCallExpressionInExpression(statement.expression, predicate);
				if (fromCall) {
					return fromCall;
				}
				break;
			}
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
	return undefined;
}

function visitCallExpressionsInStatements(
	statements: ReadonlyArray<LuaStatement>,
	visitor: (expression: LuaCallExpression) => void,
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					visitCallExpressionsInExpression(value, visitor);
				}
				break;
			case LuaSyntaxKind.AssignmentStatement:
				for (const left of statement.left) {
					visitCallExpressionsInExpression(left, visitor);
				}
				for (const right of statement.right) {
					visitCallExpressionsInExpression(right, visitor);
				}
				break;
			case LuaSyntaxKind.LocalFunctionStatement:
				visitCallExpressionsInStatements(statement.functionExpression.body.body, visitor);
				break;
			case LuaSyntaxKind.FunctionDeclarationStatement:
				visitCallExpressionsInStatements(statement.functionExpression.body.body, visitor);
				break;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					visitCallExpressionsInExpression(expression, visitor);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					visitCallExpressionsInExpression(clause.condition, visitor);
					visitCallExpressionsInStatements(clause.block.body, visitor);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				visitCallExpressionsInExpression(statement.condition, visitor);
				visitCallExpressionsInStatements(statement.block.body, visitor);
				break;
			case LuaSyntaxKind.RepeatStatement:
				visitCallExpressionsInStatements(statement.block.body, visitor);
				visitCallExpressionsInExpression(statement.condition, visitor);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				visitCallExpressionsInExpression(statement.start, visitor);
				visitCallExpressionsInExpression(statement.limit, visitor);
				visitCallExpressionsInExpression(statement.step, visitor);
				visitCallExpressionsInStatements(statement.block.body, visitor);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					visitCallExpressionsInExpression(iterator, visitor);
				}
				visitCallExpressionsInStatements(statement.block.body, visitor);
				break;
			case LuaSyntaxKind.DoStatement:
				visitCallExpressionsInStatements(statement.block.body, visitor);
				break;
			case LuaSyntaxKind.CallStatement:
				visitCallExpressionsInExpression(statement.expression, visitor);
				break;
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
}

function isGetSpaceCallExpression(expression: LuaExpression | null): boolean {
	if (!expression || expression.kind !== LuaSyntaxKind.CallExpression) {
		return false;
	}
	return expression.callee.kind === LuaSyntaxKind.IdentifierExpression
		&& expression.callee.name === 'get_space'
		&& expression.arguments.length === 0;
}

function lintSetSpaceRoundtripPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (getCallMethodName(expression) !== 'set_space' || expression.arguments.length !== 1) {
		return;
	}
	if (!isGetSpaceCallExpression(expression.arguments[0])) {
		return;
	}
	pushIssue(
		issues,
		'set_space_roundtrip_pattern',
		expression,
		'set_space(get_space()) is forbidden. Set the target space directly instead of re-reading and re-applying the same space.',
	);
}

function isEventProxyFlagPropertyName(propertyName: string): boolean {
	const lowered = propertyName.toLowerCase();
	return lowered.endsWith('_requested')
		|| lowered.endsWith('_pending')
		|| lowered.endsWith('_done')
		|| lowered.startsWith('pending_');
}

type SelfPropertyAssignmentMatch = {
	readonly propertyName: string;
	readonly target: LuaExpression;
};

function findSelfPropertyAssignmentInStatements(
	statements: ReadonlyArray<LuaStatement>,
	propertyPredicate: (propertyName: string) => boolean,
): SelfPropertyAssignmentMatch | undefined {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.AssignmentStatement:
				for (const target of statement.left) {
					const propertyName = getSelfAssignedPropertyNameFromTarget(target);
					if (!propertyName || !propertyPredicate(propertyName)) {
						continue;
					}
					return {
						propertyName,
						target,
					};
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					const nested = findSelfPropertyAssignmentInStatements(clause.block.body, propertyPredicate);
					if (nested) {
						return nested;
					}
				}
				break;
			case LuaSyntaxKind.WhileStatement: {
				const nested = findSelfPropertyAssignmentInStatements(statement.block.body, propertyPredicate);
				if (nested) {
					return nested;
				}
				break;
			}
			case LuaSyntaxKind.RepeatStatement: {
				const nested = findSelfPropertyAssignmentInStatements(statement.block.body, propertyPredicate);
				if (nested) {
					return nested;
				}
				break;
			}
			case LuaSyntaxKind.ForNumericStatement: {
				const nested = findSelfPropertyAssignmentInStatements(statement.block.body, propertyPredicate);
				if (nested) {
					return nested;
				}
				break;
			}
			case LuaSyntaxKind.ForGenericStatement: {
				const nested = findSelfPropertyAssignmentInStatements(statement.block.body, propertyPredicate);
				if (nested) {
					return nested;
				}
				break;
			}
			case LuaSyntaxKind.DoStatement: {
				const nested = findSelfPropertyAssignmentInStatements(statement.block.body, propertyPredicate);
				if (nested) {
					return nested;
				}
				break;
			}
			case LuaSyntaxKind.LocalAssignmentStatement:
			case LuaSyntaxKind.LocalFunctionStatement:
			case LuaSyntaxKind.FunctionDeclarationStatement:
			case LuaSyntaxKind.ReturnStatement:
			case LuaSyntaxKind.CallStatement:
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
	return undefined;
}

function isTickInputCheckCallExpression(expression: LuaCallExpression): boolean {
	if (expression.callee.kind === LuaSyntaxKind.IdentifierExpression) {
		const calleeName = expression.callee.name.toLowerCase();
		if (calleeName === 'action_triggered'
			|| calleeName === 'action_pressed'
			|| calleeName === 'action_released'
			|| calleeName === 'action_held') {
			return true;
		}
	}
	const methodName = getCallMethodName(expression);
	if (!methodName) {
		return false;
	}
	const loweredMethodName = methodName.toLowerCase();
	if (!loweredMethodName.includes('pressed')
		&& !loweredMethodName.includes('held')
		&& !loweredMethodName.includes('triggered')
		&& !loweredMethodName.includes('input')) {
		return false;
	}
	const receiver = getCallReceiverExpression(expression);
	return !!receiver && isSelfExpressionRoot(receiver);
}

function isDirectActionTriggeredCallExpression(expression: LuaExpression): expression is LuaCallExpression {
	return expression.kind === LuaSyntaxKind.CallExpression
		&& expression.callee.kind === LuaSyntaxKind.IdentifierExpression
		&& expression.callee.name === 'action_triggered';
}

function lintActionTriggeredBoolChainPattern(expression: LuaExpression, issues: LuaLintIssue[]): void {
	if (expression.kind !== LuaSyntaxKind.BinaryExpression) {
		return;
	}
	if (expression.operator !== LuaBinaryOperator.Or && expression.operator !== LuaBinaryOperator.And) {
		return;
	}
	if (!isDirectActionTriggeredCallExpression(expression.left) || !isDirectActionTriggeredCallExpression(expression.right)) {
		return;
	}
	pushIssue(
		issues,
		'action_triggered_bool_chain_pattern',
		expression,
		'Combining multiple action_triggered(...) calls with and/or is forbidden. Use one action_triggered query with complex action-query syntax instead.',
	);
}

function getSelfPropertyNameFromConditionExpression(expression: LuaExpression | null): string | undefined {
	if (!expression) {
		return undefined;
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression && isSelfExpressionRoot(expression.base)) {
		return expression.identifier;
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression && isSelfExpressionRoot(expression.base)) {
		return getExpressionKeyName(expression.index);
	}
	if (expression.kind === LuaSyntaxKind.UnaryExpression && expression.operator === LuaUnaryOperator.Not) {
		return getSelfPropertyNameFromConditionExpression(expression.operand);
	}
	return undefined;
}

function isFalseOrNilExpression(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.NilLiteralExpression
		|| (expression.kind === LuaSyntaxKind.BooleanLiteralExpression && expression.value === false);
}

function hasTransitionReturnInStatements(statements: ReadonlyArray<LuaStatement>): boolean {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					if (expression.kind === LuaSyntaxKind.StringLiteralExpression && expression.value.startsWith('/')) {
						return true;
					}
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (hasTransitionReturnInStatements(clause.block.body)) {
						return true;
					}
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				if (hasTransitionReturnInStatements(statement.block.body)) {
					return true;
				}
				break;
			case LuaSyntaxKind.RepeatStatement:
				if (hasTransitionReturnInStatements(statement.block.body)) {
					return true;
				}
				break;
			case LuaSyntaxKind.ForNumericStatement:
				if (hasTransitionReturnInStatements(statement.block.body)) {
					return true;
				}
				break;
			case LuaSyntaxKind.ForGenericStatement:
				if (hasTransitionReturnInStatements(statement.block.body)) {
					return true;
				}
				break;
			case LuaSyntaxKind.DoStatement:
				if (hasTransitionReturnInStatements(statement.block.body)) {
					return true;
				}
				break;
			default:
				break;
		}
	}
	return false;
}

function hasSelfPropertyResetInStatements(statements: ReadonlyArray<LuaStatement>, propertyName: string): boolean {
	for (const statement of statements) {
		if (statement.kind !== LuaSyntaxKind.AssignmentStatement || statement.operator !== LuaAssignmentOperator.Assign) {
			continue;
		}
		for (let index = 0; index < statement.left.length && index < statement.right.length; index += 1) {
			const targetPropertyName = getSelfAssignedPropertyNameFromTarget(statement.left[index]);
			if (targetPropertyName !== propertyName) {
				continue;
			}
			if (isFalseOrNilExpression(statement.right[index])) {
				return true;
			}
		}
	}
	return false;
}

function lintTickFlagPollingPattern(functionExpression: LuaFunctionExpression, issues: LuaLintIssue[]): void {
	for (const statement of functionExpression.body.body) {
		if (statement.kind !== LuaSyntaxKind.IfStatement) {
			continue;
		}
		for (const clause of statement.clauses) {
			const propertyName = getSelfPropertyNameFromConditionExpression(clause.condition);
			if (!propertyName) {
				continue;
			}
			const hasReset = hasSelfPropertyResetInStatements(clause.block.body, propertyName);
			if (!hasReset) {
				continue;
			}
			const hasTransitionReturn = hasTransitionReturnInStatements(clause.block.body);
			if (!hasTransitionReturn && !isEventProxyFlagPropertyName(propertyName)) {
				continue;
			}
			pushIssue(
				issues,
				'tick_flag_polling_pattern',
				clause.condition ?? statement,
				hasTransitionReturn
					? `Delayed event-proxy transition via self.${propertyName} in tick is forbidden. Handle the transition directly via FSM events/on maps, input handlers, process_input, or timelines instead of flag polling + reset + return.`
					: `Tick polling on self.${propertyName} is forbidden. Use FSM events/timelines/input handlers for transitions instead of tick-flag polling and manual resets.`,
			);
		}
	}
}

function lintTickInputCheckPattern(functionExpression: LuaFunctionExpression, issues: LuaLintIssue[]): void {
	const inputCheck = findCallExpressionInStatements(functionExpression.body.body, isTickInputCheckCallExpression);
	if (!inputCheck) {
		return;
	}
	pushIssue(
		issues,
		'tick_input_check_pattern',
		inputCheck,
		'Input checks inside tick are forbidden. Use FSM input handlers (player-index based), the FSM process_input handler, or events/timelines instead of polling input in tick.',
	);
}

function isObjectOrServiceResolverCallExpression(expression: LuaExpression | undefined): boolean {
	if (!expression || expression.kind !== LuaSyntaxKind.CallExpression) {
		return false;
	}
	return expression.callee.kind === LuaSyntaxKind.IdentifierExpression
		&& (expression.callee.name === 'object' || expression.callee.name === 'service');
}

function lintCrossObjectStateEventRelayPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (activeLintRules.has('forbidden_dispatch_pattern')) {
		return;
	}
	if (!isCrossObjectDispatchStateEventCallExpression(expression)) {
		return;
	}
	if (expression.arguments.length === 0 || expression.arguments[0].kind !== LuaSyntaxKind.IdentifierExpression) {
		return;
	}
	const receiver = getCallReceiverExpression(expression);
	if (!isObjectOrServiceResolverCallExpression(receiver)) {
		return;
	}
	pushIssue(
		issues,
		'cross_object_state_event_relay_pattern',
		expression,
		'Cross-object dispatch_state_event relay with dynamic event names is forbidden. Keep event ownership local and model transitions via FSM events/on maps.',
	);
}

function lintEventHandlerDispatchPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isEventsOnCallExpression(expression)) {
		return;
	}
	const globalDispatchBan = activeLintRules.has('forbidden_dispatch_pattern');
	for (const argument of expression.arguments) {
		const handlerField = findTableFieldByKey(argument, 'handler');
		if (!handlerField || handlerField.value.kind !== LuaSyntaxKind.FunctionExpression) {
			continue;
		}
		if (!globalDispatchBan) {
				const scDispatchCall = findCallExpressionInStatements(
					handlerField.value.body.body,
					isStateControllerDispatchCallExpression,
			);
			if (scDispatchCall) {
			pushIssue(
				issues,
				'event_handler_dispatch_pattern',
				scDispatchCall,
				'Event handler callbacks must not call sc:dispatch(...). Route event-driven transitions via FSM definitions instead of manual dispatch inside events:on handlers.',
			);
		}
				const crossObjectStateDispatchCall = findCallExpressionInStatements(
					handlerField.value.body.body,
					isCrossObjectDispatchStateEventCallExpression,
				);
				if (crossObjectStateDispatchCall) {
				pushIssue(
					issues,
					'event_handler_state_dispatch_pattern',
					crossObjectStateDispatchCall,
						'Event handler callbacks must not dispatch_state_event(...) on other objects/services. Keep transitions owned by each object/service FSM.',
					);
				}
		}
				const proxyFlagAssignment = findSelfPropertyAssignmentInStatements(
					handlerField.value.body.body,
					isEventProxyFlagPropertyName,
				);
			if (proxyFlagAssignment) {
				pushIssue(
					issues,
					'event_handler_flag_proxy_pattern',
					proxyFlagAssignment.target,
					`Event handler flag-proxy pattern is forbidden (self.${proxyFlagAssignment.propertyName}). Do not stage FSM transitions through *_requested/*_pending/*_done flags; use FSM events/timelines/input handlers directly.`,
				);
			}
		}
}

function lintDispatchFanoutLoopPattern(statement: LuaStatement, issues: LuaLintIssue[]): void {
	if (activeLintRules.has('forbidden_dispatch_pattern')) {
		return;
	}
	if (statement.kind !== LuaSyntaxKind.ForNumericStatement && statement.kind !== LuaSyntaxKind.ForGenericStatement) {
		return;
	}
	const dispatchCall = findCallExpressionInStatements(
		statement.block.body,
		isCrossObjectDispatchStateEventCallExpression,
	);
	if (!dispatchCall) {
		return;
	}
	pushIssue(
		issues,
		'dispatch_fanout_loop_pattern',
		dispatchCall,
		'Fan-out dispatch_state_event(...) loops are forbidden. Objects/services must own their own FSM/event handling instead of external manual dispatch loops.',
	);
}

function getEnsureVariableName(statement: LuaIfStatement): string {
	if (statement.clauses.length !== 1) {
		return undefined;
	}
	const clause = statement.clauses[0];
	const condition = clause.condition;
	if (!condition || condition.kind !== LuaSyntaxKind.BinaryExpression || condition.operator !== LuaBinaryOperator.Equal) {
		return undefined;
	}
	if (isNilExpression(condition.left) && condition.right.kind === LuaSyntaxKind.IdentifierExpression) {
		return condition.right.name;
	}
	if (isNilExpression(condition.right) && condition.left.kind === LuaSyntaxKind.IdentifierExpression) {
		return condition.left.name;
	}
	return undefined;
}

function matchesImgIdNilFallbackPattern(statement: LuaIfStatement): boolean {
	if (statement.clauses.length !== 1) {
		return false;
	}
	const clause = statement.clauses[0];
	const condition = clause.condition;
	if (!condition || condition.kind !== LuaSyntaxKind.BinaryExpression || condition.operator !== LuaBinaryOperator.Equal) {
		return false;
	}
	let variableName: string | undefined;
	if (isNilExpression(condition.left) && isIdentifier(condition.right, 'imgid')) {
		variableName = 'imgid';
	}
	if (isNilExpression(condition.right) && isIdentifier(condition.left, 'imgid')) {
		variableName = 'imgid';
	}
	if (variableName !== 'imgid') {
		return false;
	}
	if (clause.block.body.length !== 1) {
		return false;
	}
	const clauseStatement = clause.block.body[0];
	if (clauseStatement.kind !== LuaSyntaxKind.AssignmentStatement) {
		return false;
	}
	const assignment = clauseStatement as LuaAssignmentStatement;
	if (assignment.operator !== LuaAssignmentOperator.Assign || assignment.left.length !== 1 || assignment.right.length !== 1) {
		return false;
	}
	const target = assignment.left[0];
	return isIdentifier(target, variableName);
}

function matchesEnsurePattern(functionExpression: LuaFunctionExpression): boolean {
	const body = functionExpression.body.body;
	if (body.length !== 2) {
		return false;
	}
	if (body[0].kind !== LuaSyntaxKind.IfStatement || body[1].kind !== LuaSyntaxKind.ReturnStatement) {
		return false;
	}
	const ifStatement = body[0];
	const variableName = getEnsureVariableName(ifStatement);
	if (!variableName) {
		return false;
	}
	const clauseBody = ifStatement.clauses[0].block.body;
	if (clauseBody.length !== 1 || clauseBody[0].kind !== LuaSyntaxKind.AssignmentStatement) {
		return false;
	}
	const assignment = clauseBody[0] as LuaAssignmentStatement;
	if (assignment.operator !== LuaAssignmentOperator.Assign || assignment.left.length !== 1 || assignment.right.length !== 1) {
		return false;
	}
	if (!isIdentifier(assignment.left[0], variableName)) {
		return false;
	}
	const returnStatement = body[1];
	return returnStatement.expressions.length === 1 && isIdentifier(returnStatement.expressions[0], variableName);
}

function matchesEnsureLocalAliasPattern(functionExpression: LuaFunctionExpression): boolean {
	const body = functionExpression.body.body;
	if (body.length !== 3) {
		return false;
	}
	const localAssignment = body[0];
	const ifStatement = body[1];
	const returnStatement = body[2];
	if (localAssignment.kind !== LuaSyntaxKind.LocalAssignmentStatement) {
		return false;
	}
	if (localAssignment.names.length !== 1 || localAssignment.values.length !== 1) {
		return false;
	}
	const localName = localAssignment.names[0].name;
	if (ifStatement.kind !== LuaSyntaxKind.IfStatement || ifStatement.clauses.length !== 1) {
		return false;
	}
	const onlyClause = ifStatement.clauses[0];
	if (!onlyClause.condition || onlyClause.condition.kind !== LuaSyntaxKind.BinaryExpression || onlyClause.condition.operator !== LuaBinaryOperator.Equal) {
		return false;
	}
	const comparesNil = (isIdentifier(onlyClause.condition.left, localName) && isNilExpression(onlyClause.condition.right))
		|| (isIdentifier(onlyClause.condition.right, localName) && isNilExpression(onlyClause.condition.left));
	if (!comparesNil || onlyClause.block.body.length !== 2) {
		return false;
	}
	const assignLocal = onlyClause.block.body[0];
	const assignStorage = onlyClause.block.body[1];
	if (assignLocal.kind !== LuaSyntaxKind.AssignmentStatement || assignStorage.kind !== LuaSyntaxKind.AssignmentStatement) {
		return false;
	}
	if (assignLocal.operator !== LuaAssignmentOperator.Assign || assignLocal.left.length !== 1 || assignLocal.right.length !== 1) {
		return false;
	}
	if (!isIdentifier(assignLocal.left[0], localName)) {
		return false;
	}
	if (assignStorage.operator !== LuaAssignmentOperator.Assign || assignStorage.left.length !== 1 || assignStorage.right.length !== 1) {
		return false;
	}
	if (!isIdentifier(assignStorage.right[0], localName)) {
		return false;
	}
	const storageTarget = assignStorage.left[0];
	if (!isAssignableStorageExpression(storageTarget)) {
		return false;
	}
	if (storageTarget.kind === LuaSyntaxKind.IdentifierExpression && storageTarget.name === localName) {
		return false;
	}
	return returnStatement.kind === LuaSyntaxKind.ReturnStatement
		&& returnStatement.expressions.length === 1
		&& isIdentifier(returnStatement.expressions[0], localName);
}

function isPrimitiveLiteralExpression(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.StringLiteralExpression
		|| expression.kind === LuaSyntaxKind.NumericLiteralExpression
		|| expression.kind === LuaSyntaxKind.BooleanLiteralExpression
		|| expression.kind === LuaSyntaxKind.NilLiteralExpression;
}

function isStaticLookupTableConstructor(expression: LuaExpression): boolean {
	if (expression.kind !== LuaSyntaxKind.TableConstructorExpression || expression.fields.length === 0) {
		return false;
	}
	for (const field of expression.fields) {
		if (field.kind === LuaTableFieldKind.ExpressionKey) {
			if (!isPrimitiveLiteralExpression(field.key) && field.key.kind !== LuaSyntaxKind.IdentifierExpression) {
				return false;
			}
		}
		if (!isPrimitiveLiteralExpression(field.value)) {
			return false;
		}
	}
	return true;
}

function lintInlineStaticLookupTableExpression(
	expression: LuaExpression | null,
	functionName: string,
	issues: LuaLintIssue[],
): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					lintInlineStaticLookupTableExpression(field.key, functionName, issues);
				}
				lintInlineStaticLookupTableExpression(field.value, functionName, issues);
			}
			return;
		case LuaSyntaxKind.MemberExpression:
			lintInlineStaticLookupTableExpression(expression.base, functionName, issues);
			return;
		case LuaSyntaxKind.IndexExpression:
			if (isStaticLookupTableConstructor(expression.base)) {
				pushIssue(
					issues,
					'inline_static_lookup_table_pattern',
					expression.base,
					`Inline static lookup table expression inside function is forbidden (in "${functionName}"). Hoist static lookup tables to file scope.`,
				);
			} else {
				lintInlineStaticLookupTableExpression(expression.base, functionName, issues);
			}
			lintInlineStaticLookupTableExpression(expression.index, functionName, issues);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintInlineStaticLookupTableExpression(expression.left, functionName, issues);
			lintInlineStaticLookupTableExpression(expression.right, functionName, issues);
			return;
		case LuaSyntaxKind.UnaryExpression:
			lintInlineStaticLookupTableExpression(expression.operand, functionName, issues);
			return;
		case LuaSyntaxKind.CallExpression:
			lintInlineStaticLookupTableExpression(expression.callee, functionName, issues);
			for (const argument of expression.arguments) {
				lintInlineStaticLookupTableExpression(argument, functionName, issues);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
			// Nested function bodies are linted separately by lintFunctionBody/lintStatements.
			return;
		default:
			return;
	}
}

function lintInlineStaticLookupTableStatements(
	statements: ReadonlyArray<LuaStatement>,
	functionName: string,
	issues: LuaLintIssue[],
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					lintInlineStaticLookupTableExpression(value, functionName, issues);
				}
				break;
			case LuaSyntaxKind.AssignmentStatement:
				for (const left of statement.left) {
					lintInlineStaticLookupTableExpression(left, functionName, issues);
				}
				for (const right of statement.right) {
					lintInlineStaticLookupTableExpression(right, functionName, issues);
				}
				break;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintInlineStaticLookupTableExpression(expression, functionName, issues);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintInlineStaticLookupTableExpression(clause.condition, functionName, issues);
					}
					lintInlineStaticLookupTableStatements(clause.block.body, functionName, issues);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				lintInlineStaticLookupTableExpression(statement.condition, functionName, issues);
				lintInlineStaticLookupTableStatements(statement.block.body, functionName, issues);
				break;
			case LuaSyntaxKind.RepeatStatement:
				lintInlineStaticLookupTableStatements(statement.block.body, functionName, issues);
				lintInlineStaticLookupTableExpression(statement.condition, functionName, issues);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				lintInlineStaticLookupTableExpression(statement.start, functionName, issues);
				lintInlineStaticLookupTableExpression(statement.limit, functionName, issues);
				lintInlineStaticLookupTableExpression(statement.step, functionName, issues);
				lintInlineStaticLookupTableStatements(statement.block.body, functionName, issues);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					lintInlineStaticLookupTableExpression(iterator, functionName, issues);
				}
				lintInlineStaticLookupTableStatements(statement.block.body, functionName, issues);
				break;
			case LuaSyntaxKind.DoStatement:
				lintInlineStaticLookupTableStatements(statement.block.body, functionName, issues);
				break;
			case LuaSyntaxKind.CallStatement:
				lintInlineStaticLookupTableExpression(statement.expression, functionName, issues);
				break;
			case LuaSyntaxKind.LocalFunctionStatement:
			case LuaSyntaxKind.FunctionDeclarationStatement:
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
}

function lintInlineStaticLookupTablePattern(
	functionName: string,
	functionExpression: LuaFunctionExpression,
	issues: LuaLintIssue[],
): void {
	lintInlineStaticLookupTableStatements(functionExpression.body.body, functionName, issues);
}

function lintSplitLocalTableInitPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	for (let index = 0; index < statements.length; index += 1) {
		const statement = statements[index];
		if (statement.kind !== LuaSyntaxKind.LocalAssignmentStatement) {
			continue;
		}
		if (statement.names.length !== 1 || statement.values.length !== 0) {
			continue;
		}
		const localName = statement.names[0].name;
		for (let nextIndex = index + 1; nextIndex < statements.length; nextIndex += 1) {
			const nextStatement = statements[nextIndex];
			if (nextStatement.kind === LuaSyntaxKind.LocalAssignmentStatement) {
				if (nextStatement.names.some(name => name.name === localName)) {
					break;
				}
				continue;
			}
			if (nextStatement.kind !== LuaSyntaxKind.AssignmentStatement) {
				continue;
			}
			if (nextStatement.operator !== LuaAssignmentOperator.Assign || nextStatement.left.length !== 1 || nextStatement.right.length !== 1) {
				continue;
			}
			if (!isIdentifier(nextStatement.left[0], localName)) {
				continue;
			}
			if (nextStatement.right[0].kind !== LuaSyntaxKind.TableConstructorExpression) {
				break;
			}
			pushIssue(
				issues,
				'split_local_table_init_pattern',
				statement.names[0],
				`Split local declaration + table initialization is forbidden ("${localName}"). Initialize the table in the local declaration.`,
			);
			break;
		}
	}
}

function getExpressionSignature(expression: LuaExpression): string {
	switch (expression.kind) {
		case LuaSyntaxKind.NumericLiteralExpression:
			return `n:${String(expression.value)}`;
		case LuaSyntaxKind.StringLiteralExpression:
			return `s:${JSON.stringify(expression.value)}`;
		case LuaSyntaxKind.BooleanLiteralExpression:
			return expression.value ? 'b:1' : 'b:0';
		case LuaSyntaxKind.NilLiteralExpression:
			return 'nil';
		case LuaSyntaxKind.VarargExpression:
			return 'vararg';
		case LuaSyntaxKind.IdentifierExpression:
			return `id:${expression.name}`;
		case LuaSyntaxKind.MemberExpression:
			return `member:${getExpressionSignature(expression.base)}.${expression.identifier}`;
		case LuaSyntaxKind.IndexExpression:
			return `index:${getExpressionSignature(expression.base)}[${getExpressionSignature(expression.index)}]`;
		case LuaSyntaxKind.UnaryExpression:
			return `unary:${expression.operator}:${getExpressionSignature(expression.operand)}`;
		case LuaSyntaxKind.BinaryExpression:
			return `binary:${expression.operator}:${getExpressionSignature(expression.left)}:${getExpressionSignature(expression.right)}`;
		case LuaSyntaxKind.CallExpression: {
			const argumentSignatures = expression.arguments.map(getExpressionSignature);
			return `call:${expression.methodName ?? ''}:${getExpressionSignature(expression.callee)}(${argumentSignatures.join(',')})`;
		}
		case LuaSyntaxKind.TableConstructorExpression: {
			const fieldSignatures = expression.fields.map(field => {
				if (field.kind === LuaTableFieldKind.Array) {
					return `a:${getExpressionSignature(field.value)}`;
				}
				if (field.kind === LuaTableFieldKind.IdentifierKey) {
					return `k:${field.name}:${getExpressionSignature(field.value)}`;
				}
				return `e:${getExpressionSignature(field.key)}:${getExpressionSignature(field.value)}`;
			});
			return `table:{${fieldSignatures.join('|')}}`;
		}
		case LuaSyntaxKind.FunctionExpression:
			return '';
		default:
			return '';
	}
}

function createDuplicateInitializerContext(issues: LuaLintIssue[]): DuplicateInitializerContext {
	const context: DuplicateInitializerContext = {
		issues,
		bindingStacksByName: new Map<string, DuplicateInitializerBinding[]>(),
		scopeStack: [],
	};
	enterDuplicateInitializerScope(context);
	return context;
}

function resolveDuplicateInitializerBinding(context: DuplicateInitializerContext, name: string): DuplicateInitializerBinding {
	const stack = context.bindingStacksByName.get(name);
	if (!stack || stack.length === 0) {
		return undefined;
	}
	return stack[stack.length - 1];
}

function enterDuplicateInitializerScope(context: DuplicateInitializerContext): void {
	context.scopeStack.push({ names: [] });
}

function leaveDuplicateInitializerScope(context: DuplicateInitializerContext): void {
	const scope = context.scopeStack.pop();
	if (!scope) {
		return;
	}
	for (const name of scope.names) {
		const stack = context.bindingStacksByName.get(name);
		if (!stack || stack.length === 0) {
			continue;
		}
		stack.pop();
		if (stack.length === 0) {
			context.bindingStacksByName.delete(name);
		}
	}
}

function declareDuplicateInitializerBinding(
	context: DuplicateInitializerContext,
	declaration: LuaIdentifierExpression,
	initializerSignature: string,
): void {
	const scope = context.scopeStack[context.scopeStack.length - 1];
	scope.names.push(declaration.name);
	let stack = context.bindingStacksByName.get(declaration.name);
	if (!stack) {
		stack = [];
		context.bindingStacksByName.set(declaration.name, stack);
	}
	stack.push({
		declaration,
		initializerSignature,
	});
}

function lintDuplicateInitializerInExpression(expression: LuaExpression | null, context: DuplicateInitializerContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.MemberExpression:
			lintDuplicateInitializerInExpression(expression.base, context);
			return;
		case LuaSyntaxKind.IndexExpression:
			lintDuplicateInitializerInExpression(expression.base, context);
			lintDuplicateInitializerInExpression(expression.index, context);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintDuplicateInitializerInExpression(expression.left, context);
			lintDuplicateInitializerInExpression(expression.right, context);
			return;
		case LuaSyntaxKind.UnaryExpression:
			lintDuplicateInitializerInExpression(expression.operand, context);
			return;
		case LuaSyntaxKind.CallExpression:
			lintDuplicateInitializerInExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintDuplicateInitializerInExpression(argument, context);
			}
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					lintDuplicateInitializerInExpression(field.key, context);
				}
				lintDuplicateInitializerInExpression(field.value, context);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
			enterDuplicateInitializerScope(context);
			for (const parameter of expression.parameters) {
				declareDuplicateInitializerBinding(context, parameter, '');
			}
			lintDuplicateInitializerInStatements(expression.body.body, context);
			leaveDuplicateInitializerScope(context);
			return;
		default:
			return;
	}
}

function lintDuplicateInitializerInStatements(
	statements: ReadonlyArray<LuaStatement>,
	context: DuplicateInitializerContext,
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement: {
				for (const value of statement.values) {
					lintDuplicateInitializerInExpression(value, context);
				}
				const isTopLevelScope = context.scopeStack.length === 1;
				for (let index = 0; index < statement.names.length; index += 1) {
					const hasInitializer = index < statement.values.length;
					const initializerSignature = isTopLevelScope && hasInitializer
						? getExpressionSignature(statement.values[index])
						: '';
					declareDuplicateInitializerBinding(context, statement.names[index], initializerSignature);
				}
				break;
			}
			case LuaSyntaxKind.AssignmentStatement: {
				for (const left of statement.left) {
					lintDuplicateInitializerInExpression(left, context);
				}
				for (const right of statement.right) {
					lintDuplicateInitializerInExpression(right, context);
				}
				const pairCount = Math.min(statement.left.length, statement.right.length);
				for (let index = 0; index < pairCount; index += 1) {
					const left = statement.left[index];
					if (left.kind !== LuaSyntaxKind.IdentifierExpression) {
						continue;
					}
					const binding = resolveDuplicateInitializerBinding(context, left.name);
					if (!binding || binding.initializerSignature.length === 0) {
						continue;
					}
					const assignmentSignature = getExpressionSignature(statement.right[index]);
					if (assignmentSignature.length === 0 || assignmentSignature !== binding.initializerSignature) {
						continue;
					}
					pushIssue(
						context.issues,
						'duplicate_initializer_pattern',
						left,
						`Duplicate initializer pattern is forbidden ("${left.name}"). Do not initialize and later reassign the same value expression; keep one deterministic initialization point.`,
					);
				}
				break;
			}
			case LuaSyntaxKind.LocalFunctionStatement:
				declareDuplicateInitializerBinding(context, statement.name, '');
				enterDuplicateInitializerScope(context);
				for (const parameter of statement.functionExpression.parameters) {
					declareDuplicateInitializerBinding(context, parameter, '');
				}
				lintDuplicateInitializerInStatements(statement.functionExpression.body.body, context);
				leaveDuplicateInitializerScope(context);
				break;
			case LuaSyntaxKind.FunctionDeclarationStatement:
				enterDuplicateInitializerScope(context);
				for (const parameter of statement.functionExpression.parameters) {
					declareDuplicateInitializerBinding(context, parameter, '');
				}
				lintDuplicateInitializerInStatements(statement.functionExpression.body.body, context);
				leaveDuplicateInitializerScope(context);
				break;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintDuplicateInitializerInExpression(expression, context);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintDuplicateInitializerInExpression(clause.condition, context);
					}
					enterDuplicateInitializerScope(context);
					lintDuplicateInitializerInStatements(clause.block.body, context);
					leaveDuplicateInitializerScope(context);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				lintDuplicateInitializerInExpression(statement.condition, context);
				enterDuplicateInitializerScope(context);
				lintDuplicateInitializerInStatements(statement.block.body, context);
				leaveDuplicateInitializerScope(context);
				break;
			case LuaSyntaxKind.RepeatStatement:
				enterDuplicateInitializerScope(context);
				lintDuplicateInitializerInStatements(statement.block.body, context);
				lintDuplicateInitializerInExpression(statement.condition, context);
				leaveDuplicateInitializerScope(context);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				lintDuplicateInitializerInExpression(statement.start, context);
				lintDuplicateInitializerInExpression(statement.limit, context);
				lintDuplicateInitializerInExpression(statement.step, context);
				enterDuplicateInitializerScope(context);
				declareDuplicateInitializerBinding(context, statement.variable, '');
				lintDuplicateInitializerInStatements(statement.block.body, context);
				leaveDuplicateInitializerScope(context);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					lintDuplicateInitializerInExpression(iterator, context);
				}
				enterDuplicateInitializerScope(context);
				for (const variable of statement.variables) {
					declareDuplicateInitializerBinding(context, variable, '');
				}
				lintDuplicateInitializerInStatements(statement.block.body, context);
				leaveDuplicateInitializerScope(context);
				break;
			case LuaSyntaxKind.DoStatement:
				enterDuplicateInitializerScope(context);
				lintDuplicateInitializerInStatements(statement.block.body, context);
				leaveDuplicateInitializerScope(context);
				break;
			case LuaSyntaxKind.CallStatement:
				lintDuplicateInitializerInExpression(statement.expression, context);
				break;
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
}

function lintDuplicateInitializerPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	const context = createDuplicateInitializerContext(issues);
	try {
		lintDuplicateInitializerInStatements(statements, context);
	} finally {
		leaveDuplicateInitializerScope(context);
	}
}

function createForeignObjectMutationContext(issues: LuaLintIssue[]): ForeignObjectMutationContext {
	const context: ForeignObjectMutationContext = {
		issues,
		bindingStacksByName: new Map<string, Array<ForeignObjectAliasBinding | null>>(),
		scopeStack: [],
	};
	enterForeignObjectMutationScope(context);
	return context;
}

function enterForeignObjectMutationScope(context: ForeignObjectMutationContext): void {
	context.scopeStack.push({ names: [] });
}

function leaveForeignObjectMutationScope(context: ForeignObjectMutationContext): void {
	const scope = context.scopeStack.pop();
	if (!scope) {
		return;
	}
	for (let index = scope.names.length - 1; index >= 0; index -= 1) {
		const name = scope.names[index];
		const stack = context.bindingStacksByName.get(name);
		if (!stack || stack.length === 0) {
			continue;
		}
		stack.pop();
		if (stack.length === 0) {
			context.bindingStacksByName.delete(name);
		}
	}
}

function declareForeignObjectBinding(
	context: ForeignObjectMutationContext,
	declaration: LuaIdentifierExpression,
	binding: ForeignObjectAliasBinding | null,
): void {
	const scope = context.scopeStack[context.scopeStack.length - 1];
	scope.names.push(declaration.name);
	let stack = context.bindingStacksByName.get(declaration.name);
	if (!stack) {
		stack = [];
		context.bindingStacksByName.set(declaration.name, stack);
	}
	stack.push(binding);
}

function resolveForeignObjectBinding(
	context: ForeignObjectMutationContext,
	name: string,
): ForeignObjectAliasBinding | null | undefined {
	const stack = context.bindingStacksByName.get(name);
	if (!stack || stack.length === 0) {
		return undefined;
	}
	return stack[stack.length - 1];
}

function setForeignObjectBinding(
	context: ForeignObjectMutationContext,
	name: string,
	binding: ForeignObjectAliasBinding | null,
): void {
	const stack = context.bindingStacksByName.get(name);
	if (!stack || stack.length === 0) {
		return;
	}
	stack[stack.length - 1] = binding;
}

function isForeignObjectAliasInitializer(expression: LuaExpression | undefined): boolean {
	return isServiceResolverCallExpression(expression);
}

function isServiceResolverCallExpression(expression: LuaExpression | undefined): boolean {
	if (!expression || expression.kind !== LuaSyntaxKind.CallExpression) {
		return false;
	}
	return expression.callee.kind === LuaSyntaxKind.IdentifierExpression
		&& expression.callee.name === 'service';
}

type AssignmentTargetInfo = {
	depth: number;
	rootName: string;
	terminalPropertyName?: string;
};

function getAssignmentTargetInfo(target: LuaExpression): AssignmentTargetInfo | undefined {
	if (target.kind === LuaSyntaxKind.IdentifierExpression) {
		return {
			depth: 0,
			rootName: target.name,
		};
	}
	if (target.kind === LuaSyntaxKind.MemberExpression) {
		const baseInfo = getAssignmentTargetInfo(target.base);
		if (!baseInfo) {
			return undefined;
		}
		return {
			depth: baseInfo.depth + 1,
			rootName: baseInfo.rootName,
			terminalPropertyName: target.identifier,
		};
	}
	if (target.kind === LuaSyntaxKind.IndexExpression) {
		const baseInfo = getAssignmentTargetInfo(target.base);
		if (!baseInfo) {
			return undefined;
		}
		return {
			depth: baseInfo.depth + 1,
			rootName: baseInfo.rootName,
			terminalPropertyName: getExpressionKeyName(target.index),
		};
	}
	return undefined;
}

function lintForeignObjectMutationInExpression(
	expression: LuaExpression | null,
	context: ForeignObjectMutationContext,
): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.MemberExpression:
			lintForeignObjectMutationInExpression(expression.base, context);
			return;
		case LuaSyntaxKind.IndexExpression:
			lintForeignObjectMutationInExpression(expression.base, context);
			lintForeignObjectMutationInExpression(expression.index, context);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintForeignObjectMutationInExpression(expression.left, context);
			lintForeignObjectMutationInExpression(expression.right, context);
			return;
		case LuaSyntaxKind.UnaryExpression:
			lintForeignObjectMutationInExpression(expression.operand, context);
			return;
		case LuaSyntaxKind.CallExpression:
			lintForeignObjectMutationInExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintForeignObjectMutationInExpression(argument, context);
			}
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					lintForeignObjectMutationInExpression(field.key, context);
				}
				lintForeignObjectMutationInExpression(field.value, context);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
			enterForeignObjectMutationScope(context);
			for (const parameter of expression.parameters) {
				declareForeignObjectBinding(context, parameter, null);
			}
			lintForeignObjectMutationInStatements(expression.body.body, context);
			leaveForeignObjectMutationScope(context);
			return;
		default:
			return;
	}
}

function lintForeignObjectMutationInStatements(
	statements: ReadonlyArray<LuaStatement>,
	context: ForeignObjectMutationContext,
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					lintForeignObjectMutationInExpression(value, context);
				}
				for (let index = 0; index < statement.names.length; index += 1) {
					const declaration = statement.names[index];
					const value = index < statement.values.length ? statement.values[index] : undefined;
					const binding = value && isForeignObjectAliasInitializer(value)
						? { declaration }
						: null;
					declareForeignObjectBinding(context, declaration, binding);
				}
				break;
				case LuaSyntaxKind.AssignmentStatement: {
					for (const left of statement.left) {
						const targetInfo = getAssignmentTargetInfo(left);
						if (!targetInfo || targetInfo.depth < 1) {
							lintForeignObjectMutationInExpression(left, context);
							continue;
						}
						const binding = resolveForeignObjectBinding(context, targetInfo.rootName);
						if (!binding) {
							continue;
						}
						if (targetInfo.depth !== 1) {
							continue;
						}
						const propertyName = targetInfo.terminalPropertyName;
						if (!propertyName) {
							continue;
						}
							pushIssue(
								context.issues,
								'foreign_object_internal_mutation_pattern',
								left,
								`Direct top-level mutation on service alias ${targetInfo.rootName}.${propertyName} is forbidden. Keep ownership in the target service implementation and call domain methods/events; do not add getter/setter wrappers as a workaround.`,
							);
					}
				for (const right of statement.right) {
					lintForeignObjectMutationInExpression(right, context);
				}
				if (statement.operator === LuaAssignmentOperator.Assign) {
					const pairCount = Math.min(statement.left.length, statement.right.length);
					for (let index = 0; index < pairCount; index += 1) {
						const left = statement.left[index];
						if (left.kind !== LuaSyntaxKind.IdentifierExpression) {
							continue;
						}
						const right = statement.right[index];
						const binding = isForeignObjectAliasInitializer(right)
							? { declaration: left }
							: null;
						setForeignObjectBinding(context, left.name, binding);
					}
				}
				break;
			}
			case LuaSyntaxKind.LocalFunctionStatement:
				declareForeignObjectBinding(context, statement.name, null);
				enterForeignObjectMutationScope(context);
				for (const parameter of statement.functionExpression.parameters) {
					declareForeignObjectBinding(context, parameter, null);
				}
				lintForeignObjectMutationInStatements(statement.functionExpression.body.body, context);
				leaveForeignObjectMutationScope(context);
				break;
			case LuaSyntaxKind.FunctionDeclarationStatement:
				enterForeignObjectMutationScope(context);
				for (const parameter of statement.functionExpression.parameters) {
					declareForeignObjectBinding(context, parameter, null);
				}
				lintForeignObjectMutationInStatements(statement.functionExpression.body.body, context);
				leaveForeignObjectMutationScope(context);
				break;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintForeignObjectMutationInExpression(expression, context);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintForeignObjectMutationInExpression(clause.condition, context);
					}
					enterForeignObjectMutationScope(context);
					lintForeignObjectMutationInStatements(clause.block.body, context);
					leaveForeignObjectMutationScope(context);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				lintForeignObjectMutationInExpression(statement.condition, context);
				enterForeignObjectMutationScope(context);
				lintForeignObjectMutationInStatements(statement.block.body, context);
				leaveForeignObjectMutationScope(context);
				break;
			case LuaSyntaxKind.RepeatStatement:
				enterForeignObjectMutationScope(context);
				lintForeignObjectMutationInStatements(statement.block.body, context);
				lintForeignObjectMutationInExpression(statement.condition, context);
				leaveForeignObjectMutationScope(context);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				lintForeignObjectMutationInExpression(statement.start, context);
				lintForeignObjectMutationInExpression(statement.limit, context);
				lintForeignObjectMutationInExpression(statement.step, context);
				enterForeignObjectMutationScope(context);
				declareForeignObjectBinding(context, statement.variable, null);
				lintForeignObjectMutationInStatements(statement.block.body, context);
				leaveForeignObjectMutationScope(context);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					lintForeignObjectMutationInExpression(iterator, context);
				}
				enterForeignObjectMutationScope(context);
				for (const variable of statement.variables) {
					declareForeignObjectBinding(context, variable, null);
				}
				lintForeignObjectMutationInStatements(statement.block.body, context);
				leaveForeignObjectMutationScope(context);
				break;
			case LuaSyntaxKind.DoStatement:
				enterForeignObjectMutationScope(context);
				lintForeignObjectMutationInStatements(statement.block.body, context);
				leaveForeignObjectMutationScope(context);
				break;
			case LuaSyntaxKind.CallStatement:
				lintForeignObjectMutationInExpression(statement.expression, context);
				break;
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
}

function lintForeignObjectInternalMutationPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	const context = createForeignObjectMutationContext(issues);
	try {
		lintForeignObjectMutationInStatements(statements, context);
	} finally {
		leaveForeignObjectMutationScope(context);
	}
}

function createRuntimeTagLookupContext(issues: LuaLintIssue[]): RuntimeTagLookupContext {
	const context: RuntimeTagLookupContext = {
		issues,
		bindingStacksByName: new Map<string, Array<RuntimeTagLookupBinding | null>>(),
		scopeStack: [],
	};
	enterRuntimeTagLookupScope(context);
	return context;
}

function enterRuntimeTagLookupScope(context: RuntimeTagLookupContext): void {
	context.scopeStack.push({ names: [] });
}

function leaveRuntimeTagLookupScope(context: RuntimeTagLookupContext): void {
	const scope = context.scopeStack.pop();
	if (!scope) {
		return;
	}
	for (const name of scope.names) {
		const stack = context.bindingStacksByName.get(name);
		if (!stack || stack.length === 0) {
			continue;
		}
		stack.pop();
		if (stack.length === 0) {
			context.bindingStacksByName.delete(name);
		}
	}
}

function declareRuntimeTagLookupBinding(
	context: RuntimeTagLookupContext,
	declaration: LuaIdentifierExpression,
	binding: RuntimeTagLookupBinding | null,
): void {
	const scope = context.scopeStack[context.scopeStack.length - 1];
	scope.names.push(declaration.name);
	let stack = context.bindingStacksByName.get(declaration.name);
	if (!stack) {
		stack = [];
		context.bindingStacksByName.set(declaration.name, stack);
	}
	stack.push(binding);
}

function resolveRuntimeTagLookupBinding(
	context: RuntimeTagLookupContext,
	name: string,
): RuntimeTagLookupBinding | null | undefined {
	const stack = context.bindingStacksByName.get(name);
	if (!stack || stack.length === 0) {
		return undefined;
	}
	return stack[stack.length - 1];
}

function setRuntimeTagLookupBinding(
	context: RuntimeTagLookupContext,
	name: string,
	binding: RuntimeTagLookupBinding | null,
): void {
	const stack = context.bindingStacksByName.get(name);
	if (!stack || stack.length === 0) {
		return;
	}
	stack[stack.length - 1] = binding;
}

function isRuntimeTagLookupAliasInitializer(expression: LuaExpression | undefined): boolean {
	return isObjectOrServiceResolverCallExpression(expression);
}

function getRuntimeTagLookupOwnerExpression(expression: LuaExpression): LuaExpression | undefined {
	if (expression.kind !== LuaSyntaxKind.MemberExpression && expression.kind !== LuaSyntaxKind.IndexExpression) {
		return undefined;
	}
	if (!isTagsContainerExpression(expression.base)) {
		return undefined;
	}
	const tagsContainer = expression.base;
	if (tagsContainer.kind !== LuaSyntaxKind.MemberExpression && tagsContainer.kind !== LuaSyntaxKind.IndexExpression) {
		return undefined;
	}
	return tagsContainer.base;
}

function isRuntimeTagLookupOwnerExpression(expression: LuaExpression, context: RuntimeTagLookupContext): boolean {
	if (isSelfExpressionRoot(expression)) {
		return true;
	}
	if (isObjectOrServiceResolverCallExpression(expression)) {
		return true;
	}
	if (expression.kind !== LuaSyntaxKind.IdentifierExpression) {
		return false;
	}
	return !!resolveRuntimeTagLookupBinding(context, expression.name);
}

function isRuntimeTagLookupExpression(expression: LuaExpression, context: RuntimeTagLookupContext): boolean {
	const ownerExpression = getRuntimeTagLookupOwnerExpression(expression);
	if (!ownerExpression) {
		return false;
	}
	return isRuntimeTagLookupOwnerExpression(ownerExpression, context);
}

function lintRuntimeTagLookupInExpression(
	expression: LuaExpression | null,
	context: RuntimeTagLookupContext,
): void {
	if (!expression) {
		return;
	}
	if (isRuntimeTagLookupExpression(expression, context)) {
		pushIssue(
			context.issues,
			'runtime_tag_table_access_pattern',
			expression,
			'Direct runtime .tags access is forbidden. Use :has_tag(...) and derived/group tags instead of reading internal tag tables to bypass linting.',
		);
	}
	switch (expression.kind) {
		case LuaSyntaxKind.MemberExpression:
			lintRuntimeTagLookupInExpression(expression.base, context);
			return;
		case LuaSyntaxKind.IndexExpression:
			lintRuntimeTagLookupInExpression(expression.base, context);
			lintRuntimeTagLookupInExpression(expression.index, context);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintRuntimeTagLookupInExpression(expression.left, context);
			lintRuntimeTagLookupInExpression(expression.right, context);
			return;
		case LuaSyntaxKind.UnaryExpression:
			lintRuntimeTagLookupInExpression(expression.operand, context);
			return;
		case LuaSyntaxKind.CallExpression:
			lintRuntimeTagLookupInExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintRuntimeTagLookupInExpression(argument, context);
			}
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					lintRuntimeTagLookupInExpression(field.key, context);
				}
				lintRuntimeTagLookupInExpression(field.value, context);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
			enterRuntimeTagLookupScope(context);
			for (const parameter of expression.parameters) {
				declareRuntimeTagLookupBinding(context, parameter, null);
			}
			lintRuntimeTagLookupInStatements(expression.body.body, context);
			leaveRuntimeTagLookupScope(context);
			return;
		default:
			return;
	}
}

function lintRuntimeTagLookupInStatements(
	statements: ReadonlyArray<LuaStatement>,
	context: RuntimeTagLookupContext,
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					lintRuntimeTagLookupInExpression(value, context);
				}
				for (let index = 0; index < statement.names.length; index += 1) {
					const declaration = statement.names[index];
					const value = index < statement.values.length ? statement.values[index] : undefined;
					const binding = value && isRuntimeTagLookupAliasInitializer(value)
						? { declaration }
						: null;
					declareRuntimeTagLookupBinding(context, declaration, binding);
				}
				break;
			case LuaSyntaxKind.AssignmentStatement:
				for (const left of statement.left) {
					lintRuntimeTagLookupInExpression(left, context);
				}
				for (const right of statement.right) {
					lintRuntimeTagLookupInExpression(right, context);
				}
				if (statement.operator === LuaAssignmentOperator.Assign) {
					const pairCount = Math.min(statement.left.length, statement.right.length);
					for (let index = 0; index < pairCount; index += 1) {
						const left = statement.left[index];
						if (left.kind !== LuaSyntaxKind.IdentifierExpression) {
							continue;
						}
						const right = statement.right[index];
						const binding = isRuntimeTagLookupAliasInitializer(right)
							? { declaration: left }
							: null;
						setRuntimeTagLookupBinding(context, left.name, binding);
					}
				}
				break;
			case LuaSyntaxKind.LocalFunctionStatement:
				declareRuntimeTagLookupBinding(context, statement.name, null);
				enterRuntimeTagLookupScope(context);
				for (const parameter of statement.functionExpression.parameters) {
					declareRuntimeTagLookupBinding(context, parameter, null);
				}
				lintRuntimeTagLookupInStatements(statement.functionExpression.body.body, context);
				leaveRuntimeTagLookupScope(context);
				break;
			case LuaSyntaxKind.FunctionDeclarationStatement:
				enterRuntimeTagLookupScope(context);
				for (const parameter of statement.functionExpression.parameters) {
					declareRuntimeTagLookupBinding(context, parameter, null);
				}
				lintRuntimeTagLookupInStatements(statement.functionExpression.body.body, context);
				leaveRuntimeTagLookupScope(context);
				break;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintRuntimeTagLookupInExpression(expression, context);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintRuntimeTagLookupInExpression(clause.condition, context);
					}
					enterRuntimeTagLookupScope(context);
					lintRuntimeTagLookupInStatements(clause.block.body, context);
					leaveRuntimeTagLookupScope(context);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				lintRuntimeTagLookupInExpression(statement.condition, context);
				enterRuntimeTagLookupScope(context);
				lintRuntimeTagLookupInStatements(statement.block.body, context);
				leaveRuntimeTagLookupScope(context);
				break;
			case LuaSyntaxKind.RepeatStatement:
				enterRuntimeTagLookupScope(context);
				lintRuntimeTagLookupInStatements(statement.block.body, context);
				lintRuntimeTagLookupInExpression(statement.condition, context);
				leaveRuntimeTagLookupScope(context);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				lintRuntimeTagLookupInExpression(statement.start, context);
				lintRuntimeTagLookupInExpression(statement.limit, context);
				lintRuntimeTagLookupInExpression(statement.step, context);
				enterRuntimeTagLookupScope(context);
				declareRuntimeTagLookupBinding(context, statement.variable, null);
				lintRuntimeTagLookupInStatements(statement.block.body, context);
				leaveRuntimeTagLookupScope(context);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					lintRuntimeTagLookupInExpression(iterator, context);
				}
				enterRuntimeTagLookupScope(context);
				for (const variable of statement.variables) {
					declareRuntimeTagLookupBinding(context, variable, null);
				}
				lintRuntimeTagLookupInStatements(statement.block.body, context);
				leaveRuntimeTagLookupScope(context);
				break;
			case LuaSyntaxKind.DoStatement:
				enterRuntimeTagLookupScope(context);
				lintRuntimeTagLookupInStatements(statement.block.body, context);
				leaveRuntimeTagLookupScope(context);
				break;
			case LuaSyntaxKind.CallStatement:
				lintRuntimeTagLookupInExpression(statement.expression, context);
				break;
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
}

function lintRuntimeTagTableAccessPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	const context = createRuntimeTagLookupContext(issues);
	try {
		lintRuntimeTagLookupInStatements(statements, context);
	} finally {
		leaveRuntimeTagLookupScope(context);
	}
}

function isModuleFieldAssignmentTarget(expression: LuaExpression): boolean {
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		return expression.base.kind === LuaSyntaxKind.IdentifierExpression;
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression) {
		return expression.base.kind === LuaSyntaxKind.IdentifierExpression;
	}
	return false;
}

function getModuleFieldAssignmentBaseIdentifier(expression: LuaExpression): string | undefined {
	if (expression.kind === LuaSyntaxKind.MemberExpression && expression.base.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.base.name;
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression && expression.base.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.base.name;
	}
	return undefined;
}

function countIdentifierMentionsInExpression(expression: LuaExpression | null, identifierName: string): number {
	if (!expression) {
		return 0;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			return expression.name === identifierName ? 1 : 0;
		case LuaSyntaxKind.MemberExpression:
			return countIdentifierMentionsInExpression(expression.base, identifierName);
		case LuaSyntaxKind.IndexExpression:
			return countIdentifierMentionsInExpression(expression.base, identifierName)
				+ countIdentifierMentionsInExpression(expression.index, identifierName);
		case LuaSyntaxKind.BinaryExpression:
			return countIdentifierMentionsInExpression(expression.left, identifierName)
				+ countIdentifierMentionsInExpression(expression.right, identifierName);
		case LuaSyntaxKind.UnaryExpression:
			return countIdentifierMentionsInExpression(expression.operand, identifierName);
		case LuaSyntaxKind.CallExpression: {
			let count = countIdentifierMentionsInExpression(expression.callee, identifierName);
			for (const argument of expression.arguments) {
				count += countIdentifierMentionsInExpression(argument, identifierName);
			}
			return count;
		}
		case LuaSyntaxKind.TableConstructorExpression: {
			let count = 0;
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					count += countIdentifierMentionsInExpression(field.key, identifierName);
				}
				count += countIdentifierMentionsInExpression(field.value, identifierName);
			}
			return count;
		}
		case LuaSyntaxKind.FunctionExpression:
			return countIdentifierMentionsInStatements(expression.body.body, identifierName);
		default:
			return 0;
	}
}

function countIdentifierMentionsInStatement(statement: LuaStatement, identifierName: string): number {
	switch (statement.kind) {
		case LuaSyntaxKind.LocalAssignmentStatement: {
			let count = 0;
			for (const value of statement.values) {
				count += countIdentifierMentionsInExpression(value, identifierName);
			}
			return count;
		}
		case LuaSyntaxKind.AssignmentStatement: {
			let count = 0;
			for (const left of statement.left) {
				count += countIdentifierMentionsInExpression(left, identifierName);
			}
			for (const right of statement.right) {
				count += countIdentifierMentionsInExpression(right, identifierName);
			}
			return count;
		}
		case LuaSyntaxKind.LocalFunctionStatement: {
			let count = statement.name.name === identifierName ? 1 : 0;
			count += countIdentifierMentionsInExpression(statement.functionExpression, identifierName);
			return count;
		}
		case LuaSyntaxKind.FunctionDeclarationStatement: {
			let count = 0;
			for (const namePart of statement.name.identifiers) {
				if (namePart === identifierName) {
					count += 1;
				}
			}
			if (statement.name.methodName === identifierName) {
				count += 1;
			}
			count += countIdentifierMentionsInExpression(statement.functionExpression, identifierName);
			return count;
		}
		case LuaSyntaxKind.ReturnStatement: {
			let count = 0;
			for (const expression of statement.expressions) {
				count += countIdentifierMentionsInExpression(expression, identifierName);
			}
			return count;
		}
		case LuaSyntaxKind.IfStatement: {
			let count = 0;
			for (const clause of statement.clauses) {
				if (clause.condition) {
					count += countIdentifierMentionsInExpression(clause.condition, identifierName);
				}
				count += countIdentifierMentionsInStatements(clause.block.body, identifierName);
			}
			return count;
		}
		case LuaSyntaxKind.WhileStatement:
			return countIdentifierMentionsInExpression(statement.condition, identifierName)
				+ countIdentifierMentionsInStatements(statement.block.body, identifierName);
		case LuaSyntaxKind.RepeatStatement:
			return countIdentifierMentionsInStatements(statement.block.body, identifierName)
				+ countIdentifierMentionsInExpression(statement.condition, identifierName);
		case LuaSyntaxKind.ForNumericStatement:
			return countIdentifierMentionsInExpression(statement.start, identifierName)
				+ countIdentifierMentionsInExpression(statement.limit, identifierName)
				+ countIdentifierMentionsInExpression(statement.step, identifierName)
				+ countIdentifierMentionsInStatements(statement.block.body, identifierName);
		case LuaSyntaxKind.ForGenericStatement: {
			let count = 0;
			for (const iterator of statement.iterators) {
				count += countIdentifierMentionsInExpression(iterator, identifierName);
			}
			count += countIdentifierMentionsInStatements(statement.block.body, identifierName);
			return count;
		}
		case LuaSyntaxKind.DoStatement:
			return countIdentifierMentionsInStatements(statement.block.body, identifierName);
		case LuaSyntaxKind.CallStatement:
			return countIdentifierMentionsInExpression(statement.expression, identifierName);
		case LuaSyntaxKind.BreakStatement:
		case LuaSyntaxKind.GotoStatement:
		case LuaSyntaxKind.LabelStatement:
			return 0;
		default:
			return 0;
	}
}

function countIdentifierMentionsInStatements(statements: ReadonlyArray<LuaStatement>, identifierName: string): number {
	let count = 0;
	for (const statement of statements) {
		count += countIdentifierMentionsInStatement(statement, identifierName);
	}
	return count;
}

function lintStagedExportLocalCallPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	const stagedLocalCallDeclarations = new Map<string, LuaIdentifierExpression>();
	const flagged = new Set<string>();
	for (const statement of statements) {
		if (statement.kind === LuaSyntaxKind.LocalAssignmentStatement) {
			const valueCount = Math.min(statement.names.length, statement.values.length);
			for (let index = 0; index < valueCount; index += 1) {
				const name = statement.names[index];
				const value = statement.values[index];
				if (isSingleUseLocalCandidateValue(value)) {
					stagedLocalCallDeclarations.set(name.name, name);
				} else {
					stagedLocalCallDeclarations.delete(name.name);
				}
			}
			for (let index = valueCount; index < statement.names.length; index += 1) {
				stagedLocalCallDeclarations.delete(statement.names[index].name);
			}
			continue;
		}
		if (statement.kind !== LuaSyntaxKind.AssignmentStatement) {
			continue;
		}
		if (statement.operator !== LuaAssignmentOperator.Assign) {
			continue;
		}
		const pairCount = Math.min(statement.left.length, statement.right.length);
		for (let index = 0; index < pairCount; index += 1) {
			const left = statement.left[index];
			const right = statement.right[index];
			if (right.kind !== LuaSyntaxKind.IdentifierExpression) {
				continue;
			}
			const declaration = stagedLocalCallDeclarations.get(right.name);
			if (!declaration || flagged.has(right.name)) {
				continue;
			}
			if (!isModuleFieldAssignmentTarget(left)) {
				continue;
			}
			flagged.add(right.name);
			pushIssue(
				issues,
				'staged_export_local_call_pattern',
				declaration,
				`Staged local call-result export is forbidden ("${right.name}"). Assign call results directly to the module field and use that field directly.`,
			);
		}
	}
}

function lintStagedExportLocalTablePattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	const stagedLocalTableDeclarations = new Map<string, { declaration: LuaIdentifierExpression; declarationStatementIndex: number; }>();
	const flagged = new Set<string>();
	for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
		const statement = statements[statementIndex];
		if (statement.kind === LuaSyntaxKind.LocalAssignmentStatement) {
			const valueCount = Math.min(statement.names.length, statement.values.length);
			for (let index = 0; index < valueCount; index += 1) {
				const name = statement.names[index];
				const value = statement.values[index];
				if (value.kind === LuaSyntaxKind.TableConstructorExpression) {
					stagedLocalTableDeclarations.set(name.name, {
						declaration: name,
						declarationStatementIndex: statementIndex,
					});
				} else {
					stagedLocalTableDeclarations.delete(name.name);
				}
			}
			for (let index = valueCount; index < statement.names.length; index += 1) {
				stagedLocalTableDeclarations.delete(statement.names[index].name);
			}
			continue;
		}
		if (statement.kind !== LuaSyntaxKind.AssignmentStatement || statement.operator !== LuaAssignmentOperator.Assign) {
			continue;
		}
		const pairCount = Math.min(statement.left.length, statement.right.length);
		for (let index = 0; index < pairCount; index += 1) {
			const left = statement.left[index];
			const right = statement.right[index];
				if (right.kind !== LuaSyntaxKind.IdentifierExpression) {
					continue;
				}
				const stagedDeclaration = stagedLocalTableDeclarations.get(right.name);
				if (!stagedDeclaration || flagged.has(right.name)) {
					continue;
				}
				if (!isModuleFieldAssignmentTarget(left)) {
				continue;
			}
			const targetBase = getModuleFieldAssignmentBaseIdentifier(left);
				if (targetBase === right.name) {
					continue;
				}
				const mentionCountAfterDeclaration = countIdentifierMentionsInStatements(
					statements.slice(stagedDeclaration.declarationStatementIndex + 1),
					right.name,
				);
				if (mentionCountAfterDeclaration > 2) {
					continue;
				}
				flagged.add(right.name);
				pushIssue(
					issues,
					'staged_export_local_table_pattern',
					stagedDeclaration.declaration,
					`Staged local table export is forbidden ("${right.name}"). Build table values directly on the destination module field instead.`,
				);
			}
	}
}

function getReturnedCallToIdentifier(statement: LuaStatement, name: string): LuaCallExpression | undefined {
	if (statement.kind !== LuaSyntaxKind.ReturnStatement || statement.expressions.length !== 1) {
		return undefined;
	}
	const expression = statement.expressions[0];
	if (expression.kind !== LuaSyntaxKind.CallExpression) {
		return undefined;
	}
	if (expression.callee.kind !== LuaSyntaxKind.IdentifierExpression || expression.callee.name !== name) {
		return undefined;
	}
	return expression;
}

function conditionComparesIdentifierWithValue(condition: LuaExpression, name: string): boolean {
	if (condition.kind !== LuaSyntaxKind.BinaryExpression || condition.operator !== LuaBinaryOperator.Equal) {
		return false;
	}
	return isIdentifier(condition.left, name) || isIdentifier(condition.right, name);
}

function matchesHandlerIdentityDispatchPattern(functionExpression: LuaFunctionExpression): boolean {
	const body = functionExpression.body.body;
	if (body.length !== 3) {
		return false;
	}
	const localAssignment = body[0];
	const ifStatement = body[1];
	const fallbackReturn = body[2];
	if (localAssignment.kind !== LuaSyntaxKind.LocalAssignmentStatement) {
		return false;
	}
	if (localAssignment.names.length !== 1 || localAssignment.values.length !== 1) {
		return false;
	}
	if (localAssignment.values[0].kind !== LuaSyntaxKind.IndexExpression) {
		return false;
	}
	const localName = localAssignment.names[0].name;
	if (ifStatement.kind !== LuaSyntaxKind.IfStatement || ifStatement.clauses.length !== 1) {
		return false;
	}
	const onlyClause = ifStatement.clauses[0];
	if (!onlyClause.condition || !conditionComparesIdentifierWithValue(onlyClause.condition, localName)) {
		return false;
	}
	if (onlyClause.block.body.length !== 1) {
		return false;
	}
	const specialReturnCall = getReturnedCallToIdentifier(onlyClause.block.body[0], localName);
	if (!specialReturnCall) {
		return false;
	}
	const fallbackReturnCall = getReturnedCallToIdentifier(fallbackReturn, localName);
	if (!fallbackReturnCall) {
		return false;
	}
	return specialReturnCall.arguments.length !== fallbackReturnCall.arguments.length;
}

function enterUnusedInitValueScope(context: UnusedInitValueContext): void {
	context.scopeStack.push({ names: [] });
}

function leaveUnusedInitValueScope(context: UnusedInitValueContext): void {
	const scope = context.scopeStack.pop();
	if (!scope) {
		return;
	}
	for (let index = scope.names.length - 1; index >= 0; index -= 1) {
		const name = scope.names[index];
		const stack = context.bindingStacksByName.get(name);
		if (!stack || stack.length === 0) {
			continue;
		}
		stack.pop();
		if (stack.length === 0) {
			context.bindingStacksByName.delete(name);
		}
	}
}

function createSingleUseHasTagContext(issues: LuaLintIssue[]): SingleUseHasTagContext {
	return {
		issues,
		bindingStacksByName: new Map<string, SingleUseHasTagBinding[]>(),
		scopeStack: [],
	};
}

function enterSingleUseHasTagScope(context: SingleUseHasTagContext): void {
	context.scopeStack.push({ names: [] });
}

function leaveSingleUseHasTagScope(context: SingleUseHasTagContext): void {
	const scope = context.scopeStack.pop();
	if (!scope) {
		return;
	}
	for (let index = scope.names.length - 1; index >= 0; index -= 1) {
		const name = scope.names[index];
		const stack = context.bindingStacksByName.get(name);
		if (!stack || stack.length === 0) {
			continue;
		}
		const binding = stack.pop();
		if (binding && binding.pendingReadCount === 1) {
			pushIssue(
				context.issues,
				'single_use_has_tag_pattern',
				binding.declaration,
				`Local has_tag result "${binding.declaration.name}" is read exactly once; inline self:has_tag(...) instead of caching it.`,
			);
		}
		if (stack.length === 0) {
			context.bindingStacksByName.delete(name);
		}
	}
}

function declareSingleUseHasTagBinding(
	context: SingleUseHasTagContext,
	declaration: LuaIdentifierExpression,
): void {
	const scope = context.scopeStack[context.scopeStack.length - 1];
	scope.names.push(declaration.name);
	let stack = context.bindingStacksByName.get(declaration.name);
	if (!stack) {
		stack = [];
		context.bindingStacksByName.set(declaration.name, stack);
	}
	stack.push({
		declaration,
		pendingReadCount: 0,
	});
}

function markSingleUseHasTagRead(context: SingleUseHasTagContext, identifier: LuaIdentifierExpression): void {
	const stack = context.bindingStacksByName.get(identifier.name);
	if (!stack || stack.length === 0) {
		return;
	}
	stack[stack.length - 1].pendingReadCount += 1;
}

function lintSingleUseHasTagInExpression(expression: LuaExpression, context: SingleUseHasTagContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			markSingleUseHasTagRead(context, expression);
			return;
		case LuaSyntaxKind.MemberExpression:
			lintSingleUseHasTagInExpression(expression.base, context);
			return;
		case LuaSyntaxKind.IndexExpression:
			lintSingleUseHasTagInExpression(expression.base, context);
			lintSingleUseHasTagInExpression(expression.index, context);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintSingleUseHasTagInExpression(expression.left, context);
			lintSingleUseHasTagInExpression(expression.right, context);
			return;
		case LuaSyntaxKind.UnaryExpression:
			lintSingleUseHasTagInExpression(expression.operand, context);
			return;
		case LuaSyntaxKind.CallExpression:
			lintSingleUseHasTagInExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintSingleUseHasTagInExpression(argument, context);
			}
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					lintSingleUseHasTagInExpression(field.key, context);
				}
				lintSingleUseHasTagInExpression(field.value, context);
			}
			return;
		case LuaSyntaxKind.FunctionExpression: {
			enterSingleUseHasTagScope(context);
			lintSingleUseHasTagInStatements(expression.body.body, context);
			leaveSingleUseHasTagScope(context);
			return;
		}
		default:
			return;
	}
}

function lintSingleUseHasTagInStatements(statements: ReadonlyArray<LuaStatement>, context: SingleUseHasTagContext): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				for (let index = 0; index < Math.min(statement.names.length, statement.values.length); index += 1) {
					const name = statement.names[index];
					const value = statement.values[index];
					if (isSelfHasTagCall(value)) {
						declareSingleUseHasTagBinding(context, name);
					}
					lintSingleUseHasTagInExpression(value, context);
				}
				break;
			case LuaSyntaxKind.AssignmentStatement:
				for (const right of statement.right) {
					lintSingleUseHasTagInExpression(right, context);
				}
				break;
			case LuaSyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LuaLocalFunctionStatement;
				enterSingleUseHasTagScope(context);
				try {
					lintSingleUseHasTagInStatements(localFunction.functionExpression.body.body, context);
				} finally {
					leaveSingleUseHasTagScope(context);
				}
				break;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement: {
				const declaration = statement as LuaFunctionDeclarationStatement;
				enterSingleUseHasTagScope(context);
				try {
					lintSingleUseHasTagInStatements(declaration.functionExpression.body.body, context);
				} finally {
					leaveSingleUseHasTagScope(context);
				}
				break;
			}
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintSingleUseHasTagInExpression(expression, context);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintSingleUseHasTagInExpression(clause.condition, context);
					}
					enterSingleUseHasTagScope(context);
					try {
						lintSingleUseHasTagInStatements(clause.block.body, context);
					} finally {
						leaveSingleUseHasTagScope(context);
					}
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				lintSingleUseHasTagInExpression(statement.condition, context);
				enterSingleUseHasTagScope(context);
				try {
					lintSingleUseHasTagInStatements(statement.block.body, context);
				} finally {
					leaveSingleUseHasTagScope(context);
				}
				break;
			case LuaSyntaxKind.RepeatStatement:
				enterSingleUseHasTagScope(context);
				try {
					lintSingleUseHasTagInStatements(statement.block.body, context);
				} finally {
					leaveSingleUseHasTagScope(context);
				}
				lintSingleUseHasTagInExpression(statement.condition, context);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				lintSingleUseHasTagInExpression(statement.start, context);
				lintSingleUseHasTagInExpression(statement.limit, context);
				lintSingleUseHasTagInExpression(statement.step, context);
				enterSingleUseHasTagScope(context);
				try {
					lintSingleUseHasTagInStatements(statement.block.body, context);
				} finally {
					leaveSingleUseHasTagScope(context);
				}
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					lintSingleUseHasTagInExpression(iterator, context);
				}
				enterSingleUseHasTagScope(context);
				try {
					lintSingleUseHasTagInStatements(statement.block.body, context);
				} finally {
					leaveSingleUseHasTagScope(context);
				}
				break;
			case LuaSyntaxKind.DoStatement:
				enterSingleUseHasTagScope(context);
				try {
					lintSingleUseHasTagInStatements(statement.block.body, context);
				} finally {
					leaveSingleUseHasTagScope(context);
				}
				break;
			case LuaSyntaxKind.CallStatement:
				lintSingleUseHasTagInExpression(statement.expression, context);
				break;
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
}

function lintSingleUseHasTagPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	const context = createSingleUseHasTagContext(issues);
	enterSingleUseHasTagScope(context);
	try {
		lintSingleUseHasTagInStatements(statements, context);
	} finally {
		leaveSingleUseHasTagScope(context);
	}
}

function createSingleUseLocalContext(issues: LuaLintIssue[]): SingleUseLocalContext {
	return {
		issues,
		bindingStacksByName: new Map<string, SingleUseLocalBinding[]>(),
		scopeStack: [],
	};
}

function enterSingleUseLocalScope(context: SingleUseLocalContext): void {
	context.scopeStack.push({ names: [] });
}

function singleUseLocalMessage(binding: SingleUseLocalBinding): string {
	if (binding.reportKind === 'small_helper') {
		return `Small one-off local helper "${binding.declaration.name}" is forbidden. Inline it, or keep it only if it materially reduces complexity.`;
	}
	return `One-off cached call-result local "${binding.declaration.name}" is forbidden. Inline the call/value instead.`;
}

function leaveSingleUseLocalScope(context: SingleUseLocalContext): void {
	const scope = context.scopeStack.pop();
	if (!scope) {
		return;
	}
	for (let index = scope.names.length - 1; index >= 0; index -= 1) {
		const name = scope.names[index];
		const stack = context.bindingStacksByName.get(name);
		if (!stack || stack.length === 0) {
			continue;
		}
		const binding = stack.pop();
		if (binding && binding.reportKind !== null) {
			const shouldReport = binding.reportKind === 'small_helper'
				? binding.readCount === 1 && binding.callReadCount === 1
				: binding.readCount === 1;
			if (shouldReport) {
				pushIssue(
					context.issues,
					'single_use_local_pattern',
					binding.declaration,
					singleUseLocalMessage(binding),
				);
			}
		}
		if (stack.length === 0) {
			context.bindingStacksByName.delete(name);
		}
	}
}

function declareSingleUseLocalBinding(
	context: SingleUseLocalContext,
	declaration: LuaIdentifierExpression,
	reportKind: SingleUseLocalReportKind | null,
): void {
	const isTopLevelScope = context.scopeStack.length === 1;
	const scope = context.scopeStack[context.scopeStack.length - 1];
	scope.names.push(declaration.name);
	let stack = context.bindingStacksByName.get(declaration.name);
	if (!stack) {
		stack = [];
		context.bindingStacksByName.set(declaration.name, stack);
	}
	stack.push({
		declaration,
		reportKind: isTopLevelScope && !declaration.name.startsWith('_') ? reportKind : null,
		readCount: 0,
		callReadCount: 0,
	});
}

function markSingleUseLocalRead(context: SingleUseLocalContext, identifier: LuaIdentifierExpression, isCallRead = false): void {
	const stack = context.bindingStacksByName.get(identifier.name);
	if (!stack || stack.length === 0) {
		return;
	}
	const binding = stack[stack.length - 1];
	binding.readCount += 1;
	if (isCallRead) {
		binding.callReadCount += 1;
	}
}

function lintSingleUseLocalInExpression(expression: LuaExpression, context: SingleUseLocalContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			markSingleUseLocalRead(context, expression);
			return;
		case LuaSyntaxKind.MemberExpression:
			lintSingleUseLocalInExpression(expression.base, context);
			return;
		case LuaSyntaxKind.IndexExpression:
			lintSingleUseLocalInExpression(expression.base, context);
			lintSingleUseLocalInExpression(expression.index, context);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintSingleUseLocalInExpression(expression.left, context);
			lintSingleUseLocalInExpression(expression.right, context);
			return;
			case LuaSyntaxKind.UnaryExpression:
				lintSingleUseLocalInExpression(expression.operand, context);
				return;
			case LuaSyntaxKind.CallExpression:
				if (expression.callee.kind === LuaSyntaxKind.IdentifierExpression) {
					markSingleUseLocalRead(context, expression.callee, true);
				} else {
					lintSingleUseLocalInExpression(expression.callee, context);
				}
				for (const argument of expression.arguments) {
					lintSingleUseLocalInExpression(argument, context);
				}
				return;
			case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					lintSingleUseLocalInExpression(field.key, context);
				}
				lintSingleUseLocalInExpression(field.value, context);
			}
				return;
			case LuaSyntaxKind.FunctionExpression: {
				enterSingleUseLocalScope(context);
				for (const parameter of expression.parameters) {
					declareSingleUseLocalBinding(context, parameter, null);
				}
				lintSingleUseLocalInStatements(expression.body.body, context);
				leaveSingleUseLocalScope(context);
				return;
			}
		default:
			return;
	}
}

function lintSingleUseLocalInAssignmentTarget(
	target: LuaExpression,
	operator: LuaAssignmentOperator,
	context: SingleUseLocalContext,
): void {
	if (target.kind === LuaSyntaxKind.IdentifierExpression) {
		if (operator !== LuaAssignmentOperator.Assign) {
			markSingleUseLocalRead(context, target);
		}
		return;
	}
	if (target.kind === LuaSyntaxKind.MemberExpression) {
		lintSingleUseLocalInExpression(target.base, context);
		return;
	}
	if (target.kind === LuaSyntaxKind.IndexExpression) {
		lintSingleUseLocalInExpression(target.base, context);
		lintSingleUseLocalInExpression(target.index, context);
	}
}

function lintSingleUseLocalInStatements(statements: ReadonlyArray<LuaStatement>, context: SingleUseLocalContext): void {
	for (const statement of statements) {
		switch (statement.kind) {
				case LuaSyntaxKind.LocalAssignmentStatement:
					for (const value of statement.values) {
						lintSingleUseLocalInExpression(value, context);
					}
					for (let index = 0; index < statement.names.length; index += 1) {
						const value = index < statement.values.length ? statement.values[index] : undefined;
						const reportKind = resolveSingleUseLocalReportKindForValue(value);
						declareSingleUseLocalBinding(context, statement.names[index], reportKind);
					}
					break;
			case LuaSyntaxKind.AssignmentStatement:
				for (const right of statement.right) {
					lintSingleUseLocalInExpression(right, context);
				}
				for (const left of statement.left) {
					lintSingleUseLocalInAssignmentTarget(left, statement.operator, context);
				}
				break;
			case LuaSyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LuaLocalFunctionStatement;
				const reportKind = isTrivialSingleUseLocalHelperFunctionExpression(localFunction.functionExpression) ? 'small_helper' : null;
				declareSingleUseLocalBinding(context, localFunction.name, reportKind);
				enterSingleUseLocalScope(context);
				for (const parameter of localFunction.functionExpression.parameters) {
					declareSingleUseLocalBinding(context, parameter, null);
					}
					lintSingleUseLocalInStatements(localFunction.functionExpression.body.body, context);
					leaveSingleUseLocalScope(context);
					break;
				}
				case LuaSyntaxKind.FunctionDeclarationStatement: {
					const declaration = statement as LuaFunctionDeclarationStatement;
					enterSingleUseLocalScope(context);
					for (const parameter of declaration.functionExpression.parameters) {
						declareSingleUseLocalBinding(context, parameter, null);
					}
					lintSingleUseLocalInStatements(declaration.functionExpression.body.body, context);
					leaveSingleUseLocalScope(context);
					break;
			}
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintSingleUseLocalInExpression(expression, context);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintSingleUseLocalInExpression(clause.condition, context);
					}
					enterSingleUseLocalScope(context);
					lintSingleUseLocalInStatements(clause.block.body, context);
					leaveSingleUseLocalScope(context);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				lintSingleUseLocalInExpression(statement.condition, context);
				enterSingleUseLocalScope(context);
				lintSingleUseLocalInStatements(statement.block.body, context);
				leaveSingleUseLocalScope(context);
				break;
			case LuaSyntaxKind.RepeatStatement:
				enterSingleUseLocalScope(context);
				lintSingleUseLocalInStatements(statement.block.body, context);
				leaveSingleUseLocalScope(context);
				lintSingleUseLocalInExpression(statement.condition, context);
				break;
				case LuaSyntaxKind.ForNumericStatement:
					lintSingleUseLocalInExpression(statement.start, context);
					lintSingleUseLocalInExpression(statement.limit, context);
					lintSingleUseLocalInExpression(statement.step, context);
					enterSingleUseLocalScope(context);
					declareSingleUseLocalBinding(context, statement.variable, null);
					lintSingleUseLocalInStatements(statement.block.body, context);
					leaveSingleUseLocalScope(context);
					break;
				case LuaSyntaxKind.ForGenericStatement:
					for (const iterator of statement.iterators) {
					lintSingleUseLocalInExpression(iterator, context);
				}
					enterSingleUseLocalScope(context);
					for (const variable of statement.variables) {
						declareSingleUseLocalBinding(context, variable, null);
					}
					lintSingleUseLocalInStatements(statement.block.body, context);
					leaveSingleUseLocalScope(context);
					break;
			case LuaSyntaxKind.DoStatement:
				enterSingleUseLocalScope(context);
				lintSingleUseLocalInStatements(statement.block.body, context);
				leaveSingleUseLocalScope(context);
				break;
			case LuaSyntaxKind.CallStatement:
				lintSingleUseLocalInExpression(statement.expression, context);
				break;
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
}

function lintSingleUseLocalPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	const context = createSingleUseLocalContext(issues);
	enterSingleUseLocalScope(context);
	try {
		lintSingleUseLocalInStatements(statements, context);
	} finally {
		leaveSingleUseLocalScope(context);
	}
}

function createUnusedInitValueContext(issues: LuaLintIssue[]): UnusedInitValueContext {
	const context: UnusedInitValueContext = {
		issues,
		bindingStacksByName: new Map<string, UnusedInitValueBinding[]>(),
		scopeStack: [],
	};
	enterUnusedInitValueScope(context);
	return context;
}

function resolveUnusedInitValueBinding(context: UnusedInitValueContext, name: string): UnusedInitValueBinding {
	const stack = context.bindingStacksByName.get(name);
	if (!stack || stack.length === 0) {
		return undefined;
	}
	return stack[stack.length - 1];
}

function declareUnusedInitValueBinding(context: UnusedInitValueContext, declaration: LuaIdentifierExpression, pendingInitValue: boolean): void {
	const scope = context.scopeStack[context.scopeStack.length - 1];
	scope.names.push(declaration.name);
	let stack = context.bindingStacksByName.get(declaration.name);
	if (!stack) {
		stack = [];
		context.bindingStacksByName.set(declaration.name, stack);
	}
	stack.push({
		declaration,
		pendingInitValue,
	});
}

function markUnusedInitValueRead(context: UnusedInitValueContext, name: string): void {
	const binding = resolveUnusedInitValueBinding(context, name);
	if (!binding || !binding.pendingInitValue) {
		return;
	}
	binding.pendingInitValue = false;
}

function markUnusedInitValueWrite(
	context: UnusedInitValueContext,
	identifier: LuaIdentifierExpression,
	isGuaranteedWrite: boolean,
): void {
	if (!isGuaranteedWrite) {
		return;
	}
	const binding = resolveUnusedInitValueBinding(context, identifier.name);
	if (!binding || !binding.pendingInitValue) {
		return;
	}
	pushIssue(
		context.issues,
		'unused_init_value_pattern',
		binding.declaration,
		`Unused initial value is forbidden ("${binding.declaration.name}"). Remove the initializer and assign only when the value is actually known.`,
	);
	binding.pendingInitValue = false;
}

function lintUnusedInitValuesInExpression(expression: LuaExpression | null, context: UnusedInitValueContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			markUnusedInitValueRead(context, expression.name);
			return;
		case LuaSyntaxKind.MemberExpression:
			lintUnusedInitValuesInExpression(expression.base, context);
			return;
		case LuaSyntaxKind.IndexExpression:
			lintUnusedInitValuesInExpression(expression.base, context);
			lintUnusedInitValuesInExpression(expression.index, context);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintUnusedInitValuesInExpression(expression.left, context);
			lintUnusedInitValuesInExpression(expression.right, context);
			return;
		case LuaSyntaxKind.UnaryExpression:
			lintUnusedInitValuesInExpression(expression.operand, context);
			return;
		case LuaSyntaxKind.CallExpression:
			lintUnusedInitValuesInExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintUnusedInitValuesInExpression(argument, context);
			}
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					lintUnusedInitValuesInExpression(field.key, context);
				}
				lintUnusedInitValuesInExpression(field.value, context);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
			lintUnusedInitValuesInFunctionBody(expression.body.body, context.issues, expression.parameters);
			return;
		default:
			return;
	}
}

function lintUnusedInitValuesInAssignmentTarget(
	target: LuaExpression,
	operator: LuaAssignmentOperator,
	context: UnusedInitValueContext,
): void {
	if (target.kind === LuaSyntaxKind.IdentifierExpression) {
		if (operator !== LuaAssignmentOperator.Assign) {
			markUnusedInitValueRead(context, target.name);
		}
		return;
	}
	if (target.kind === LuaSyntaxKind.MemberExpression) {
		lintUnusedInitValuesInExpression(target.base, context);
		return;
	}
	if (target.kind === LuaSyntaxKind.IndexExpression) {
		lintUnusedInitValuesInExpression(target.base, context);
		lintUnusedInitValuesInExpression(target.index, context);
	}
}

function lintUnusedInitValuesInStatements(
	statements: ReadonlyArray<LuaStatement>,
	context: UnusedInitValueContext,
	isGuaranteedPath: boolean,
): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					lintUnusedInitValuesInExpression(value, context);
				}
				for (let index = 0; index < statement.names.length; index += 1) {
					declareUnusedInitValueBinding(context, statement.names[index], index < statement.values.length);
				}
				break;
			case LuaSyntaxKind.AssignmentStatement:
				for (const right of statement.right) {
					lintUnusedInitValuesInExpression(right, context);
				}
				for (const left of statement.left) {
					lintUnusedInitValuesInAssignmentTarget(left, statement.operator, context);
				}
				for (const left of statement.left) {
					if (left.kind === LuaSyntaxKind.IdentifierExpression) {
						markUnusedInitValueWrite(context, left, isGuaranteedPath);
					}
				}
				break;
			case LuaSyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LuaLocalFunctionStatement;
				declareUnusedInitValueBinding(context, localFunction.name, false);
				lintUnusedInitValuesInFunctionBody(
					localFunction.functionExpression.body.body,
					context.issues,
					localFunction.functionExpression.parameters,
				);
				break;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement:
				lintUnusedInitValuesInFunctionBody(
					statement.functionExpression.body.body,
					context.issues,
					statement.functionExpression.parameters,
				);
				break;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintUnusedInitValuesInExpression(expression, context);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintUnusedInitValuesInExpression(clause.condition, context);
					}
					enterUnusedInitValueScope(context);
					lintUnusedInitValuesInStatements(clause.block.body, context, false);
					leaveUnusedInitValueScope(context);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				lintUnusedInitValuesInExpression(statement.condition, context);
				enterUnusedInitValueScope(context);
				lintUnusedInitValuesInStatements(statement.block.body, context, false);
				leaveUnusedInitValueScope(context);
				break;
			case LuaSyntaxKind.RepeatStatement:
				enterUnusedInitValueScope(context);
				lintUnusedInitValuesInStatements(statement.block.body, context, false);
				lintUnusedInitValuesInExpression(statement.condition, context);
				leaveUnusedInitValueScope(context);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				lintUnusedInitValuesInExpression(statement.start, context);
				lintUnusedInitValuesInExpression(statement.limit, context);
				lintUnusedInitValuesInExpression(statement.step, context);
				enterUnusedInitValueScope(context);
				declareUnusedInitValueBinding(context, statement.variable, false);
				lintUnusedInitValuesInStatements(statement.block.body, context, false);
				leaveUnusedInitValueScope(context);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					lintUnusedInitValuesInExpression(iterator, context);
				}
				enterUnusedInitValueScope(context);
				for (const variable of statement.variables) {
					declareUnusedInitValueBinding(context, variable, false);
				}
				lintUnusedInitValuesInStatements(statement.block.body, context, false);
				leaveUnusedInitValueScope(context);
				break;
			case LuaSyntaxKind.DoStatement:
				enterUnusedInitValueScope(context);
				lintUnusedInitValuesInStatements(statement.block.body, context, isGuaranteedPath);
				leaveUnusedInitValueScope(context);
				break;
			case LuaSyntaxKind.CallStatement:
				lintUnusedInitValuesInExpression(statement.expression, context);
				break;
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
}

function lintUnusedInitValuesInFunctionBody(
	statements: ReadonlyArray<LuaStatement>,
	issues: LuaLintIssue[],
	parameters: ReadonlyArray<LuaIdentifierExpression>,
): void {
	const context = createUnusedInitValueContext(issues);
	try {
		for (const parameter of parameters) {
			declareUnusedInitValueBinding(context, parameter, false);
		}
		lintUnusedInitValuesInStatements(statements, context, true);
	} finally {
		leaveUnusedInitValueScope(context);
	}
}

function lintFunctionBody(
	functionName: string,
	functionExpression: LuaFunctionExpression,
	issues: LuaLintIssue[],
	options: { readonly isMethodDeclaration: boolean; readonly usageInfo?: FunctionUsageInfo; },
): void {
	const isNamedFunction = functionName !== '<anonymous>';
	const isVisualUpdateLike = isNamedFunction && isVisualUpdateLikeFunctionName(functionName);
	if (isVisualUpdateLike) {
		pushIssue(
			issues,
			'visual_update_pattern',
			functionExpression,
			`update_visual/sync_*_components/apply_pose/refresh_presentation_if_changed-style code is forbidden ("${functionName}"). This is an ugly workaround pattern (update_visual <-> sync_*_components <-> apply_pose <-> refresh_presentation_if_changed). Use deterministic initialization and on-change updates.`,
		);
	}
	const isGetterOrSetter = isNamedFunction && (matchesGetterPattern(functionExpression) || matchesSetterPattern(functionExpression));
	if (isGetterOrSetter) {
		pushIssue(
			issues,
			'getter_setter_pattern',
			functionExpression,
			`Getter/setter wrapper pattern is forbidden ("${functionName}").`,
		);
	}
	const isComparisonWrapperGetter = isNamedFunction && matchesComparisonWrapperGetterPattern(functionExpression);
	if (isComparisonWrapperGetter) {
		pushIssue(
			issues,
			'comparison_wrapper_getter_pattern',
			functionExpression,
			`Single-value comparison wrapper is forbidden ("${functionName}"). Inline the comparison or expose the original value source directly.`,
		);
	}
	const isBuiltinRecreation = isNamedFunction && matchesBuiltinRecreationPattern(functionExpression);
	if (isBuiltinRecreation) {
		pushIssue(
			issues,
			'builtin_recreation_pattern',
			functionExpression,
			`Recreating existing built-in behavior is forbidden ("${functionName}").`,
		);
	}
	const isForbiddenRandomHelper = isNamedFunction && !isBuiltinRecreation && matchesForbiddenRandomHelperPattern(functionName);
	if (isForbiddenRandomHelper) {
		pushIssue(
			issues,
			'forbidden_random_helper_pattern',
			functionExpression,
			`Custom random helper "${functionName}" is forbidden. Use math.random directly instead of inventing a random_int-style wrapper.`,
		);
	}
	const isBool01Duplicate = isNamedFunction && matchesBool01DuplicatePattern(functionExpression);
	if (isBool01Duplicate) {
		pushIssue(
			issues,
			'bool01_duplicate_pattern',
			functionExpression,
			`Duplicate of global bool01 is forbidden ("${functionName}"). Use bool01(...) directly.`,
		);
	}
	const isPureCopyFunction = isNamedFunction && matchesPureCopyFunctionPattern(functionExpression);
	if (isPureCopyFunction) {
		pushIssue(
			issues,
			'pure_copy_function_pattern',
			functionExpression,
			`Defensive pure-copy function is forbidden ("${functionName}"). Do not replace it with workaround wrappers/helpers; use original source values directly.`,
		);
	}
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
	if (matchesEnsureLocalAliasPattern(functionExpression)) {
		pushIssue(
			issues,
			'ensure_local_alias_pattern',
			functionExpression,
			`Ensure-style local alias lazy initialization is forbidden ("${functionName}").`,
		);
	}
	if (isNamedFunction) {
		lintInlineStaticLookupTablePattern(functionName, functionExpression, issues);
	}
	if (isNamedFunction && matchesHandlerIdentityDispatchPattern(functionExpression)) {
		pushIssue(
			issues,
			'handler_identity_dispatch_pattern',
			functionExpression,
			`Handler-identity dispatch branching with mixed call signatures is forbidden ("${functionName}"). Use uniform handler signatures and direct dispatch without a cached handler local.`,
		);
	}
}

function lintLocalAssignment(statement: LuaLocalAssignmentStatement, issues: LuaLintIssue[]): void {
	const valueCount = Math.min(statement.names.length, statement.values.length);
	for (let index = 0; index < valueCount; index += 1) {
		const value = statement.values[index];
		const localName = statement.names[index].name;
		const selfPropertyName = getSelfPropertyNameFromAliasExpression(value);
		if (localName !== '_' && selfPropertyName && (isStateLikeAliasName(localName) || isStateLikeAliasName(selfPropertyName))) {
			pushIssue(
				issues,
				'self_property_local_alias_pattern',
				statement.names[index],
				`Local alias of self state-data is forbidden (${localName}). Read state values directly from self instead of caching them in locals.`,
			);
		}
	}
}

function lintConstantCopyInExpression(expression: LuaExpression | null, context: ConstantCopyContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.MemberExpression:
			lintConstantCopyInExpression(expression.base, context);
			return;
		case LuaSyntaxKind.IndexExpression:
			lintConstantCopyInExpression(expression.base, context);
			lintConstantCopyInExpression(expression.index, context);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintConstantCopyInExpression(expression.left, context);
			lintConstantCopyInExpression(expression.right, context);
			return;
		case LuaSyntaxKind.UnaryExpression:
			lintConstantCopyInExpression(expression.operand, context);
			return;
		case LuaSyntaxKind.CallExpression:
			lintConstantCopyInExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintConstantCopyInExpression(argument, context);
			}
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					lintConstantCopyInExpression(field.key, context);
				}
				lintConstantCopyInExpression(field.value, context);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
			enterConstantCopyScope(context);
			for (const parameter of expression.parameters) {
				declareConstantCopyBinding(context, parameter, false);
			}
			lintConstantCopyInStatements(expression.body.body, context);
			leaveConstantCopyScope(context);
			return;
		default:
			return;
	}
}

function lintConstantCopyInAssignmentTarget(target: LuaExpression | null, context: ConstantCopyContext): void {
	if (!target) {
		return;
	}
	if (target.kind === LuaSyntaxKind.MemberExpression) {
		lintConstantCopyInExpression(target.base, context);
		return;
	}
	if (target.kind === LuaSyntaxKind.IndexExpression) {
		lintConstantCopyInExpression(target.base, context);
		lintConstantCopyInExpression(target.index, context);
	}
}

function lintConstantCopyInStatements(statements: ReadonlyArray<LuaStatement>, context: ConstantCopyContext): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement: {
				const valueCount = Math.min(statement.names.length, statement.values.length);
				const isConstantSourceByValue: boolean[] = [];
				const isForbiddenCopyByValue: boolean[] = [];
				for (let index = 0; index < valueCount; index += 1) {
					const value = statement.values[index];
					lintConstantCopyInExpression(value, context);
					isConstantSourceByValue[index] = isConstantSourceExpression(value, context);
					isForbiddenCopyByValue[index] = isForbiddenConstantCopyExpression(value, context);
				}
				for (let index = 0; index < statement.names.length; index += 1) {
					if (index < valueCount && isForbiddenCopyByValue[index]) {
						pushIssue(
							context.issues,
							'constant_copy_pattern',
							statement.values[index],
							`Local copies of constants are forbidden ("${statement.names[index].name}").`,
						);
					}
					declareConstantCopyBinding(context, statement.names[index], isConstantSourceByValue[index] ?? false);
				}
				break;
			}
			case LuaSyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LuaLocalFunctionStatement;
				declareConstantCopyBinding(context, localFunction.name, false);
				enterConstantCopyScope(context);
				for (const parameter of localFunction.functionExpression.parameters) {
					declareConstantCopyBinding(context, parameter, false);
				}
				lintConstantCopyInStatements(localFunction.functionExpression.body.body, context);
				leaveConstantCopyScope(context);
				break;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement: {
				const declaration = statement as LuaFunctionDeclarationStatement;
				if (declaration.name.identifiers.length === 1 && declaration.name.methodName === null) {
					setConstantCopyBindingByName(context, declaration.name.identifiers[0], false);
				}
				enterConstantCopyScope(context);
				for (const parameter of declaration.functionExpression.parameters) {
					declareConstantCopyBinding(context, parameter, false);
				}
				lintConstantCopyInStatements(declaration.functionExpression.body.body, context);
				leaveConstantCopyScope(context);
				break;
			}
			case LuaSyntaxKind.AssignmentStatement: {
				for (const right of statement.right) {
					lintConstantCopyInExpression(right, context);
				}
				if (statement.operator === LuaAssignmentOperator.Assign) {
					const assignedConstantSources: boolean[] = [];
					for (let index = 0; index < statement.left.length; index += 1) {
						const right = index < statement.right.length ? statement.right[index] : null;
						assignedConstantSources[index] = right ? isConstantSourceExpression(right, context) : false;
					}
					for (let index = 0; index < statement.left.length; index += 1) {
						const left = statement.left[index];
						if (left.kind === LuaSyntaxKind.IdentifierExpression) {
							setConstantCopyBindingByName(context, left.name, assignedConstantSources[index]);
							continue;
						}
						lintConstantCopyInAssignmentTarget(left, context);
					}
					break;
				}
				for (const left of statement.left) {
					if (left.kind === LuaSyntaxKind.IdentifierExpression) {
						setConstantCopyBindingByName(context, left.name, false);
						continue;
					}
					lintConstantCopyInAssignmentTarget(left, context);
				}
				break;
			}
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintConstantCopyInExpression(expression, context);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintConstantCopyInExpression(clause.condition, context);
					}
					enterConstantCopyScope(context);
					lintConstantCopyInStatements(clause.block.body, context);
					leaveConstantCopyScope(context);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				lintConstantCopyInExpression(statement.condition, context);
				enterConstantCopyScope(context);
				lintConstantCopyInStatements(statement.block.body, context);
				leaveConstantCopyScope(context);
				break;
			case LuaSyntaxKind.RepeatStatement:
				enterConstantCopyScope(context);
				lintConstantCopyInStatements(statement.block.body, context);
				leaveConstantCopyScope(context);
				lintConstantCopyInExpression(statement.condition, context);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				lintConstantCopyInExpression(statement.start, context);
				lintConstantCopyInExpression(statement.limit, context);
				lintConstantCopyInExpression(statement.step, context);
				enterConstantCopyScope(context);
				declareConstantCopyBinding(context, statement.variable, false);
				lintConstantCopyInStatements(statement.block.body, context);
				leaveConstantCopyScope(context);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					lintConstantCopyInExpression(iterator, context);
				}
				enterConstantCopyScope(context);
				for (const variable of statement.variables) {
					declareConstantCopyBinding(context, variable, false);
				}
				lintConstantCopyInStatements(statement.block.body, context);
				leaveConstantCopyScope(context);
				break;
			case LuaSyntaxKind.DoStatement:
				enterConstantCopyScope(context);
				lintConstantCopyInStatements(statement.block.body, context);
				leaveConstantCopyScope(context);
				break;
			case LuaSyntaxKind.CallStatement:
				lintConstantCopyInExpression(statement.expression, context);
				break;
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
}

function lintConstantCopyPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	const context = createConstantCopyContext(issues);
	enterConstantCopyScope(context);
	try {
		lintConstantCopyInStatements(statements, context);
	} finally {
		leaveConstantCopyScope(context);
	}
}

function createConstLocalContext(issues: LuaLintIssue[]): ConstLocalContext {
	return {
		issues,
		bindingStacksByName: new Map<string, ConstLocalBinding[]>(),
		scopeStack: [],
	};
}

function enterConstLocalScope(context: ConstLocalContext): void {
	context.scopeStack.push({ names: [] });
}

function leaveConstLocalScope(context: ConstLocalContext): void {
	const scope = context.scopeStack.pop();
	if (!scope) {
		return;
	}
	for (let index = scope.names.length - 1; index >= 0; index -= 1) {
		const name = scope.names[index];
		const stack = context.bindingStacksByName.get(name);
		if (!stack || stack.length === 0) {
			continue;
		}
		const binding = stack.pop();
		if (binding.shouldReport && binding.writeCountAfterDeclaration === 0) {
			pushIssue(
				context.issues,
				'local_const_pattern',
				binding.declaration,
				`Local "${binding.declaration.name}" is never reassigned. Mark it <const>.`,
			);
		}
		if (stack.length === 0) {
			context.bindingStacksByName.delete(name);
		}
	}
}

function declareConstLocalBinding(
	context: ConstLocalContext,
	declaration: LuaIdentifierExpression,
	shouldReport: boolean,
): void {
	const scope = context.scopeStack[context.scopeStack.length - 1];
	scope.names.push(declaration.name);
	let stack = context.bindingStacksByName.get(declaration.name);
	if (!stack) {
		stack = [];
		context.bindingStacksByName.set(declaration.name, stack);
	}
	stack.push({
		declaration,
		shouldReport,
		writeCountAfterDeclaration: 0,
	});
}

function markConstLocalWriteByName(context: ConstLocalContext, name: string): void {
	const stack = context.bindingStacksByName.get(name);
	if (!stack || stack.length === 0) {
		return;
	}
	const binding = stack[stack.length - 1];
	if (!binding.shouldReport) {
		return;
	}
	binding.writeCountAfterDeclaration += 1;
}

function markConstLocalWrite(context: ConstLocalContext, identifier: LuaIdentifierExpression): void {
	markConstLocalWriteByName(context, identifier.name);
}

function lintConstLocalInExpression(expression: LuaExpression | null, context: ConstLocalContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.MemberExpression:
			lintConstLocalInExpression(expression.base, context);
			return;
		case LuaSyntaxKind.IndexExpression:
			lintConstLocalInExpression(expression.base, context);
			lintConstLocalInExpression(expression.index, context);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintConstLocalInExpression(expression.left, context);
			lintConstLocalInExpression(expression.right, context);
			return;
		case LuaSyntaxKind.UnaryExpression:
			lintConstLocalInExpression(expression.operand, context);
			return;
		case LuaSyntaxKind.CallExpression:
			lintConstLocalInExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintConstLocalInExpression(argument, context);
			}
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					lintConstLocalInExpression(field.key, context);
				}
				lintConstLocalInExpression(field.value, context);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
			enterConstLocalScope(context);
			for (const parameter of expression.parameters) {
				declareConstLocalBinding(context, parameter, false);
			}
			lintConstLocalInStatements(expression.body.body, context);
			leaveConstLocalScope(context);
			return;
		default:
			return;
	}
}

function lintConstLocalInAssignmentTarget(target: LuaExpression | null, context: ConstLocalContext): void {
	if (!target) {
		return;
	}
	if (target.kind === LuaSyntaxKind.IdentifierExpression) {
		markConstLocalWrite(context, target);
		return;
	}
	if (target.kind === LuaSyntaxKind.MemberExpression) {
		lintConstLocalInExpression(target.base, context);
		return;
	}
	if (target.kind === LuaSyntaxKind.IndexExpression) {
		lintConstLocalInExpression(target.base, context);
		lintConstLocalInExpression(target.index, context);
	}
}

function lintConstLocalInStatements(statements: ReadonlyArray<LuaStatement>, context: ConstLocalContext): void {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement: {
				const hasInitializer = statement.values.length > 0;
				for (const value of statement.values) {
					lintConstLocalInExpression(value, context);
				}
				for (let index = 0; index < statement.names.length; index += 1) {
					declareConstLocalBinding(
						context,
						statement.names[index],
						hasInitializer && statement.attributes[index] !== 'const',
					);
				}
				break;
			}
			case LuaSyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LuaLocalFunctionStatement;
				declareConstLocalBinding(context, localFunction.name, false);
				enterConstLocalScope(context);
				for (const parameter of localFunction.functionExpression.parameters) {
					declareConstLocalBinding(context, parameter, false);
				}
				lintConstLocalInStatements(localFunction.functionExpression.body.body, context);
				leaveConstLocalScope(context);
				break;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement: {
				const declaration = statement as LuaFunctionDeclarationStatement;
				if (declaration.name.identifiers.length === 1 && declaration.name.methodName === null) {
					markConstLocalWriteByName(context, declaration.name.identifiers[0]);
				}
				enterConstLocalScope(context);
				for (const parameter of declaration.functionExpression.parameters) {
					declareConstLocalBinding(context, parameter, false);
				}
				lintConstLocalInStatements(declaration.functionExpression.body.body, context);
				leaveConstLocalScope(context);
				break;
			}
			case LuaSyntaxKind.AssignmentStatement:
				for (const right of statement.right) {
					lintConstLocalInExpression(right, context);
				}
				for (const left of statement.left) {
					lintConstLocalInAssignmentTarget(left, context);
				}
				break;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintConstLocalInExpression(expression, context);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintConstLocalInExpression(clause.condition, context);
					}
					enterConstLocalScope(context);
					lintConstLocalInStatements(clause.block.body, context);
					leaveConstLocalScope(context);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				lintConstLocalInExpression(statement.condition, context);
				enterConstLocalScope(context);
				lintConstLocalInStatements(statement.block.body, context);
				leaveConstLocalScope(context);
				break;
			case LuaSyntaxKind.RepeatStatement:
				enterConstLocalScope(context);
				lintConstLocalInStatements(statement.block.body, context);
				leaveConstLocalScope(context);
				lintConstLocalInExpression(statement.condition, context);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				lintConstLocalInExpression(statement.start, context);
				lintConstLocalInExpression(statement.limit, context);
				lintConstLocalInExpression(statement.step, context);
				enterConstLocalScope(context);
				declareConstLocalBinding(context, statement.variable, false);
				lintConstLocalInStatements(statement.block.body, context);
				leaveConstLocalScope(context);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					lintConstLocalInExpression(iterator, context);
				}
				enterConstLocalScope(context);
				for (const variable of statement.variables) {
					declareConstLocalBinding(context, variable, false);
				}
				lintConstLocalInStatements(statement.block.body, context);
				leaveConstLocalScope(context);
				break;
			case LuaSyntaxKind.DoStatement:
				enterConstLocalScope(context);
				lintConstLocalInStatements(statement.block.body, context);
				leaveConstLocalScope(context);
				break;
			case LuaSyntaxKind.CallStatement:
				lintConstLocalInExpression(statement.expression, context);
				break;
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
}

function lintConstLocalPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	const context = createConstLocalContext(issues);
	enterConstLocalScope(context);
	try {
		lintConstLocalInStatements(statements, context);
	} finally {
		leaveConstLocalScope(context);
	}
}

function lintLocalFunctionConstPattern(statement: LuaLocalFunctionStatement, issues: LuaLintIssue[]): void {
	pushIssue(
		issues,
		'local_function_const_pattern',
		statement.name,
		`Local function "${statement.name.name}" is forbidden. Use "local ${statement.name.name}<const> = function(...) ... end" instead.`,
	);
}

function lintRequireCall(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (expression.callee.kind !== LuaSyntaxKind.IdentifierExpression || expression.callee.name !== 'require') {
		return;
	}
	if (expression.arguments.length === 0) {
		return;
	}
	const firstArgument = expression.arguments[0];
	if (firstArgument.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return;
	}
	if (FORBIDDEN_RENDER_MODULE_REQUIRES.has(firstArgument.value)) {
		pushIssue(
			issues,
			'forbidden_render_module_require_pattern',
			firstArgument,
			`require('${firstArgument.value}') is forbidden. The legacy Lua render wrapper modules are removed; submit VDP work through MMIO registers instead.`,
		);
		return;
	}
	if (!firstArgument.value.toLowerCase().endsWith('.lua')) {
		return;
	}
	pushIssue(
		issues,
		'require_lua_extension_pattern',
		firstArgument,
		`require() must not include a ".lua" suffix ("${firstArgument.value}").`,
	);
}

function isGlobalCall(expression: LuaCallExpression, name: string): boolean {
	return expression.callee.kind === LuaSyntaxKind.IdentifierExpression && expression.callee.name === name;
}

function lintForbiddenRenderWrapperCall(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (expression.callee.kind !== LuaSyntaxKind.IdentifierExpression) {
		return;
	}
	const calleeName = expression.callee.name;
	if (!FORBIDDEN_RENDER_WRAPPER_CALLS.has(calleeName)) {
		return;
	}
	pushIssue(
		issues,
		'forbidden_render_wrapper_call_pattern',
		expression.callee,
		`Legacy render wrapper "${calleeName}" is forbidden. Submit VDP work through MMIO registers instead of Lua draw-wrapper calls.`,
	);
}

function lintForbiddenRenderLayerString(field: LuaTableField, issues: LuaLintIssue[]): void {
	if (field.kind !== LuaTableFieldKind.IdentifierKey || field.name !== 'layer') {
		return;
	}
	if (field.value.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return;
	}
	if (!FORBIDDEN_RENDER_LAYER_STRINGS.has(field.value.value)) {
		return;
	}
	pushIssue(
		issues,
		'forbidden_render_layer_string_pattern',
		field.value,
		`Render layer "${field.value.value}" is forbidden here. Use the sys_vdp_layer_* enum constants instead of Lua strings.`,
	);
}

function containsServiceLabel(value: string): boolean {
	return value.toLowerCase().includes('service');
}

function containsLabel(value: string, label: string): boolean {
	return value.toLowerCase().includes(label.toLowerCase());
}

function removeLabel(value: string, label: string): string | undefined {
	const stripped = value
		.replace(new RegExp(label, 'gi'), '')
		.replace(/[._-]{2,}/g, '_')
		.replace(/^[._-]+|[._-]+$/g, '');
	if (stripped.length === 0 || stripped === value) {
		return undefined;
	}
	return stripped;
}

function removeServiceLabel(value: string): string | undefined {
	return removeLabel(value, 'service');
}

function appendSuggestionMessage(baseMessage: string, value: string, label: string): string {
	const suggested = removeLabel(value, label);
	if (!suggested) {
		return baseMessage;
	}
	return `${baseMessage} Use "${suggested}" instead.`;
}

function readStringFieldValueFromTable(expression: LuaExpression | undefined, fieldName: string): string | undefined {
	if (!expression || expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return undefined;
	}
	for (const field of expression.fields) {
		if (getTableFieldKey(field) !== fieldName) {
			continue;
		}
		if (field.value.kind !== LuaSyntaxKind.StringLiteralExpression) {
			return undefined;
		}
		return field.value.value;
	}
	return undefined;
}

function readBooleanFieldValueFromTable(expression: LuaExpression | undefined, fieldName: string): boolean | undefined {
	if (!expression || expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return undefined;
	}
	for (const field of expression.fields) {
		if (getTableFieldKey(field) !== fieldName) {
			continue;
		}
		if (field.value.kind !== LuaSyntaxKind.BooleanLiteralExpression) {
			return undefined;
		}
		return field.value.value;
	}
	return undefined;
}

function findTableFieldByKey(expression: LuaExpression | undefined, fieldName: string): LuaTableField | undefined {
	if (!expression || expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return undefined;
	}
	for (const field of expression.fields) {
		if (getTableFieldKey(field) === fieldName) {
			return field;
		}
	}
	return undefined;
}

function lintServiceDefinitionSuffixPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (isGlobalCall(expression, 'define_service')) {
		const definitionId = readStringFieldValueFromTable(expression.arguments[0], 'def_id');
		if (definitionId && containsServiceLabel(definitionId)) {
			const suggestedName = removeServiceLabel(definitionId);
			const suggestion = suggestedName
				? ` Use "${suggestedName}" instead.`
				: '';
			pushIssue(
				issues,
				'service_definition_suffix_pattern',
				expression.arguments[0],
				`Service definition id must not contain "service" ("${definitionId}").${suggestion}`,
			);
		}
		return;
	}
	if (!isGlobalCall(expression, 'create_service')) {
		return;
	}
	const definitionArgument = expression.arguments[0];
	if (!definitionArgument || definitionArgument.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return;
	}
	const definitionId = definitionArgument.value;
	if (!containsServiceLabel(definitionId)) {
		return;
	}
	const suggestedName = removeServiceLabel(definitionId);
	const suggestion = suggestedName
		? ` Use "${suggestedName}" instead.`
		: '';
	pushIssue(
		issues,
		'service_definition_suffix_pattern',
		definitionArgument,
		`Service definition id must not contain "service" ("${definitionId}").${suggestion}`,
	);
}

function lintCreateServiceIdAddonPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isGlobalCall(expression, 'create_service')) {
		return;
	}
	if (expression.arguments.length < 2) {
		return;
	}
	const addons = expression.arguments[1];
	const idField = findTableFieldByKey(addons, 'id');
	if (!idField) {
		return;
	}
	pushIssue(
		issues,
		'create_service_id_addon_pattern',
		idField.value,
		'Passing "id" in create_service(...) addons is forbidden. Set the id in define_service.defaults.id.',
	);
}

function lintDefineServiceIdPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_service')) {
		return;
	}
	const definition = expression.arguments[0];
	if (!definition || definition.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	const defaultsField = findTableFieldByKey(definition, 'defaults');
	if (!defaultsField || defaultsField.value.kind !== LuaSyntaxKind.TableConstructorExpression) {
		pushIssue(
			issues,
			'define_service_id_pattern',
			definition,
			'Service id must be defined via define_service.defaults.id (string literal, no "_service" suffix).',
		);
		return;
	}
	const idField = findTableFieldByKey(defaultsField.value, 'id');
	if (!idField) {
		pushIssue(
			issues,
			'define_service_id_pattern',
			defaultsField.value,
			'Service id must be defined via define_service.defaults.id (string literal, no "_service" suffix).',
		);
		return;
	}
	if (idField.value.kind !== LuaSyntaxKind.StringLiteralExpression) {
		pushIssue(
			issues,
			'define_service_id_pattern',
			idField.value,
			'Service id in define_service.defaults.id must be a string literal and must not contain "service".',
		);
		return;
	}
	const serviceId = idField.value.value;
	if (!containsServiceLabel(serviceId)) {
		return;
	}
	const suggestedId = removeServiceLabel(serviceId);
	const suggestion = suggestedId
		? ` Use "${suggestedId}" instead.`
		: '';
	pushIssue(
		issues,
		'define_service_id_pattern',
		idField.value,
		`Service id in define_service.defaults.id must not contain "service" ("${serviceId}").${suggestion}`,
	);
}

function visitTableFieldsRecursively(
	expression: LuaExpression | undefined,
	onField: (field: LuaTableField) => void,
): void {
	if (!expression || expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		onField(field);
		if (field.kind === LuaTableFieldKind.ExpressionKey) {
			visitTableFieldsRecursively(field.key, onField);
		}
		visitTableFieldsRecursively(field.value, onField);
	}
}

function lintDefineFactoryTickEnabledAndSpaceIdPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	let factoryName: string | undefined;
	if (isGlobalCall(expression, 'define_service')) {
		factoryName = 'define_service';
	} else if (isGlobalCall(expression, 'define_prefab')) {
		factoryName = 'define_prefab';
	}
	if (!factoryName) {
		return;
	}
	const definition = expression.arguments[0];
	visitTableFieldsRecursively(definition, (field) => {
		const key = getTableFieldKey(field);
		if (key === 'tick_enabled' && field.value.kind === LuaSyntaxKind.BooleanLiteralExpression) {
			pushIssue(
				issues,
				'define_factory_tick_enabled_pattern',
				field.value,
				`${factoryName}: tick_enabled=true/false is forbidden. Remove it: true is redundant (default), and false is ineffective because ticking is enabled on activate.`,
			);
			return;
		}
		if (key !== 'space_id') {
			return;
		}
		pushIssue(
			issues,
			'define_factory_space_id_pattern',
			field.value,
			`${factoryName}: space_id is forbidden. Services must not carry space_id, and prefab/object space must be assigned at inst(..., { space_id = ... }).`,
		);
	});
}

type FsmVisualPrefabDefaults = {
	readonly imgid?: string;
	readonly visible?: boolean;
};

function isSelfGfxCallExpression(expression: LuaCallExpression): boolean {
	if (getCallMethodName(expression) !== 'gfx') {
		return false;
	}
	const receiver = getCallReceiverExpression(expression);
	return !!receiver && isSelfExpressionRoot(receiver);
}

function getSelfGfxStringLiteralArgument(expression: LuaCallExpression): string | undefined {
	if (!isSelfGfxCallExpression(expression) || expression.arguments.length !== 1) {
		return undefined;
	}
	const argument = expression.arguments[0];
	if (argument.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return undefined;
	}
	return argument.value;
}

type SelfBooleanPropertyAssignmentMatch = {
	readonly propertyName: string;
	readonly target: LuaExpression;
	readonly value: LuaExpression;
};

function findSelfBooleanPropertyAssignmentInStatements(
	statements: ReadonlyArray<LuaStatement>,
	propertyName: string,
): SelfBooleanPropertyAssignmentMatch | undefined {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.AssignmentStatement:
				if (statement.operator !== LuaAssignmentOperator.Assign) {
					break;
				}
				for (let index = 0; index < statement.left.length && index < statement.right.length; index += 1) {
					const target = statement.left[index];
					const assignedPropertyName = getSelfAssignedPropertyNameFromTarget(target);
					if (assignedPropertyName !== propertyName) {
						continue;
					}
					const value = statement.right[index];
					if (value.kind !== LuaSyntaxKind.BooleanLiteralExpression) {
						continue;
					}
					return {
						propertyName: assignedPropertyName,
						target,
						value,
					};
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					const nested = findSelfBooleanPropertyAssignmentInStatements(clause.block.body, propertyName);
					if (nested) {
						return nested;
					}
				}
				break;
			case LuaSyntaxKind.WhileStatement: {
				const nested = findSelfBooleanPropertyAssignmentInStatements(statement.block.body, propertyName);
				if (nested) {
					return nested;
				}
				break;
			}
			case LuaSyntaxKind.RepeatStatement: {
				const nested = findSelfBooleanPropertyAssignmentInStatements(statement.block.body, propertyName);
				if (nested) {
					return nested;
				}
				break;
			}
			case LuaSyntaxKind.ForNumericStatement: {
				const nested = findSelfBooleanPropertyAssignmentInStatements(statement.block.body, propertyName);
				if (nested) {
					return nested;
				}
				break;
			}
			case LuaSyntaxKind.ForGenericStatement: {
				const nested = findSelfBooleanPropertyAssignmentInStatements(statement.block.body, propertyName);
				if (nested) {
					return nested;
				}
				break;
			}
			case LuaSyntaxKind.DoStatement: {
				const nested = findSelfBooleanPropertyAssignmentInStatements(statement.block.body, propertyName);
				if (nested) {
					return nested;
				}
				break;
			}
			case LuaSyntaxKind.LocalAssignmentStatement:
			case LuaSyntaxKind.LocalFunctionStatement:
			case LuaSyntaxKind.FunctionDeclarationStatement:
			case LuaSyntaxKind.ReturnStatement:
			case LuaSyntaxKind.CallStatement:
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
	return undefined;
}

function stateTimelinesDriveSelfGfx(stateExpression: LuaExpression): boolean {
	const timelinesField = findTableFieldByKey(stateExpression, 'timelines');
	if (!timelinesField || timelinesField.value.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return false;
	}
	for (const timelineField of timelinesField.value.fields) {
		if (timelineField.value.kind !== LuaSyntaxKind.TableConstructorExpression) {
			continue;
		}
		const onFrameField = findTableFieldByKey(timelineField.value, 'on_frame');
		if (!onFrameField || onFrameField.value.kind !== LuaSyntaxKind.FunctionExpression) {
			continue;
		}
		if (findCallExpressionInStatements(onFrameField.value.body.body, isSelfGfxCallExpression)) {
			return true;
		}
	}
	return false;
}

function collectPrefabVisualDefaultsById(statements: ReadonlyArray<LuaStatement>): ReadonlyMap<string, FsmVisualPrefabDefaults> {
	const prefabs = new Map<string, FsmVisualPrefabDefaults>();
	visitCallExpressionsInStatements(statements, (expression) => {
		if (!isGlobalCall(expression, 'define_prefab')) {
			return;
		}
		const definition = expression.arguments[0];
		const defId = readStringFieldValueFromTable(definition, 'def_id');
		if (!defId) {
			return;
		}
		const defaultsField = findTableFieldByKey(definition, 'defaults');
		const defaults = defaultsField?.value;
		prefabs.set(defId, {
			imgid: readStringFieldValueFromTable(defaults, 'imgid'),
			visible: readBooleanFieldValueFromTable(defaults, 'visible'),
		});
	});
	return prefabs;
}

function lintFsmEnteringStateVisualSetupPattern(
	statements: ReadonlyArray<LuaStatement>,
	issues: LuaLintIssue[],
): void {
	const prefabDefaultsById = collectPrefabVisualDefaultsById(statements);
	visitCallExpressionsInStatements(statements, (expression) => {
		if (!isGlobalCall(expression, 'define_fsm')) {
			return;
		}
		const fsmIdArgument = expression.arguments[0];
		if (!fsmIdArgument || fsmIdArgument.kind !== LuaSyntaxKind.StringLiteralExpression) {
			return;
		}
		const definition = expression.arguments[1];
		const statesField = findTableFieldByKey(definition, 'states');
		if (!statesField || statesField.value.kind !== LuaSyntaxKind.TableConstructorExpression) {
			return;
		}
		const prefabDefaults = prefabDefaultsById.get(fsmIdArgument.value);
		for (const stateField of statesField.value.fields) {
			const stateName = getStateNameFromStateField(stateField);
			if (!stateName || stateField.value.kind !== LuaSyntaxKind.TableConstructorExpression) {
				continue;
			}
			const enteringStateField = findTableFieldByKey(stateField.value, 'entering_state');
			if (!enteringStateField || enteringStateField.value.kind !== LuaSyntaxKind.FunctionExpression) {
				continue;
			}
			const body = enteringStateField.value.body.body;
			const visibleAssignment = findSelfBooleanPropertyAssignmentInStatements(body, 'visible');
			const gfxCall = findCallExpressionInStatements(body, isSelfGfxCallExpression);
			if (visibleAssignment) {
				pushIssue(
					issues,
					'fsm_entering_state_visual_setup_pattern',
					visibleAssignment.target,
					`FSM state "${stateName}" must not set self.visible in entering_state. Move the object between spaces instead of hiding/showing it via visible; keep visual setup out of entering_state${gfxCall ? ', including self:gfx(...)' : ''}.`,
				);
				continue;
			}
			if (!gfxCall) {
				continue;
			}
			const gfxLiteral = getSelfGfxStringLiteralArgument(gfxCall);
			if (gfxLiteral && prefabDefaults?.imgid === gfxLiteral) {
				pushIssue(
					issues,
					'fsm_entering_state_visual_setup_pattern',
					gfxCall,
					`FSM state "${stateName}" must not call self:gfx('${gfxLiteral}') in entering_state when define_prefab already sets imgid='${gfxLiteral}'. Keep the default sprite in define_prefab defaults instead of reapplying it on state entry.`,
				);
				continue;
			}
			if (!stateTimelinesDriveSelfGfx(stateField.value)) {
				continue;
			}
			pushIssue(
				issues,
				'fsm_entering_state_visual_setup_pattern',
				gfxCall,
				`FSM state "${stateName}" must not seed self:gfx(...) in entering_state when the same state's timeline already drives gfx in on_frame. Let the timeline produce the visual frame instead of pre-setting gfx on entry.`,
			);
		}
	});
}

const FSM_STATE_HANDLER_MAP_KEYS = new Set<string>([
	'on',
	'input_event_handlers',
	'events_once',
]);

function lintFsmDirectStateHandlerMapValue(mapExpression: LuaExpression, issues: LuaLintIssue[]): void {
	if (mapExpression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const entry of mapExpression.fields) {
		const value = entry.value;
		if (value.kind !== LuaSyntaxKind.TableConstructorExpression) {
			continue;
		}
		if (value.fields.length !== 1) {
			continue;
		}
		const goField = findTableFieldByKey(value, 'go');
		if (!goField) {
			continue;
		}
		if (
			goField.value.kind !== LuaSyntaxKind.StringLiteralExpression &&
			goField.value.kind !== LuaSyntaxKind.FunctionExpression &&
			goField.value.kind !== LuaSyntaxKind.IdentifierExpression &&
			goField.value.kind !== LuaSyntaxKind.MemberExpression &&
			goField.value.kind !== LuaSyntaxKind.IndexExpression
		) {
			continue;
		}
		if (goField.value.kind === LuaSyntaxKind.StringLiteralExpression) {
			pushIssue(
				issues,
				'fsm_direct_state_handler_shorthand_pattern',
				goField.value,
				`FSM direct state-id handlers must use shorthand. Replace "{ go = '${goField.value.value}' }" with "${goField.value.value}".`,
			);
			continue;
		}
		pushIssue(
			issues,
			'fsm_direct_state_handler_shorthand_pattern',
			goField.value,
			'FSM direct handler shorthand is required. Replace "{ go = <handler> }" with "<handler>".',
		);
	}
}

function lintFsmDirectStateHandlerShorthandPatternInTable(
	expression: LuaExpression,
	issues: LuaLintIssue[],
): void {
	if (expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		const key = getTableFieldKey(field);
		if (key && FSM_STATE_HANDLER_MAP_KEYS.has(key)) {
			lintFsmDirectStateHandlerMapValue(field.value, issues);
		}
		if (field.kind === LuaTableFieldKind.ExpressionKey) {
			lintFsmDirectStateHandlerShorthandPatternInTable(field.key, issues);
		}
		lintFsmDirectStateHandlerShorthandPatternInTable(field.value, issues);
	}
}

function lintFsmDirectStateHandlerShorthandPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const definition = expression.arguments[1];
	if (!definition) {
		return;
	}
	lintFsmDirectStateHandlerShorthandPatternInTable(definition, issues);
}

function isSelfEventsEmitCallExpression(expression: LuaCallExpression): boolean {
	if (getCallMethodName(expression) !== 'emit') {
		return false;
	}
	const receiver = getCallReceiverExpression(expression);
	if (!receiver) {
		return false;
	}
	return isEventsContainerExpression(receiver) && isSelfExpressionRoot(receiver);
}

function getGoFunctionFromHandlerEntryValue(value: LuaExpression): LuaFunctionExpression | undefined {
	if (value.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return undefined;
	}
	const goField = findTableFieldByKey(value, 'go');
	if (!goField || goField.value.kind !== LuaSyntaxKind.FunctionExpression) {
		return undefined;
	}
	return goField.value;
}

function lintFsmEventReemitHandlerPatternInMap(mapExpression: LuaExpression, issues: LuaLintIssue[]): void {
	if (mapExpression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const entry of mapExpression.fields) {
		const goFunction = getGoFunctionFromHandlerEntryValue(entry.value);
		if (!goFunction) {
			continue;
		}
		if (goFunction.body.body.length !== 1) {
			continue;
		}
		const onlyStatement = goFunction.body.body[0];
		if (onlyStatement.kind !== LuaSyntaxKind.CallStatement) {
			continue;
		}
		if (!isSelfEventsEmitCallExpression(onlyStatement.expression)) {
			continue;
		}
		pushIssue(
			issues,
			'fsm_event_reemit_handler_pattern',
			onlyStatement.expression,
			'FSM event handler that only re-emits another event is forbidden. Model the transition directly in FSM maps instead of event->event relay handlers.',
		);
	}
}

function lintFsmEventReemitHandlerPatternInTable(expression: LuaExpression, issues: LuaLintIssue[]): void {
	if (expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		const key = getTableFieldKey(field);
		if (key && FSM_STATE_HANDLER_MAP_KEYS.has(key)) {
			lintFsmEventReemitHandlerPatternInMap(field.value, issues);
		}
		if (field.kind === LuaTableFieldKind.ExpressionKey) {
			lintFsmEventReemitHandlerPatternInTable(field.key, issues);
		}
		lintFsmEventReemitHandlerPatternInTable(field.value, issues);
	}
}

function lintFsmEventReemitHandlerPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const definition = expression.arguments[1];
	if (!definition) {
		return;
	}
	lintFsmEventReemitHandlerPatternInTable(definition, issues);
}

const FORBIDDEN_FSM_LEGACY_FIELDS = new Set<string>([
	'tick',
	'process_input',
	'run_checks',
]);

function lintFsmForbiddenLegacyFieldsInTable(expression: LuaExpression, issues: LuaLintIssue[]): void {
	if (expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		const key = getTableFieldKey(field);
		if (key && FORBIDDEN_FSM_LEGACY_FIELDS.has(key)) {
			pushIssue(
				issues,
				'fsm_forbidden_legacy_fields_pattern',
				field.value,
				`FSM field "${key}" is forbidden. Use state "update" and "input_event_handlers" only.`,
			);
		}
		if (field.kind === LuaTableFieldKind.ExpressionKey) {
			lintFsmForbiddenLegacyFieldsInTable(field.key, issues);
		}
		lintFsmForbiddenLegacyFieldsInTable(field.value, issues);
	}
}

function lintFsmForbiddenLegacyFieldsPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const definition = expression.arguments[1];
	if (!definition) {
		return;
	}
	lintFsmForbiddenLegacyFieldsInTable(definition, issues);
}

function lintFsmProcessInputPollingTransitionPatternInTable(expression: LuaExpression, issues: LuaLintIssue[]): void {
	if (expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		const key = getTableFieldKey(field);
		if (key === 'process_input' && field.value.kind === LuaSyntaxKind.FunctionExpression) {
			const inputCheck = findCallExpressionInStatements(field.value.body.body, isTickInputCheckCallExpression);
			if (inputCheck && hasTransitionReturnInStatements(field.value.body.body)) {
				pushIssue(
					issues,
					'fsm_process_input_polling_transition_pattern',
					inputCheck,
					'FSM process_input polling that drives state transitions is forbidden. Use input_event_handlers with direct state-id mappings instead of action_triggered checks in process_input.',
				);
			}
		}
		if (field.kind === LuaTableFieldKind.ExpressionKey) {
			lintFsmProcessInputPollingTransitionPatternInTable(field.key, issues);
		}
		lintFsmProcessInputPollingTransitionPatternInTable(field.value, issues);
	}
}

function lintFsmProcessInputPollingTransitionPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const definition = expression.arguments[1];
	if (!definition) {
		return;
	}
	lintFsmProcessInputPollingTransitionPatternInTable(definition, issues);
}

function getRunCheckGoFunction(entryExpression: LuaExpression): LuaFunctionExpression | undefined {
	if (entryExpression.kind === LuaSyntaxKind.FunctionExpression) {
		return entryExpression;
	}
	if (entryExpression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return undefined;
	}
	const goField = findTableFieldByKey(entryExpression, 'go');
	if (!goField || goField.value.kind !== LuaSyntaxKind.FunctionExpression) {
		return undefined;
	}
	return goField.value;
}

function lintFsmRunChecksInputTransitionPatternInTable(expression: LuaExpression, issues: LuaLintIssue[]): void {
	if (expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		const key = getTableFieldKey(field);
		if (key === 'run_checks' && field.value.kind === LuaSyntaxKind.TableConstructorExpression) {
			for (const runCheckEntry of field.value.fields) {
				const goFunction = getRunCheckGoFunction(runCheckEntry.value);
				if (!goFunction) {
					continue;
				}
				const inputCheck = findCallExpressionInStatements(goFunction.body.body, isTickInputCheckCallExpression);
				if (!inputCheck) {
					continue;
				}
				if (!hasTransitionReturnInStatements(goFunction.body.body)) {
					continue;
				}
				pushIssue(
					issues,
					'fsm_run_checks_input_transition_pattern',
					inputCheck,
					'FSM run_checks input polling with state-transition return is forbidden. Use input_event_handlers with direct state-id mappings instead of action_triggered checks in run_checks.',
				);
			}
		}
		if (field.kind === LuaTableFieldKind.ExpressionKey) {
			lintFsmRunChecksInputTransitionPatternInTable(field.key, issues);
		}
		lintFsmRunChecksInputTransitionPatternInTable(field.value, issues);
	}
}

function lintFsmRunChecksInputTransitionPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const definition = expression.arguments[1];
	if (!definition) {
		return;
	}
	lintFsmRunChecksInputTransitionPatternInTable(definition, issues);
}

const FSM_DELEGATE_HANDLER_KEYS = new Set<string>([
	'entering_state',
	'exiting_state',
	'leaving_state',
	'tick',
	'process_input',
]);

function getLifecycleWrapperCallExpression(functionExpression: LuaFunctionExpression): LuaCallExpression | undefined {
	if (functionExpression.parameters.length === 0 || functionExpression.hasVararg) {
		return undefined;
	}
	if (functionExpression.body.body.length !== 1) {
		return undefined;
	}
	const onlyStatement = functionExpression.body.body[0];
	let expression: LuaExpression | undefined;
	if (onlyStatement.kind === LuaSyntaxKind.CallStatement) {
		expression = onlyStatement.expression;
	} else if (onlyStatement.kind === LuaSyntaxKind.ReturnStatement && onlyStatement.expressions.length === 1) {
		expression = onlyStatement.expressions[0];
	}
	if (!expression || expression.kind !== LuaSyntaxKind.CallExpression) {
		return undefined;
	}
	const receiver = getCallReceiverExpression(expression);
	if (!receiver || receiver.kind !== LuaSyntaxKind.IdentifierExpression) {
		return undefined;
	}
	const firstParamName = functionExpression.parameters[0].name;
	if (receiver.name !== firstParamName) {
		return undefined;
	}
	const passthroughParameterCount = functionExpression.parameters.length - 1;
	if (expression.arguments.length > passthroughParameterCount) {
		return undefined;
	}
	for (let index = 0; index < expression.arguments.length; index += 1) {
		const argument = expression.arguments[index];
		if (argument.kind !== LuaSyntaxKind.IdentifierExpression) {
			return undefined;
		}
		const expectedParamName = functionExpression.parameters[index + 1].name;
		if (argument.name !== expectedParamName) {
			return undefined;
		}
	}
	return expression;
}

function lintFsmLifecycleWrapperPatternInTable(expression: LuaExpression, issues: LuaLintIssue[]): void {
	if (expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		const key = getTableFieldKey(field);
		if (key && FSM_DELEGATE_HANDLER_KEYS.has(key) && field.value.kind === LuaSyntaxKind.FunctionExpression) {
			const callExpression = getLifecycleWrapperCallExpression(field.value);
			if (callExpression) {
				const methodName = getCallMethodName(callExpression) || 'handler';
				pushIssue(
					issues,
					'fsm_lifecycle_wrapper_pattern',
					field.value,
					`FSM handler wrapper for "${key}" is forbidden ("${methodName}"). Use a direct function reference (for example "<class>.${methodName}") instead of wrapper functions like "function(self) self:${methodName}(...) end".`,
				);
			}
		}
		if (field.kind === LuaTableFieldKind.ExpressionKey) {
			lintFsmLifecycleWrapperPatternInTable(field.key, issues);
		}
		lintFsmLifecycleWrapperPatternInTable(field.value, issues);
	}
}

function lintFsmLifecycleWrapperPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const definition = expression.arguments[1];
	if (!definition) {
		return;
	}
	lintFsmLifecycleWrapperPatternInTable(definition, issues);
}

function isSelfPropertyReferenceByName(expression: LuaExpression, propertyName: string): boolean {
	if (expression.kind === LuaSyntaxKind.MemberExpression && isSelfExpressionRoot(expression.base)) {
		return expression.identifier === propertyName;
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression && isSelfExpressionRoot(expression.base)) {
		return getExpressionKeyName(expression.index) === propertyName;
	}
	return false;
}

function findTickCounterMutationInAssignment(statement: LuaAssignmentStatement): LuaExpression | undefined {
	if (statement.operator !== LuaAssignmentOperator.Assign) {
		return undefined;
	}
	for (let index = 0; index < statement.left.length && index < statement.right.length; index += 1) {
		const target = statement.left[index];
		const propertyName = getSelfAssignedPropertyNameFromTarget(target);
		if (!propertyName) {
			continue;
		}
		const right = statement.right[index];
		if (right.kind !== LuaSyntaxKind.BinaryExpression) {
			continue;
		}
		if (right.operator !== LuaBinaryOperator.Add && right.operator !== LuaBinaryOperator.Subtract) {
			continue;
		}
		const leftHasCounter = isSelfPropertyReferenceByName(right.left, propertyName);
		const rightHasCounter = isSelfPropertyReferenceByName(right.right, propertyName);
		if (!leftHasCounter && !rightHasCounter) {
			continue;
		}
		if (leftHasCounter && rightHasCounter) {
			continue;
		}
		if (!leftHasCounter && rightHasCounter && right.operator !== LuaBinaryOperator.Add) {
			continue;
		}
		return right;
	}
	return undefined;
}

function findTickCounterMutationInStatements(statements: ReadonlyArray<LuaStatement>): LuaExpression | undefined {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.AssignmentStatement: {
				const found = findTickCounterMutationInAssignment(statement);
				if (found) {
					return found;
				}
				break;
			}
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					const found = findTickCounterMutationInStatements(clause.block.body);
					if (found) {
						return found;
					}
				}
				break;
			case LuaSyntaxKind.WhileStatement: {
				const found = findTickCounterMutationInStatements(statement.block.body);
				if (found) {
					return found;
				}
				break;
			}
			case LuaSyntaxKind.RepeatStatement: {
				const found = findTickCounterMutationInStatements(statement.block.body);
				if (found) {
					return found;
				}
				break;
			}
			case LuaSyntaxKind.ForNumericStatement: {
				const found = findTickCounterMutationInStatements(statement.block.body);
				if (found) {
					return found;
				}
				break;
			}
			case LuaSyntaxKind.ForGenericStatement: {
				const found = findTickCounterMutationInStatements(statement.block.body);
				if (found) {
					return found;
				}
				break;
			}
			case LuaSyntaxKind.DoStatement: {
				const found = findTickCounterMutationInStatements(statement.block.body);
				if (found) {
					return found;
				}
				break;
			}
			default:
				break;
		}
	}
	return undefined;
}

function lintFsmTickCounterTransitionPatternInTable(expression: LuaExpression, issues: LuaLintIssue[]): void {
	if (expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		const key = getTableFieldKey(field);
		if (key === 'tick' && field.value.kind === LuaSyntaxKind.FunctionExpression) {
			const body = field.value.body.body;
			if (hasTransitionReturnInStatements(body)) {
				const mutation = findTickCounterMutationInStatements(body);
				if (mutation) {
					pushIssue(
						issues,
						'fsm_tick_counter_transition_pattern',
						mutation,
						'Tick-based countdown/countup transition pattern is forbidden. Model timed transitions with FSM timelines and timeline events instead of mutating self counters in tick.',
					);
				}
			}
		}
		if (field.kind === LuaTableFieldKind.ExpressionKey) {
			lintFsmTickCounterTransitionPatternInTable(field.key, issues);
		}
		lintFsmTickCounterTransitionPatternInTable(field.value, issues);
	}
}

function lintFsmTickCounterTransitionPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const definition = expression.arguments[1];
	if (!definition) {
		return;
	}
	lintFsmTickCounterTransitionPatternInTable(definition, issues);
}

function lintFsmIdLabelPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const idArgument = expression.arguments[0];
	if (!idArgument || idArgument.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return;
	}
	const fsmId = idArgument.value;
	if (!containsLabel(fsmId, 'fsm')) {
		return;
	}
	pushIssue(
		issues,
		'fsm_id_label_pattern',
		idArgument,
		appendSuggestionMessage(
			`FSM id must not contain "fsm" ("${fsmId}").`,
			fsmId,
			'fsm',
		),
	);
}

function normalizeStateNameToken(stateName: string): string {
	if (stateName.startsWith('/')) {
		return stateName.slice(1);
	}
	return stateName;
}

function getStateNameFromStateField(field: LuaTableField): string | undefined {
	if (field.kind === LuaTableFieldKind.IdentifierKey) {
		return field.name;
	}
	if (field.kind === LuaTableFieldKind.ExpressionKey) {
		return getExpressionKeyName(field.key);
	}
	return undefined;
}

function getSelfAssignedPropertyNameFromTarget(target: LuaExpression): string | undefined {
	if (target.kind === LuaSyntaxKind.MemberExpression && isSelfExpressionRoot(target.base)) {
		return target.identifier;
	}
	if (target.kind === LuaSyntaxKind.IndexExpression && isSelfExpressionRoot(target.base)) {
		return getExpressionKeyName(target.index);
	}
	return undefined;
}

function findStateNameMirrorAssignmentInExpression(
	expression: LuaExpression | null,
	stateName: string,
): { readonly propertyName: string; readonly valueNode: LuaExpression; } | undefined {
	if (!expression) {
		return undefined;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.MemberExpression:
			return findStateNameMirrorAssignmentInExpression(expression.base, stateName);
		case LuaSyntaxKind.IndexExpression:
			return findStateNameMirrorAssignmentInExpression(expression.base, stateName)
				|| findStateNameMirrorAssignmentInExpression(expression.index, stateName);
		case LuaSyntaxKind.BinaryExpression:
			return findStateNameMirrorAssignmentInExpression(expression.left, stateName)
				|| findStateNameMirrorAssignmentInExpression(expression.right, stateName);
		case LuaSyntaxKind.UnaryExpression:
			return findStateNameMirrorAssignmentInExpression(expression.operand, stateName);
		case LuaSyntaxKind.CallExpression: {
			const fromCallee = findStateNameMirrorAssignmentInExpression(expression.callee, stateName);
			if (fromCallee) {
				return fromCallee;
			}
			for (const argument of expression.arguments) {
				const fromArgument = findStateNameMirrorAssignmentInExpression(argument, stateName);
				if (fromArgument) {
					return fromArgument;
				}
			}
			return undefined;
		}
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					const fromKey = findStateNameMirrorAssignmentInExpression(field.key, stateName);
					if (fromKey) {
						return fromKey;
					}
				}
				const fromValue = findStateNameMirrorAssignmentInExpression(field.value, stateName);
				if (fromValue) {
					return fromValue;
				}
			}
			return undefined;
		case LuaSyntaxKind.FunctionExpression:
			return findStateNameMirrorAssignmentInStatements(expression.body.body, stateName);
		default:
			return undefined;
	}
}

function findStateNameMirrorAssignmentInStatements(
	statements: ReadonlyArray<LuaStatement>,
	stateName: string,
): { readonly propertyName: string; readonly valueNode: LuaExpression; } | undefined {
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				for (const value of statement.values) {
					const fromValue = findStateNameMirrorAssignmentInExpression(value, stateName);
					if (fromValue) {
						return fromValue;
					}
				}
				break;
			case LuaSyntaxKind.AssignmentStatement: {
				for (let index = 0; index < statement.left.length && index < statement.right.length; index += 1) {
					const propertyName = getSelfAssignedPropertyNameFromTarget(statement.left[index]);
					if (!propertyName) {
						continue;
					}
					const right = statement.right[index];
					if (right.kind !== LuaSyntaxKind.StringLiteralExpression) {
						continue;
					}
					if (normalizeStateNameToken(right.value) !== stateName) {
						continue;
					}
					return { propertyName, valueNode: right };
				}
				for (const left of statement.left) {
					const fromLeft = findStateNameMirrorAssignmentInExpression(left, stateName);
					if (fromLeft) {
						return fromLeft;
					}
				}
				for (const right of statement.right) {
					const fromRight = findStateNameMirrorAssignmentInExpression(right, stateName);
					if (fromRight) {
						return fromRight;
					}
				}
				break;
			}
			case LuaSyntaxKind.LocalFunctionStatement: {
				const fromFunction = findStateNameMirrorAssignmentInStatements(statement.functionExpression.body.body, stateName);
				if (fromFunction) {
					return fromFunction;
				}
				break;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement: {
				const fromFunction = findStateNameMirrorAssignmentInStatements(statement.functionExpression.body.body, stateName);
				if (fromFunction) {
					return fromFunction;
				}
				break;
			}
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					const fromExpression = findStateNameMirrorAssignmentInExpression(expression, stateName);
					if (fromExpression) {
						return fromExpression;
					}
				}
				break;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					const fromCondition = findStateNameMirrorAssignmentInExpression(clause.condition, stateName);
					if (fromCondition) {
						return fromCondition;
					}
					const fromBlock = findStateNameMirrorAssignmentInStatements(clause.block.body, stateName);
					if (fromBlock) {
						return fromBlock;
					}
				}
				break;
			case LuaSyntaxKind.WhileStatement: {
				const fromCondition = findStateNameMirrorAssignmentInExpression(statement.condition, stateName);
				if (fromCondition) {
					return fromCondition;
				}
				const fromBlock = findStateNameMirrorAssignmentInStatements(statement.block.body, stateName);
				if (fromBlock) {
					return fromBlock;
				}
				break;
			}
			case LuaSyntaxKind.RepeatStatement: {
				const fromBlock = findStateNameMirrorAssignmentInStatements(statement.block.body, stateName);
				if (fromBlock) {
					return fromBlock;
				}
				const fromCondition = findStateNameMirrorAssignmentInExpression(statement.condition, stateName);
				if (fromCondition) {
					return fromCondition;
				}
				break;
			}
			case LuaSyntaxKind.ForNumericStatement: {
				const fromStart = findStateNameMirrorAssignmentInExpression(statement.start, stateName);
				if (fromStart) {
					return fromStart;
				}
				const fromLimit = findStateNameMirrorAssignmentInExpression(statement.limit, stateName);
				if (fromLimit) {
					return fromLimit;
				}
				const fromStep = findStateNameMirrorAssignmentInExpression(statement.step, stateName);
				if (fromStep) {
					return fromStep;
				}
				const fromBlock = findStateNameMirrorAssignmentInStatements(statement.block.body, stateName);
				if (fromBlock) {
					return fromBlock;
				}
				break;
			}
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					const fromIterator = findStateNameMirrorAssignmentInExpression(iterator, stateName);
					if (fromIterator) {
						return fromIterator;
					}
				}
				{
					const fromBlock = findStateNameMirrorAssignmentInStatements(statement.block.body, stateName);
					if (fromBlock) {
						return fromBlock;
					}
				}
				break;
			case LuaSyntaxKind.DoStatement: {
				const fromBlock = findStateNameMirrorAssignmentInStatements(statement.block.body, stateName);
				if (fromBlock) {
					return fromBlock;
				}
				break;
			}
			case LuaSyntaxKind.CallStatement: {
				const fromCall = findStateNameMirrorAssignmentInExpression(statement.expression, stateName);
				if (fromCall) {
					return fromCall;
				}
				break;
			}
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
	return undefined;
}

function lintFsmStateNameMirrorAssignmentPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const definition = expression.arguments[1];
	const statesField = findTableFieldByKey(definition, 'states');
	if (!statesField || statesField.value.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const stateField of statesField.value.fields) {
		const stateNameRaw = getStateNameFromStateField(stateField);
		if (!stateNameRaw || stateField.value.kind !== LuaSyntaxKind.TableConstructorExpression) {
			continue;
		}
		const stateName = normalizeStateNameToken(stateNameRaw);
		if (!stateName) {
			continue;
		}
		const mirror = findStateNameMirrorAssignmentInExpression(stateField.value, stateName);
		if (!mirror) {
			continue;
		}
		pushIssue(
			issues,
			'fsm_state_name_mirror_assignment_pattern',
			mirror.valueNode,
			`FSM state "${stateName}" must not be mirrored into self.${mirror.propertyName} using the same string literal. Derive behavior from the active state instead of duplicating state-name strings in properties.`,
		);
	}
}

function lintBtIdLabelPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	const methodName = getCallMethodName(expression);
	if (methodName !== 'register_behaviour_tree' && methodName !== 'register_definition') {
		return;
	}
	const idArgument = expression.arguments[0];
	if (!idArgument || idArgument.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return;
	}
	const btId = idArgument.value;
	if (!containsLabel(btId, 'bt')) {
		return;
	}
	pushIssue(
		issues,
		'bt_id_label_pattern',
		idArgument,
		appendSuggestionMessage(
			`Behavior-tree id must not contain "bt" ("${btId}").`,
			btId,
			'bt',
		),
	);
}

function lintCollectionStringValuesForLabel(
	expression: LuaExpression,
	label: string,
	rule: LuaLintIssueRule,
	issues: LuaLintIssue[],
	messagePrefix: string,
): void {
	if (expression.kind === LuaSyntaxKind.StringLiteralExpression) {
		if (!containsLabel(expression.value, label)) {
			return;
		}
		pushIssue(
			issues,
			rule,
			expression,
			appendSuggestionMessage(
				`${messagePrefix} must not contain "${label}" ("${expression.value}").`,
				expression.value,
				label,
			),
		);
		return;
	}
	if (expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		if (field.kind !== LuaTableFieldKind.Array || field.value.kind !== LuaSyntaxKind.StringLiteralExpression) {
			continue;
		}
		const value = field.value.value;
		if (!containsLabel(value, label)) {
			continue;
		}
		pushIssue(
			issues,
			rule,
			field.value,
			appendSuggestionMessage(
				`${messagePrefix} must not contain "${label}" ("${value}").`,
				value,
				label,
			),
		);
	}
}

function lintCollectionLabelPatterns(field: LuaTableField, issues: LuaLintIssue[]): void {
	if (field.kind !== LuaTableFieldKind.IdentifierKey) {
		return;
	}
	if (field.name === 'fsms') {
		lintCollectionStringValuesForLabel(
			field.value,
			'fsm',
			'fsm_id_label_pattern',
			issues,
			'FSM id',
		);
		return;
	}
	if (field.name === 'bts') {
		lintCollectionStringValuesForLabel(
			field.value,
			'bt',
			'bt_id_label_pattern',
			issues,
			'Behavior-tree id',
		);
	}
}

function isInjectedServiceIdPropertyName(propertyName: string): boolean {
	return propertyName.toLowerCase().endsWith('_service_id');
}

function getExpressionKeyName(expression: LuaExpression): string | undefined {
	if (expression.kind === LuaSyntaxKind.StringLiteralExpression) {
		return expression.value;
	}
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.name;
	}
	return undefined;
}

function getInjectedServiceIdPropertyNameFromTarget(target: LuaExpression): string | undefined {
	if (target.kind === LuaSyntaxKind.MemberExpression) {
		return target.identifier;
	}
	if (target.kind === LuaSyntaxKind.IndexExpression) {
		return getExpressionKeyName(target.index);
	}
	return undefined;
}

function lintInjectedServiceIdPropertyAssignmentTarget(target: LuaExpression, issues: LuaLintIssue[]): void {
	const propertyName = getInjectedServiceIdPropertyNameFromTarget(target);
	if (!propertyName || !isInjectedServiceIdPropertyName(propertyName)) {
		return;
	}
	pushIssue(
		issues,
		'injected_service_id_property_pattern',
		target,
		`Injecting service ids via property "${propertyName}" is forbidden. Do not pass/store service ids on objects/services; resolve services directly via service('<id>').`,
	);
}

function lintInjectedServiceIdPropertyTableField(field: LuaTableField, issues: LuaLintIssue[]): void {
	let propertyName: string | undefined;
	if (field.kind === LuaTableFieldKind.IdentifierKey) {
		propertyName = field.name;
	} else if (field.kind === LuaTableFieldKind.ExpressionKey) {
		propertyName = getExpressionKeyName(field.key);
	}
	if (!propertyName || !isInjectedServiceIdPropertyName(propertyName)) {
		return;
	}
	pushIssue(
		issues,
		'injected_service_id_property_pattern',
		field,
		`Injecting service ids via property "${propertyName}" is forbidden. Do not pass/store service ids on objects/services; resolve services directly via service('<id>').`,
	);
}

function lintTableField(field: LuaTableField, issues: LuaLintIssue[]): void {
	lintCollectionLabelPatterns(field, issues);
	lintInjectedServiceIdPropertyTableField(field, issues);
	lintForbiddenRenderLayerString(field, issues);
	if (field.kind === LuaTableFieldKind.IdentifierKey
		&& field.name === 'tick'
		&& field.value.kind === LuaSyntaxKind.FunctionExpression) {
		lintTickFlagPollingPattern(field.value, issues);
		lintTickInputCheckPattern(field.value, issues);
	}
	switch (field.kind) {
		case LuaTableFieldKind.Array:
			lintExpression(field.value, issues, false);
			return;
		case LuaTableFieldKind.IdentifierKey:
			lintExpression(field.value, issues, false);
			return;
		case LuaTableFieldKind.ExpressionKey:
			lintExpression(field.key, issues, false);
			lintExpression(field.value, issues, false);
			return;
		default:
			return;
	}
}

function expressionUsesIdentifier(expression: LuaExpression | null, name: string): boolean {
	if (!expression) {
		return false;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			return expression.name === name;
		case LuaSyntaxKind.MemberExpression:
			return expressionUsesIdentifier(expression.base, name);
		case LuaSyntaxKind.IndexExpression:
			return expressionUsesIdentifier(expression.base, name) || expressionUsesIdentifier(expression.index, name);
		case LuaSyntaxKind.BinaryExpression:
			return expressionUsesIdentifier(expression.left, name) || expressionUsesIdentifier(expression.right, name);
		case LuaSyntaxKind.UnaryExpression:
			return expressionUsesIdentifier(expression.operand, name);
		case LuaSyntaxKind.CallExpression:
			if (expressionUsesIdentifier(expression.callee, name)) {
				return true;
			}
			for (const argument of expression.arguments) {
				if (expressionUsesIdentifier(argument, name)) {
					return true;
				}
			}
			return false;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey && expressionUsesIdentifier(field.key, name)) {
					return true;
				}
				if (expressionUsesIdentifier(field.value, name)) {
					return true;
				}
			}
			return false;
		case LuaSyntaxKind.FunctionExpression:
			// Nested function bodies are intentionally excluded for this rule.
			return false;
		default:
			return false;
	}
}

function isUnsafeBinaryOperator(operator: LuaBinaryOperator): boolean {
	return operator !== LuaBinaryOperator.Or
		&& operator !== LuaBinaryOperator.And
		&& operator !== LuaBinaryOperator.Equal
		&& operator !== LuaBinaryOperator.NotEqual;
}

function isUnsafeUnaryOperator(operator: LuaUnaryOperator): boolean {
	return operator === LuaUnaryOperator.Negate
		|| operator === LuaUnaryOperator.Length
		|| operator === LuaUnaryOperator.BitwiseNot;
}

function expressionUsesIdentifierUnsafely(expression: LuaExpression | null, name: string): boolean {
	if (!expression) {
		return false;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			return false;
		case LuaSyntaxKind.MemberExpression:
			if (expressionUsesIdentifier(expression.base, name)) {
				return true;
			}
			return expressionUsesIdentifierUnsafely(expression.base, name);
		case LuaSyntaxKind.IndexExpression:
			if (expressionUsesIdentifier(expression.base, name) || expressionUsesIdentifier(expression.index, name)) {
				return true;
			}
			return expressionUsesIdentifierUnsafely(expression.base, name)
				|| expressionUsesIdentifierUnsafely(expression.index, name);
		case LuaSyntaxKind.BinaryExpression:
			if (isUnsafeBinaryOperator(expression.operator)
				&& (expressionUsesIdentifier(expression.left, name) || expressionUsesIdentifier(expression.right, name))) {
				return true;
			}
			return expressionUsesIdentifierUnsafely(expression.left, name)
				|| expressionUsesIdentifierUnsafely(expression.right, name);
		case LuaSyntaxKind.UnaryExpression:
			if (isUnsafeUnaryOperator(expression.operator) && expressionUsesIdentifier(expression.operand, name)) {
				return true;
			}
			return expressionUsesIdentifierUnsafely(expression.operand, name);
		case LuaSyntaxKind.CallExpression:
			if (expressionUsesIdentifier(expression.callee, name) || expressionUsesIdentifierUnsafely(expression.callee, name)) {
				return true;
			}
			for (const argument of expression.arguments) {
				if (expressionUsesIdentifierUnsafely(argument, name)) {
					return true;
				}
			}
			return false;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey && expressionUsesIdentifierUnsafely(field.key, name)) {
					return true;
				}
				if (expressionUsesIdentifierUnsafely(field.value, name)) {
					return true;
				}
			}
			return false;
		case LuaSyntaxKind.FunctionExpression:
			// Nested function bodies are intentionally excluded for this rule.
			return false;
		default:
			return false;
	}
}

function assignmentDirectlyTargetsIdentifier(statement: LuaStatement, name: string): boolean {
	if (statement.kind !== LuaSyntaxKind.AssignmentStatement || statement.operator !== LuaAssignmentOperator.Assign) {
		return false;
	}
	for (const left of statement.left) {
		if (left.kind === LuaSyntaxKind.IdentifierExpression && left.name === name) {
			return true;
		}
	}
	return false;
}

function blockDirectlyAssignsIdentifier(blockStatements: ReadonlyArray<LuaStatement>, name: string): boolean {
	for (const statement of blockStatements) {
		if (assignmentDirectlyTargetsIdentifier(statement, name)) {
			return true;
		}
	}
	return false;
}

function isSingleBranchConditionalAssignment(statement: LuaIfStatement, name: string): boolean {
	if (statement.clauses.length !== 1) {
		return false;
	}
	const onlyClause = statement.clauses[0];
	if (!onlyClause.condition) {
		return false;
	}
	return blockDirectlyAssignsIdentifier(onlyClause.block.body, name);
}

function statementUsesIdentifierUnsafelyInCurrentScope(statement: LuaStatement, name: string): boolean {
	switch (statement.kind) {
		case LuaSyntaxKind.LocalAssignmentStatement:
			for (const value of statement.values) {
				if (expressionUsesIdentifierUnsafely(value, name)) {
					return true;
				}
			}
			return false;
		case LuaSyntaxKind.AssignmentStatement:
			for (const left of statement.left) {
				if (left.kind === LuaSyntaxKind.IdentifierExpression && left.name === name) {
					if (statement.operator !== LuaAssignmentOperator.Assign) {
						return true;
					}
				} else if (expressionUsesIdentifierUnsafely(left, name)) {
					return true;
				}
			}
			for (const right of statement.right) {
				if (expressionUsesIdentifierUnsafely(right, name)) {
					return true;
				}
			}
			return false;
		case LuaSyntaxKind.LocalFunctionStatement:
		case LuaSyntaxKind.FunctionDeclarationStatement:
			return false;
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					if (expressionUsesIdentifierUnsafely(expression, name)) {
						return true;
					}
				}
				return false;
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) {
					if (clause.condition && expressionUsesIdentifierUnsafely(clause.condition, name)) {
						return true;
					}
					for (const nested of clause.block.body) {
						if (statementUsesIdentifierUnsafelyInCurrentScope(nested, name)) {
							return true;
						}
					}
				}
				return false;
			case LuaSyntaxKind.WhileStatement:
				if (expressionUsesIdentifierUnsafely(statement.condition, name)) {
					return true;
				}
				for (const nested of statement.block.body) {
					if (statementUsesIdentifierUnsafelyInCurrentScope(nested, name)) {
						return true;
					}
				}
				return false;
			case LuaSyntaxKind.RepeatStatement:
				for (const nested of statement.block.body) {
					if (statementUsesIdentifierUnsafelyInCurrentScope(nested, name)) {
						return true;
					}
				}
				return expressionUsesIdentifierUnsafely(statement.condition, name);
			case LuaSyntaxKind.ForNumericStatement:
				if (expressionUsesIdentifier(statement.start, name)
					|| expressionUsesIdentifier(statement.limit, name)
					|| expressionUsesIdentifier(statement.step, name)) {
					return true;
				}
				for (const nested of statement.block.body) {
					if (statementUsesIdentifierUnsafelyInCurrentScope(nested, name)) {
						return true;
					}
				}
				return false;
			case LuaSyntaxKind.ForGenericStatement:
				for (const iterator of statement.iterators) {
					if (expressionUsesIdentifierUnsafely(iterator, name)) {
						return true;
					}
				}
				for (const nested of statement.block.body) {
					if (statementUsesIdentifierUnsafelyInCurrentScope(nested, name)) {
						return true;
					}
				}
				return false;
			case LuaSyntaxKind.DoStatement:
				for (const nested of statement.block.body) {
					if (statementUsesIdentifierUnsafelyInCurrentScope(nested, name)) {
						return true;
					}
				}
				return false;
			case LuaSyntaxKind.CallStatement:
				return expressionUsesIdentifierUnsafely(statement.expression, name);
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				return false;
		default:
			return false;
	}
}

function lintBranchUninitializedLocalPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	for (let index = 0; index + 2 < statements.length; index += 1) {
		const declaration = statements[index];
		if (declaration.kind !== LuaSyntaxKind.LocalAssignmentStatement) {
			continue;
		}
		if (declaration.names.length !== 1 || declaration.values.length !== 0) {
			continue;
		}
		const name = declaration.names[0].name;
		const firstStatement = statements[index + 1];
		if (firstStatement.kind !== LuaSyntaxKind.IfStatement) {
			continue;
		}
		if (!isSingleBranchConditionalAssignment(firstStatement, name)) {
			continue;
		}
		let usedAfter = false;
		for (let scan = index + 2; scan < statements.length; scan += 1) {
			if (statementUsesIdentifierUnsafelyInCurrentScope(statements[scan], name)) {
				usedAfter = true;
				break;
			}
		}
		if (!usedAfter) {
			continue;
		}
		pushIssue(
			issues,
			'branch_uninitialized_local_pattern',
			declaration.names[0],
			`Local "${name}" is declared without initialization and only conditionally assigned before use. Assign deterministically or assign in all branches before use.`,
		);
	}
}

function lintExpression(expression: LuaExpression | null, issues: LuaLintIssue[], topLevel = true): void {
	if (!expression) {
		return;
	}
	lintEmptyStringConditionPattern(expression, issues);
	lintEmptyStringFallbackPattern(expression, issues);
	lintOrNilFallbackPattern(expression, issues);
	lintExplicitTruthyComparisonPattern(expression, issues);
	lintForbiddenMathFloorPattern(expression, issues);
	lintStringOrChainComparisonPattern(expression, issues);
	lintActionTriggeredBoolChainPattern(expression, issues);
	if (topLevel) {
		lintMultiHasTagPattern(expression, issues);
	}
			switch (expression.kind) {
				case LuaSyntaxKind.CallExpression:
					lintRequireCall(expression, issues);
					lintForbiddenRenderWrapperCall(expression, issues);
					lintForbiddenStateCalls(expression, issues);
					lintForbiddenDispatchPattern(expression, issues);
					lintEventHandlerDispatchPattern(expression, issues);
					lintCrossObjectStateEventRelayPattern(expression, issues);
					lintSetSpaceRoundtripPattern(expression, issues);
				lintServiceDefinitionSuffixPattern(expression, issues);
				lintCreateServiceIdAddonPattern(expression, issues);
				lintDefineServiceIdPattern(expression, issues);
				lintDefineFactoryTickEnabledAndSpaceIdPattern(expression, issues);
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
		case LuaSyntaxKind.MemberExpression:
			lintExpression(expression.base, issues, false);
			return;
		case LuaSyntaxKind.IndexExpression:
			lintExpression(expression.base, issues, false);
			lintExpression(expression.index, issues, false);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintExpression(expression.left, issues, false);
			lintExpression(expression.right, issues, false);
			return;
		case LuaSyntaxKind.UnaryExpression:
			lintExpression(expression.operand, issues, false);
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				lintTableField(field, issues);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
			lintFunctionBody('<anonymous>', expression, issues, { isMethodDeclaration: false });
			lintStatements(expression.body.body, issues);
			return;
		default:
			return;
	}
}

function lintStatements(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	lintBranchUninitializedLocalPattern(statements, issues);
	lintContiguousMultiEmitPattern(statements, issues);
	const functionUsageInfo = collectFunctionUsageCounts(statements);
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				lintLocalAssignment(statement, issues);
				for (let index = 0; index < statement.values.length; index += 1) {
					const value = statement.values[index];
					if (index < statement.names.length && value.kind === LuaSyntaxKind.FunctionExpression) {
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
			case LuaSyntaxKind.AssignmentStatement:
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
			case LuaSyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LuaLocalFunctionStatement;
				lintLocalFunctionConstPattern(localFunction, issues);
				lintFunctionBody(getFunctionDisplayName(localFunction), localFunction.functionExpression, issues, {
					isMethodDeclaration: false,
					usageInfo: functionUsageInfo,
				});
				lintStatements(localFunction.functionExpression.body.body, issues);
				break;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement: {
				const declaration = statement as LuaFunctionDeclarationStatement;
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
			case LuaSyntaxKind.ReturnStatement:
				for (const expression of statement.expressions) {
					lintExpression(expression, issues);
				}
				break;
			case LuaSyntaxKind.IfStatement:
				if (matchesUselessAssertPattern(statement)) {
					pushIssue(
						issues,
						'useless_assert_pattern',
						statement,
						'Useless assert-pattern is forbidden (if ... then error(...) end). Remove the check; do not replace it with another check/assert.',
					);
				}
				if (matchesImgIdNilFallbackPattern(statement)) {
					pushIssue(
						issues,
						'imgid_fallback_pattern',
						statement,
						'imgid fallback initialization is forbidden. Remove nil checks for imgid defaults; use deterministic setup.',
					);
				}
				lintSplitNestedIfHasTagPattern(statement, issues);
				for (const clause of statement.clauses) {
					if (clause.condition) {
						lintExpression(clause.condition, issues);
					}
					lintStatements(clause.block.body, issues);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				lintExpression(statement.condition, issues);
				lintStatements(statement.block.body, issues);
				break;
			case LuaSyntaxKind.RepeatStatement:
				lintStatements(statement.block.body, issues);
				lintExpression(statement.condition, issues);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				lintDispatchFanoutLoopPattern(statement, issues);
				lintExpression(statement.start, issues);
				lintExpression(statement.limit, issues);
				lintExpression(statement.step, issues);
				lintStatements(statement.block.body, issues);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				lintDispatchFanoutLoopPattern(statement, issues);
				for (const iterator of statement.iterators) {
					lintExpression(iterator, issues);
				}
				lintStatements(statement.block.body, issues);
				break;
			case LuaSyntaxKind.DoStatement:
				lintStatements(statement.block.body, issues);
				break;
			case LuaSyntaxKind.CallStatement:
				lintExpression(statement.expression, issues);
				break;
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				break;
			default:
				break;
		}
	}
}

function formatIssues(issues: LuaLintIssue[], profile: LuaLintProfile): string {
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

function pushSyntaxErrorIssue(
	issues: LuaLintIssue[],
	error: { readonly path: string; readonly line: number; readonly column: number; readonly message: string; },
): void {
	pushIssueAt(
		issues,
		'syntax_error_pattern',
		error.path,
		error.line,
		error.column,
		error.message,
	);
}

export async function lintCartLuaSources(options: LuaCartLintOptions): Promise<void> {
	const profile = options.profile ?? 'cart';
	activeLintRules = resolveEnabledRules(profile);
	const files = await collectLuaFiles(options.roots);
	if (files.length === 0) {
		activeLintRules = new Set(ALL_LUA_LINT_RULES);
		return;
	}

	const issues: LuaLintIssue[] = [];
	const topLevelLocalStringConstants: TopLevelLocalStringConstant[] = [];
	suppressedLineRangesByPath.clear();
	try {
		for (const absolutePath of files) {
			const source = await readFile(absolutePath, 'utf8');
			const workspacePath = toWorkspaceRelativePath(absolutePath);
			suppressedLineRangesByPath.set(workspacePath, collectSuppressedLineRanges(source));
			const lexer = new LuaLexer(source, workspacePath, { canonicalizeIdentifiers: 'none' });
			const lexed = lexer.scanTokensWithRecovery();
			const tokens = lexed.tokens;
			lintUppercaseCode(workspacePath, tokens, issues);
			if (lexed.syntaxError) {
				pushSyntaxErrorIssue(issues, lexed.syntaxError);
				continue;
			}
			const parser = new LuaParser(tokens, workspacePath, source);
			let parsed: ReturnType<LuaParser['parseChunkWithRecovery']>;
			try {
				parsed = parser.parseChunkWithRecovery();
			} catch (error) {
				if ((error as { name?: string } | null)?.name === 'Syntax Error') {
					pushSyntaxErrorIssue(
						issues,
						error as { readonly path: string; readonly line: number; readonly column: number; readonly message: string; },
					);
					continue;
				}
				throw error;
			}
			if (parsed.syntaxError) {
				pushSyntaxErrorIssue(issues, parsed.syntaxError);
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
		activeLintRules = new Set(ALL_LUA_LINT_RULES);
		suppressedLineRangesByPath.clear();
	}

	if (issues.length > 0) {
		throw new Error(formatIssues(issues, profile));
	}
}
