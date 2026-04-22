import ts from 'typescript';
import { FunctionLikeWithSignature } from './types';

export function isFunctionLikeValue(node: ts.Expression | undefined): node is ts.ArrowFunction | ts.FunctionExpression {
	let current: ts.Expression | undefined = node;
	while (current) {
		if (ts.isParenthesizedExpression(current)) {
			current = current.expression;
			continue;
		}
		if (ts.isAsExpression(current)) {
			current = current.expression;
			continue;
		}
		if ((ts as unknown as { isTypeAssertionExpression?: (node: ts.Node) => node is ts.TypeAssertion }) .isTypeAssertionExpression?.(current)) {
			current = current.expression;
			continue;
		}
		if (ts.isNonNullExpression(current)) {
			current = current.expression;
			continue;
		}
		return ts.isArrowFunction(current) || ts.isFunctionExpression(current);
	}
	return false;
}

export function getFunctionSignature(node: FunctionLikeWithSignature): string {
	const typeParameterCount = node.typeParameters?.length ?? 0;
	const parameters = node.parameters;
	if (parameters === undefined) {
		return `${typeParameterCount}:`;
	}
	const parts: string[] = [];
	for (let i = 0; i < parameters.length; i += 1) {
		const parameter = parameters[i];
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
