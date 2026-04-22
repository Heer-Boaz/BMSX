import { cppAccessChainLeafName, cppCallTarget, findAccessChainStart, splitArgumentRanges } from '../../../../../src/bmsx/language/cpp/syntax/syntax';
import { type Token } from '../../../../../src/bmsx/language/cpp/syntax/tokens';
import { TEXT_SEMANTIC_SIGNATURE_PREFIX } from '../../common/semantic_signature';
import { isNumericSanitizationCall } from './numeric';

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
	return cppAccessChainLeafName(target) === 'isfinite';
}

export function semanticNormalizationFamily(target: string): string | null {
	switch (cppAccessChainLeafName(target)) {
		case 'clamp':
		case 'max':
		case 'min':
			return 'numeric:bounds';
		case 'ceil':
		case 'floor':
		case 'round':
		case 'trunc':
			return 'numeric:rounding';
		case 'isfinite':
			return 'numeric:finite';
		case 'replace':
		case 'replaceAll':
		case 'replace_all':
			return 'text:replace';
		case 'normalize':
			return 'text:normalize';
		case 'trim':
		case 'trimStart':
		case 'trimEnd':
			return 'text:trim';
		case 'tolower':
		case 'toupper':
		case 'toLower':
		case 'toUpper':
			return 'text:case';
		case 'join':
		case 'split':
		case 'substr':
		case 'substring':
			return 'text:segment';
		case 'contains':
		case 'starts_with':
		case 'ends_with':
			return 'text:lookup';
		default:
			return null;
	}
}

export function semanticOperationName(target: string): string {
	return cppAccessChainLeafName(target);
}

export function collectSemanticBodySignatures(tokens: readonly Token[], pairs: readonly number[], start: number, end: number): string[] {
	const callsByFamily = new Map<string, Map<string, number>>();
	for (let index = start; index < end; index += 1) {
		if (tokens[index].text !== '(' || pairs[index] < 0 || pairs[index] > end) {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (target === null || (!isNumericSanitizationCall(tokens, index, target) && !isSemanticNormalizationWrapperTarget(target))) {
			continue;
		}
		const family = semanticNormalizationFamily(target);
		if (family !== null && family.startsWith(TEXT_SEMANTIC_SIGNATURE_PREFIX)) {
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

export function collectSemanticNormalizationCallSignatures(tokens: readonly Token[], pairs: readonly number[], start: number, end: number): string[] {
	const signatures: string[] = [];
	for (let index = start; index < end; index += 1) {
		if (tokens[index].text !== '(' || pairs[index] < 0 || pairs[index] > end) {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (target !== null && (isNumericSanitizationCall(tokens, index, target) || isSemanticNormalizationWrapperTarget(target))) {
			const callEnd = pairs[index] + 1;
			signatures.push(`${target}:${semanticExpressionFingerprint(target, tokens, findAccessChainStart(tokens, index - 1), callEnd)}`);
		}
	}
	return signatures;
}

export function isSemanticFloorDivisionCall(tokens: readonly Token[], pairs: readonly number[], openParen: number, target: string | null): boolean {
	if (target !== 'floor' && target !== 'std::floor') {
		return false;
	}
	const closeParen = pairs[openParen];
	if (closeParen < 0) {
		return false;
	}
	const args = splitArgumentRanges(tokens, openParen + 1, closeParen);
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

export function semanticExpressionFingerprint(target: string, tokens: readonly Token[], start: number, end: number): string {
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
