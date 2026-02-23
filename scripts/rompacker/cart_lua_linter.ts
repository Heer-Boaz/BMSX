import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';

import { LuaLexer } from '../../src/bmsx/lua/lualexer';
import { LuaParser } from '../../src/bmsx/lua/luaparser';
import type { LuaToken } from '../../src/bmsx/lua/luatoken';
import { LuaTokenType } from '../../src/bmsx/lua/luatoken';
import {
	LuaAssignmentOperator,
	LuaBinaryOperator,
	LuaSyntaxKind,
	LuaTableFieldKind,
	LuaUnaryOperator,
} from '../../src/bmsx/lua/lua_ast';
import type {
	LuaAssignmentStatement,
	LuaCallExpression,
	LuaExpression,
	LuaFunctionDeclarationStatement,
	LuaFunctionExpression,
	LuaIdentifierExpression,
	LuaIfStatement,
	LuaLocalAssignmentStatement,
	LuaLocalFunctionStatement,
	LuaStatement,
	LuaTableField,
} from '../../src/bmsx/lua/lua_ast';

type LuaLintIssueRule =
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
	'unused_init_value_pattern' |
	'getter_setter_pattern' |
	'single_line_method_pattern' |
	'builtin_recreation_pattern' |
	'multi_has_tag_pattern' |
	'single_use_has_tag_pattern' |
	'single_use_local_pattern' |
	'imgid_assignment_pattern' |
	'self_imgid_assignment_pattern' |
	'imgid_fallback_pattern' |
	'forbidden_transition_to_pattern' |
	'forbidden_matches_state_path_pattern' |
	'event_handler_dispatch_pattern' |
	'event_handler_state_dispatch_pattern' |
	'dispatch_fanout_loop_pattern' |
	'set_space_roundtrip_pattern' |
	'fsm_state_name_mirror_assignment_pattern' |
	'constant_copy_pattern' |
	'split_local_table_init_pattern' |
	'duplicate_initializer_pattern' |
	'handler_identity_dispatch_pattern' |
	'ensure_local_alias_pattern' |
	'service_definition_suffix_pattern' |
	'create_service_id_addon_pattern' |
	'define_service_id_pattern' |
	'fsm_id_label_pattern' |
	'bt_id_label_pattern' |
	'injected_service_id_property_pattern' |
	'inline_static_lookup_table_pattern' |
	'staged_export_local_call_pattern' |
	'staged_export_local_table_pattern' |
	'require_lua_extension_pattern' |
	'branch_uninitialized_local_pattern' |
	'ensure_pattern';

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
const FORBIDDEN_STATE_CALL_RECEIVERS = new Set<string>([
	'sc',
	'worldobject',
]);
const SINGLE_USE_LOCAL_SMALL_HELPER_MAX_LINES = 7;
const LINT_SUPPRESSION_OPEN_MARKER = '-- bmsx-lint:disable';
const LINT_SUPPRESSION_CLOSE_MARKER = '-- bmsx-lint:enable';
const suppressedLineRangesByPath = new Map<string, ReadonlyArray<LuaLintSuppressionRange>>();
const ALL_LUA_LINT_RULES: ReadonlyArray<LuaLintIssueRule> = [
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
	'unused_init_value_pattern',
	'getter_setter_pattern',
	'single_line_method_pattern',
	'builtin_recreation_pattern',
	'multi_has_tag_pattern',
	'single_use_has_tag_pattern',
	'single_use_local_pattern',
	'imgid_assignment_pattern',
	'self_imgid_assignment_pattern',
	'imgid_fallback_pattern',
	'forbidden_transition_to_pattern',
	'forbidden_matches_state_path_pattern',
	'event_handler_dispatch_pattern',
	'event_handler_state_dispatch_pattern',
	'dispatch_fanout_loop_pattern',
	'set_space_roundtrip_pattern',
	'fsm_state_name_mirror_assignment_pattern',
	'constant_copy_pattern',
	'split_local_table_init_pattern',
	'duplicate_initializer_pattern',
	'handler_identity_dispatch_pattern',
	'ensure_local_alias_pattern',
	'service_definition_suffix_pattern',
	'create_service_id_addon_pattern',
	'define_service_id_pattern',
	'fsm_id_label_pattern',
	'bt_id_label_pattern',
	'injected_service_id_property_pattern',
	'inline_static_lookup_table_pattern',
	'staged_export_local_call_pattern',
	'staged_export_local_table_pattern',
	'require_lua_extension_pattern',
	'branch_uninitialized_local_pattern',
	'ensure_pattern',
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
	'event_handler_dispatch_pattern',
	'event_handler_state_dispatch_pattern',
	'dispatch_fanout_loop_pattern',
	'set_space_roundtrip_pattern',
	'fsm_state_name_mirror_assignment_pattern',
	'multi_has_tag_pattern',
	'single_use_has_tag_pattern',
	'handler_identity_dispatch_pattern',
	'getter_setter_pattern',
	'single_line_method_pattern',
	'useless_assert_pattern',
	'define_service_id_pattern',
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

function isSameOrDescendantPath(path: string, root: string): boolean {
	return path === root || path.startsWith(`${root}/`);
}

function shouldSkipPath(path: string): boolean {
	return false;
}

async function collectLuaFilesFromRoot(rootPath: string, output: string[]): Promise<void> {
	const workspaceRoot = toWorkspaceRelativePath(rootPath);
	if (shouldSkipPath(workspaceRoot)) {
		return;
	}

	const entries = await readdir(rootPath, { withFileTypes: true });
	for (const entry of entries) {
		if (SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
			continue;
		}
		const absolutePath = resolve(join(rootPath, entry.name));
		const workspacePath = toWorkspaceRelativePath(absolutePath);
		if (shouldSkipPath(workspacePath)) {
			continue;
		}
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
		'"or nil" fallback pattern is forbidden. Lua has no undefined; remove the nil fallback and keep direct truthy semantics.',
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

function expressionsEquivalentForLint(left: LuaExpression, right: LuaExpression): boolean {
	if (left.kind !== right.kind) {
		return false;
	}
	switch (left.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			return left.name === (right as LuaIdentifierExpression).name;
		case LuaSyntaxKind.MemberExpression:
			return left.identifier === right.identifier && expressionsEquivalentForLint(left.base, right.base);
		case LuaSyntaxKind.IndexExpression:
			return expressionsEquivalentForLint(left.base, right.base) && expressionsEquivalentForLint(left.index, right.index);
		case LuaSyntaxKind.StringLiteralExpression:
			return left.value === right.value;
		case LuaSyntaxKind.NumericLiteralExpression:
			return left.value === right.value;
		case LuaSyntaxKind.BooleanLiteralExpression:
			return left.value === right.value;
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

function isConstantAccessExpression(expression: LuaExpression): boolean {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.name === 'constants';
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		return isConstantAccessExpression(expression.base);
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression) {
		return isConstantAccessExpression(expression.base);
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

function isSelfExpressionRoot(expression: LuaExpression): boolean {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.name === 'self';
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression || expression.kind === LuaSyntaxKind.IndexExpression) {
		return isSelfExpressionRoot(expression.base);
	}
	return false;
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
		const maybeIf = body[0];
		const fallback = getSingleReturnedStringValue(body[1]);
		if (maybeIf.kind !== LuaSyntaxKind.IfStatement || !fallback || maybeIf.clauses.length !== 1) {
			return false;
		}
		const onlyClause = maybeIf.clauses[0];
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

function lintEventHandlerDispatchPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isEventsOnCallExpression(expression)) {
		return;
	}
	for (const argument of expression.arguments) {
		const handlerField = findTableFieldByKey(argument, 'handler');
		if (!handlerField || handlerField.value.kind !== LuaSyntaxKind.FunctionExpression) {
			continue;
		}
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
		const stateDispatchCall = findCallExpressionInStatements(
			handlerField.value.body.body,
			isDispatchStateEventCallExpression,
		);
		if (stateDispatchCall) {
			pushIssue(
				issues,
				'event_handler_state_dispatch_pattern',
				stateDispatchCall,
				'Event handler callbacks must not call dispatch_state_event(...). Model event-driven transitions directly in FSM definitions instead of manual state dispatch inside events:on handlers.',
			);
		}
	}
}

function lintDispatchFanoutLoopPattern(statement: LuaStatement, issues: LuaLintIssue[]): void {
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
	options: { readonly isMethodDeclaration: boolean; },
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
	if (isNamedFunction && options.isMethodDeclaration && !isGetterOrSetter && !isVisualUpdateLike && !isAllowedSingleLineMethodName(functionName) && matchesMeaninglessSingleLineMethodPattern(functionExpression)) {
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
		if (!isConstantAccessExpression(value)) {
			continue;
		}
		pushIssue(
			issues,
			'constant_copy_pattern',
			value,
			`Local copies of constants are forbidden ("${statement.names[index].name}").`,
		);
	}
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
		const maybeIf = statements[index + 1];
		if (maybeIf.kind !== LuaSyntaxKind.IfStatement) {
			continue;
		}
		if (!isSingleBranchConditionalAssignment(maybeIf, name)) {
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
	lintStringOrChainComparisonPattern(expression, issues);
	if (topLevel) {
		lintMultiHasTagPattern(expression, issues);
	}
	switch (expression.kind) {
		case LuaSyntaxKind.CallExpression:
			lintRequireCall(expression, issues);
			lintForbiddenStateCalls(expression, issues);
			lintEventHandlerDispatchPattern(expression, issues);
			lintSetSpaceRoundtripPattern(expression, issues);
			lintServiceDefinitionSuffixPattern(expression, issues);
			lintCreateServiceIdAddonPattern(expression, issues);
			lintDefineServiceIdPattern(expression, issues);
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
	for (const statement of statements) {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				lintLocalAssignment(statement, issues);
				for (const value of statement.values) {
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
				lintFunctionBody(getFunctionDisplayName(localFunction), localFunction.functionExpression, issues, { isMethodDeclaration: false });
				lintStatements(localFunction.functionExpression.body.body, issues);
				break;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement: {
				const declaration = statement as LuaFunctionDeclarationStatement;
				lintFunctionBody(
					getFunctionDisplayName(declaration),
					declaration.functionExpression,
					issues,
					{ isMethodDeclaration: isMethodLikeFunctionDeclaration(declaration) },
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
			const tokens = lexer.scanTokens();
			lintUppercaseCode(workspacePath, tokens, issues);
			const parser = new LuaParser(tokens, workspacePath, source);
			let parsed: ReturnType<LuaParser['parseChunkWithRecovery']>;
			try {
				parsed = parser.parseChunkWithRecovery();
			} catch (error) {
				// If parser errors occur here, treat the file as non-lintable for AST-based checks.
				// Syntax-related validation happens in the compilation pipeline.
				if ((error as { name?: string } | null)?.name === 'Syntax Error') {
					continue;
				}
				throw error;
			}
				if (parsed.syntaxError) {
					continue;
				}
				const chunk = parsed.path;
				topLevelLocalStringConstants.push(...collectTopLevelLocalStringConstants(workspacePath, chunk.body));
				lintSplitLocalTableInitPattern(chunk.body, issues);
				lintDuplicateInitializerPattern(chunk.body, issues);
				lintStagedExportLocalCallPattern(chunk.body, issues);
				lintStagedExportLocalTablePattern(chunk.body, issues);
				lintUnusedInitValuesInFunctionBody(chunk.body, issues, []);
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
