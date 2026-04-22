import ts from 'typescript';
import { callTargetText, isExpressionChildOfLargerExpression } from '../../../../../src/bmsx/language/ts/ast/expressions';
import { isNumericSanitizerCall, isSemanticTransformTarget, isSemanticValidationPredicateTarget, semanticBodyCallSignature, semanticTransformFamily } from '../../../../../src/bmsx/language/ts/ast/semantic';
import { TEXT_SEMANTIC_SIGNATURE_PREFIX } from '../../common/semantic_signature';
import { normalizedAstFingerprint } from './declarations';

export const SEMANTIC_REPEATED_EXPRESSION_MIN_COUNT = 2;

export function semanticSignatureLabel(signature: string): string {
	const separator = signature.indexOf('|');
	return (separator >= 0 ? signature.slice(0, separator) : signature).replace(':', ' ');
}

export function collectSemanticBodySignatures(node: ts.Node): string[] {
	const callsByFamily = new Map<string, { calls: Map<string, number>; literalAnchorCount: number }>();
	const visit = (current: ts.Node): void => {
		if (ts.isCallExpression(current)) {
			const target = callTargetText(current);
			if (target !== null && (isSemanticTransformTarget(target) || isNumericSanitizerCall(current))) {
				const family = semanticTransformFamily(target);
				if (family !== null && family.startsWith(TEXT_SEMANTIC_SIGNATURE_PREFIX)) {
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
	if (target === null || (!isSemanticTransformTarget(target) && !isNumericSanitizerCall(node))) {
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
	const family = semanticTransformFamily(target);
	if (family !== null && family.startsWith('numeric:')) {
		return `${target}|${node.arguments.map(arg => arg.getText(sourceFile).replace(/\s+/g, ' ')).join(',')}`;
	}
	return `${target}|${normalizedAstFingerprint(node)}`;
}
