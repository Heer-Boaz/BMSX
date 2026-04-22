import ts from 'typescript';
import { callTargetText, unwrapExpression } from './expressions';

export type SemanticBodyCallSignature = {
	key: string;
	hasLiteralAnchor: boolean;
};

const SEMANTIC_TRANSFORM_CALL_SUFFIXES = [
	'.endsWith',
	'.includes',
	'.indexOf',
	'.lastIndexOf',
	'.normalize',
	'.padEnd',
	'.padStart',
	'.replace',
	'.replaceAll',
	'.slice',
	'.join',
	'.split',
	'.startsWith',
	'.substr',
	'.substring',
	'.trimEnd',
	'.trimStart',
	'.toLocaleLowerCase',
	'.toLocaleUpperCase',
	'.toLowerCase',
	'.toUpperCase',
	'.trim',
] as const;

const SEMANTIC_TRANSFORM_CALL_TARGETS = new Set([
	'Math.max',
	'Math.min',
	'Math.floor',
	'Math.round',
	'Math.ceil',
	'Math.trunc',
	'clamp',
	'replace',
	'replaceAll',
]);

function callTargetLeaf(target: string): string {
	const dotIndex = target.lastIndexOf('.');
	return dotIndex >= 0 ? target.slice(dotIndex + 1) : target;
}

export function isNumericSanitizerTarget(target: string | null): boolean {
	switch (target) {
		case 'Math.ceil':
		case 'Math.floor':
		case 'Math.max':
		case 'Math.min':
		case 'Math.round':
		case 'Math.trunc':
		case 'Number.isFinite':
		case 'clamp':
			return true;
		default:
			return false;
	}
}

export function isNumericSanitizerCall(node: ts.CallExpression): boolean {
	return isNumericSanitizerTarget(callTargetText(node));
}

export function isSemanticFloorDivisionCall(node: ts.CallExpression): boolean {
	if (callTargetText(node) !== 'Math.floor' || node.arguments.length !== 1) {
		return false;
	}
	const argument = unwrapExpression(node.arguments[0]);
	return ts.isBinaryExpression(argument) && argument.operatorToken.kind === ts.SyntaxKind.SlashToken;
}

export function isNumericContractSentinelExpression(node: ts.Expression): boolean {
	const expression = unwrapExpression(node);
	if (ts.isNumericLiteral(expression)) {
		return expression.text === '0' || expression.text === '1';
	}
	if (expression.kind === ts.SyntaxKind.NullKeyword || expression.kind === ts.SyntaxKind.UndefinedKeyword) {
		return true;
	}
	if (ts.isIdentifier(expression)) {
		return expression.text === 'undefined';
	}
	if (ts.isStringLiteral(expression)) {
		return expression.text === 'number';
	}
	return ts.isPropertyAccessExpression(expression)
		&& ts.isIdentifier(expression.expression)
		&& expression.expression.text === 'Number'
		&& expression.name.text === 'MAX_SAFE_INTEGER';
}

export function isSemanticTransformTarget(target: string): boolean {
	if (SEMANTIC_TRANSFORM_CALL_TARGETS.has(target)) {
		return true;
	}
	for (let index = 0; index < SEMANTIC_TRANSFORM_CALL_SUFFIXES.length; index += 1) {
		if (target.endsWith(SEMANTIC_TRANSFORM_CALL_SUFFIXES[index])) {
			return true;
		}
	}
	return false;
}

export function semanticTransformFamily(target: string): string | null {
	switch (target) {
		case 'Number.isFinite':
			return 'numeric:finite';
		case 'Math.max':
		case 'Math.min':
		case 'clamp':
			return 'numeric:bounds';
		case 'Math.ceil':
		case 'Math.floor':
		case 'Math.round':
		case 'Math.trunc':
			return 'numeric:rounding';
		default:
			return textTransformFamily(callTargetLeaf(target));
	}
}

function textTransformFamily(leaf: string): string | null {
	switch (leaf) {
		case 'replace':
		case 'replaceAll':
			return 'text:replace';
		case 'normalize':
			return 'text:normalize';
		case 'startsWith':
		case 'endsWith':
		case 'includes':
		case 'indexOf':
		case 'lastIndexOf':
			return 'text:lookup';
		case 'trim':
		case 'trimStart':
		case 'trimEnd':
			return 'text:trim';
		case 'toLowerCase':
		case 'toUpperCase':
		case 'toLocaleLowerCase':
		case 'toLocaleUpperCase':
			return 'text:case';
		case 'padStart':
		case 'padEnd':
			return 'text:padding';
		case 'join':
		case 'split':
		case 'slice':
		case 'substr':
		case 'substring':
			return 'text:segment';
		default:
			return null;
	}
}

export function semanticOperationName(target: string): string {
	if (target.startsWith('Math.')) {
		return target;
	}
	for (let index = 0; index < SEMANTIC_TRANSFORM_CALL_SUFFIXES.length; index += 1) {
		const suffix = SEMANTIC_TRANSFORM_CALL_SUFFIXES[index];
		if (target.endsWith(suffix)) {
			return suffix.startsWith('.') ? suffix.slice(1) : suffix;
		}
	}
	return callTargetLeaf(target);
}

export function isSemanticValidationPredicateTarget(target: string): boolean {
	return target === 'Number.isFinite';
}

export function semanticLiteralSignature(node: ts.Expression): string | null {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
		return JSON.stringify(node.text);
	}
	if (ts.isNumericLiteral(node)) {
		return node.text;
	}
	if (node.kind === ts.SyntaxKind.TrueKeyword) {
		return 'true';
	}
	if (node.kind === ts.SyntaxKind.FalseKeyword) {
		return 'false';
	}
	if (node.kind === ts.SyntaxKind.NullKeyword) {
		return 'null';
	}
	if (ts.isRegularExpressionLiteral(node)) {
		return node.getText();
	}
	if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
		return `${ts.SyntaxKind[node.operator]}${node.operand.text}`;
	}
	return null;
}

export function semanticBodyCallSignature(node: ts.CallExpression, target: string): SemanticBodyCallSignature {
	const args: string[] = [];
	let hasLiteralAnchor = false;
	for (let index = 0; index < node.arguments.length && index < 3; index += 1) {
		const literal = semanticLiteralSignature(node.arguments[index]);
		if (literal === null) {
			args.push('*');
		} else {
			hasLiteralAnchor = true;
			args.push(literal);
		}
	}
	return {
		key: `${semanticOperationName(target)}(${args.join(',')})`,
		hasLiteralAnchor,
	};
}
