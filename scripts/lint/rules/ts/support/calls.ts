import ts from 'typescript';
import { getExpressionText, unwrapExpression } from './ast';

export function isLookupCallExpression(node: ts.Expression): boolean {
	const unwrapped = unwrapExpression(node);
	return ts.isCallExpression(unwrapped)
		&& ts.isPropertyAccessExpression(unwrapped.expression)
		&& unwrapped.expression.name.text === 'get';
}

export function getCallTargetLeafName(expression: ts.Expression): string | null {
	const unwrapped = unwrapExpression(expression);
	if (ts.isIdentifier(unwrapped)) {
		return unwrapped.text;
	}
	if (ts.isPropertyAccessExpression(unwrapped)) {
		return unwrapped.name.text;
	}
	if (ts.isElementAccessExpression(unwrapped)) {
		const argument = unwrapExpression(unwrapped.argumentExpression);
		if (ts.isStringLiteralLike(argument)) {
			return argument.text;
		}
	}
	return getExpressionText(unwrapped);
}

export function hasQuestionDotToken(node: ts.Node): boolean {
	return (node as { questionDotToken?: ts.QuestionDotToken }).questionDotToken !== undefined;
}

export function callTargetText(node: ts.CallExpression | ts.NewExpression): string | null {
	const expression = ts.isCallExpression(node) ? node.expression : node.expression;
	return expression ? getExpressionText(expression) : null;
}
