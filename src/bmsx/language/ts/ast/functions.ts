import ts from 'typescript';
import { getPropertyName, hasModifier, unwrapExpression } from './expressions';

export type FunctionWithBlockBody =
	| ts.FunctionDeclaration
	| ts.MethodDeclaration
	| ts.FunctionExpression
	| ts.ArrowFunction;

export function isFunctionLikeValue(node: ts.Expression | undefined): node is ts.ArrowFunction | ts.FunctionExpression {
	if (node === undefined) {
		return false;
	}
	const expression = unwrapExpression(node);
	return ts.isArrowFunction(expression) || ts.isFunctionExpression(expression);
}

export function getFunctionSignature(node: {
	readonly parameters?: ts.NodeArray<ts.ParameterDeclaration> | undefined;
	readonly typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration>;
}): string {
	const typeParameterCount = node.typeParameters?.length ?? 0;
	const parameters = node.parameters;
	if (parameters === undefined) {
		return `${typeParameterCount}:`;
	}
	const parts: string[] = [];
	for (let index = 0; index < parameters.length; index += 1) {
		const parameter = parameters[index];
		let marker = '';
		if (parameter.dotDotDotToken !== undefined) {
			marker += '...';
		}
		if (parameter.questionToken !== undefined) {
			marker += '?';
		}
		if (parameter.initializer !== undefined) {
			marker += '=';
		}
		if (parameter.name.kind === ts.SyntaxKind.ObjectBindingPattern) {
			marker += 'obj';
		} else if (parameter.name.kind === ts.SyntaxKind.ArrayBindingPattern) {
			marker += 'arr';
		} else {
			marker += 'id';
		}
		parts.push(marker);
	}
	return `${typeParameterCount}:${parts.join(',')}`;
}

export function isFunctionExpressionLike(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
	return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

export function isFunctionLikeWithParameters(node: ts.Node): node is ts.FunctionDeclaration
	| ts.MethodDeclaration
	| ts.FunctionExpression
	| ts.ArrowFunction
	| ts.ConstructorDeclaration
	| ts.GetAccessorDeclaration
	| ts.SetAccessorDeclaration {
	return ts.isFunctionDeclaration(node)
		|| ts.isMethodDeclaration(node)
		|| ts.isFunctionExpression(node)
		|| ts.isArrowFunction(node)
		|| ts.isConstructorDeclaration(node)
		|| ts.isGetAccessorDeclaration(node)
		|| ts.isSetAccessorDeclaration(node);
}

export function getFunctionLikeName(node: FunctionWithBlockBody): string | null {
	if (node.name !== undefined) {
		return getPropertyName(node.name);
	}
	const parent = node.parent;
	if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
		return parent.name.text;
	}
	if (ts.isPropertyAssignment(parent)) {
		return getPropertyName(parent.name);
	}
	return null;
}

export function isPredicateFunctionName(name: string | undefined): boolean {
	return name !== undefined && /^(is|has|can|should)[A-Z]/.test(name);
}

export function hasPrivateOrProtectedModifier(node: ts.Node): boolean {
	return hasModifier(node, ts.SyntaxKind.PrivateKeyword) || hasModifier(node, ts.SyntaxKind.ProtectedKeyword);
}

export function isPublicMethodDeclaration(node: ts.Node): node is ts.MethodDeclaration {
	return ts.isMethodDeclaration(node) && !hasPrivateOrProtectedModifier(node);
}
