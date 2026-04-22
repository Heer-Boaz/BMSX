import { type CppFunctionInfo } from '../../../../../src/bmsx/language/cpp/syntax/declarations';
import { isCppAssignmentOperator } from '../../../../../src/bmsx/language/cpp/syntax/syntax';
import { type CppToken } from '../../../../../src/bmsx/language/cpp/syntax/tokens';
import { type AnalysisRegion, lineInAnalysisRegion } from '../../../../analysis/lint_suppressions';
import { DECLARATION_PREFIX_ALLOWED_OPERATORS, DECLARATION_PREFIX_ALLOWED_PUNCTUATION, isCppSingleUseSuppressingToken, isCppTemporalSnapshotName } from './ast';
import { isHotPathFunction } from './numeric';
import { CppLocalBinding } from './types';

export function isIgnoredName(name: string): boolean {
	return name.length === 0 || name === '_' || name.startsWith('_');
}

export function isCppConstructorLike(info: CppFunctionInfo): boolean {
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

export function cppLocalConstCandidateKind(info: CppFunctionInfo, regions: readonly AnalysisRegion[], tokens: readonly CppToken[], binding: CppLocalBinding): string {
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

export function hasCppDeclarationPrefixNoise(tokens: readonly CppToken[], start: number, nameIndex: number): boolean {
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

export function cppLocalBindingValueKind(binding: CppLocalBinding): string {
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

export function isCppScalarLocalType(typeText: string): boolean {
	return /^(?:u?int(?:8|16|32|64)?_t|[ui](?:8|16|32|64)|size_t|std::size_t|ptrdiff_t|std::ptrdiff_t|float|double|f32|f64|bool|char|unsigned char|signed char|short|unsigned short|int|unsigned int|long|unsigned long|long long|unsigned long long)\b/.test(typeText);
}

export function cppLocalBindingReadBucket(binding: CppLocalBinding): string {
	return binding.readCount >= 2 ? 'reused' : 'single_read';
}

export function markBindingUses(binding: CppLocalBinding, tokens: readonly CppToken[], bodyStart: number, bodyEnd: number): void {
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

export function shouldReportCppLocalConst(binding: CppLocalBinding): boolean {
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

export function shouldReportSingleUseLocal(binding: CppLocalBinding): boolean {
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

export function isWriteUse(tokens: readonly CppToken[], index: number): boolean {
	return isCppAssignmentOperator(tokens[index + 1]?.text) || tokens[index + 1]?.text === '++' || tokens[index + 1]?.text === '--' ||
		tokens[index - 1]?.text === '++' || tokens[index - 1]?.text === '--';
}
