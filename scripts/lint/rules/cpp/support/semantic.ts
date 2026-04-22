import { cppCallTarget, findCppAccessChainStart, splitCppArgumentRanges } from '../../../../../src/bmsx/language/cpp/syntax/syntax';
import { type CppToken } from '../../../../../src/bmsx/language/cpp/syntax/tokens';
import { isCppNumericSanitizationCall } from './numeric';

export const SEMANTIC_NORMALIZATION_WRAPPER_SUFFIXES = [
	'.join',
	'.contains',
	'.ends_with',
	'.starts_with',
	'.replace',
	'.replaceAll',
	'.trim',
	'.trimStart',
	'.trimEnd',
	'.split',
	'.substr',
	'.substring',
	'.normalize',
	'.tolower',
	'.toupper',
	'::join',
	'::contains',
	'::ends_with',
	'::starts_with',
	'::replace',
	'::replaceAll',
	'::trim',
	'::trimStart',
	'::trimEnd',
	'::split',
	'::substr',
	'::substring',
	'::normalize',
	'::tolower',
	'::toupper',
];

export const SEMANTIC_NORMALIZATION_WRAPPER_TARGETS = new Set([
	'clamp',
	'ceil',
	'floor',
	'isfinite',
	'max',
	'min',
	'replace',
	'replaceAll',
	'split',
	'substr',
	'substring',
	'join',
	'contains',
	'normalize',
	'round',
	'starts_with',
	'ends_with',
	'std::clamp',
	'std::ceil',
	'std::floor',
	'std::isfinite',
	'std::max',
	'std::min',
	'std::replace',
	'std::replace_all',
	'std::trim',
	'trimStart',
	'trimEnd',
	'std::round',
	'std::tolower',
	'std::toupper',
	'std::trunc',
	'tolower',
	'toupper',
	'trim',
	'trunc',
]);

export const CPP_SEMANTIC_REPEATED_EXPRESSION_MIN_COUNT = 2;

export function isSemanticNormalizationWrapperTarget(target: string): boolean {
	if (SEMANTIC_NORMALIZATION_WRAPPER_TARGETS.has(target)) {
		return true;
	}
	for (let index = 0; index < SEMANTIC_NORMALIZATION_WRAPPER_SUFFIXES.length; index += 1) {
		if (target.endsWith(SEMANTIC_NORMALIZATION_WRAPPER_SUFFIXES[index])) {
			return true;
		}
	}
	return false;
}

export function isSemanticValidationPredicateTarget(target: string): boolean {
	return target === 'isfinite' || target === 'std::isfinite';
}

export function semanticNormalizationFamily(target: string): string | null {
	if (target === 'clamp' || target === 'max' || target === 'min' || target === 'std::clamp' || target === 'std::max' || target === 'std::min') {
		return 'numeric:bounds';
	}
	if (
		target === 'ceil'
		|| target === 'floor'
		|| target === 'round'
		|| target === 'trunc'
		|| target === 'std::ceil'
		|| target === 'std::floor'
		|| target === 'std::round'
		|| target === 'std::trunc'
	) {
		return 'numeric:rounding';
	}
	if (target === 'isfinite' || target === 'std::isfinite') {
		return 'numeric:finite';
	}
	if (
		target === 'replace'
		|| target === 'replaceAll'
		|| target === 'std::replace'
		|| target === 'std::replace_all'
		|| target.endsWith('.replace')
		|| target.endsWith('::replace')
		|| target.endsWith('.replaceAll')
		|| target.endsWith('::replaceAll')
	) {
		return 'text:replace';
	}
	if (target === 'normalize' || target === 'std::normalize' || target.endsWith('.normalize') || target.endsWith('::normalize')) {
		return 'text:normalize';
	}
	if (
		target === 'trim'
		|| target === 'std::trim'
		|| target === 'trimStart'
		|| target === 'trimEnd'
		|| target === 'std::trimStart'
		|| target === 'std::trimEnd'
		|| target.endsWith('.trim')
		|| target.endsWith('::trim')
		|| target.endsWith('.trimStart')
		|| target.endsWith('::trimStart')
		|| target.endsWith('.trimEnd')
		|| target.endsWith('::trimEnd')
	) {
		return 'text:trim';
	}
	if (
		target === 'tolower'
		|| target === 'toupper'
		|| target === 'std::tolower'
		|| target === 'std::toupper'
		|| target.endsWith('.tolower')
		|| target.endsWith('::tolower')
		|| target.endsWith('.toupper')
		|| target.endsWith('::toupper')
		|| target.endsWith('.toLower')
		|| target.endsWith('::toLower')
		|| target.endsWith('.toUpper')
		|| target.endsWith('::toUpper')
	) {
		return 'text:case';
	}
	if (
		target === 'join'
		|| target === 'split'
		|| target === 'substr'
		|| target === 'substring'
		|| target.endsWith('.join')
		|| target.endsWith('::join')
		|| target.endsWith('.split')
		|| target.endsWith('::split')
		|| target.endsWith('.substr')
		|| target.endsWith('::substr')
		|| target.endsWith('.substring')
		|| target.endsWith('::substring')
	) {
		return 'text:segment';
	}
	if (
		target === 'contains'
		|| target === 'starts_with'
		|| target === 'ends_with'
		|| target.endsWith('.contains')
		|| target.endsWith('::contains')
		|| target.endsWith('.starts_with')
		|| target.endsWith('::starts_with')
		|| target.endsWith('.ends_with')
		|| target.endsWith('::ends_with')
	) {
		return 'text:lookup';
	}
	return null;
}

export function semanticOperationName(target: string): string {
	const namespaceIndex = target.lastIndexOf('::');
	const dotIndex = target.lastIndexOf('.');
	const separatorIndex = Math.max(namespaceIndex, dotIndex);
	if (separatorIndex < 0) {
		return target;
	}
	return target.slice(separatorIndex + (separatorIndex === namespaceIndex ? 2 : 1));
}

export function collectSemanticBodySignatures(tokens: readonly CppToken[], pairs: readonly number[], start: number, end: number): string[] {
	const callsByFamily = new Map<string, Map<string, number>>();
	for (let index = start; index < end; index += 1) {
		if (tokens[index].text !== '(' || pairs[index] < 0 || pairs[index] > end) {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (target === null || (!isCppNumericSanitizationCall(tokens, index, target) && !isSemanticNormalizationWrapperTarget(target))) {
			continue;
		}
		const family = semanticNormalizationFamily(target);
		if (family !== null && isSemanticBodySignatureFamily(family)) {
			let calls = callsByFamily.get(family);
			if (calls === undefined) {
				calls = new Map<string, number>();
				callsByFamily.set(family, calls);
			}
			const operation = semanticOperationName(target);
			calls.set(operation, (calls.get(operation) ?? 0) + 1);
		}
	}
	const signatures: string[] = [];
	for (const [family, calls] of callsByFamily) {
		let count = 0;
		const parts: string[] = [];
		for (const [operation, operationCount] of calls) {
			count += operationCount;
			parts.push(`${operation}x${operationCount}`);
		}
		if (count < 2) {
			continue;
		}
		parts.sort((left, right) => left.localeCompare(right));
		signatures.push(`${family}|${parts.join(',')}`);
	}
	signatures.sort((left, right) => left.localeCompare(right));
	return signatures;
}

export function isSemanticBodySignatureFamily(family: string): boolean {
	return family.startsWith('text:');
}

export function collectSemanticNormalizationCallSignatures(tokens: readonly CppToken[], pairs: readonly number[], start: number, end: number): string[] {
	const signatures: string[] = [];
	for (let index = start; index < end; index += 1) {
		if (tokens[index].text !== '(' || pairs[index] < 0 || pairs[index] > end) {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (target !== null && (isCppNumericSanitizationCall(tokens, index, target) || isSemanticNormalizationWrapperTarget(target))) {
			const callEnd = pairs[index] + 1;
			signatures.push(`${target}:${semanticCppExpressionFingerprint(target, tokens, findCppAccessChainStart(tokens, index - 1), callEnd)}`);
		}
	}
	return signatures;
}

export function isCppSemanticFloorDivisionCall(tokens: readonly CppToken[], pairs: readonly number[], openParen: number, target: string | null): boolean {
	if (target !== 'floor' && target !== 'std::floor') {
		return false;
	}
	const closeParen = pairs[openParen];
	if (closeParen < 0) {
		return false;
	}
	const args = splitCppArgumentRanges(tokens, openParen + 1, closeParen);
	if (args.length !== 1) {
		return false;
	}
	for (let index = args[0][0]; index < args[0][1]; index += 1) {
		if (tokens[index].text === '/') {
			return true;
		}
	}
	return false;
}

export function semanticCppExpressionFingerprint(target: string, tokens: readonly CppToken[], start: number, end: number): string {
	let text = `${target}|`;
	for (let index = start; index < end; index += 1) {
		const token = tokens[index];
		if (token.kind === 'id') {
			text += 'Identifier|';
		} else if (token.kind === 'string' || token.kind === 'char') {
			text += 'StringLiteral|';
		} else if (token.kind === 'number') {
			text += 'NumericLiteral|';
		} else {
			text += token.text;
			text += '|';
		}
	}
	return text;
}

export function cppSemanticRepeatedExpressionMinCount(target: string): number {
	const family = semanticNormalizationFamily(target);
	if (family === 'numeric:bounds' || family === 'numeric:rounding') {
		return 3;
	}
	return CPP_SEMANTIC_REPEATED_EXPRESSION_MIN_COUNT;
}
