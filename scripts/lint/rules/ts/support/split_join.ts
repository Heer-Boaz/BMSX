import ts from 'typescript';
import { getCallTargetLeafName, unwrapExpression } from '../../../../../src/bmsx/language/ts/ast/expressions';

export function splitJoinDelimiterFingerprint(expression: ts.Expression | undefined): string | null {
	if (expression === undefined) {
		return null;
	}
	const unwrapped = unwrapExpression(expression);
	if (ts.isStringLiteralLike(unwrapped)) {
		switch (unwrapped.text) {
			case '\n':
			case '\r':
			case '\r\n':
				return 'linebreak';
			default:
				return `text:${unwrapped.text}`;
		}
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
	switch (getCallTargetLeaf(target)) {
		case 'split':
		case 'splitText':
		case 'splitLines':
			return true;
		default:
			return false;
	}
}

export function isJoinLikeCallTarget(target: string): boolean {
	switch (getCallTargetLeaf(target)) {
		case 'join':
		case 'joinLines':
			return true;
		default:
			return false;
	}
}

function getCallTargetLeaf(target: string): string {
	const dotIndex = target.lastIndexOf('.');
	return dotIndex === -1 ? target : target.slice(dotIndex + 1);
}
