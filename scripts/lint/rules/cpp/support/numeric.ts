import { type CppFunctionInfo } from '../../../../../src/bmsx/language/cpp/syntax/declarations';
import { cppCallTarget, findCppAccessChainStart, isCppExpressionScanBoundary } from '../../../../../src/bmsx/language/cpp/syntax/syntax';
import { type CppToken } from '../../../../../src/bmsx/language/cpp/syntax/tokens';
import { type AnalysisRegion, lineInAnalysisRegion } from '../../../../analysis/lint_suppressions';
import { NUMERIC_DEFENSIVE_CALLS } from './ast';
import { isCppSemanticFloorDivisionCall } from './semantic';

export const HOT_PATH_TEMPORARY_TYPES = new Set([
	'std::function',
	'std::map',
	'std::optional',
	'std::string',
	'std::unordered_map',
	'std::vector',
]);

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
	if (info.context !== undefined && info.name === info.context) {
		return false;
	}
	if (info.name.startsWith('~')) {
		return false;
	}
	return true;
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
		if (isCppExpressionScanBoundary(text)) {
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

export function lineAllowsCppNumericSanitization(regions: readonly AnalysisRegion[], line: number): boolean {
	return lineInAnalysisRegion(regions, 'numeric-sanitization-acceptable', line)
		|| lineInAnalysisRegion(regions, 'value-or-boundary', line);
}

export function shouldReportCppHotPathNumericSanitization(tokens: readonly CppToken[], pairs: readonly number[], regions: readonly AnalysisRegion[], openParen: number, target: string | null): boolean {
	if (!isCppNumericSanitizationCall(tokens, openParen, target)) {
		return false;
	}
	if (lineAllowsCppNumericSanitization(regions, tokens[openParen].line)) {
		return false;
	}
	if (isCppSemanticFloorDivisionCall(tokens, pairs, openParen, target)) {
		return false;
	}
	const callStart = findCppAccessChainStart(tokens, openParen - 1);
	const callEnd = pairs[openParen] + 1;
	return rangeContainsNestedCppNumericSanitization(tokens, pairs, callStart, callEnd);
}
