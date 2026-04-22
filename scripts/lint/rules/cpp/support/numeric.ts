import { type FunctionInfo } from '../../../../../src/bmsx/language/cpp/syntax/declarations';
import { cppCallTarget, cppRangeIsOrderingComparisonWithIdentifierAndNumericLiteral, cppStatementOrBlockAssignsIdentifier, cppStatementOrBlockEnd, findAccessChainStart, findPreviousDelimiter, findTopLevelOperator, findTopLevelSemicolon, isExpressionScanBoundary, previousIdentifier } from '../../../../../src/bmsx/language/cpp/syntax/syntax';
import { type Token } from '../../../../../src/bmsx/language/cpp/syntax/tokens';
import { type AnalysisRegion, lineInAnalysisRegion } from '../../../../analysis/lint_suppressions';
import { NUMERIC_DEFENSIVE_CALLS } from './ast';
import { isSemanticFloorDivisionCall } from './semantic';

export const HOT_PATH_TEMPORARY_TYPES = new Set([
	'std::function',
	'std::map',
	'std::optional',
	'std::string',
	'std::unordered_map',
	'std::vector',
]);

export function rangeContainsNestedNumericSanitization(tokens: readonly Token[], pairs: readonly number[], start: number, end: number): boolean {
	const activeCalls: number[] = [];
	for (let index = start; index < end; index += 1) {
		while (activeCalls.length > 0 && activeCalls[activeCalls.length - 1] <= index) {
			activeCalls.pop();
		}
		if (tokens[index].text !== '(' || pairs[index] < 0 || pairs[index] > end) {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (!isNumericSanitizationCall(tokens, index, target)) {
			continue;
		}
		if (activeCalls.length > 0) {
			return true;
		}
		activeCalls.push(pairs[index]);
	}
	return false;
}

export function isHotPathFunction(info: FunctionInfo, regions: readonly AnalysisRegion[], tokens: readonly Token[]): boolean {
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

export function isNumericLimitsMemberCall(tokens: readonly Token[], openParen: number): boolean {
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
		if (isExpressionScanBoundary(text)) {
			return false;
		}
		if (text === 'numeric_limits') {
			return true;
		}
	}
	return false;
}

export function isNumericSanitizationCall(tokens: readonly Token[], openParen: number, target: string | null): boolean {
	return target !== null && NUMERIC_DEFENSIVE_CALLS.has(target) && !isNumericLimitsMemberCall(tokens, openParen);
}

function isNumericRoundingSanitizationCall(tokens: readonly Token[], openParen: number, target: string | null): boolean {
	if (!isNumericSanitizationCall(tokens, openParen, target)) {
		return false;
	}
	switch (target) {
		case 'ceil':
		case 'floor':
		case 'round':
		case 'std::ceil':
		case 'std::floor':
		case 'std::round':
		case 'std::trunc':
		case 'trunc':
			return true;
		default:
			return false;
	}
}

export function lineAllowsNumericSanitization(regions: readonly AnalysisRegion[], line: number): boolean {
	return lineInAnalysisRegion(regions, 'numeric-sanitization-acceptable', line)
		|| lineInAnalysisRegion(regions, 'value-or-boundary', line);
}

export function shouldReportHotPathNumericSanitization(tokens: readonly Token[], pairs: readonly number[], regions: readonly AnalysisRegion[], openParen: number, target: string | null, bodyEnd: number): boolean {
	if (!isNumericSanitizationCall(tokens, openParen, target)) {
		return false;
	}
	if (lineAllowsNumericSanitization(regions, tokens[openParen].line)) {
		return false;
	}
	if (isSemanticFloorDivisionCall(tokens, pairs, openParen, target)) {
		return false;
	}
	const callStart = findAccessChainStart(tokens, openParen - 1);
	const callEnd = pairs[openParen] + 1;
	return rangeContainsNestedNumericSanitization(tokens, pairs, callStart, callEnd)
		|| isSplitRoundingThenBoundsCheck(tokens, pairs, openParen, target, bodyEnd);
}

export function isSplitRoundingThenBoundsCheck(tokens: readonly Token[], pairs: readonly number[], openParen: number, target: string | null, bodyEnd: number): boolean {
	if (!isNumericRoundingSanitizationCall(tokens, openParen, target)) {
		return false;
	}
	const statementStart = findPreviousDelimiter(tokens, openParen) + 1;
	const statementEnd = findTopLevelSemicolon(tokens, statementStart, bodyEnd);
	if (statementEnd < 0 || openParen >= statementEnd) {
		return false;
	}
	const initializerIndex = findTopLevelOperator(tokens, statementStart, statementEnd, '=');
	if (initializerIndex < 0 || openParen <= initializerIndex) {
		return false;
	}
	const nameIndex = previousIdentifier(tokens, initializerIndex);
	if (nameIndex < statementStart) {
		return false;
	}
	const next = statementEnd + 1;
	if (tokens[next]?.text !== 'if' || tokens[next + 1]?.text !== '(') {
		return false;
	}
	const conditionOpen = next + 1;
	const conditionEnd = pairs[conditionOpen];
	if (conditionEnd < 0 || conditionEnd >= bodyEnd) {
		return false;
	}
	const name = tokens[nameIndex].text;
	if (!cppRangeIsOrderingComparisonWithIdentifierAndNumericLiteral(tokens, pairs, conditionOpen + 1, conditionEnd, name)) {
		return false;
	}
	return ifThenOrElseAssignsName(tokens, pairs, conditionEnd + 1, bodyEnd, name);
}

function ifThenOrElseAssignsName(tokens: readonly Token[], pairs: readonly number[], start: number, end: number, name: string): boolean {
	const thenEnd = cppStatementOrBlockEnd(tokens, pairs, start, end);
	if (thenEnd < 0) {
		return false;
	}
	if (cppStatementOrBlockAssignsIdentifier(tokens, start, thenEnd, name)) {
		return true;
	}
	const elseIndex = thenEnd + 1;
	return tokens[elseIndex]?.text === 'else'
		&& cppStatementOrBlockAssignsIdentifier(tokens, elseIndex + 1, cppStatementOrBlockEnd(tokens, pairs, elseIndex + 1, end), name);
}
