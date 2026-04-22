import { type AnalysisRegion } from '../../../../analysis/lint_suppressions';
import { noteQualityLedger, type QualityLedger } from '../../../../analysis/quality_ledger';
import { type CodeQualityLintRule } from '../../../ts_rule';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import ts from 'typescript';
import { FILE_EXTENSIONS } from '../../../../analysis/code_quality/cli';
import { nodeIsInAnalysisRegion } from '../../../../analysis/code_quality/source_scan';
import { isTsAssignmentOperator } from './bindings';
import { getCallTargetLeafName } from './calls';
import { falseLiteralComparison } from './conditions';
import { SKIP_DIRECTORIES, expressionAccessFingerprint, isIgnoredMethod } from './declarations';
import { getFunctionNodeUsageNames } from './function_usage';
import { nullishLiteralComparison } from './nullish';
import { catchBlockHandlesLuaFaultBoundary } from './runtime_patterns';
import { binaryParentAndSibling } from './statements';
import { LintBinding } from './types';

export type LintIssue = {
	kind: CodeQualityLintRule;
	file: string;
	line: number;
	column: number;
	name: string;
	message: string;
};

export type RepeatedExpressionInfo = {
	line: number;
	column: number;
	count: number;
	sampleText: string;
};

export const DEFAULT_ROOTS = ['src', 'scripts', 'tests', 'tools'];

export const NORMALIZED_BODY_MIN_LENGTH = 120;

export const COMPACT_SAMPLE_TEXT_LENGTH = 180;

export const REPEATED_EXPRESSION_PAIR_MIN_LENGTH = 48;

export const REPEATED_STATEMENT_SEQUENCE_MIN_COUNT = 4;

export const REPEATED_STATEMENT_SEQUENCE_MIN_TEXT_LENGTH = 140;

export const LOCAL_CONST_PATTERN_ENABLED = true;

export function resolveInputPath(candidate: string): string {
	return isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate);
}

export function shouldSkipDirectory(name: string): boolean {
	return SKIP_DIRECTORIES.has(name) || (name.length > 0 && name[0] === '.');
}

export function normalizePathForAnalysis(path: string): string {
	return path.replace(/\\/g, '/');
}

export function pushLintIssue(
	issues: LintIssue[],
	sourceFile: ts.SourceFile,
	node: ts.Node,
	kind: CodeQualityLintRule,
	message: string,
	name = kind,
): void {
	const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
	issues.push({
		kind,
		file: sourceFile.fileName,
		line: position.line + 1,
		column: position.character + 1,
		name,
		message,
	});
}

export function nodeStartLine(sourceFile: ts.SourceFile, node: ts.Node): number {
	return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

export function collectTypeScriptFiles(pathCandidates: ReadonlyArray<string>): string[] {
	const files: string[] = [];
	const stack = pathCandidates.map(resolveInputPath);
	while (stack.length > 0) {
		const current = stack.pop();
		if (!existsSync(current)) continue;
		const stat = statSync(current);
		if (stat.isFile()) {
			const extension = extname(current);
			if (FILE_EXTENSIONS.has(extension)) {
				files.push(current);
			}
			continue;
		}
		if (!stat.isDirectory()) {
			continue;
		}
		const directoryName = basename(current);
		if (shouldSkipDirectory(directoryName)) {
			continue;
		}
		const entries = readdirSync(current, { withFileTypes: true });
		for (let i = 0; i < entries.length; i += 1) {
			const entry = entries[i];
			stack.push(join(current, entry.name));
		}
	}
	return files;
}

export function getPropertyName(node: ts.PropertyName | ts.Expression): string | null {
	if (ts.isIdentifier(node)) return node.text;
	if (ts.isStringLiteral(node)) return node.text;
	if (ts.isNumericLiteral(node)) return node.text;
	if (ts.isComputedPropertyName(node)) return null;
	if (ts.isPrivateIdentifier(node)) return node.text;
	if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
	return null;
}

export function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
	const modifiers = (node as { modifiers?: ts.NodeArray<ts.Modifier> }).modifiers;
	if (modifiers === undefined) {
		return false;
	}
	for (let i = 0; i < modifiers.length; i += 1) {
		if (modifiers[i].kind === kind) {
			return true;
		}
	}
	return false;
}

export function getExtendsExpression(node: ts.ClassDeclaration, importAliases: Map<string, string>): string | null {
	const heritage = node.heritageClauses;
	if (heritage === undefined) {
		return null;
	}
	for (let i = 0; i < heritage.length; i += 1) {
		const clause = heritage[i];
		if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
			continue;
		}
		const types = clause.types;
		for (let j = 0; j < types.length; j += 1) {
			const expr = types[j].expression;
			const text = getExpressionText(expr, importAliases);
			if (text !== null) {
				return text;
			}
		}
	}
	return null;
}

export function getExpressionText(node: ts.Expression, aliases?: Map<string, string>): string | null {
	if (node.kind === ts.SyntaxKind.ThisKeyword) {
		return 'this';
	}
	if (ts.isIdentifier(node)) {
		const alias = aliases?.get(node.text);
		return alias ?? node.text;
	}
	if (ts.isPropertyAccessExpression(node)) {
		const left = getExpressionText(node.expression, aliases);
		if (left === null) {
			return null;
		}
		return `${left}.${node.name.text}`;
	}
	return null;
}

export function getCallExpressionTarget(node: ts.Expression): string | null {
	let current: ts.Expression = node;
	while (true) {
		if (ts.isParenthesizedExpression(current)) {
			current = current.expression;
			continue;
		}
		if (ts.isAsExpression(current)) {
			current = current.expression;
			continue;
		}
		const isTypeAssertion = (ts as unknown as { isTypeAssertionExpression?: (node: ts.Node) => node is ts.TypeAssertion })
			.isTypeAssertionExpression;
		if (isTypeAssertion !== undefined && isTypeAssertion(current)) {
			current = current.expression;
			continue;
		}
		if (ts.isNonNullExpression(current)) {
			current = current.expression;
			continue;
		}
		break;
	}
	if (!ts.isCallExpression(current)) {
		return null;
	}
	return getExpressionText(current.expression);
}

export function isVariableImportExportName(node: ts.Node): boolean {
	if (
		ts.isImportClause(node) ||
		ts.isNamespaceImport(node) ||
		ts.isImportSpecifier(node) ||
		ts.isExportSpecifier(node) ||
		ts.isImportEqualsDeclaration(node)
	) {
		return true;
	}
	return false;
}

export function shouldIgnoreLintName(name: string): boolean {
	return name.length === 0 || name === '_' || name.startsWith('_');
}

export function compactExpressionText(node: ts.Expression, sourceFile: ts.SourceFile): string {
	return node.getText(sourceFile).replace(/\s+/g, ' ').trim();
}

export function isRedundantConditionalExpression(node: ts.ConditionalExpression, sourceFile: ts.SourceFile): boolean {
	return compactExpressionText(node.whenTrue, sourceFile) === compactExpressionText(node.whenFalse, sourceFile);
}

export function getSingleReturnExpression(statement: ts.Statement): ts.Expression | null {
	if (ts.isReturnStatement(statement)) {
		return statement.expression ?? null;
	}
	if (!ts.isBlock(statement) || statement.statements.length !== 1) {
		return null;
	}
	const onlyStatement = statement.statements[0];
	if (!ts.isReturnStatement(onlyStatement)) {
		return null;
	}
	return onlyStatement.expression ?? null;
}

export function functionBodyContainsLazyInitAssignment(root: ts.Node, targetFingerprint: string): boolean {
	let found = false;
	const visit = (current: ts.Node): void => {
		if (found) {
			return;
		}
		if (current !== root && ts.isFunctionLike(current)) {
			return;
		}
		if (ts.isBinaryExpression(current) && isTsAssignmentOperator(current.operatorToken.kind)) {
			const assignmentTarget = expressionAccessFingerprint(current.left);
			if (assignmentTarget === targetFingerprint) {
				const assignedValue = unwrapExpression(current.right);
				if (
					ts.isCallExpression(assignedValue)
					|| ts.isNewExpression(assignedValue)
					|| ts.isObjectLiteralExpression(assignedValue)
					|| ts.isArrayLiteralExpression(assignedValue)
				) {
					found = true;
					return;
				}
			}
		}
		ts.forEachChild(current, visit);
	};
	visit(root);
	return found;
}

export function lintEnsurePattern(
	node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
	sourceFile: ts.SourceFile,
	regions: readonly AnalysisRegion[],
	issues: LintIssue[],
): void {
	if (nodeIsInAnalysisRegion(sourceFile, regions, 'ensure-acceptable', node)) {
		return;
	}
	const names = getFunctionNodeUsageNames(node);
	if (names.length === 0 || !names.some(name => name.startsWith('ensure'))) {
		return;
	}
	const body = node.body;
	if (body === undefined || !ts.isBlock(body) || body.statements.length < 2) {
		return;
	}
	const lastStatement = body.statements[body.statements.length - 1];
	const returnExpression = getSingleReturnExpression(lastStatement);
	if (returnExpression === null) {
		return;
	}
	const targetFingerprint = expressionAccessFingerprint(returnExpression);
	if (targetFingerprint === null) {
		return;
	}
	let hasGuardReturn = false;
	for (let index = 0; index < body.statements.length - 1; index += 1) {
		const statement = body.statements[index];
		if (!ts.isIfStatement(statement) || statement.elseStatement !== undefined) {
			continue;
		}
		const guardReturn = getSingleReturnExpression(statement.thenStatement);
		if (guardReturn === null) {
			continue;
		}
		if (expressionAccessFingerprint(guardReturn) === targetFingerprint) {
			hasGuardReturn = true;
			break;
		}
	}
	if (!hasGuardReturn || !functionBodyContainsLazyInitAssignment(body, targetFingerprint)) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node.name ?? node,
		'ensure_pattern',
		'Lazy ensure/init wrapper is forbidden. Initialize the resource eagerly instead of guarding creation and returning the cached singleton.',
	);
}

export function lintTerminalReturnPaddingPattern(
	node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
	sourceFile: ts.SourceFile,
	issues: LintIssue[],
): void {
	const body = node.body;
	if (body === undefined || !ts.isBlock(body) || body.statements.length === 0) {
		return;
	}
	const lastStatement = body.statements[body.statements.length - 1];
	if (!ts.isReturnStatement(lastStatement) || lastStatement.expression !== undefined) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		lastStatement,
		'useless_terminal_return_pattern',
		'Terminal `return;` is forbidden. Remove no-op returns instead of padding the body.',
	);
}

export function unwrapExpression(node: ts.Expression): ts.Expression {
	let current = node;
	while (true) {
		if (ts.isParenthesizedExpression(current)) {
			current = current.expression;
			continue;
		}
		if (ts.isAsExpression(current)) {
			current = current.expression;
			continue;
		}
		const isTypeAssertion = (ts as unknown as { isTypeAssertionExpression?: (node: ts.Node) => node is ts.TypeAssertion })
			.isTypeAssertionExpression;
		if (isTypeAssertion !== undefined && isTypeAssertion(current)) {
			current = current.expression;
			continue;
		}
		if (ts.isNonNullExpression(current)) {
			current = current.expression;
			continue;
		}
		return current;
	}
}

export function isSimpleAliasExpression(node: ts.Expression | undefined): boolean {
	if (node === undefined) {
		return false;
	}
	const unwrapped = unwrapExpression(node);
	return ts.isIdentifier(unwrapped);
}

export function splitIdentifierWords(text: string): string[] {
	const words = text.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z0-9])/g);
	return words === null ? [text.toLowerCase()] : words.map(word => word.toLowerCase());
}

export function getActiveBinding(scopes: Array<Map<string, LintBinding[]>>, name: string): LintBinding | null {
	for (let index = scopes.length - 1; index >= 0; index -= 1) {
		const scope = scopes[index];
		const bindings = scope.get(name);
		if (bindings === undefined || bindings.length === 0) {
			continue;
		}
		return bindings[bindings.length - 1];
	}
	return null;
}

export function lintCatchClausePatterns(node: ts.CatchClause, sourceFile: ts.SourceFile, issues: LintIssue[], ledger: QualityLedger): void {
	const statements = node.block.statements;
	if (statements.length === 0) {
		pushLintIssue(
			issues,
			sourceFile,
			node,
			'empty_catch_pattern',
			'Empty catch block is forbidden. Catch only when you can handle or rethrow the error.',
		);
		return;
	}
	const declaration = node.variableDeclaration;
	if (declaration !== undefined && ts.isIdentifier(declaration.name) && statements.length === 1) {
		const onlyStatement = statements[0];
		if (
			ts.isThrowStatement(onlyStatement)
			&& onlyStatement.expression !== undefined
			&& ts.isIdentifier(onlyStatement.expression)
			&& onlyStatement.expression.text === declaration.name.text
		) {
			pushLintIssue(
				issues,
				sourceFile,
				node,
				'useless_catch_pattern',
				'Catch clause only rethrows the caught error. Remove the wrapper and let the exception propagate.',
			);
			return;
		}
	}
	for (let index = 0; index < statements.length; index += 1) {
		const statement = statements[index];
		if (!ts.isReturnStatement(statement)) {
			continue;
		}
		if (catchBlockHandlesAsyncError(node)) {
			noteQualityLedger(ledger, 'allowed_catch_async_fault_boundary');
		} else if (catchBlockHandlesLuaFaultBoundary(node, sourceFile)) {
			noteQualityLedger(ledger, 'allowed_catch_lua_fault_boundary');
		} else if (catchBlockReportsCaughtError(node)) {
			noteQualityLedger(ledger, 'allowed_catch_reported_fallback');
		} else {
			pushLintIssue(
				issues,
				sourceFile,
				node,
				'silent_catch_fallback_pattern',
				'Catch clause swallows the error and returns a fallback. Trust the caller/callee or propagate the failure.',
			);
			return;
		}
	}
}

export function expressionReferencesAnyName(node: ts.Node, names: ReadonlySet<string>): boolean {
	let references = false;
	const visit = (current: ts.Node): void => {
		if (references) {
			return;
		}
		if (ts.isIdentifier(current) && names.has(current.text)) {
			references = true;
			return;
		}
		ts.forEachChild(current, visit);
	};
	visit(node);
	return references;
}

export function isErrorReportingTarget(target: string | null): boolean {
	return target === 'showEditorMessage'
		|| target === 'tryShowLuaErrorOverlay'
		|| target === 'console.error'
		|| target === 'console.warn';
}

export function collectCatchReportValueNames(node: ts.CatchClause, caughtName: string | null): Set<string> {
	const names = new Set<string>();
	if (caughtName !== null) {
		names.add(caughtName);
	}
	const visit = (current: ts.Node): void => {
		if (
			ts.isVariableDeclaration(current)
			&& ts.isIdentifier(current.name)
			&& current.initializer !== undefined
			&& expressionReferencesAnyName(current.initializer, names)
		) {
			names.add(current.name.text);
		}
		ts.forEachChild(current, visit);
	};
	visit(node.block);
	return names;
}

export function catchBlockReportsCaughtError(node: ts.CatchClause): boolean {
	const declaration = node.variableDeclaration;
	const caughtName = declaration !== undefined && ts.isIdentifier(declaration.name) ? declaration.name.text : null;
	const reportValueNames = collectCatchReportValueNames(node, caughtName);
	let reports = false;
	const visit = (current: ts.Node): void => {
		if (reports) {
			return;
		}
		if (ts.isCallExpression(current)) {
			const target = getExpressionText(current.expression);
			if (isErrorReportingTarget(target) && current.arguments.some(arg => expressionReferencesAnyName(arg, reportValueNames))) {
				reports = true;
				return;
			}
		}
		ts.forEachChild(current, visit);
	};
	visit(node.block);
	return reports;
}

export function catchBlockHandlesAsyncError(node: ts.CatchClause): boolean {
	const declaration = node.variableDeclaration;
	const caughtName = declaration !== undefined && ts.isIdentifier(declaration.name) ? declaration.name.text : null;
	let handles = false;
	const visit = (current: ts.Node): void => {
		if (handles) {
			return;
		}
		if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
			const left = getExpressionText(current.left);
			const right = getExpressionText(current.right);
			if (left !== null && left.endsWith('.fault') && (caughtName === null || right === caughtName)) {
				handles = true;
				return;
			}
		}
		if (ts.isCallExpression(current)) {
			const target = getCallTargetLeafName(current.expression);
			if (target !== null && /^finish[A-Za-z0-9]*Error$/.test(target)) {
				handles = true;
				return;
			}
		}
		ts.forEachChild(current, visit);
	};
	visit(node.block);
	return handles;
}

export function functionUsageExpressionName(node: ts.Expression): string | null {
	const unwrapped = unwrapExpression(node);
	if (ts.isIdentifier(unwrapped)) {
		return unwrapped.text;
	}
	if (unwrapped.kind === ts.SyntaxKind.ThisKeyword) {
		return 'this';
	}
	if (ts.isPropertyAccessExpression(unwrapped)) {
		const base = functionUsageExpressionName(unwrapped.expression);
		return base === null ? null : `${base}.${unwrapped.name.text}`;
	}
	if (ts.isElementAccessExpression(unwrapped)) {
		const base = functionUsageExpressionName(unwrapped.expression);
		if (base === null) {
			return null;
		}
		if (ts.isStringLiteral(unwrapped.argumentExpression) || ts.isNumericLiteral(unwrapped.argumentExpression)) {
			return `${base}.${unwrapped.argumentExpression.text}`;
		}
	}
	return null;
}

export function usageCountForNames(names: readonly string[], counts: ReadonlyMap<string, number>): number {
	let total = 0;
	const visited = new Set<string>();
	for (let index = 0; index < names.length; index += 1) {
		const name = names[index];
		if (visited.has(name)) {
			continue;
		}
		visited.add(name);
		total += counts.get(name) ?? 0;
	}
	return total;
}

export function expressionRootName(node: ts.Expression): string | null {
	const current = unwrapExpression(node);
	if (ts.isIdentifier(current)) {
		return current.text;
	}
	if (current.kind === ts.SyntaxKind.ThisKeyword) {
		return 'this';
	}
	if (ts.isPropertyAccessExpression(current)) {
		return expressionRootName(current.expression);
	}
	if (ts.isElementAccessExpression(current)) {
		return expressionRootName(current.expression);
	}
	if (ts.isCallExpression(current)) {
		return expressionRootName(current.expression);
	}
	return null;
}

export function isInsideConstructor(node: ts.Node): boolean {
	let current: ts.Node | undefined = node;
	while (current !== undefined) {
		if (ts.isConstructorDeclaration(current)) {
			return true;
		}
		if (ts.isFunctionLike(current) || ts.isSourceFile(current)) {
			return false;
		}
		current = current.parent;
	}
	return false;
}

export function compactSampleText(text: string): string {
	if (text.length <= COMPACT_SAMPLE_TEXT_LENGTH) {
		return text;
	}
	return `${text.slice(0, COMPACT_SAMPLE_TEXT_LENGTH - 3)}...`;
}

export function isExpressionChildOfLargerExpression(node: ts.Expression, parent: ts.Node | undefined): boolean {
	if (parent === undefined) {
		return false;
	}
	let child: ts.Node = node;
	while (
		ts.isParenthesizedExpression(parent)
		|| ts.isAsExpression(parent)
		|| ts.isNonNullExpression(parent)
		|| ((ts as unknown as { isTypeAssertionExpression?: (node: ts.Node) => node is ts.TypeAssertion }).isTypeAssertionExpression?.(parent) ?? false)
	) {
		child = parent;
		parent = parent.parent;
		if (parent === undefined) {
			return false;
		}
	}
	if (ts.isPropertyAccessExpression(parent) && parent.expression === child) {
		return true;
	}
	if (ts.isElementAccessExpression(parent) && parent.expression === child) {
		return true;
	}
	if (ts.isCallExpression(parent) && parent.expression === child) {
		return true;
	}
	if (ts.isNewExpression(parent) && parent.expression === child) {
		return true;
	}
	if (
		ts.isBinaryExpression(parent)
		&& (parent.left === child || parent.right === child)
		&& !isTsAssignmentOperator(parent.operatorToken.kind)
	) {
		return true;
	}
	return false;
}

export function isExplicitNonJsTruthinessPair(node: ts.BinaryExpression): boolean {
	const falseCheck = falseLiteralComparison(node);
	if (falseCheck === null) {
		return false;
	}
	const context = binaryParentAndSibling(node);
	if (context === null) {
		return false;
	}
	const nullishCheck = nullishLiteralComparison(context.sibling);
	if (nullishCheck === null || nullishCheck.subject !== falseCheck.subject || nullishCheck.isPositive !== falseCheck.isPositive) {
		return false;
	}
	const pairOperatorKind = context.parent.operatorToken.kind;
	if (falseCheck.isPositive) {
		return pairOperatorKind === ts.SyntaxKind.BarBarToken;
	}
	return pairOperatorKind === ts.SyntaxKind.AmpersandAmpersandToken;
}

export function isLuaSourceLookupExpression(node: ts.Expression): boolean {
	const unwrapped = unwrapExpression(node);
	if (ts.isBinaryExpression(unwrapped) && unwrapped.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
		return isLuaSourceLookupExpression(unwrapped.left) || isLuaSourceLookupExpression(unwrapped.right);
	}
	if (!ts.isElementAccessExpression(unwrapped)) {
		return false;
	}
	const target = unwrapExpression(unwrapped.expression);
	return ts.isPropertyAccessExpression(target) && target.name.text === 'path2lua';
}

export function isSinglePropertyOptionsType(type: ts.TypeNode | undefined): boolean {
	if (type === undefined || !ts.isTypeLiteralNode(type)) {
		return false;
	}
	let propertyCount = 0;
	for (let index = 0; index < type.members.length; index += 1) {
		if (!ts.isPropertySignature(type.members[index])) {
			return false;
		}
		propertyCount += 1;
	}
	return propertyCount === 1;
}

export function lintSinglePropertyOptionsParameter(
	node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
	sourceFile: ts.SourceFile,
	issues: LintIssue[],
): void {
	if (ts.isMethodDeclaration(node) && (node.body === undefined || isIgnoredMethod(node))) {
		return;
	}
	if (ts.isFunctionDeclaration(node) && node.body === undefined) {
		return;
	}
	for (let index = 0; index < node.parameters.length; index += 1) {
		const parameter = node.parameters[index];
		if (!ts.isIdentifier(parameter.name)) {
			continue;
		}
		const name = parameter.name.text;
		if (name !== 'opts' && name !== 'options') {
			continue;
		}
		if (!isSinglePropertyOptionsType(parameter.type)) {
			continue;
		}
		pushLintIssue(
			issues,
			sourceFile,
			parameter.name,
			'single_property_options_parameter_pattern',
			'Single-property opts/options parameters are forbidden. Use a direct parameter or split the operation instead of implying future extensibility.',
		);
	}
}

export function ideLayer(path: string): string | null {
	const normalized = normalizePathForAnalysis(path);
	const marker = '/src/bmsx/ide/';
	const index = normalized.indexOf(marker);
	if (index === -1) {
		return null;
	}
	const rest = normalized.slice(index + marker.length);
	const slash = rest.indexOf('/');
	return slash === -1 ? rest : rest.slice(0, slash);
}

export function forbiddenLayerImportReason(sourceLayer: string, targetLayer: string): string | null {
	if (sourceLayer === targetLayer) {
		return null;
	}
	if (sourceLayer === 'common') {
		return `ide/common must not import ${targetLayer}; common code must stay below feature layers.`;
	}
	if (sourceLayer === 'language' && targetLayer !== 'common') {
		return `ide/language must not import ${targetLayer}; language code must stay UI/workbench independent.`;
	}
	if (sourceLayer === 'terminal' && (targetLayer === 'editor' || targetLayer === 'workbench')) {
		return `ide/terminal must not import ${targetLayer}; terminal code must not depend on editor/workbench internals.`;
	}
	if (sourceLayer === 'editor' && targetLayer === 'workbench') {
		return 'ide/editor must not import ide/workbench; workbench may compose editor, not the reverse.';
	}
	if (sourceLayer === 'workbench' && targetLayer === 'editor') {
		return 'ide/workbench must not import deep editor internals directly; route shared contracts through common modules.';
	}
	if (sourceLayer === 'runtime' && (targetLayer === 'editor' || targetLayer === 'workbench')) {
		return `ide/runtime must not import ${targetLayer}; runtime glue must not own UI feature internals.`;
	}
	return null;
}

export function lintCrossLayerImports(sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	const sourceLayer = ideLayer(sourceFile.fileName);
	if (sourceLayer === null) {
		return;
	}
	for (let index = 0; index < sourceFile.statements.length; index += 1) {
		const statement = sourceFile.statements[index];
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
			continue;
		}
		const specifier = statement.moduleSpecifier.text;
		if (!specifier.startsWith('.')) {
			continue;
		}
		const targetPath = resolve(dirname(sourceFile.fileName), specifier);
		const targetLayer = ideLayer(targetPath);
		if (targetLayer === null) {
			continue;
		}
		const reason = forbiddenLayerImportReason(sourceLayer, targetLayer);
		if (reason === null) {
			continue;
		}
		pushLintIssue(
			issues,
			sourceFile,
			statement.moduleSpecifier,
			'cross_layer_import_pattern',
			reason,
		);
	}
}
