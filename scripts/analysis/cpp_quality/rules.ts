import {
	localConstPatternRule,
	singleUseLocalPatternRule,
} from '../../lint/rules/common';
import {
	hotPathClosureArgumentPatternRule,
	hotPathObjectLiteralPatternRule,
	numericDefensiveSanitizationPatternRule,
	redundantNumericSanitizationPatternRule,
	semanticRepeatedExpressionPatternRule,
} from '../../lint/rules/code_quality';

import type { CppFunctionInfo } from '../../../src/bmsx/language/cpp/syntax/declarations';
import type { CppLintIssue, CppNormalizedBodyInfo } from './diagnostics';
import { pushLintIssue } from './diagnostics';
import {
	collectCppStatementRanges,
	cppCallTarget,
	findCppAccessChainStart,
	findNextCppTokenText,
	hasCppDeclarationPrefix,
	isCppAssignmentOperator,
	isCppFunctionDeclaratorParen,
	previousCppIdentifier,
	splitCppArgumentRanges,
	trimmedCppExpressionText,
} from '../../../src/bmsx/language/cpp/syntax/syntax';
import type { CppToken } from '../../../src/bmsx/language/cpp/syntax/tokens';
import { cppTokenText, normalizedCppTokenText } from '../../../src/bmsx/language/cpp/syntax/tokens';
import { lineInAnalysisRegion, type AnalysisRegion } from '../lint_suppressions';
import { noteQualityLedger, type QualityLedger } from '../quality_ledger';

const CPP_SINGLE_LINE_WRAPPER_NAME_WORDS: ReadonlySet<string> = new Set([
	'acquire',
	'add',
	'append',
	'apply',
	'attach',
	'begin',
	'bind',
	'build',
	'call',
	'capture',
	'change',
	'clear',
	'copy',
	'configure',
	'create',
	'count',
	'decode',
	'consume',
	'destroy',
	'disable',
	'dispose',
	'detach',
	'encode',
	'enable',
	'end',
	'ensure',
	'focus',
	'format',
	'get',
	'has',
	'ident',
	'init',
	'install',
	'emplace',
	'index',
	'load',
	'make',
	'on',
	'pending',
	'open',
	'pixels',
	'pop',
	'push',
	'read',
	'release',
	'refresh',
	'register',
	'remove',
	'replace',
	'render',
	'reset',
	'resolve',
	'resume',
	'resize',
	'snapshot',
	'save',
	'set',
	'setup',
	'size',
	'state',
	'stop',
	'suspend',
	'submit',
	'switch',
	'reserve',
	'shutdown',
	'start',
	'to',
	'try',
	'update',
	'use',
	'value',
	'write',
	'with',
	'blur',
]);

type CppLocalBinding = {
	name: string;
	nameToken: number;
	typeText: string;
	line: number;
	column: number;
	isConst: boolean;
	isReference: boolean;
	isPointer: boolean;
	hasInitializer: boolean;
	readCount: number;
	writeCount: number;
	memberAccessCount: number;
	initializerTextLength: number;
	isSimpleAliasInitializer: boolean;
	firstReadLeftText: string | null;
	firstReadRightText: string | null;
};

export type CppFunctionUsageInfo = {
	totalCounts: ReadonlyMap<string, number>;
	referenceCounts: ReadonlyMap<string, number>;
};

const DECLARATION_START_BLOCKLIST = new Set([
	'break',
	'case',
	'catch',
	'co_return',
	'continue',
	'delete',
	'do',
	'else',
	'for',
	'goto',
	'if',
	'return',
	'switch',
	'throw',
	'while',
]);

const DECLARATION_NAME_PREFIX_BLOCKLIST = new Set([
	',',
	'.',
	'->',
	'::',
	':',
	'?',
	'(',
	'return',
	'throw',
	'<<',
	'>>',
]);

const DECLARATION_NAME_BLOCKLIST = new Set([
	'auto',
	'bool',
	'char',
	'const',
	'double',
	'float',
	'int',
	'long',
	'return',
	'short',
	'signed',
	'static',
	'struct',
	'unsigned',
	'void',
]);

const DECLARATION_PREFIX_ALLOWED_OPERATORS = new Set([
	'::',
	'*',
	'&',
	'&&',
	'<',
	'>',
	'>>',
]);

const DECLARATION_PREFIX_ALLOWED_PUNCTUATION = new Set([
	',',
]);

const NUMERIC_DEFENSIVE_CALLS = new Set([
	'clamp',
	'ceil',
	'floor',
	'isfinite',
	'max',
	'min',
	'round',
	'std::clamp',
	'std::ceil',
	'std::floor',
	'std::isfinite',
	'std::max',
	'std::min',
	'std::round',
	'std::trunc',
	'tolower',
	'std::tolower',
	'trunc',
]);

const HOT_PATH_FUNCTION_NAME_WORDS = new Set([
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

const NUMERIC_BOUNDARY_FUNCTION_NAME_WORDS = new Set([
	'append',
	'blit',
	'bucket',
	'clip',
	'clipped',
	'copy',
	'cost',
	'draw',
	'fill',
	'frame',
	'glyph',
	'line',
	'pack',
	'rasterize',
	'rect',
	'register',
	'render',
	'span',
	'tile',
	'vertices',
]);

const CPP_BOUNDED_NUMERIC_HINT_WORDS = new Set([
	'caret',
	'cursor',
	'end',
	'index',
	'left',
	'line',
	'offset',
	'page',
	'position',
	'right',
	'row',
	'scroll',
	'start',
	'top',
]);

const SEMANTIC_NORMALIZATION_WRAPPER_SUFFIXES = [
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

const SEMANTIC_NORMALIZATION_WRAPPER_TARGETS = new Set([
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

const CPP_NORMALIZED_BODY_MIN_LENGTH = 120;
const COMPACT_SAMPLE_TEXT_LENGTH = 180;
const CPP_SEMANTIC_REPEATED_EXPRESSION_MIN_COUNT = 2;
const CPP_LOCAL_CONST_PATTERN_ENABLED = false;

function isSemanticNormalizationWrapperTarget(target: string): boolean {
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

function isSemanticValidationPredicateTarget(target: string): boolean {
	return target === 'isfinite' || target === 'std::isfinite';
}

function semanticNormalizationFamily(target: string): string | null {
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

function semanticOperationName(target: string): string {
	const namespaceIndex = target.lastIndexOf('::');
	const dotIndex = target.lastIndexOf('.');
	const separatorIndex = Math.max(namespaceIndex, dotIndex);
	if (separatorIndex < 0) {
		return target;
	}
	return target.slice(separatorIndex + (separatorIndex === namespaceIndex ? 2 : 1));
}

const HOT_PATH_TEMPORARY_TYPES = new Set([
	'std::function',
	'std::map',
	'std::optional',
	'std::string',
	'std::unordered_map',
	'std::vector',
]);
function compactSampleText(text: string): string {
	if (text.length <= COMPACT_SAMPLE_TEXT_LENGTH) {
		return text;
	}
	return `${text.slice(0, COMPACT_SAMPLE_TEXT_LENGTH - 3)}...`;
}

function cppWordSegments(text: string): string[] {
	const words = text.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z0-9])/g);
	return words === null ? [text.toLowerCase()] : words.map(word => word.toLowerCase());
}

function containsCppBoundedNumericHint(tokens: readonly CppToken[], start: number, end: number): boolean {
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

function rangeContainsNestedCppNumericSanitization(tokens: readonly CppToken[], pairs: readonly number[], start: number, end: number): boolean {
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

function collectSemanticBodySignatures(tokens: readonly CppToken[], pairs: readonly number[], start: number, end: number): string[] {
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

function isSemanticBodySignatureFamily(family: string): boolean {
	return family.startsWith('text:');
}

function collectSemanticNormalizationCallSignatures(tokens: readonly CppToken[], pairs: readonly number[], start: number, end: number): string[] {
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

function isHotPathFunction(info: CppFunctionInfo, regions: readonly AnalysisRegion[], tokens: readonly CppToken[]): boolean {
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

function isNumericBoundaryFunction(info: CppFunctionInfo): boolean {
	const segments = cppWordSegments(info.name);
	for (let index = 0; index < segments.length; index += 1) {
		if (NUMERIC_BOUNDARY_FUNCTION_NAME_WORDS.has(segments[index])) {
			return true;
		}
	}
	return false;
}

function isCppNumericLimitsMemberCall(tokens: readonly CppToken[], openParen: number): boolean {
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

function isCppNumericSanitizationCall(tokens: readonly CppToken[], openParen: number, target: string | null): boolean {
	return target !== null && NUMERIC_DEFENSIVE_CALLS.has(target) && !isCppNumericLimitsMemberCall(tokens, openParen);
}

function shouldReportCppHotPathNumericSanitization(tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, openParen: number, target: string | null): boolean {
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

function isCppSemanticFloorDivisionCall(tokens: readonly CppToken[], pairs: readonly number[], openParen: number, target: string | null): boolean {
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

function isIgnoredName(name: string): boolean {
	return name.length === 0 || name === '_' || name.startsWith('_');
}

function incrementCppUsageCount(counts: Map<string, number>, name: string): void {
	if (name.length === 0) {
		return;
	}
	counts.set(name, (counts.get(name) ?? 0) + 1);
}

function cppUsageLeafName(name: string): string {
	const arrowIndex = name.lastIndexOf('->');
	const dotIndex = name.lastIndexOf('.');
	const colonIndex = name.lastIndexOf('::');
	const separatorIndex = Math.max(arrowIndex, dotIndex, colonIndex);
	if (separatorIndex === -1) {
		return name;
	}
	if (separatorIndex === arrowIndex) {
		return name.slice(separatorIndex + 2);
	}
	return name.slice(separatorIndex + 1);
}

export function createCppFunctionUsageInfo(): { totalCounts: Map<string, number>; referenceCounts: Map<string, number>; } {
	return {
		totalCounts: new Map<string, number>(),
		referenceCounts: new Map<string, number>(),
	};
}

export function collectCppFunctionUsageCounts(tokens: readonly CppToken[], pairs: readonly number[], usageInfo: { totalCounts: Map<string, number>; referenceCounts: Map<string, number>; }): void {
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index].text !== '(' || pairs[index] <= index) {
			continue;
		}
		if (isCppFunctionDeclaratorParen(tokens, pairs, index)) {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (target === null) {
			continue;
		}
		incrementCppUsageCount(usageInfo.totalCounts, target);
		incrementCppUsageCount(usageInfo.totalCounts, `leaf:${cppUsageLeafName(target)}`);
	}
}

export function isCppSingleLineWrapperAllowedByUsage(info: CppFunctionInfo, usageInfo: CppFunctionUsageInfo): boolean {
	if (isCppConstructorLike(info)) {
		return true;
	}
	if (isCppBoundaryStyleWrapperName(info.name)) {
		return true;
	}
	const names = [info.qualifiedName, info.name, `leaf:${info.name}`];
	let total = 0;
	for (let index = 0; index < names.length; index += 1) {
		total += usageInfo.totalCounts.get(names[index]) ?? 0;
	}
	if (total >= 2) {
		return true;
	}
	for (let index = 0; index < names.length; index += 1) {
		if ((usageInfo.referenceCounts.get(names[index]) ?? 0) >= 1) {
			return true;
		}
	}
	return false;
}

function isCppBoundaryStyleWrapperName(name: string): boolean {
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

function isCppConstructorLike(info: CppFunctionInfo): boolean {
	if (info.name.startsWith('~') || info.qualifiedName.startsWith('~') || info.qualifiedName.includes('::~')) {
		return true;
	}
	const methodSeparator = info.qualifiedName.lastIndexOf('::');
	if (methodSeparator !== -1) {
		const ownerNameEnd = methodSeparator;
		const ownerNameStart = info.qualifiedName.lastIndexOf('::', ownerNameEnd - 1) + 2;
		const ownerName = info.qualifiedName.slice(ownerNameStart, ownerNameEnd);
		const methodName = info.qualifiedName.slice(methodSeparator + 2);
		if (methodName === ownerName || methodName === `~${ownerName}`) {
			return true;
		}
	}
	if (info.context === undefined) {
		return false;
	}
	return info.name === info.context;
}

export function lintCppRedundantNumericSanitizationPattern(file: string, tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, regions: readonly AnalysisRegion[], issues: CppLintIssue[]): void {
	if (lineInAnalysisRegion(regions, 'numeric-sanitization-acceptable', tokens[info.nameToken].line)) {
		return;
	}
	if (lineInAnalysisRegion(regions, 'hot-path', tokens[info.nameToken].line)) {
		return;
	}
	const activeNumericCalls: number[] = [];
	for (let index = info.bodyStart + 1; index < info.bodyEnd; index += 1) {
		while (activeNumericCalls.length > 0 && activeNumericCalls[activeNumericCalls.length - 1] <= index) {
			activeNumericCalls.pop();
		}
		if (tokens[index].text !== '(' || pairs[index] < 0 || pairs[index] > info.bodyEnd) {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (!isCppNumericSanitizationCall(tokens, index, target)) {
			continue;
		}
		if (isCppSemanticFloorDivisionCall(tokens, pairs, index, target)) {
			continue;
		}
		if (activeNumericCalls.length > 0) {
			continue;
		}
		const callStart = findCppAccessChainStart(tokens, index - 1);
		const callEnd = pairs[index] + 1;
		if (!rangeContainsNestedCppNumericSanitization(tokens, pairs, callStart, callEnd)) {
			continue;
		}
		pushLintIssue(
			issues,
			file,
			tokens[index],
			redundantNumericSanitizationPatternRule.name,
			'Redundant numeric sanitization is forbidden. Bound values once at the boundary instead of clamping or flooring them repeatedly.',
		);
		activeNumericCalls.push(callEnd);
	}
}

export function lintCppLocalBindings(file: string, tokens: readonly CppToken[], info: CppFunctionInfo, regions: readonly AnalysisRegion[], issues: CppLintIssue[], ledger: QualityLedger): void {
	const ranges = collectCppStatementRanges(tokens, info.bodyStart + 1, info.bodyEnd);
	for (let index = 0; index < ranges.length; index += 1) {
		const binding = declarationFromStatement(tokens, ranges[index][0], ranges[index][1]);
		if (binding === null) {
			continue;
		}
		markBindingUses(binding, tokens, info.bodyStart, info.bodyEnd);
		if (!binding.isConst && binding.hasInitializer && binding.writeCount === 0) {
			noteQualityLedger(ledger, 'cpp_local_const_candidate');
		}
		if (!CPP_LOCAL_CONST_PATTERN_ENABLED && !binding.isConst && binding.hasInitializer && binding.writeCount === 0) {
			noteQualityLedger(ledger, 'skipped_cpp_local_const_disabled');
			noteQualityLedger(ledger, `skipped_cpp_local_const_${cppLocalConstCandidateKind(info, regions, tokens, binding)}`);
		} else if (CPP_LOCAL_CONST_PATTERN_ENABLED && shouldReportCppLocalConst(binding)) {
			pushLintIssue(issues, file, tokens[binding.nameToken], localConstPatternRule.name, `Prefer "const" for "${binding.name}"; it is never reassigned.`);
		} else if (!binding.isConst && binding.hasInitializer && binding.writeCount === 0) {
			noteQualityLedger(ledger, 'skipped_cpp_local_const_heuristic');
		}
		if (binding.readCount === 1 && shouldReportSingleUseLocal(binding)) {
			pushLintIssue(issues, file, tokens[binding.nameToken], singleUseLocalPatternRule.name, `Local alias "${binding.name}" is read only once in this scope.`);
		}
	}
}

function cppLocalConstCandidateKind(info: CppFunctionInfo, regions: readonly AnalysisRegion[], tokens: readonly CppToken[], binding: CppLocalBinding): string {
	if (lineInAnalysisRegion(regions, 'local-const-specialization', tokens[binding.nameToken].line) && /^[A-Z0-9_]+$/.test(binding.name)) {
		return 'vm_specialization';
	}
	const prefix = isHotPathFunction(info, regions, tokens) ? 'hot_path_' : '';
	const valueKind = cppLocalBindingValueKind(binding);
	if (valueKind === 'handle' || valueKind === 'simple_alias') {
		return `${prefix}${valueKind}`;
	}
	if (binding.memberAccessCount > 0) {
		return `${prefix}${valueKind}_member_access`;
	}
	return `${prefix}${valueKind}_${cppLocalBindingReadBucket(binding)}`;
}

function declarationFromStatement(tokens: readonly CppToken[], start: number, end: number): CppLocalBinding | null {
	const declarationStart = start;
	let isLeadingConst = false;
	while (start < end && (tokens[start].text === 'const' || tokens[start].text === 'constexpr')) {
		isLeadingConst = true;
		start += 1;
	}
	if (start >= end || DECLARATION_START_BLOCKLIST.has(tokens[start].text)) {
		return null;
	}
	if (tokens[start].text === '*' || tokens[start].text === '&' || tokens[start].text === '&&') {
		return null;
	}
	let initializerIndex = -1;
	for (let index = start; index < end; index += 1) {
		const text = tokens[index].text;
		if (text === '=' || text === '{') {
			initializerIndex = index;
			break;
		}
		if (text === '(') {
			const nameIndex = previousCppIdentifier(tokens, index);
			if (nameIndex > start && hasCppDeclarationPrefix(tokens, start, nameIndex)) {
				initializerIndex = index;
			}
			break;
		}
	}
	if (initializerIndex < 0) {
		return null;
	}
	const nameIndex = previousCppIdentifier(tokens, initializerIndex);
	if (nameIndex < 0 || nameIndex <= start || !hasCppDeclarationPrefix(tokens, start, nameIndex)) {
		return null;
	}
	if (hasCppDeclarationPrefixNoise(tokens, declarationStart, nameIndex)) {
		return null;
	}
	if (DECLARATION_NAME_PREFIX_BLOCKLIST.has(tokens[nameIndex - 1]?.text ?? '')) {
		return null;
	}
	const nameToken = tokens[nameIndex];
	if (DECLARATION_NAME_BLOCKLIST.has(nameToken.text) || isIgnoredName(nameToken.text)) {
		return null;
	}
	const typeText = cppTokenText(tokens, declarationStart, nameIndex).replace(/\s+/g, ' ').trim();
	const initializerText = trimmedCppExpressionText(tokens, initializerIndex + 1, end);
	let isConst = isLeadingConst;
	let isReference = false;
	let isPointer = false;
	for (let index = declarationStart; index < nameIndex; index += 1) {
		if (tokens[index].text === 'const' || tokens[index].text === 'constexpr') {
			isConst = true;
			break;
		}
		if (tokens[index].text === '&' || tokens[index].text === '&&') {
			isReference = true;
		}
		if (tokens[index].text === '*') {
			isPointer = true;
		}
	}
	return {
		name: nameToken.text,
		nameToken: nameIndex,
		typeText,
		line: nameToken.line,
		column: nameToken.column,
		isConst,
		isReference,
		isPointer,
		hasInitializer: true,
		readCount: 0,
		writeCount: 0,
		memberAccessCount: 0,
		initializerTextLength: initializerText.length,
		isSimpleAliasInitializer: isCppSimpleAliasInitializer(tokens, initializerIndex + 1, end),
		firstReadLeftText: null,
		firstReadRightText: null,
	};
}

function hasCppDeclarationPrefixNoise(tokens: readonly CppToken[], start: number, nameIndex: number): boolean {
	for (let index = start; index < nameIndex; index += 1) {
		const token = tokens[index];
		if (token.text === '#') {
			return true;
		}
		if (isCppAssignmentOperator(token.text)) {
			return true;
		}
		if (token.kind === 'op' && !DECLARATION_PREFIX_ALLOWED_OPERATORS.has(token.text)) {
			return true;
		}
		if (token.kind === 'punct' && !DECLARATION_PREFIX_ALLOWED_PUNCTUATION.has(token.text)) {
			return true;
		}
	}
	return false;
}

function cppLocalBindingValueKind(binding: CppLocalBinding): string {
	if (binding.isReference || binding.isPointer) {
		return 'handle';
	}
	if (binding.isSimpleAliasInitializer) {
		return 'simple_alias';
	}
	const typeText = binding.typeText.replace(/\b(?:const|constexpr|static|volatile|mutable)\b/g, '').replace(/\s+/g, ' ').trim();
	if (isCppScalarLocalType(typeText)) {
		return 'scalar';
	}
	if (/^(?:auto|decltype\b)/.test(typeText)) {
		return 'auto_value';
	}
	if (/\b(?:string|string_view|span|array|vector|map|unordered_map|set|unordered_set|optional|variant|function)\b/.test(typeText)) {
		return 'library_value';
	}
	if (/[A-Z]/.test(typeText[0] ?? '')) {
		return 'domain_value';
	}
	return 'value';
}

function isCppScalarLocalType(typeText: string): boolean {
	return /^(?:u?int(?:8|16|32|64)?_t|[ui](?:8|16|32|64)|size_t|std::size_t|ptrdiff_t|std::ptrdiff_t|float|double|f32|f64|bool|char|unsigned char|signed char|short|unsigned short|int|unsigned int|long|unsigned long|long long|unsigned long long)\b/.test(typeText);
}

function cppLocalBindingReadBucket(binding: CppLocalBinding): string {
	return binding.readCount >= 2 ? 'reused' : 'single_read';
}

function markBindingUses(binding: CppLocalBinding, tokens: readonly CppToken[], bodyStart: number, bodyEnd: number): void {
	for (let index = bodyStart + 1; index < bodyEnd; index += 1) {
		const token = tokens[index];
		if (token.kind !== 'id' || token.text !== binding.name || index === binding.nameToken) {
			continue;
		}
		if (tokens[index - 1]?.text === '.' || tokens[index - 1]?.text === '->' || tokens[index - 1]?.text === '::') {
			continue;
		}
		if (tokens[index + 1]?.text === '.' || tokens[index + 1]?.text === '->') {
			binding.memberAccessCount += 1;
		}
		if (isWriteUse(tokens, index)) {
			binding.writeCount += 1;
		} else {
			if (binding.readCount === 0) {
				binding.firstReadLeftText = tokens[index - 1]?.text ?? null;
				binding.firstReadRightText = tokens[index + 1]?.text ?? null;
			}
			binding.readCount += 1;
		}
	}
}

function isCppSimpleAliasInitializer(tokens: readonly CppToken[], start: number, end: number): boolean {
	let seenToken = false;
	for (let index = start; index < end; index += 1) {
		const token = tokens[index];
		if (token.kind === 'id') {
			seenToken = true;
			continue;
		}
		if (token.text === '.' || token.text === '->' || token.text === '::') {
			continue;
		}
		return false;
	}
	return seenToken;
}

function isCppSingleUseSuppressingToken(text: string | null): boolean {
	return text === '.'
		|| text === '->'
		|| text === '::'
		|| text === '&'
		|| text === '['
		|| text === ']'
		|| text === '=='
		|| text === '==='
		|| text === '!='
		|| text === '!=='
		|| text === '<'
		|| text === '<='
		|| text === '>'
		|| text === '>='
		|| text === '&&'
		|| text === '||'
		|| text === '??';
}

function shouldReportCppLocalConst(binding: CppLocalBinding): boolean {
	if (binding.isConst || binding.isReference || binding.isPointer || !binding.hasInitializer || binding.writeCount !== 0) {
		return false;
	}
	if (binding.memberAccessCount > 0) {
		return false;
	}
	if (binding.readCount < 2) {
		return false;
	}
	if (binding.isSimpleAliasInitializer && binding.initializerTextLength <= 32) {
		return false;
	}
	return true;
}

function shouldReportSingleUseLocal(binding: CppLocalBinding): boolean {
	if (!binding.hasInitializer || !binding.isSimpleAliasInitializer) {
		return false;
	}
	if (isCppTemporalSnapshotName(binding.name)) {
		return false;
	}
	if (binding.writeCount > 0) {
		return false;
	}
	if (binding.initializerTextLength > 32) {
		return false;
	}
	if (isCppSingleUseSuppressingToken(binding.firstReadLeftText) || isCppSingleUseSuppressingToken(binding.firstReadRightText)) {
		return false;
	}
	return true;
}

function isCppTemporalSnapshotName(name: string): boolean {
	return /^(previous|prev|next|before|after|initial|was|had)[A-Z_]?/.test(name);
}

function isWriteUse(tokens: readonly CppToken[], index: number): boolean {
	return isCppAssignmentOperator(tokens[index + 1]?.text) || tokens[index + 1]?.text === '++' || tokens[index + 1]?.text === '--' ||
		tokens[index - 1]?.text === '++' || tokens[index - 1]?.text === '--';
}

export function lintCppHotPathCalls(file: string, tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, regions: readonly AnalysisRegion[], issues: CppLintIssue[]): void {
	if (!isHotPathFunction(info, regions, tokens)) {
		return;
	}
	for (let index = info.bodyStart + 1; index < info.bodyEnd; index += 1) {
		if (tokens[index].text !== '(' || pairs[index] < 0 || pairs[index] >= info.bodyEnd) {
			continue;
		}
		if (isCppFunctionDeclaratorParen(tokens, pairs, index)) {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (target === null) {
			continue;
		}
		if (shouldReportCppHotPathNumericSanitization(tokens, pairs, info, index, target)) {
			pushLintIssue(issues, file, tokens[index - 1], numericDefensiveSanitizationPatternRule.name, 'Defensive numeric sanitization in hot paths is forbidden. Coordinates, cycles, and layout values must already be valid.');
		}
		const args = splitCppArgumentRanges(tokens, index + 1, pairs[index]);
		for (let argIndex = 0; argIndex < args.length; argIndex += 1) {
			const argStart = args[argIndex][0];
			const argEnd = args[argIndex][1];
			if (rangeContainsCapturingLambda(tokens, argStart, argEnd)) {
				pushLintIssue(issues, file, tokens[argStart], hotPathClosureArgumentPatternRule.name, 'Lambda/closure argument allocation in hot-path calls is forbidden. Move ownership to direct methods or stable state.');
			}
			if (rangeContainsTemporaryAllocation(tokens, argStart, argEnd)) {
				pushLintIssue(issues, file, tokens[argStart], hotPathObjectLiteralPatternRule.name, 'Temporary object/container allocation in hot-path calls is forbidden. Pass primitives or reuse state/scratch storage.');
			}
		}
	}
}

function rangeContainsCapturingLambda(tokens: readonly CppToken[], start: number, end: number): boolean {
	for (let index = start; index < end; index += 1) {
		if (tokens[index].text === '[') {
			const close = findNextCppTokenText(tokens, index + 1, end, ']');
			if (close > index + 1 && findNextCppTokenText(tokens, close + 1, end, '{') >= 0) {
				return true;
			}
		}
	}
	return false;
}

function rangeContainsTemporaryAllocation(tokens: readonly CppToken[], start: number, end: number): boolean {
	for (let index = start; index < end; index += 1) {
		if (tokens[index].text === 'new') {
			return true;
		}
		if (tokens[index].text === '{' && index === start) {
			return true;
		}
		if (tokens[index].kind !== 'id') {
			continue;
		}
		const chainStart = findCppAccessChainStart(tokens, index);
		const text = cppTokenText(tokens, chainStart, index + 1);
		if (text === 'std::make_unique' || text === 'std::make_shared' || HOT_PATH_TEMPORARY_TYPES.has(text)) {
			return true;
		}
	}
	return false;
}

function semanticCppExpressionFingerprint(target: string, tokens: readonly CppToken[], start: number, end: number): string {
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

function cppSemanticRepeatedExpressionMinCount(target: string): number {
	const family = semanticNormalizationFamily(target);
	if (family === 'numeric:bounds' || family === 'numeric:rounding') {
		return 3;
	}
	return CPP_SEMANTIC_REPEATED_EXPRESSION_MIN_COUNT;
}

export function lintCppSemanticRepeatedExpressions(file: string, tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, issues: CppLintIssue[]): void {
	const expressions = new Map<string, { token: CppToken; count: number; sampleText: string; target: string }>();
	const semanticCallSignatures = collectSemanticNormalizationCallSignatures(tokens, pairs, info.bodyStart + 1, info.bodyEnd);
	const semanticTargetPrefix = semanticCallSignatures.join('|');
	const activeSemanticCalls: number[] = [];
	for (let index = info.bodyStart + 1; index < info.bodyEnd; index += 1) {
		while (activeSemanticCalls.length > 0 && activeSemanticCalls[activeSemanticCalls.length - 1] <= index) {
			activeSemanticCalls.pop();
		}
		if (tokens[index].text !== '(' || pairs[index] < 0 || pairs[index] >= info.bodyEnd) {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (target === null || (!isCppNumericSanitizationCall(tokens, index, target) && !isSemanticNormalizationWrapperTarget(target))) {
			continue;
		}
		if (isSemanticValidationPredicateTarget(target)) {
			continue;
		}
		if (activeSemanticCalls.length > 0) {
			continue;
		}
		const callStart = findCppAccessChainStart(tokens, index - 1);
		const callEnd = pairs[index] + 1;
		const text = normalizedCppTokenText(tokens, callStart, callEnd);
		if (text.length < 24 || text.startsWith('this.') || text.startsWith('this->')) {
			continue;
		}
		const fingerprint = semanticTargetPrefix.length > 0
			? `${semanticTargetPrefix}|${semanticCppExpressionFingerprint(target, tokens, callStart, callEnd)}`
			: semanticCppExpressionFingerprint(target, tokens, callStart, callEnd);
		const existing = expressions.get(fingerprint);
		if (existing !== undefined) {
			existing.count += 1;
			continue;
		}
		expressions.set(fingerprint, {
			token: tokens[callStart],
			count: 1,
			sampleText: compactSampleText(text),
			target,
		});
		activeSemanticCalls.push(callEnd);
	}
	for (const value of expressions.values()) {
		if (value.count < cppSemanticRepeatedExpressionMinCount(value.target)) {
			continue;
		}
		issues.push({
			kind: semanticRepeatedExpressionPatternRule.name,
			file,
			line: value.token.line,
			column: value.token.column,
			name: semanticRepeatedExpressionPatternRule.name,
			message: `Semantic transform call is repeated ${value.count} times in the same scope: ${value.sampleText}`,
		});
	}
}

export function collectCppNormalizedBody(file: string, tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, regions: readonly AnalysisRegion[], normalizedBodies: CppNormalizedBodyInfo[], ledger: QualityLedger): void {
	if (info.name.endsWith('Thunk')) {
		noteQualityLedger(ledger, 'skipped_cpp_normalized_body_thunk');
		return;
	}
	if (lineInAnalysisRegion(regions, 'normalized-body-acceptable', tokens[info.nameToken].line)) {
		noteQualityLedger(ledger, 'skipped_cpp_normalized_body_analysis_region');
		return;
	}
	const semanticNormalization = info.wrapperTarget !== null && isSemanticNormalizationWrapperTarget(info.wrapperTarget);
	if (info.wrapperTarget !== null && !semanticNormalization) {
		noteQualityLedger(ledger, 'skipped_cpp_normalized_body_wrapper');
		return;
	}
	const bodyText = normalizedCppTokenText(tokens, info.bodyStart + 1, info.bodyEnd);
	const semanticSignatures = collectSemanticBodySignatures(tokens, pairs, info.bodyStart + 1, info.bodyEnd);
	const semanticBody = semanticSignatures.length > 0;
	if (!semanticBody && bodyText.length < CPP_NORMALIZED_BODY_MIN_LENGTH) {
		noteQualityLedger(ledger, 'skipped_cpp_normalized_body_short_text');
		return;
	}
	normalizedBodies.push({
		name: info.qualifiedName,
		file,
		line: tokens[info.nameToken].line,
		column: tokens[info.nameToken].column,
		fingerprint: normalizedBodyFingerprint(tokens, info.bodyStart + 1, info.bodyEnd),
		semanticSignatures: semanticBody ? semanticSignatures : null,
	});
}

function normalizedBodyFingerprint(tokens: readonly CppToken[], start: number, end: number): string {
	let text = '';
	for (let index = start; index < end; index += 1) {
		const token = tokens[index];
		if (token.kind === 'id') {
			if (isCppCallIdentifier(tokens, index)) {
				text += `Call:${token.text}|`;
			} else {
				text += 'Identifier|';
			}
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

function isCppCallIdentifier(tokens: readonly CppToken[], index: number): boolean {
	const text = tokens[index].text;
	if (text === 'if' || text === 'for' || text === 'while' || text === 'switch' || text === 'catch') {
		return false;
	}
	return tokens[index + 1]?.text === '(';
}
