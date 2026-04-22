import ts from 'typescript';
import { unwrapExpression } from './ast';
import { getCallTargetLeafName } from './calls';

export function splitJoinDelimiterFingerprint(expression: ts.Expression | undefined): string | null {
	if (expression === undefined) {
		return null;
	}
	const unwrapped = unwrapExpression(expression);
	if (ts.isStringLiteralLike(unwrapped)) {
		if (unwrapped.text === '\n' || unwrapped.text === '\r' || unwrapped.text === '\r\n') {
			return 'linebreak';
		}
		return `text:${unwrapped.text}`;
	}
	if (unwrapped.kind === ts.SyntaxKind.RegularExpressionLiteral) {
		const text = unwrapped.getText();
		if (text.includes('\\n')) {
			return 'linebreak';
		}
		return `regex:${text}`;
	}
	return null;
}

export function findSplitLikeDelimiterInExpression(expression: ts.Expression): string | null {
	const unwrapped = unwrapExpression(expression);
	if (ts.isCallExpression(unwrapped)) {
		const target = getCallTargetLeafName(unwrapped.expression);
		if (target !== null && isSplitLikeCallTarget(target)) {
			return splitJoinDelimiterFingerprint(unwrapped.arguments[0]);
		}
		return findSplitLikeDelimiterInExpression(unwrapped.expression);
	}
	if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
		return findSplitLikeDelimiterInExpression(unwrapped.expression);
	}
	return null;
}

export function isSplitLikeCallTarget(target: string): boolean {
	return target === 'split'
		|| target === 'splitText'
		|| target === 'splitLines'
		|| target.endsWith('.split')
		|| target.endsWith('.splitText')
		|| target.endsWith('.splitLines');
}

export function isJoinLikeCallTarget(target: string): boolean {
	return target === 'join'
		|| target === 'joinLines'
		|| target.endsWith('.join')
		|| target.endsWith('.joinLines');
}
