import ts from 'typescript';
import { isExpressionChildOfLargerExpression, unwrapExpression } from './ast';
import { callTargetText } from './calls';
import { normalizedAstFingerprint } from './declarations';
import { isNumericDefensiveCall } from './numeric';
import { SemanticBodyCallSignature } from './types';

export const SEMANTIC_NORMALIZATION_CALL_SUFFIXES = [
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

export const SEMANTIC_NORMALIZATION_CALL_TARGETS = new Set([
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

export const SEMANTIC_REPEATED_EXPRESSION_MIN_COUNT = 2;

export function isSemanticFloorDivisionCall(node: ts.CallExpression): boolean {
	if (callTargetText(node) !== 'Math.floor' || node.arguments.length !== 1) {
		return false;
	}
	const argument = unwrapExpression(node.arguments[0]);
	return ts.isBinaryExpression(argument) && argument.operatorToken.kind === ts.SyntaxKind.SlashToken;
}

export function isSemanticNormalizationCallTarget(target: string): boolean {
	if (SEMANTIC_NORMALIZATION_CALL_TARGETS.has(target)) {
		return true;
	}
	for (let index = 0; index < SEMANTIC_NORMALIZATION_CALL_SUFFIXES.length; index += 1) {
		if (target.endsWith(SEMANTIC_NORMALIZATION_CALL_SUFFIXES[index])) {
			return true;
		}
	}
	return false;
}

export function semanticNormalizationFamily(target: string): string | null {
	if (target === 'Number.isFinite') {
		return 'numeric:finite';
	}
	if (target === 'Math.max' || target === 'Math.min' || target === 'clamp') {
		return 'numeric:bounds';
	}
	if (target === 'Math.ceil' || target === 'Math.floor' || target === 'Math.round' || target === 'Math.trunc') {
		return 'numeric:rounding';
	}
	if (target === 'replace' || target === 'replaceAll' || target.endsWith('.replace') || target.endsWith('.replaceAll')) {
		return 'text:replace';
	}
	if (target === 'normalize' || target.endsWith('.normalize')) {
		return 'text:normalize';
	}
	if (
		target === 'startsWith'
		|| target === 'endsWith'
		|| target === 'includes'
		|| target === 'indexOf'
		|| target === 'lastIndexOf'
		|| target.endsWith('.startsWith')
		|| target.endsWith('.endsWith')
		|| target.endsWith('.includes')
		|| target.endsWith('.indexOf')
		|| target.endsWith('.lastIndexOf')
	) {
		return 'text:lookup';
	}
	if (target === 'trim' || target.endsWith('.trim') || target.endsWith('.trimStart') || target.endsWith('.trimEnd')) {
		return 'text:trim';
	}
	if (
		target === 'toLowerCase'
		|| target === 'toUpperCase'
		|| target === 'toLocaleLowerCase'
		|| target === 'toLocaleUpperCase'
		|| target.endsWith('.toLowerCase')
		|| target.endsWith('.toUpperCase')
		|| target.endsWith('.toLocaleLowerCase')
		|| target.endsWith('.toLocaleUpperCase')
	) {
		return 'text:case';
	}
	if (
		target === 'join'
		|| target === 'split'
		|| target === 'slice'
		|| target === 'substr'
		|| target === 'substring'
		|| target === 'padStart'
		|| target === 'padEnd'
		|| target.endsWith('.join')
		|| target.endsWith('.split')
		|| target.endsWith('.slice')
		|| target.endsWith('.substr')
		|| target.endsWith('.substring')
		|| target.endsWith('.padStart')
		|| target.endsWith('.padEnd')
	) {
		return target === 'padStart' || target === 'padEnd' || target.endsWith('.padStart') || target.endsWith('.padEnd')
			? 'text:padding'
			: 'text:segment';
	}
	return null;
}

export function semanticOperationName(target: string): string {
	if (target.startsWith('Math.')) {
		return target;
	}
	for (let index = 0; index < SEMANTIC_NORMALIZATION_CALL_SUFFIXES.length; index += 1) {
		const suffix = SEMANTIC_NORMALIZATION_CALL_SUFFIXES[index];
		if (target.endsWith(suffix)) {
			return suffix.startsWith('.') ? suffix.slice(1) : suffix;
		}
	}
	const dotIndex = target.lastIndexOf('.');
	return dotIndex >= 0 ? target.slice(dotIndex + 1) : target;
}

export function isSemanticValidationPredicateTarget(target: string): boolean {
	return target === 'Number.isFinite';
}

export function semanticSignatureLabel(signature: string): string {
	const separator = signature.indexOf('|');
	return (separator >= 0 ? signature.slice(0, separator) : signature).replace(':', ' ');
}

export function isSemanticBodySignatureFamily(family: string): boolean {
	return family.startsWith('text:');
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

export function collectSemanticBodySignatures(node: ts.Node): string[] {
	const callsByFamily = new Map<string, { calls: Map<string, number>; literalAnchorCount: number }>();
	const visit = (current: ts.Node): void => {
		if (ts.isCallExpression(current)) {
			const target = callTargetText(current);
			if (target !== null && (isSemanticNormalizationCallTarget(target) || isNumericDefensiveCall(current))) {
				const family = semanticNormalizationFamily(target);
				if (family !== null && isSemanticBodySignatureFamily(family)) {
					let group = callsByFamily.get(family);
					if (group === undefined) {
						group = { calls: new Map<string, number>(), literalAnchorCount: 0 };
						callsByFamily.set(family, group);
					}
					const signature = semanticBodyCallSignature(current, target);
					group.calls.set(signature.key, (group.calls.get(signature.key) ?? 0) + 1);
					if (signature.hasLiteralAnchor) {
						group.literalAnchorCount += 1;
					}
				}
			}
		}
		ts.forEachChild(current, visit);
	};
	visit(node);
	const signatures: string[] = [];
	for (const [family, group] of callsByFamily) {
		let count = 0;
		const parts: string[] = [];
		for (const [operation, operationCount] of group.calls) {
			count += operationCount;
			parts.push(`${operation}x${operationCount}`);
		}
		if (count < 2 || group.literalAnchorCount === 0) {
			continue;
		}
		parts.sort((left, right) => left.localeCompare(right));
		signatures.push(`${family}|${parts.join(',')}`);
	}
	signatures.sort((left, right) => left.localeCompare(right));
	return signatures;
}

export function isNestedInsideSemanticCall(node: ts.Expression, parent: ts.Node | undefined): boolean {
	let current = parent;
	while (current !== undefined && ts.isParenthesizedExpression(current)) {
		current = current.parent;
	}
	if (current === undefined) {
		return false;
	}
	if (!ts.isCallExpression(current) && !ts.isNewExpression(current)) {
		return false;
	}
	return current.expression !== node;
}

export function semanticRepeatedExpressionFingerprint(node: ts.Expression, sourceFile: ts.SourceFile, parent: ts.Node | undefined): string | null {
	if (isExpressionChildOfLargerExpression(node, parent)) {
		return null;
	}
	if (!ts.isCallExpression(node)) {
		return null;
	}
	if (isNestedInsideSemanticCall(node, parent)) {
		return null;
	}
	const target = callTargetText(node);
	if (target === null || (!isSemanticNormalizationCallTarget(target) && !isNumericDefensiveCall(node))) {
		return null;
	}
	if (isSemanticValidationPredicateTarget(target)) {
		return null;
	}
	const text = node.getText(sourceFile).replace(/\s+/g, ' ');
	if (text.length < 24) {
		return null;
	}
	if (text.startsWith('this.')) {
		return null;
	}
	const family = semanticNormalizationFamily(target);
	if (family !== null && family.startsWith('numeric:')) {
		return `${target}|${node.arguments.map(arg => arg.getText(sourceFile).replace(/\s+/g, ' ')).join(',')}`;
	}
	return `${target}|${normalizedAstFingerprint(node)}`;
}

export function isSemanticPredicateFunctionName(name: string | undefined): boolean {
	return name !== undefined && /^(is|has|can|should)[A-Z]/.test(name);
}
