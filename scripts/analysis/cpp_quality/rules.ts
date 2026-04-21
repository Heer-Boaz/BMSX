import { dirname, isAbsolute, resolve } from 'node:path';

import type { CppClassRange, CppFunctionInfo } from '../../../src/bmsx/language/cpp/syntax/declarations';
import type { CppLintIssue, CppNormalizedBodyInfo } from './diagnostics';
import { pushLintIssue } from './diagnostics';
import {
	collectCppStatementRanges,
	cppCallTargetFromStatement,
	cppCallTarget,
	cppRangeHas,
	findCppAccessChainStart,
	findCppTernaryColon,
	findNextCppDelimiter,
	findNextCppTokenText,
	findPreviousCppDelimiter,
	findTopLevelCppSemicolon,
	hasCppDeclarationPrefix,
	isCppAssignmentOperator,
	isCppBooleanToken,
	isCppEmptyStringToken,
	isCppFunctionDeclaratorParen,
	isCppNullToken,
	previousCppIdentifier,
	splitCppArgumentRanges,
	trimmedCppExpressionText,
} from '../../../src/bmsx/language/cpp/syntax/syntax';
import type { CppToken } from '../../../src/bmsx/language/cpp/syntax/tokens';
import { cppTokenText, normalizedCppTokenText } from '../../../src/bmsx/language/cpp/syntax/tokens';

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
	'load',
	'make',
	'on',
	'pending',
	'open',
	'pixels',
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
]);

type CppFacadeStats = {
	callableCount: number;
	wrapperCount: number;
	firstWrapperToken: CppToken;
};

type CppLocalBinding = {
	name: string;
	nameToken: number;
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

const HOT_PATH_SEGMENTS = [
	'/src/bmsx_cpp/audio/',
	'/src/bmsx_cpp/machine/cpu/',
	'/src/bmsx_cpp/machine/devices/vdp/',
	'/src/bmsx_cpp/machine/runtime/',
	'/src/bmsx_cpp/render/',
] as const;

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

function normalizePathForAnalysis(path: string): string {
	return path.replace(/\\/g, '/');
}

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

function isHotPathFile(fileName: string): boolean {
	const normalized = normalizePathForAnalysis(isAbsolute(fileName) ? fileName : resolve(process.cwd(), fileName));
	for (let index = 0; index < HOT_PATH_SEGMENTS.length; index += 1) {
		if (normalized.includes(HOT_PATH_SEGMENTS[index])) {
			return true;
		}
	}
	return false;
}

function isHotPathFunction(fileName: string, info: CppFunctionInfo): boolean {
	if (!isHotPathFile(fileName)) {
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
	if (info.context === null) {
		return false;
	}
	return info.name === info.context || info.name === `~${info.context}`;
}

export function createCppFacadeStats(functions: readonly CppFunctionInfo[], tokens: readonly CppToken[]): CppFacadeStats | null {
	if (functions.length === 0) {
		return null;
	}
	return {
		callableCount: 0,
		wrapperCount: 0,
		firstWrapperToken: tokens[functions[0].nameToken],
	};
}

export function lintCppFacadeStats(file: string, stats: CppFacadeStats, issues: CppLintIssue[]): void {
	if (stats.wrapperCount < 3 || stats.wrapperCount * 10 < stats.callableCount * 6) {
		return;
	}
	pushLintIssue(
		issues,
		file,
		stats.firstWrapperToken,
		'facade_module_density_pattern',
		`Translation unit contains ${stats.wrapperCount}/${stats.callableCount} callable wrappers. Facade modules are forbidden; move ownership to the real module.`,
	);
}

export function lintCppEnsureLazyInitPattern(file: string, tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, issues: CppLintIssue[]): void {
	if (!info.name.startsWith('ensure')) {
		return;
	}
	const bodyStart = info.bodyStart + 1;
	if (tokens[bodyStart]?.text !== 'if') {
		return;
	}
	const conditionOpen = bodyStart + 1;
	if (tokens[conditionOpen]?.text !== '(' || tokens[conditionOpen + 1]?.text !== '!') {
		return;
	}
	const conditionClose = pairs[conditionOpen];
	if (conditionClose <= conditionOpen) {
		return;
	}
	const hasInstanceTarget = cppCallTarget(tokens, conditionClose - 2);
	if (hasInstanceTarget === null || !hasInstanceTarget.endsWith('::hasInstance')) {
		return;
	}
	const blockOpen = conditionClose + 1;
	if (tokens[blockOpen]?.text !== '{' || pairs[blockOpen] < 0) {
		return;
	}
	const blockClose = pairs[blockOpen];
	const blockStatements = collectCppStatementRanges(tokens, blockOpen + 1, blockClose);
	let createTarget: string | null = null;
	for (let index = 0; index < blockStatements.length; index += 1) {
		createTarget = cppCallTargetFromStatement(tokens, pairs, blockStatements[index][0], blockStatements[index][1]);
		if (createTarget !== null) {
			break;
		}
	}
	if (createTarget === null) {
		return;
	}
	if (!/(?:create|init|initialize)[A-Za-z0-9_]*$/.test(createTarget)) {
		return;
	}
	const targetPrefix = createTarget.slice(0, createTarget.lastIndexOf('::'));
	const returnStart = blockClose + 1;
	const returnEnd = findTopLevelCppSemicolon(tokens, returnStart, info.bodyEnd);
	if (returnEnd < 0) {
		return;
	}
	const returnTarget = cppCallTargetFromStatement(tokens, pairs, returnStart, returnEnd);
	if (returnTarget !== `${targetPrefix}::instance`) {
		return;
	}
	pushLintIssue(
		issues,
		file,
		tokens[info.nameToken],
		'ensure_lazy_init_pattern',
		'Lazy ensure/init wrapper is forbidden. Initialize eagerly instead of guarding creation and returning the cached singleton.',
	);
}

export function lintCppTerminalReturnPaddingPattern(file: string, tokens: readonly CppToken[], info: CppFunctionInfo, issues: CppLintIssue[]): void {
	let statementStart = info.bodyStart + 1;
	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;
	let lastStart = -1;
	let lastEnd = -1;
	for (let index = info.bodyStart + 1; index < info.bodyEnd; index += 1) {
		const text = tokens[index].text;
		if (text === '(') parenDepth += 1;
		else if (text === ')') parenDepth -= 1;
		else if (text === '[') bracketDepth += 1;
		else if (text === ']') bracketDepth -= 1;
		else if (text === '{') {
			braceDepth += 1;
			statementStart = index + 1;
			continue;
		}
		else if (text === '}') {
			braceDepth -= 1;
			statementStart = index + 1;
			continue;
		}
		else if (text === ';' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
			if (statementStart < index) {
				lastStart = statementStart;
				lastEnd = index;
			}
			statementStart = index + 1;
		}
	}
	if (lastStart < 0 || tokens[lastStart]?.text !== 'return' || lastEnd !== lastStart + 1) {
		return;
	}
	pushLintIssue(
		issues,
		file,
		tokens[lastStart],
		'useless_terminal_return_pattern',
		'Terminal `return;` is forbidden. Remove no-op returns instead of padding the body.',
	);
}

export function lintCppCatchPatterns(file: string, tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, issues: CppLintIssue[]): void {
	for (let index = info.bodyStart + 1; index < info.bodyEnd; index += 1) {
		if (tokens[index].text !== 'catch' || tokens[index + 1]?.text !== '(') {
			continue;
		}
		const declarationClose = pairs[index + 1];
		if (declarationClose < 0 || declarationClose >= info.bodyEnd) {
			continue;
		}
		const blockOpen = declarationClose + 1;
		if (tokens[blockOpen]?.text !== '{' || pairs[blockOpen] < 0 || pairs[blockOpen] > info.bodyEnd) {
			continue;
		}
		const blockClose = pairs[blockOpen];
		const statements = collectCppStatementRanges(tokens, blockOpen + 1, blockClose);
		if (statements.length === 0) {
			pushLintIssue(
				issues,
				file,
				tokens[index],
				'empty_catch_pattern',
				'Empty catch block is forbidden. Catch only when you can handle or rethrow the error.',
			);
			continue;
		}
		const declarationNameIndex = previousCppIdentifier(tokens, declarationClose);
		const declarationName = declarationNameIndex >= 0 && tokens[declarationNameIndex + 1]?.text === ')' ? tokens[declarationNameIndex].text : null;
		if (statements.length === 1) {
			const [statementStart, statementEnd] = statements[0];
			if (
				tokens[statementStart]?.text === 'throw'
				&& (
					statementEnd === statementStart + 1
					|| (declarationName !== null && trimmedCppExpressionText(tokens, statementStart + 1, statementEnd) === declarationName)
				)
			) {
				pushLintIssue(
					issues,
					file,
					tokens[index],
					'useless_catch_pattern',
					'Catch clause only rethrows the caught error. Remove the wrapper and let the exception propagate.',
				);
				continue;
			}
		}
		if (
			cppRangeHas(tokens, blockOpen + 1, blockClose, token => token.text === 'return')
			&& !cppCatchBlockStoresCurrentException(tokens, blockOpen + 1, blockClose)
			&& !cppCatchBlockFinishesError(tokens, blockOpen + 1, blockClose)
		) {
			pushLintIssue(
				issues,
				file,
				tokens[index],
				'silent_catch_fallback_pattern',
				'Catch clause swallows the error and returns a fallback. Trust the caller/callee or propagate the failure.',
			);
		}
	}
}

function cppCatchBlockStoresCurrentException(tokens: readonly CppToken[], start: number, end: number): boolean {
	for (let index = start; index < end; index += 1) {
		if (tokens[index].text !== '(') {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (target === 'std::current_exception' || target === 'current_exception') {
			return true;
		}
	}
	return false;
}

function cppCatchBlockFinishesError(tokens: readonly CppToken[], start: number, end: number): boolean {
	for (let index = start; index < end; index += 1) {
		if (tokens[index].text !== '(') {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (target !== null && /^finish[A-Za-z0-9]*Error$/.test(target)) {
			return true;
		}
	}
	return false;
}

export function lintCppRedundantNumericSanitizationPattern(file: string, tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, issues: CppLintIssue[]): void {
	if (isHotPathFile(file)) {
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
			'redundant_numeric_sanitization_pattern',
			'Redundant numeric sanitization is forbidden. Bound values once at the boundary instead of clamping or flooring them repeatedly.',
		);
		activeNumericCalls.push(callEnd);
	}
}

export function lintCppLocalBindings(file: string, tokens: readonly CppToken[], info: CppFunctionInfo, issues: CppLintIssue[]): void {
	const ranges = collectCppStatementRanges(tokens, info.bodyStart + 1, info.bodyEnd);
	for (let index = 0; index < ranges.length; index += 1) {
		const binding = declarationFromStatement(tokens, ranges[index][0], ranges[index][1]);
		if (binding === null) {
			continue;
		}
		markBindingUses(binding, tokens, info.bodyStart, info.bodyEnd);
		if (CPP_LOCAL_CONST_PATTERN_ENABLED && shouldReportCppLocalConst(binding)) {
			pushLintIssue(issues, file, tokens[binding.nameToken], 'local_const_pattern', `Prefer "const" for "${binding.name}"; it is never reassigned.`);
		}
		if (binding.readCount === 1 && shouldReportSingleUseLocal(binding)) {
			pushLintIssue(issues, file, tokens[binding.nameToken], 'single_use_local_pattern', `Local alias "${binding.name}" is read only once in this scope.`);
		}
	}
}

export function lintCppSinglePropertyOptionsTypes(file: string, tokens: readonly CppToken[], classRanges: readonly CppClassRange[], issues: CppLintIssue[]): void {
	for (let index = 0; index < classRanges.length; index += 1) {
		const range = classRanges[index];
		if (!/(?:Options|Opts)$/.test(range.name)) {
			continue;
		}
		const memberCount = countCppTopLevelDataMembers(tokens, range.start + 1, range.end);
		if (memberCount !== 1) {
			continue;
		}
		pushLintIssue(
			issues,
			file,
			tokens[range.nameToken],
			'single_property_options_parameter_pattern',
			`Single-property options type "${range.name}" is forbidden. Use a direct parameter or split the operation instead of implying future extensibility.`,
		);
	}
}

function countCppTopLevelDataMembers(tokens: readonly CppToken[], start: number, end: number): number {
	const ranges = collectCppClassMemberStatementRanges(tokens, start, end);
	let count = 0;
	for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
		const statementStart = ranges[rangeIndex][0];
		const statementEnd = ranges[rangeIndex][1];
		if (statementStart >= statementEnd) {
			continue;
		}
		const first = tokens[statementStart].text;
		if (first === 'public' || first === 'private' || first === 'protected') {
			continue;
		}
		if (cppRangeHas(tokens, statementStart, statementEnd, token =>
			token.text === 'class'
			|| token.text === 'struct'
			|| token.text === 'union'
			|| token.text === 'namespace'
			|| token.text === 'template'
			|| token.text === 'using'
			|| token.text === 'typedef'
			|| token.text === 'enum'
			|| token.text === 'friend'
			|| token.text === 'static'
		)) {
			continue;
		}
		if (cppRangeHas(tokens, statementStart, statementEnd, token => token.text === '(')) {
			continue;
		}
		if (cppRangeHas(tokens, statementStart, statementEnd, token => token.kind === 'id')) {
			count += countCppDataMemberDeclarators(tokens, statementStart, statementEnd);
		}
	}
	return count;
}

function collectCppClassMemberStatementRanges(tokens: readonly CppToken[], start: number, end: number): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	let statementStart = start;
	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;
	for (let index = start; index < end; index += 1) {
		const text = tokens[index].text;
		if (text === '(') parenDepth += 1;
		else if (text === ')') parenDepth -= 1;
		else if (text === '[') bracketDepth += 1;
		else if (text === ']') bracketDepth -= 1;
		else if (text === '{') braceDepth += 1;
		else if (text === '}') braceDepth -= 1;
		else if (
			text === ':'
			&& parenDepth === 0
			&& bracketDepth === 0
			&& braceDepth === 0
			&& index === statementStart + 1
			&& (tokens[statementStart].text === 'public' || tokens[statementStart].text === 'private' || tokens[statementStart].text === 'protected')
		) {
			statementStart = index + 1;
		} else if (text === ';' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
			if (statementStart < index) {
				ranges.push([statementStart, index]);
			}
			statementStart = index + 1;
		}
	}
	return ranges;
}

function countCppDataMemberDeclarators(tokens: readonly CppToken[], start: number, end: number): number {
	let count = 1;
	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;
	let angleDepth = 0;
	for (let index = start; index < end; index += 1) {
		const text = tokens[index].text;
		if (text === '(') parenDepth += 1;
		else if (text === ')') parenDepth -= 1;
		else if (text === '[') bracketDepth += 1;
		else if (text === ']') bracketDepth -= 1;
		else if (text === '{') braceDepth += 1;
		else if (text === '}') braceDepth -= 1;
		else if (text === '<' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) angleDepth += 1;
		else if (text === '>' && angleDepth > 0 && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) angleDepth -= 1;
		else if (text === '>>' && angleDepth > 0 && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) angleDepth = angleDepth > 1 ? angleDepth - 2 : 0;
		else if (text === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && angleDepth === 0) count += 1;
	}
	return count;
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
	if (DECLARATION_NAME_PREFIX_BLOCKLIST.has(tokens[nameIndex - 1]?.text ?? '')) {
		return null;
	}
	const nameToken = tokens[nameIndex];
	if (DECLARATION_NAME_BLOCKLIST.has(nameToken.text) || isIgnoredName(nameToken.text)) {
		return null;
	}
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
	return /^(previous|next|before|after|initial)[A-Z_]?/.test(name);
}

function isWriteUse(tokens: readonly CppToken[], index: number): boolean {
	return isCppAssignmentOperator(tokens[index + 1]?.text) || tokens[index + 1]?.text === '++' || tokens[index + 1]?.text === '--' ||
		tokens[index - 1]?.text === '++' || tokens[index - 1]?.text === '--';
}

export function lintCppSimpleTokenPatterns(file: string, tokens: readonly CppToken[], issues: CppLintIssue[]): void {
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.text === '==' || token.text === '!=') {
			const left = tokens[index - 1];
			const right = tokens[index + 1];
			if (left !== undefined && right !== undefined) {
				if ((isCppEmptyStringToken(left) && right.kind !== 'string') || (isCppEmptyStringToken(right) && left.kind !== 'string')) {
					pushLintIssue(issues, file, token, 'empty_string_condition_pattern', 'Empty-string condition checks are forbidden. Prefer explicit truthy/falsy checks.');
				}
				if ((isCppBooleanToken(left) && !isCppBooleanToken(right)) || (isCppBooleanToken(right) && !isCppBooleanToken(left))) {
					pushLintIssue(issues, file, token, 'explicit_truthy_comparison_pattern', 'Explicit boolean literal comparison is forbidden. Use truthy/falsy checks instead.');
				}
			}
		}
		if (token.text === '?') {
			lintTernaryFallback(file, tokens, index, issues);
		}
	}
	lintStringOrChains(file, tokens, issues);
}

function lintTernaryFallback(file: string, tokens: readonly CppToken[], questionIndex: number, issues: CppLintIssue[]): void {
	const statementStart = findPreviousCppDelimiter(tokens, questionIndex) + 1;
	const statementEnd = findNextCppDelimiter(tokens, questionIndex);
	const colonIndex = findCppTernaryColon(tokens, questionIndex, statementEnd);
	if (colonIndex < 0) {
		return;
	}
	const condition = trimmedCppExpressionText(tokens, statementStart, questionIndex);
	const trueBranch = trimmedCppExpressionText(tokens, questionIndex + 1, colonIndex);
	const falseBranch = trimmedCppExpressionText(tokens, colonIndex + 1, statementEnd);
	const trueHasEmpty = cppRangeHas(tokens, questionIndex + 1, colonIndex, isCppEmptyStringToken);
	const falseHasEmpty = cppRangeHas(tokens, colonIndex + 1, statementEnd, isCppEmptyStringToken);
	if ((condition === trueBranch && falseHasEmpty) || (condition === falseBranch && trueHasEmpty)) {
		pushLintIssue(issues, file, tokens[questionIndex], 'empty_string_fallback_pattern', 'Empty-string fallback through a conditional expression is forbidden. Do not use empty strings as default values.');
	}
	const trueHasNull = cppRangeIsNull(tokens, questionIndex + 1, colonIndex);
	const falseHasNull = cppRangeIsNull(tokens, colonIndex + 1, statementEnd);
	if (trueHasNull || falseHasNull) {
		pushLintIssue(issues, file, tokens[questionIndex], 'or_nil_fallback_pattern', '`nullptr` fallback through a conditional expression is forbidden. Use direct ownership checks or optional state.');
	}
	if ((condition === trueBranch && falseHasNull) || (condition === falseBranch && trueHasNull)) {
		pushLintIssue(issues, file, tokens[questionIndex], 'nullish_null_normalization_pattern', 'Conditional nullptr normalization is forbidden. Preserve the actual value or branch explicitly.');
	}
}

export function lintCppNullishReturnGuards(file: string, tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, issues: CppLintIssue[]): void {
	for (let index = info.bodyStart + 1; index < info.bodyEnd; index += 1) {
		if (tokens[index].text !== 'if' || tokens[index + 1]?.text !== '(') {
			continue;
		}
		const conditionStart = index + 2;
		const conditionEnd = pairs[index + 1];
		if (conditionEnd < 0 || conditionEnd >= info.bodyEnd) {
			continue;
		}
		const guardedExpression = cppNullishGuardExpression(tokens, conditionStart, conditionEnd);
		if (guardedExpression === null) {
			continue;
		}
		const consequentStart = conditionEnd + 1;
		const consequentEnd = cppNullishReturnConsequentEnd(tokens, pairs, consequentStart, info.bodyEnd);
		if (consequentEnd < 0) {
			continue;
		}
		const returnStart = consequentEnd + 1;
		if (tokens[returnStart]?.text === 'else' || tokens[returnStart]?.text !== 'return') {
			continue;
		}
		const returnEnd = findTopLevelCppSemicolon(tokens, returnStart, info.bodyEnd);
		if (returnEnd < 0) {
			continue;
		}
		const returnedExpression = trimmedCppExpressionText(tokens, returnStart + 1, returnEnd);
		if (!cppExpressionUsesGuardedValue(returnedExpression, guardedExpression)) {
			continue;
		}
		pushLintIssue(
			issues,
			file,
			tokens[index],
			'nullish_return_guard_pattern',
			'Nullish guard that only returns nullptr before returning the guarded value is forbidden. Keep the compact expression form instead of expanding it into a branch.',
		);
	}
}

function cppNullishReturnConsequentEnd(tokens: readonly CppToken[], pairs: readonly number[], start: number, bodyEnd: number): number {
	if (tokens[start]?.text === '{') {
		const closeBrace = pairs[start];
		if (closeBrace < 0 || closeBrace > bodyEnd) {
			return -1;
		}
		const returnEnd = findTopLevelCppSemicolon(tokens, start + 1, closeBrace);
		if (returnEnd < 0 || returnEnd + 1 !== closeBrace || !cppStatementReturnsNull(tokens, start + 1, returnEnd)) {
			return -1;
		}
		return closeBrace;
	}
	const returnEnd = findTopLevelCppSemicolon(tokens, start, bodyEnd);
	if (returnEnd < 0 || !cppStatementReturnsNull(tokens, start, returnEnd)) {
		return -1;
	}
	return returnEnd;
}

function cppStatementReturnsNull(tokens: readonly CppToken[], start: number, end: number): boolean {
	return tokens[start]?.text === 'return' && end === start + 2 && isCppNullToken(tokens[start + 1]);
}

function cppNullishGuardExpression(tokens: readonly CppToken[], start: number, end: number): string | null {
	const orIndex = findTopLevelCppOperator(tokens, start, end, '||');
	if (orIndex >= 0) {
		const left = cppNullishGuardExpression(tokens, start, orIndex);
		const right = cppNullishGuardExpression(tokens, orIndex + 1, end);
		return left !== null && left === right ? left : null;
	}
	const equalsIndex = findTopLevelCppOperator(tokens, start, end, '==');
	if (equalsIndex < 0) {
		return null;
	}
	if (cppRangeIsNull(tokens, start, equalsIndex)) {
		return trimmedCppExpressionText(tokens, equalsIndex + 1, end);
	}
	if (cppRangeIsNull(tokens, equalsIndex + 1, end)) {
		return trimmedCppExpressionText(tokens, start, equalsIndex);
	}
	return null;
}

function findTopLevelCppOperator(tokens: readonly CppToken[], start: number, end: number, operator: string): number {
	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;
	for (let index = start; index < end; index += 1) {
		const text = tokens[index].text;
		if (text === '(') parenDepth += 1;
		else if (text === ')') parenDepth -= 1;
		else if (text === '[') bracketDepth += 1;
		else if (text === ']') bracketDepth -= 1;
		else if (text === '{') braceDepth += 1;
		else if (text === '}') braceDepth -= 1;
		else if (text === operator && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) return index;
	}
	return -1;
}

function cppRangeIsNull(tokens: readonly CppToken[], start: number, end: number): boolean {
	while (start < end && tokens[start].text === '(' && tokens[end - 1]?.text === ')') {
		start += 1;
		end -= 1;
	}
	return end === start + 1 && isCppNullToken(tokens[start]);
}

function cppExpressionUsesGuardedValue(expression: string, guardedExpression: string): boolean {
	return expression === guardedExpression
		|| expression.startsWith(`${guardedExpression}.`)
		|| expression.startsWith(`${guardedExpression}->`)
		|| expression.startsWith(`${guardedExpression}[`);
}

function cppIfBranchEnd(tokens: readonly CppToken[], pairs: readonly number[], start: number, bodyEnd: number): number {
	if (tokens[start]?.text === '{') {
		const closeBrace = pairs[start];
		if (closeBrace < 0 || closeBrace > bodyEnd) {
			return -1;
		}
		return closeBrace;
	}
	return findTopLevelCppSemicolon(tokens, start, bodyEnd);
}

function stringSwitchComparisonSubject(tokens: readonly CppToken[], start: number, end: number): string | null {
	for (let index = start; index < end; index += 1) {
		if (tokens[index].text !== '==') {
			continue;
		}
		if (cppRangeHas(tokens, start, index, token => token.kind === 'string') && !cppRangeHas(tokens, index + 1, end, token => token.kind === 'string')) {
			return trimmedCppExpressionText(tokens, index + 1, end);
		}
		if (cppRangeHas(tokens, index + 1, end, token => token.kind === 'string') && !cppRangeHas(tokens, start, index, token => token.kind === 'string')) {
			return trimmedCppExpressionText(tokens, start, index);
		}
	}
	return null;
}

function lintStringOrChains(file: string, tokens: readonly CppToken[], issues: CppLintIssue[]): void {
	const visited = new Set<number>();
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index].text !== '||') {
			continue;
		}
		const start = findPreviousCppDelimiter(tokens, index) + 1;
		if (visited.has(start)) {
			continue;
		}
		visited.add(start);
		const end = findNextCppDelimiter(tokens, index);
		const subjects: string[] = [];
		let segmentStart = start;
		for (let cursor = start; cursor <= end; cursor += 1) {
			if (cursor === end || tokens[cursor].text === '||') {
				const subject = stringComparisonSubject(tokens, segmentStart, cursor);
				if (subject !== null) {
					subjects.push(subject);
				}
				segmentStart = cursor + 1;
			}
		}
			if (subjects.length <= 2) {
				continue;
			}
		const first = subjects[0];
		let sameSubject = true;
		for (let subjectIndex = 1; subjectIndex < subjects.length; subjectIndex += 1) {
			if (subjects[subjectIndex] !== first) {
				sameSubject = false;
				break;
			}
		}
		if (sameSubject) {
			pushLintIssue(issues, file, tokens[index], 'string_or_chain_comparison_pattern', 'Multiple OR-comparisons against the same expression with string literals are forbidden. Use switch-statement or set-like lookups instead.');
		}
	}
}

export function lintCppStringSwitchChains(file: string, tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, issues: CppLintIssue[]): void {
	for (let index = info.bodyStart + 1; index < info.bodyEnd; index += 1) {
		if (tokens[index].text !== 'if' || tokens[index - 1]?.text === 'else') {
			continue;
		}
		const subjects: string[] = [];
		let currentIfIndex = index;
		while (true) {
			if (tokens[currentIfIndex]?.text !== 'if' || tokens[currentIfIndex + 1]?.text !== '(') {
				subjects.length = 0;
				break;
			}
			const conditionStart = currentIfIndex + 2;
			const conditionEnd = pairs[currentIfIndex + 1];
			if (conditionEnd < 0 || conditionEnd >= info.bodyEnd) {
				subjects.length = 0;
				break;
			}
			const subject = stringSwitchComparisonSubject(tokens, conditionStart, conditionEnd);
			if (subject === null) {
				subjects.length = 0;
				break;
			}
			subjects.push(subject);
			const consequentEnd = cppIfBranchEnd(tokens, pairs, conditionEnd + 1, info.bodyEnd);
			if (consequentEnd < 0) {
				subjects.length = 0;
				break;
			}
			if (tokens[consequentEnd + 1]?.text !== 'else') {
				break;
			}
			currentIfIndex = consequentEnd + 2;
			if (tokens[currentIfIndex]?.text !== 'if') {
				break;
			}
		}
		if (subjects.length < 3) {
			continue;
		}
		const first = subjects[0];
		let sameSubject = true;
		for (let subjectIndex = 1; subjectIndex < subjects.length; subjectIndex += 1) {
			if (subjects[subjectIndex] !== first) {
				sameSubject = false;
				break;
			}
		}
		if (sameSubject) {
			pushLintIssue(issues, file, tokens[index], 'string_switch_chain_pattern', 'Multiple string comparisons against the same expression are forbidden. Use switch-statement or lookup table instead.');
		}
	}
}

function stringComparisonSubject(tokens: readonly CppToken[], start: number, end: number): string | null {
	for (let index = start; index < end; index += 1) {
		if (tokens[index].text !== '==' && tokens[index].text !== '!=') {
			continue;
		}
		if (cppRangeHas(tokens, start, index, token => token.kind === 'string') && !cppRangeHas(tokens, index + 1, end, token => token.kind === 'string')) {
			return trimmedCppExpressionText(tokens, index + 1, end);
		}
		if (cppRangeHas(tokens, index + 1, end, token => token.kind === 'string') && !cppRangeHas(tokens, start, index, token => token.kind === 'string')) {
			return trimmedCppExpressionText(tokens, start, index);
		}
	}
	return null;
}

export function lintCppHotPathCalls(file: string, tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, issues: CppLintIssue[]): void {
	if (!isHotPathFunction(file, info)) {
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
			pushLintIssue(issues, file, tokens[index - 1], 'numeric_defensive_sanitization_pattern', 'Defensive numeric sanitization in hot paths is forbidden. Coordinates, cycles, and layout values must already be valid.');
		}
		const args = splitCppArgumentRanges(tokens, index + 1, pairs[index]);
		for (let argIndex = 0; argIndex < args.length; argIndex += 1) {
			const argStart = args[argIndex][0];
			const argEnd = args[argIndex][1];
			if (rangeContainsCapturingLambda(tokens, argStart, argEnd)) {
				pushLintIssue(issues, file, tokens[argStart], 'hot_path_closure_argument_pattern', 'Lambda/closure argument allocation in hot-path calls is forbidden. Move ownership to direct methods or stable state.');
			}
			if (rangeContainsTemporaryAllocation(tokens, argStart, argEnd)) {
				pushLintIssue(issues, file, tokens[argStart], 'hot_path_object_literal_pattern', 'Temporary object/container allocation in hot-path calls is forbidden. Pass primitives or reuse state/scratch storage.');
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

export function lintCppRepeatedExpressions(file: string, tokens: readonly CppToken[], _pairs: readonly number[], info: CppFunctionInfo, issues: CppLintIssue[]): void {
	const expressions = new Map<string, { token: CppToken; count: number }>();
	const record = (start: number, end: number): void => {
		const text = normalizedCppTokenText(tokens, start, end);
		if (text.length < 24 || text.startsWith('this.') || text.startsWith('this->')) {
			return;
		}
		const existing = expressions.get(text);
		if (existing !== undefined) {
			existing.count += 1;
			return;
		}
		expressions.set(text, { token: tokens[start], count: 1 });
	};
	const ranges = collectCppStatementRanges(tokens, info.bodyStart + 1, info.bodyEnd);
	for (let index = 0; index < ranges.length; index += 1) {
		const start = ranges[index][0];
		const end = ranges[index][1];
		if (cppRangeHas(tokens, start, end, token => token.text === '==' || token.text === '!=' || token.text === '<' || token.text === '>')) {
			record(start, end);
		}
	}
	for (const [text, value] of expressions) {
		if (value.count <= 2) {
			continue;
		}
		issues.push({
			kind: 'repeated_expression_pattern',
			file,
			line: value.token.line,
			column: value.token.column,
			name: 'repeated_expression_pattern',
			message: `Expression is repeated ${value.count} times in the same scope: ${compactSampleText(text)}`,
		});
	}
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
			kind: 'semantic_repeated_expression_pattern',
			file,
			line: value.token.line,
			column: value.token.column,
			name: 'semantic_repeated_expression_pattern',
			message: `Semantic transform call is repeated ${value.count} times in the same scope: ${value.sampleText}`,
		});
	}
}

export function collectCppNormalizedBody(file: string, tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, normalizedBodies: CppNormalizedBodyInfo[]): void {
	if (info.name.endsWith('Thunk')) {
		return;
	}
	const semanticNormalization = info.wrapperTarget !== null && isSemanticNormalizationWrapperTarget(info.wrapperTarget);
	if (info.wrapperTarget !== null && !semanticNormalization) {
		return;
	}
	const bodyText = normalizedCppTokenText(tokens, info.bodyStart + 1, info.bodyEnd);
	const semanticSignatures = collectSemanticBodySignatures(tokens, pairs, info.bodyStart + 1, info.bodyEnd);
	const semanticBody = semanticSignatures.length > 0;
	if (!semanticBody && bodyText.length < CPP_NORMALIZED_BODY_MIN_LENGTH) {
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

export function lintCppCrossLayerIncludes(file: string, source: string, issues: CppLintIssue[]): void {
	const sourceLayer = ideLayer(file);
	if (sourceLayer === null) {
		return;
	}
	const lines = source.split('\n');
	for (let index = 0; index < lines.length; index += 1) {
		const match = /^\s*#\s*include\s+"([^"]+)"/.exec(lines[index]);
		if (match === null || !match[1].startsWith('.')) {
			continue;
		}
		const targetLayer = ideLayer(resolve(dirname(file), match[1]));
		if (targetLayer === null) {
			continue;
		}
		const reason = forbiddenLayerImportReason(sourceLayer, targetLayer);
		if (reason === null) {
			continue;
		}
		issues.push({
			kind: 'cross_layer_import_pattern',
			file,
			line: index + 1,
			column: lines[index].indexOf(match[1]) + 1,
			name: 'cross_layer_import_pattern',
			message: reason,
		});
	}
}

function ideLayer(path: string): string | null {
	const normalized = normalizePathForAnalysis(path);
	const marker = '/src/bmsx_cpp/ide/';
	const index = normalized.indexOf(marker);
	if (index === -1) {
		return null;
	}
	const rest = normalized.slice(index + marker.length);
	const slash = rest.indexOf('/');
	return slash === -1 ? rest : rest.slice(0, slash);
}

function forbiddenLayerImportReason(sourceLayer: string, targetLayer: string): string | null {
	if (sourceLayer === targetLayer) {
		return null;
	}
	if (sourceLayer === 'common') {
		return `ide/common must not include ${targetLayer}; common code must stay below feature layers.`;
	}
	if (sourceLayer === 'language' && targetLayer !== 'common') {
		return `ide/language must not include ${targetLayer}; language code must stay UI/workbench independent.`;
	}
	if (sourceLayer === 'terminal' && (targetLayer === 'editor' || targetLayer === 'workbench')) {
		return `ide/terminal must not include ${targetLayer}; terminal code must not depend on editor/workbench internals.`;
	}
	if (sourceLayer === 'editor' && targetLayer === 'workbench') {
		return 'ide/editor must not include ide/workbench; workbench may compose editor, not the reverse.';
	}
	if (sourceLayer === 'workbench' && targetLayer === 'editor') {
		return 'ide/workbench must not include deep editor internals directly; route shared contracts through common modules.';
	}
	if (sourceLayer === 'runtime' && (targetLayer === 'editor' || targetLayer === 'workbench')) {
		return `ide/runtime must not include ${targetLayer}; runtime glue must not own UI feature internals.`;
	}
	return null;
}
