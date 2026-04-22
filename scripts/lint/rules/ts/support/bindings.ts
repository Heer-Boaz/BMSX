import ts from 'typescript';
import { getPropertyName, isVariableImportExportName } from '../../../../../src/bmsx/language/ts/ast/expressions';
import { isAssignmentOperator } from '../../../../../src/bmsx/language/ts/ast/operators';

export function getClassScopePath(node: ts.Node): string | null {
	const parts: string[] = [];
	let current: ts.Node | undefined = node;
	while (current) {
		if (ts.isClassDeclaration(current) || ts.isInterfaceDeclaration(current) || ts.isModuleDeclaration(current)) {
			if (current.name) {
				const name = getPropertyName(current.name);
				if (name !== null) {
					parts.push(name);
				}
			}
		}
		current = current.parent;
	}
	if (parts.length === 0) {
		return null;
	}
	parts.reverse();
	return parts.join('.');
}

export function isDeclarationIdentifier(node: ts.Identifier, parent: ts.Node): boolean {
	if (ts.isVariableDeclaration(parent)) return parent.name === node;
	if (ts.isParameter(parent)) return parent.name === node;
	if (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isMethodDeclaration(parent)) {
		return parent.name === node;
	}
	if (ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent)) {
		return parent.name === node;
	}
	if (ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent)) {
		return parent.name === node;
	}
	if (ts.isEnumDeclaration(parent) || ts.isEnumMember(parent)) {
		return parent.name === node;
	}
	if (ts.isTypeParameterDeclaration(parent)) return parent.name === node;
	if (ts.isPropertyDeclaration(parent) || ts.isMethodSignature(parent) || ts.isPropertySignature(parent)) {
		return parent.name === node;
	}
	if (ts.isImportClause(parent) && parent.name === node) return true;
	return isVariableImportExportName(parent);
}

export function isIdentifierPropertyName(node: ts.Identifier, parent: ts.Node): boolean {
	if (ts.isPropertyAccessExpression(parent)) {
		return parent.name === node;
	}
	if (ts.isPropertyAssignment(parent)) {
		return parent.name === node;
	}
	if (ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent)) {
		return parent.name === node;
	}
	if (ts.isMethodSignature(parent) || ts.isPropertySignature(parent)) {
		return parent.name === node;
	}
	return false;
}

export function isWriteIdentifier(node: ts.Identifier, parent: ts.Node): boolean {
	if (ts.isBinaryExpression(parent) && isAssignmentOperator(parent.operatorToken.kind) && parent.left === node) {
		return true;
	}
	if (ts.isPrefixUnaryExpression(parent) && (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) {
		return true;
	}
	if (ts.isPostfixUnaryExpression(parent) && (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) {
		return true;
	}
	return false;
}

export function isScopeBoundary(node: ts.Node, parent: ts.Node | undefined): boolean {
	if (ts.isSourceFile(node)) {
		return true;
	}
	if (ts.isModuleBlock(node)) {
		return true;
	}
	if (ts.isFunctionLike(node)) {
		return true;
	}
	return ts.isBlock(node) && !ts.isFunctionLike(parent ?? node);
}

export function isExpressionInScopeFingerprint(node: ts.Expression): string | null {
	if (ts.isIdentifier(node)) {
		return `id:${node.text}`;
	}
	if (node.kind === ts.SyntaxKind.ThisKeyword) {
		return 'this';
	}
	if (node.kind === ts.SyntaxKind.SuperKeyword) {
		return 'super';
	}
	if (ts.isPropertyAccessExpression(node)) {
		const left = isExpressionInScopeFingerprint(node.expression);
		if (left === null) {
			return null;
		}
		return `${left}.${node.name.text}`;
	}
	if (ts.isElementAccessExpression(node)) {
		const base = isExpressionInScopeFingerprint(node.expression);
		if (base === null) {
			return null;
		}
		if (ts.isStringLiteral(node.argumentExpression) || ts.isNumericLiteral(node.argumentExpression)) {
			return `${base}[${node.argumentExpression.getText()}]`;
		}
		return null;
	}
	if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
		return isExpressionInScopeFingerprint(node.expression);
	}
	return null;
}

export function isInsideLoop(node: ts.Node): boolean {
	let current: ts.Node | undefined = node;
	while (current !== undefined) {
		if (
			ts.isForStatement(current)
			|| ts.isForInStatement(current)
			|| ts.isForOfStatement(current)
			|| ts.isWhileStatement(current)
			|| ts.isDoStatement(current)
		) {
			return true;
		}
		if (ts.isFunctionLike(current) || ts.isSourceFile(current)) {
			return false;
		}
		current = current.parent;
	}
	return false;
}
