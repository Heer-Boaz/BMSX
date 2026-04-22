import { type AnalysisRegion } from '../../../../analysis/lint_suppressions';
import { noteQualityLedger, type QualityLedger } from '../../../../analysis/quality_ledger';
import ts from 'typescript';
import { nodeIsInAnalysisRegion } from '../../../../analysis/code_quality/source_scan';
import { LintIssue, NORMALIZED_BODY_MIN_LENGTH, getCallExpressionTarget, hasModifier, isExpressionChildOfLargerExpression, pushLintIssue, unwrapExpression } from './ast';
import { isExpressionInScopeFingerprint, isTsAssignmentOperator } from './bindings';
import { isFunctionLikeValue } from './functions';
import { isTemporalSnapshotInitializer } from './local_bindings';
import { isPublicContractMethod } from './numeric';
import { hasExportModifier, isBoundaryStyleWrapperName, isNamedPrimitivePredicate, isTrivialDelegationCallExpression } from './runtime_patterns';
import { collectSemanticBodySignatures } from './semantic';
import { getSingleStatementWrapperTarget, isLoopConditionExpression } from './statements';

export type NormalizedBodyInfo = {
	name: string;
	file: string;
	line: number;
	column: number;
	fingerprint: string;
	semanticSignatures: string[] | null;
};

export function isAbstractClass(node: ts.ClassDeclaration): boolean {
	return hasModifier(node, ts.SyntaxKind.AbstractKeyword);
}

export function isIgnoredMethod(node: ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration): boolean {
	return hasModifier(node, ts.SyntaxKind.OverrideKeyword) || hasModifier(node, ts.SyntaxKind.AbstractKeyword);
}

export function getFunctionWrapperTarget(
	node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
): string | null {
	const name = node.name?.text;
	if (name !== undefined && isBoundaryStyleWrapperName(name)) {
		return null;
	}
	const body = node.body;
	if (body === undefined || body === null) {
		return null;
	}
	if (ts.isBlock(body)) {
		const statements = body.statements;
		if (statements.length === 1) {
			return getSingleStatementWrapperTarget(statements[0]);
		}
		if (statements.length === 2) {
			const first = statements[0];
			const second = statements[1];
			if (ts.isIfStatement(first) && first.elseStatement === undefined) {
				if (ts.isReturnStatement(first.thenStatement) && first.thenStatement.expression === undefined) {
					return getSingleStatementWrapperTarget(second);
				}
			}
		}
		return null;
	}
	return getCallExpressionTarget(body);
}

export function isExportedVariableDeclaration(node: ts.VariableDeclaration): boolean {
	const parent = node.parent;
	if (!parent || !ts.isVariableDeclarationList(parent)) {
		return false;
	}
	const statement = parent.parent;
	if (!statement || !ts.isVariableStatement(statement)) {
		return false;
	}
	const modifiers = statement.modifiers;
	if (!modifiers) {
		return false;
	}
	for (let i = 0; i < modifiers.length; i += 1) {
		if (modifiers[i].kind === ts.SyntaxKind.ExportKeyword) {
			return true;
		}
	}
	return false;
}

export function expressionAccessFingerprint(node: ts.Expression): string | null {
	const unwrapped = unwrapExpression(node);
	if (ts.isCallExpression(unwrapped)) {
		return expressionAccessFingerprint(unwrapped.expression);
	}
	return isExpressionInScopeFingerprint(unwrapped);
}

export function enclosingVariableDeclarationName(node: ts.Node): string | null {
	let current: ts.Node | undefined = node;
	while (current !== undefined) {
		if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
			return current.name.text;
		}
		current = current.parent;
	}
	return null;
}

export function repeatedExpressionFingerprint(node: ts.Expression, sourceFile: ts.SourceFile, parent: ts.Node | undefined): string | null {
	if (isExpressionChildOfLargerExpression(node, parent)) {
		return null;
	}
	if (isLoopConditionExpression(node, parent)) {
		return null;
	}
	if (parent !== undefined && ts.isBinaryExpression(parent) && isTsAssignmentOperator(parent.operatorToken.kind) && parent.left === node) {
		return null;
	}
	if (ts.isCallExpression(node)) {
		return null;
	}
	if (
		!ts.isConditionalExpression(node)
		&& !ts.isBinaryExpression(node)
		&& !ts.isElementAccessExpression(node)
		&& !ts.isPropertyAccessExpression(node)
	) {
		return null;
	}
	if (ts.isBinaryExpression(node) && isTsAssignmentOperator(node.operatorToken.kind)) {
		return null;
	}
	if (isTemporalSnapshotInitializer(node, parent)) {
		return null;
	}
	const text = node.getText(sourceFile).replace(/\s+/g, ' ');
	if (text.length < 24) {
		return null;
	}
	if (text.startsWith('this.')) {
		return null;
	}
	return text;
}

export function isSingleLineWrapperCandidate(functionNode: ts.Node, _sourceFile: ts.SourceFile): boolean {
	if (!ts.isFunctionDeclaration(functionNode) && !ts.isMethodDeclaration(functionNode)) {
		return false;
	}
	if (hasExportModifier(functionNode) || isPublicContractMethod(functionNode)) {
		return false;
	}
	const name = functionNode.name?.getText();
	if (name !== undefined && isBoundaryStyleWrapperName(name)) {
		return false;
	}
	const body = functionNode.body;
	if (body === undefined) {
		return false;
	}
	if (!ts.isBlock(body)) {
		return ts.isCallExpression(body) && isTrivialDelegationCallExpression(body);
	}
	if (body.statements.length !== 1) {
		return false;
	}
	const statement = body.statements[0];
	if (ts.isReturnStatement(statement)) {
		return statement.expression !== undefined
			&& ts.isCallExpression(statement.expression)
			&& !isNamedPrimitivePredicate(functionNode, statement.expression)
			&& isTrivialDelegationCallExpression(statement.expression);
	}
	if (ts.isExpressionStatement(statement)) {
		return ts.isCallExpression(statement.expression) && isTrivialDelegationCallExpression(statement.expression);
	}
	return false;
}

export const DIRECT_MUTATION_METHOD_NAMES = new Set([
	'add',
	'clear',
	'delete',
	'pop',
	'push',
	'set',
	'shift',
	'splice',
	'unshift',
]);

export const BOUNDARY_WRAPPER_NAME_WORDS: ReadonlySet<string> = new Set([
	'acquire',
	'add',
	'append',
	'apply',
	'attach',
	'begin',
	'bind',
	'build',
	'capture',
	'change',
	'clear',
	'copy',
	'configure',
	'create',
	'count',
	'decode',
	'destroy',
	'disable',
	'dispose',
	'detach',
	'encode',
	'enable',
	'end',
	'ensure',
	'focus',
	'format',
	'get',
	'has',
	'ident',
	'init',
	'install',
	'intern',
	'launch',
	'load',
	'make',
	'on',
	'open',
	'emplace',
	'pixels',
	'push',
	'read',
	'release',
	'refresh',
	'register',
	'remove',
	'replace',
	'render',
	'reset',
	'resolve',
	'resize',
	'snapshot',
	'save',
	'set',
	'setup',
	'size',
	'state',
	'submit',
	'switch',
	'reserve',
	'shutdown',
	'start',
	'to',
	'update',
	'use',
	'value',
	'write',
	'with',
]);

export function lintFacadeModuleDensity(sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	let exportedCallableCount = 0;
	let exportedWrapperCount = 0;
	let firstWrapperNode: ts.Node | null = null;
	for (let index = 0; index < sourceFile.statements.length; index += 1) {
		const statement = sourceFile.statements[index];
		if (ts.isFunctionDeclaration(statement) && statement.body !== undefined && hasExportModifier(statement)) {
			exportedCallableCount += 1;
			if (getFunctionWrapperTarget(statement) !== null) {
				exportedWrapperCount += 1;
				firstWrapperNode ??= statement.name ?? statement;
			}
			continue;
		}
		if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) {
			continue;
		}
		const declarations = statement.declarationList.declarations;
		for (let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex += 1) {
			const declaration = declarations[declarationIndex];
			if (!isFunctionLikeValue(declaration.initializer)) {
				continue;
			}
			exportedCallableCount += 1;
			if (getFunctionWrapperTarget(declaration.initializer) !== null) {
				exportedWrapperCount += 1;
				firstWrapperNode ??= declaration.name;
			}
		}
	}
	if (exportedWrapperCount >= 3 && exportedWrapperCount * 10 >= exportedCallableCount * 6 && firstWrapperNode !== null) {
		pushLintIssue(
			issues,
			sourceFile,
			firstWrapperNode,
			'facade_module_density_pattern',
			`Module exports ${exportedWrapperCount}/${exportedCallableCount} callable wrappers. Facade modules are forbidden; move ownership to the real module.`,
		);
	}
}

export function normalizedAstFingerprint(node: ts.Node): string {
	const parts: string[] = [];
	const visit = (current: ts.Node): void => {
		if (ts.isIdentifier(current)) {
			parts.push('Identifier');
			return;
		}
		if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
			parts.push('StringLiteral');
			return;
		}
		if (ts.isNumericLiteral(current)) {
			parts.push('NumericLiteral');
			return;
		}
		parts.push(ts.SyntaxKind[current.kind]);
		if (ts.isBinaryExpression(current)) {
			parts.push(`op:${ts.SyntaxKind[current.operatorToken.kind]}`);
		}
		if (ts.isPrefixUnaryExpression(current) || ts.isPostfixUnaryExpression(current)) {
			parts.push(`op:${ts.SyntaxKind[current.operator]}`);
		}
		ts.forEachChild(current, visit);
	};
	visit(node);
	return parts.join('|');
}

export function collectNormalizedBody(
	sourceFile: ts.SourceFile,
	regions: readonly AnalysisRegion[],
	name: string,
	node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
	normalizedBodies: NormalizedBodyInfo[],
	ledger: QualityLedger,
): void {
	if (name.endsWith('Thunk')) {
		noteQualityLedger(ledger, 'skipped_normalized_body_thunk');
		return;
	}
	if (hasExportModifier(node)) {
		noteQualityLedger(ledger, 'skipped_normalized_body_exported');
		return;
	}
	if (isPublicContractMethod(node)) {
		noteQualityLedger(ledger, 'skipped_normalized_body_public_contract');
		return;
	}
	if (nodeIsInAnalysisRegion(sourceFile, regions, 'normalized-body-acceptable', node)) {
		noteQualityLedger(ledger, 'skipped_normalized_body_analysis_region');
		return;
	}
	const body = node.body;
	if (body === undefined) {
		return;
	}
	const text = body.getText(sourceFile);
	const semanticSignatures = collectSemanticBodySignatures(body);
	const semanticBody = semanticSignatures.length > 0;
	if (ts.isBlock(body)) {
		if (!semanticBody) {
			if (body.statements.length < 2 || isSingleLineWrapperCandidate(node, sourceFile)) {
				noteQualityLedger(ledger, 'skipped_normalized_body_too_small_or_wrapper');
				return;
			}
			if (text.length < NORMALIZED_BODY_MIN_LENGTH) {
				noteQualityLedger(ledger, 'skipped_normalized_body_short_text');
				return;
			}
		}
	} else if (!semanticBody) {
		noteQualityLedger(ledger, 'skipped_normalized_body_expression_without_semantic_work');
		return;
	}
	const locationNode = (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node)) && node.name
		? node.name
		: body;
	const position = sourceFile.getLineAndCharacterOfPosition(locationNode.getStart(sourceFile));
	normalizedBodies.push({
		name,
		file: sourceFile.fileName,
		line: position.line + 1,
		column: position.character + 1,
		fingerprint: normalizedAstFingerprint(body),
		semanticSignatures: semanticBody ? semanticSignatures : null,
	});
}
