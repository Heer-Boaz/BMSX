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
} from '../../src/bmsx/lua/lua_ast';
import type {
	LuaAssignmentStatement,
	LuaCallExpression,
	LuaExpression,
	LuaFunctionDeclarationStatement,
	LuaFunctionExpression,
	LuaIfStatement,
	LuaLocalAssignmentStatement,
	LuaLocalFunctionStatement,
	LuaStatement,
	LuaTableField,
} from '../../src/bmsx/lua/lua_ast';

type LuaLintIssueRule =
	'uppercase_code_pattern' |
	'visual_update_pattern' |
	'pure_copy_function_pattern' |
	'useless_assert_pattern' |
	'getter_setter_pattern' |
	'single_line_method_pattern' |
	'builtin_recreation_pattern' |
	'forbidden_transition_to_pattern' |
	'forbidden_matches_state_path_pattern' |
	'constant_copy_pattern' |
	'require_lua_extension_pattern' |
	'ensure_pattern';

type LuaLintIssue = {
	readonly rule: LuaLintIssueRule;
	readonly path: string;
	readonly line: number;
	readonly column: number;
	readonly message: string;
};

type LuaCartLintOptions = {
	readonly roots: ReadonlyArray<string>;
};

const BIOS_ROOT_PATH = normalizeWorkspacePath('src/bmsx/res');
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
	return isSameOrDescendantPath(path, BIOS_ROOT_PATH);
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
	issues.push({
		rule,
		path: node.range.path,
		line: node.range.start.line,
		column: node.range.start.column,
		message,
	});
}

function pushIssueAt(issues: LuaLintIssue[], rule: LuaLintIssueRule, path: string, line: number, column: number, message: string): void {
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
	return /^update(?:_[a-z0-9]+)*_visual(?:_[a-z0-9]+)*$/.test(leaf);
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

function matchesGetterPattern(functionExpression: LuaFunctionExpression): boolean {
	const body = functionExpression.body.body;
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
			`update_visual-style code is forbidden ("${functionName}"). Use deterministic initialization and on-change updates.`,
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
	const isBuiltinRecreation = isNamedFunction && matchesBuiltinRecreationPattern(functionExpression);
	if (isBuiltinRecreation) {
		pushIssue(
			issues,
			'builtin_recreation_pattern',
			functionExpression,
			`Recreating existing built-in behavior is forbidden ("${functionName}").`,
		);
	}
	const isPureCopyFunction = isNamedFunction && matchesPureCopyFunctionPattern(functionExpression);
	if (isPureCopyFunction) {
		pushIssue(
			issues,
			'pure_copy_function_pattern',
			functionExpression,
			`Defensive pure-copy function is forbidden ("${functionName}").`,
		);
	}
	if (isNamedFunction && options.isMethodDeclaration && !isGetterOrSetter && !isVisualUpdateLike && matchesMeaninglessSingleLineMethodPattern(functionExpression)) {
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

function lintTableField(field: LuaTableField, issues: LuaLintIssue[]): void {
	switch (field.kind) {
		case LuaTableFieldKind.Array:
			lintExpression(field.value, issues);
			return;
		case LuaTableFieldKind.IdentifierKey:
			lintExpression(field.value, issues);
			return;
		case LuaTableFieldKind.ExpressionKey:
			lintExpression(field.key, issues);
			lintExpression(field.value, issues);
			return;
		default:
			return;
	}
}

function lintExpression(expression: LuaExpression | null, issues: LuaLintIssue[]): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.CallExpression:
			lintRequireCall(expression, issues);
			lintForbiddenStateCalls(expression, issues);
			lintExpression(expression.callee, issues);
			for (const arg of expression.arguments) {
				lintExpression(arg, issues);
			}
			return;
		case LuaSyntaxKind.MemberExpression:
			lintExpression(expression.base, issues);
			return;
		case LuaSyntaxKind.IndexExpression:
			lintExpression(expression.base, issues);
			lintExpression(expression.index, issues);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintExpression(expression.left, issues);
			lintExpression(expression.right, issues);
			return;
		case LuaSyntaxKind.UnaryExpression:
			lintExpression(expression.operand, issues);
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
				lintExpression(statement.start, issues);
				lintExpression(statement.limit, issues);
				lintExpression(statement.step, issues);
				lintStatements(statement.block.body, issues);
				break;
			case LuaSyntaxKind.ForGenericStatement:
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

function formatIssues(issues: LuaLintIssue[]): string {
	const sorted = [...issues].sort((a, b) => {
		if (a.path !== b.path) return a.path.localeCompare(b.path);
		if (a.line !== b.line) return a.line - b.line;
		if (a.column !== b.column) return a.column - b.column;
		return a.rule.localeCompare(b.rule);
	});
	const lines = sorted.map(issue => `${issue.path}:${issue.line}:${issue.column}: ${issue.message}`);
	return `[Lua Cart Lint] ${sorted.length} violation(s):\n${lines.join('\n')}`;
}

export async function lintCartLuaSources(options: LuaCartLintOptions): Promise<void> {
	const files = await collectLuaFiles(options.roots);
	if (files.length === 0) {
		return;
	}

	const issues: LuaLintIssue[] = [];
	for (const absolutePath of files) {
		const source = await readFile(absolutePath, 'utf8');
		const workspacePath = toWorkspaceRelativePath(absolutePath);
		const lexer = new LuaLexer(source, workspacePath, { canonicalizeIdentifiers: 'none' });
		const tokens = lexer.scanTokens();
		lintUppercaseCode(workspacePath, tokens, issues);
		const parser = new LuaParser(tokens, workspacePath, source);
		const chunk = parser.parseChunk();
		lintStatements(chunk.body, issues);
	}

	if (issues.length > 0) {
		throw new Error(formatIssues(issues));
	}
}
