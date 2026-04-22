import { type CppFunctionInfo } from '../../../../../src/bmsx/language/cpp/syntax/declarations';
import { cppCallTarget, findCppAccessChainStart } from '../../../../../src/bmsx/language/cpp/syntax/syntax';
import { type CppToken } from '../../../../../src/bmsx/language/cpp/syntax/tokens';
import { type AnalysisRegion, lineInAnalysisRegion } from '../../../../analysis/lint_suppressions';
import { CPP_BOUNDED_NUMERIC_HINT_WORDS, CPP_SINGLE_LINE_WRAPPER_NAME_WORDS, NUMERIC_BOUNDARY_FUNCTION_NAME_WORDS, NUMERIC_DEFENSIVE_CALLS, cppWordSegments } from './ast';
import { isCppSemanticFloorDivisionCall } from './semantic';

export const HOT_PATH_FUNCTION_NAME_WORDS = new Set([
	'advance',
	'begin',
	'consume',
	'draw',
	'execute',
	'flush',
	'frame',
	'halt',
	'irq',
	'poll',
	'render',
	'run',
	'schedule',
	'service',
	'sync',
	'tick',
	'timer',
	'update',
	'vblank',
]);

export const HOT_PATH_TEMPORARY_TYPES = new Set([
	'std::function',
	'std::map',
	'std::optional',
	'std::string',
	'std::unordered_map',
	'std::vector',
]);

export function containsCppBoundedNumericHint(tokens: readonly CppToken[], start: number, end: number): boolean {
	for (let index = start; index < end; index += 1) {
		if (tokens[index].kind !== 'id') {
			continue;
		}
		const segments = cppWordSegments(tokens[index].text);
		for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
			if (CPP_BOUNDED_NUMERIC_HINT_WORDS.has(segments[segmentIndex])) {
				return true;
			}
		}
	}
	return false;
}

export function rangeContainsNestedCppNumericSanitization(tokens: readonly CppToken[], pairs: readonly number[], start: number, end: number): boolean {
	const activeCalls: number[] = [];
	for (let index = start; index < end; index += 1) {
		while (activeCalls.length > 0 && activeCalls[activeCalls.length - 1] <= index) {
			activeCalls.pop();
		}
		if (tokens[index].text !== '(' || pairs[index] < 0 || pairs[index] > end) {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (!isCppNumericSanitizationCall(tokens, index, target)) {
			continue;
		}
		if (activeCalls.length > 0) {
			return true;
		}
		activeCalls.push(pairs[index]);
	}
	return false;
}

export function isHotPathFunction(info: CppFunctionInfo, regions: readonly AnalysisRegion[], tokens: readonly CppToken[]): boolean {
	if (!lineInAnalysisRegion(regions, 'hot-path', tokens[info.nameToken].line)) {
		return false;
	}
	if (info.context !== null && info.name === info.context) {
		return false;
	}
	if (info.name.startsWith('~')) {
		return false;
	}
	const segments = cppWordSegments(info.name);
	for (let index = 0; index < segments.length; index += 1) {
		if (HOT_PATH_FUNCTION_NAME_WORDS.has(segments[index])) {
			return true;
		}
	}
	return false;
}

export function isNumericBoundaryFunction(info: CppFunctionInfo): boolean {
	const segments = cppWordSegments(info.name);
	for (let index = 0; index < segments.length; index += 1) {
		if (NUMERIC_BOUNDARY_FUNCTION_NAME_WORDS.has(segments[index])) {
			return true;
		}
	}
	return false;
}

export function isCppNumericLimitsMemberCall(tokens: readonly CppToken[], openParen: number): boolean {
	const nameIndex = openParen - 1;
	if (nameIndex < 2) {
		return false;
	}
	const name = tokens[nameIndex].text;
	if (name !== 'min' && name !== 'max' && name !== 'lowest') {
		return false;
	}
	if (tokens[nameIndex - 1].text !== '::') {
		return false;
	}
	for (let index = nameIndex - 2; index >= 0; index -= 1) {
		const text = tokens[index].text;
		if (text === ';' || text === '{' || text === '}' || text === '(' || text === ',' || text === '=') {
			return false;
		}
		if (text === 'numeric_limits') {
			return true;
		}
	}
	return false;
}

export function isCppNumericSanitizationCall(tokens: readonly CppToken[], openParen: number, target: string | null): boolean {
	return target !== null && NUMERIC_DEFENSIVE_CALLS.has(target) && !isCppNumericLimitsMemberCall(tokens, openParen);
}

export function shouldReportCppHotPathNumericSanitization(tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, openParen: number, target: string | null): boolean {
	if (!isCppNumericSanitizationCall(tokens, openParen, target)) {
		return false;
	}
	if (isCppSemanticFloorDivisionCall(tokens, pairs, openParen, target)) {
		return false;
	}
	if (isNumericBoundaryFunction(info)) {
		return false;
	}
	const callStart = findCppAccessChainStart(tokens, openParen - 1);
	const callEnd = pairs[openParen] + 1;
	return rangeContainsNestedCppNumericSanitization(tokens, pairs, callStart, callEnd) || containsCppBoundedNumericHint(tokens, callStart, callEnd);
}

export function isCppBoundaryStyleWrapperName(name: string): boolean {
	const words = name.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z0-9])/g);
	if (words === null) {
		return CPP_SINGLE_LINE_WRAPPER_NAME_WORDS.has(name.toLowerCase());
	}
	for (let index = 0; index < words.length; index += 1) {
		if (CPP_SINGLE_LINE_WRAPPER_NAME_WORDS.has(words[index].toLowerCase())) {
			return true;
		}
	}
	const lower = name.toLowerCase();
	return lower.endsWith('fault') || lower.endsWith('thunk');
}
