import { dirname, isAbsolute, resolve } from 'node:path';

import type { CppFunctionInfo } from '../../../src/bmsx/language/cpp/syntax/declarations';
import type { CppLintIssue, CppNormalizedBodyInfo } from './diagnostics';
import { pushLintIssue } from './diagnostics';
import {
	collectCppStatementRanges,
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
	hasInitializer: boolean;
	readCount: number;
	writeCount: number;
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
	'ceil',
	'floor',
	'isfinite',
	'round',
	'std::ceil',
	'std::floor',
	'std::isfinite',
	'std::round',
	'std::trunc',
	'trunc',
]);

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

function isHotPathFile(fileName: string): boolean {
	const normalized = normalizePathForAnalysis(isAbsolute(fileName) ? fileName : resolve(process.cwd(), fileName));
	for (let index = 0; index < HOT_PATH_SEGMENTS.length; index += 1) {
		if (normalized.includes(HOT_PATH_SEGMENTS[index])) {
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

export function lintCppLocalBindings(file: string, tokens: readonly CppToken[], info: CppFunctionInfo, issues: CppLintIssue[]): void {
	const ranges = collectCppStatementRanges(tokens, info.bodyStart + 1, info.bodyEnd);
	for (let index = 0; index < ranges.length; index += 1) {
		const binding = declarationFromStatement(tokens, ranges[index][0], ranges[index][1]);
		if (binding === null) {
			continue;
		}
		markBindingUses(binding, tokens, info.bodyStart, info.bodyEnd);
		if (!binding.isConst && !binding.isReference && binding.hasInitializer && binding.writeCount === 0) {
			pushLintIssue(issues, file, tokens[binding.nameToken], 'local_const_pattern', `Prefer "const" for "${binding.name}"; it is never reassigned.`);
		}
		if (binding.readCount === 1 && shouldReportSingleUseLocal(binding)) {
			pushLintIssue(issues, file, tokens[binding.nameToken], 'single_use_local_pattern', `Local alias "${binding.name}" is read only once in this scope.`);
		}
	}
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
	const nameToken = tokens[nameIndex];
	if (DECLARATION_NAME_BLOCKLIST.has(nameToken.text) || isIgnoredName(nameToken.text)) {
		return null;
	}
	const initializerText = trimmedCppExpressionText(tokens, initializerIndex + 1, end);
	let isConst = isLeadingConst;
	let isReference = false;
	for (let index = declarationStart; index < nameIndex; index += 1) {
		if (tokens[index].text === 'const' || tokens[index].text === 'constexpr') {
			isConst = true;
			break;
		}
		if (tokens[index].text === '&' || tokens[index].text === '&&') {
			isReference = true;
		}
	}
	return {
		name: nameToken.text,
		nameToken: nameIndex,
		line: nameToken.line,
		column: nameToken.column,
		isConst,
		isReference,
		hasInitializer: true,
		readCount: 0,
		writeCount: 0,
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

function shouldReportSingleUseLocal(binding: CppLocalBinding): boolean {
	if (!binding.hasInitializer || !binding.isSimpleAliasInitializer) {
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
	const trueHasEmpty = cppRangeHas(tokens, questionIndex + 1, colonIndex, isCppEmptyStringToken);
	const falseHasEmpty = cppRangeHas(tokens, colonIndex + 1, statementEnd, isCppEmptyStringToken);
	if (trueHasEmpty || falseHasEmpty) {
		pushLintIssue(issues, file, tokens[questionIndex], 'empty_string_fallback_pattern', 'Empty-string fallback through a conditional expression is forbidden. Do not use empty strings as default values.');
	}
	const trueHasNull = cppRangeHas(tokens, questionIndex + 1, colonIndex, isCppNullToken);
	const falseHasNull = cppRangeHas(tokens, colonIndex + 1, statementEnd, isCppNullToken);
	if (trueHasNull || falseHasNull) {
		pushLintIssue(issues, file, tokens[questionIndex], 'or_nil_fallback_pattern', '`nullptr` fallback through a conditional expression is forbidden. Use direct ownership checks or optional state.');
	}
	const condition = trimmedCppExpressionText(tokens, statementStart, questionIndex);
	const trueBranch = trimmedCppExpressionText(tokens, questionIndex + 1, colonIndex);
	const falseBranch = trimmedCppExpressionText(tokens, colonIndex + 1, statementEnd);
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
		if (subjects.length <= 1) {
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

export function lintCppHotPathCalls(file: string, tokens: readonly CppToken[], pairs: readonly number[], issues: CppLintIssue[]): void {
	if (!isHotPathFile(file)) {
		return;
	}
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index].text !== '(' || pairs[index] < 0) {
			continue;
		}
		if (isCppFunctionDeclaratorParen(tokens, pairs, index)) {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (target === null) {
			continue;
		}
		if (NUMERIC_DEFENSIVE_CALLS.has(target)) {
			pushLintIssue(issues, file, tokens[index - 1], 'numeric_defensive_sanitization_pattern', 'Defensive numeric sanitization in hot paths is forbidden. Coordinates, cycles, and layout values must already be valid.');
		}
		const args = splitCppArgumentRanges(tokens, index + 1, pairs[index]);
		for (let argIndex = 0; argIndex < args.length; argIndex += 1) {
			const argStart = args[argIndex][0];
			const argEnd = args[argIndex][1];
			if (rangeContainsLambda(tokens, argStart, argEnd)) {
				pushLintIssue(issues, file, tokens[argStart], 'hot_path_closure_argument_pattern', 'Lambda/closure argument allocation in hot-path calls is forbidden. Move ownership to direct methods or stable state.');
			}
			if (rangeContainsTemporaryAllocation(tokens, argStart, argEnd)) {
				pushLintIssue(issues, file, tokens[argStart], 'hot_path_object_literal_pattern', 'Temporary object/container allocation in hot-path calls is forbidden. Pass primitives or reuse state/scratch storage.');
			}
		}
	}
}

function rangeContainsLambda(tokens: readonly CppToken[], start: number, end: number): boolean {
	for (let index = start; index < end; index += 1) {
		if (tokens[index].text === '[') {
			const close = findNextCppTokenText(tokens, index + 1, end, ']');
			if (close >= 0 && findNextCppTokenText(tokens, close + 1, end, '{') >= 0) {
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
			message: `Expression is repeated ${value.count} times in the same scope: ${text}`,
		});
	}
}

export function collectCppNormalizedBody(file: string, tokens: readonly CppToken[], info: CppFunctionInfo, normalizedBodies: CppNormalizedBodyInfo[]): void {
	if (info.wrapperTarget !== null) {
		return;
	}
	const bodyText = normalizedCppTokenText(tokens, info.bodyStart + 1, info.bodyEnd);
	if (bodyText.length < 120) {
		return;
	}
	normalizedBodies.push({
		name: info.qualifiedName,
		file,
		line: tokens[info.nameToken].line,
		column: tokens[info.nameToken].column,
		fingerprint: normalizedBodyFingerprint(tokens, info.bodyStart + 1, info.bodyEnd),
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
