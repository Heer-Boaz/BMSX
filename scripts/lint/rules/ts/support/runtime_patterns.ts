import { type AnalysisRegion } from '../../../../analysis/lint_suppressions';
import ts from 'typescript';
import { nodeIsInAnalysisRegion } from '../../../../analysis/code_quality/source_scan';
import { expressionRootName, getCallTargetLeafName, unwrapExpression } from '../../../../../src/bmsx/language/ts/ast/expressions';
import { isFunctionExpressionLike, isFunctionLikeWithParameters, isPredicateFunctionName } from '../../../../../src/bmsx/language/ts/ast/functions';
import { DIRECT_MUTATION_METHOD_NAMES } from './declarations';

export function isAllocationExpression(node: ts.Expression): boolean {
	const unwrapped = unwrapExpression(node);
	return ts.isObjectLiteralExpression(unwrapped)
		|| ts.isArrayLiteralExpression(unwrapped)
		|| ts.isNewExpression(unwrapped);
}

export function optionalChainBoundaryKind(node: ts.Expression, sourceFile: ts.SourceFile, regions: readonly AnalysisRegion[]): string | null {
	if (nodeIsInAnalysisRegion(sourceFile, regions, 'optional-chain-acceptable', node)) {
		return 'analysis-region';
	}
	const root = expressionRootName(node);
	if (root !== null && rootIsOptionalFunctionParameter(node, root)) {
		return 'optional-parameter';
	}
	if (isMapLookupProjectionOptionalChain(node)) {
		return 'lookup-projection';
	}
	return null;
}

export function rootIsOptionalFunctionParameter(node: ts.Node, root: string): boolean {
	let current: ts.Node | undefined = node;
	while (current !== undefined) {
		if (isFunctionLikeWithParameters(current)) {
			for (let index = 0; index < current.parameters.length; index += 1) {
				const parameter = current.parameters[index];
				if (ts.isIdentifier(parameter.name) && parameter.name.text === root) {
					return parameter.questionToken !== undefined || parameter.initializer !== undefined;
				}
			}
		}
		current = current.parent;
	}
	return false;
}

export function isMapLookupProjectionOptionalChain(node: ts.Expression): boolean {
	const unwrapped = unwrapExpression(node);
	if (!ts.isPropertyAccessExpression(unwrapped)) {
		return false;
	}
	const receiver = unwrapExpression(unwrapped.expression);
	if (!ts.isCallExpression(receiver)) {
		return false;
	}
	return getCallTargetLeafName(receiver.expression) === 'get';
}

export function containsClosureExpression(node: ts.Node): boolean {
	let found = false;
	const visit = (current: ts.Node): void => {
		if (found) {
			return;
		}
		if (isFunctionExpressionLike(current)) {
			found = true;
			return;
		}
		ts.forEachChild(current, visit);
	};
	visit(node);
	return found;
}

export function isTrivialDelegationCallExpression(callExpression: ts.CallExpression): boolean {
	return !isDirectMutationCallExpression(callExpression) && !containsClosureExpression(callExpression) && hasOnlyTrivialDelegationArguments(callExpression);
}

function hasOnlyTrivialDelegationArguments(callExpression: ts.CallExpression): boolean {
	for (let index = 0; index < callExpression.arguments.length; index += 1) {
		if (!isTrivialDelegationArgument(callExpression.arguments[index])) {
			return false;
		}
	}
	return true;
}

function isTrivialDelegationArgument(expression: ts.Expression): boolean {
	const unwrapped = unwrapExpression(expression);
	if (
		ts.isIdentifier(unwrapped)
		|| unwrapped.kind === ts.SyntaxKind.ThisKeyword
		|| ts.isNumericLiteral(unwrapped)
		|| ts.isStringLiteral(unwrapped)
		|| unwrapped.kind === ts.SyntaxKind.NullKeyword
		|| unwrapped.kind === ts.SyntaxKind.TrueKeyword
		|| unwrapped.kind === ts.SyntaxKind.FalseKeyword
	) {
		return true;
	}
	if (ts.isPropertyAccessExpression(unwrapped)) {
		return isTrivialDelegationArgument(unwrapped.expression);
	}
	if (ts.isElementAccessExpression(unwrapped)) {
		return isTrivialDelegationArgument(unwrapped.expression) && isTrivialDelegationArgument(unwrapped.argumentExpression);
	}
	if (ts.isPrefixUnaryExpression(unwrapped)) {
		return isTrivialDelegationArgument(unwrapped.operand);
	}
	return false;
}

export function isPrimitivePredicateMethodCall(callExpression: ts.CallExpression): boolean {
	const target = unwrapExpression(callExpression.expression);
	if (!ts.isPropertyAccessExpression(target)) {
		return false;
	}
	switch (target.name.text) {
		case 'startsWith':
		case 'endsWith':
		case 'includes':
		case 'has':
			return true;
		default:
			return false;
	}
}

export function isNamedPrimitivePredicate(functionNode: ts.FunctionDeclaration | ts.MethodDeclaration, callExpression: ts.CallExpression): boolean {
	return isPredicateFunctionName(functionNode.name?.getText()) && isPrimitivePredicateMethodCall(callExpression);
}

export function isDirectMutationReceiver(expression: ts.Expression): boolean {
	let current = expression;
	while (ts.isParenthesizedExpression(current)) {
		current = current.expression;
	}
	if (ts.isIdentifier(current) || current.kind === ts.SyntaxKind.ThisKeyword) {
		return true;
	}
	if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
		return isDirectMutationReceiver(current.expression);
	}
	return false;
}

export function isDirectMutationCallExpression(callExpression: ts.CallExpression): boolean {
	if (!ts.isPropertyAccessExpression(callExpression.expression)) {
		return false;
	}
	if (!DIRECT_MUTATION_METHOD_NAMES.has(callExpression.expression.name.text)) {
		return false;
	}
	return isDirectMutationReceiver(callExpression.expression.expression);
}
