import ts from 'typescript';
import { lineInAnalysisRegion, type AnalysisRegion } from '../../../analysis/lint_suppressions';
import type { CppLintIssue } from '../cpp/support/diagnostics';
import { noteQualityLedger, type QualityLedger } from '../../../analysis/quality_ledger';
import type { CppFunctionInfo } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import { collectCppStatementRanges } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import { normalizedCppTokenText, type CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { defineLintRule } from '../../rule';
import { compactStatementText } from '../../ts_node';
import type { TsLintIssue } from '../../ts_rule';

export const repeatedStatementSequencePatternRule = defineLintRule('common', 'repeated_statement_sequence_pattern');

const REPEATED_STATEMENT_SEQUENCE_MIN_COUNT = 4;
const REPEATED_STATEMENT_SEQUENCE_MIN_TEXT_LENGTH = 140;
const CPP_REPEATED_STATEMENT_SEQUENCE_MIN_COUNT = 4;
const CPP_REPEATED_STATEMENT_SEQUENCE_MIN_TEXT_LENGTH = 140;
const CPP_REPEATED_STATEMENT_SEQUENCE_PATTERN_ENABLED = true;

export type StatementSequenceInfo = {
	file: string;
	line: number;
	column: number;
	endLine: number;
	statementCount: number;
	textLength: number;
	fingerprint: string;
};

export type CppStatementSequenceInfo = {
	file: string;
	line: number;
	column: number;
	endLine: number;
	functionName: string;
	statementCount: number;
	textLength: number;
	fingerprint: string;
};

export function collectRepeatedStatementSequences(
	statements: ts.NodeArray<ts.Statement>,
	sourceFile: ts.SourceFile,
	regions: readonly AnalysisRegion[],
	sequences: StatementSequenceInfo[],
): void {
	if (statements.length < REPEATED_STATEMENT_SEQUENCE_MIN_COUNT) {
		return;
	}
	const statementTexts: string[] = [];
	for (let index = 0; index < statements.length; index += 1) {
		const statement = statements[index];
		statementTexts.push(ts.isEmptyStatement(statement) || ts.isImportDeclaration(statement) ? '' : compactStatementText(statement, sourceFile));
	}
	for (let index = 0; index <= statements.length - REPEATED_STATEMENT_SEQUENCE_MIN_COUNT; index += 1) {
		let textLength = 0;
		let usable = true;
		const parts: string[] = [];
		for (let offset = 0; offset < REPEATED_STATEMENT_SEQUENCE_MIN_COUNT; offset += 1) {
			const text = statementTexts[index + offset];
			if (text.length === 0) {
				usable = false;
				break;
			}
			textLength += text.length;
			parts.push(text);
		}
		if (!usable || textLength < REPEATED_STATEMENT_SEQUENCE_MIN_TEXT_LENGTH) {
			continue;
		}
		const first = statements[index];
		const last = statements[index + REPEATED_STATEMENT_SEQUENCE_MIN_COUNT - 1];
		const start = sourceFile.getLineAndCharacterOfPosition(first.getStart(sourceFile));
		if (lineInAnalysisRegion(regions, 'repeated-sequence-acceptable', start.line + 1)) {
			continue;
		}
		const end = sourceFile.getLineAndCharacterOfPosition(last.getEnd());
		sequences.push({
			file: sourceFile.fileName,
			line: start.line + 1,
			column: start.character + 1,
			endLine: end.line + 1,
			statementCount: REPEATED_STATEMENT_SEQUENCE_MIN_COUNT,
			textLength,
			fingerprint: parts.join('\u0000'),
		});
	}
}

export function addRepeatedStatementSequenceIssues(sequences: readonly StatementSequenceInfo[], issues: TsLintIssue[]): void {
	const byFingerprint = new Map<string, StatementSequenceInfo[]>();
	for (let index = 0; index < sequences.length; index += 1) {
		const entry = sequences[index];
		let list = byFingerprint.get(entry.fingerprint);
		if (list === undefined) {
			list = [];
			byFingerprint.set(entry.fingerprint, list);
		}
		list.push(entry);
	}
	const reportedRanges = new Map<string, Array<{ start: number; end: number }>>();
	const duplicateGroups = Array.from(byFingerprint.values())
		.filter(list => list.length > 1)
		.sort((left, right) => {
			const leftTextLength = Math.max(...left.map(entry => entry.textLength));
			const rightTextLength = Math.max(...right.map(entry => entry.textLength));
			return rightTextLength - leftTextLength || right.length - left.length;
		});
	for (let groupIndex = 0; groupIndex < duplicateGroups.length; groupIndex += 1) {
		const list = duplicateGroups[groupIndex];
		if (list.length <= 1) {
			continue;
		}
		for (let entryIndex = 0; entryIndex < list.length; entryIndex += 1) {
			const entry = list[entryIndex];
			let ranges = reportedRanges.get(entry.file);
			if (ranges === undefined) {
				ranges = [];
				reportedRanges.set(entry.file, ranges);
			}
			if (statementSequenceOverlapsReportedRange(entry, ranges)) {
				continue;
			}
			ranges.push({ start: entry.line, end: entry.endLine });
			issues.push({
				kind: repeatedStatementSequencePatternRule.name,
				file: entry.file,
				line: entry.line,
				column: entry.column,
				name: repeatedStatementSequencePatternRule.name,
				message: `${entry.statementCount} consecutive statements are copied in ${list.length} reportable places. Extract the shared operation or collapse the duplicated lifecycle block.`,
			});
		}
	}
}

function statementSequenceOverlapsReportedRange(entry: StatementSequenceInfo, ranges: readonly { start: number; end: number }[]): boolean {
	for (let index = 0; index < ranges.length; index += 1) {
		const range = ranges[index];
		if (entry.line <= range.end && entry.endLine >= range.start) {
			return true;
		}
	}
	return false;
}

export function collectCppRepeatedStatementSequences(
	file: string,
	tokens: readonly CppToken[],
	pairs: readonly number[],
	info: CppFunctionInfo,
	regions: readonly AnalysisRegion[],
	sequences: CppStatementSequenceInfo[],
): void {
	for (let index = info.bodyStart; index < info.bodyEnd; index += 1) {
		if (tokens[index].text !== '{') {
			continue;
		}
		const close = pairs[index];
		if (close < 0 || close > info.bodyEnd) {
			continue;
		}
		collectCppRepeatedStatementSequencesInBlock(file, tokens, index + 1, close, info.name, regions, sequences);
	}
}

function collectCppRepeatedStatementSequencesInBlock(
	file: string,
	tokens: readonly CppToken[],
	blockStart: number,
	blockEnd: number,
	functionName: string,
	regions: readonly AnalysisRegion[],
	sequences: CppStatementSequenceInfo[],
): void {
	const ranges = collectCppStatementRanges(tokens, blockStart, blockEnd);
	if (ranges.length < CPP_REPEATED_STATEMENT_SEQUENCE_MIN_COUNT) {
		return;
	}
	const statementTexts: string[] = [];
	for (let index = 0; index < ranges.length; index += 1) {
		statementTexts.push(normalizedCppTokenText(tokens, ranges[index][0], ranges[index][1]));
	}
	for (let index = 0; index <= ranges.length - CPP_REPEATED_STATEMENT_SEQUENCE_MIN_COUNT; index += 1) {
		let textLength = 0;
		let usable = true;
		const parts: string[] = [];
		for (let offset = 0; offset < CPP_REPEATED_STATEMENT_SEQUENCE_MIN_COUNT; offset += 1) {
			const text = statementTexts[index + offset];
			if (text.length === 0) {
				usable = false;
				break;
			}
			textLength += text.length;
			parts.push(text);
		}
		if (!usable || textLength < CPP_REPEATED_STATEMENT_SEQUENCE_MIN_TEXT_LENGTH) {
			continue;
		}
		const first = ranges[index][0];
		const last = ranges[index + CPP_REPEATED_STATEMENT_SEQUENCE_MIN_COUNT - 1][1] - 1;
		if (lineInAnalysisRegion(regions, 'repeated-sequence-acceptable', tokens[first].line)) {
			continue;
		}
		sequences.push({
			file,
			line: tokens[first].line,
			column: tokens[first].column,
			endLine: tokens[last].line,
			functionName,
			statementCount: CPP_REPEATED_STATEMENT_SEQUENCE_MIN_COUNT,
			textLength,
			fingerprint: parts.join('\u0000'),
		});
	}
}

export function addCppRepeatedStatementSequenceIssues(
	sequences: readonly CppStatementSequenceInfo[],
	issues: CppLintIssue[],
	ledger: QualityLedger,
): void {
	const byFingerprint = new Map<string, CppStatementSequenceInfo[]>();
	const seenRanges = new Set<string>();
	for (let index = 0; index < sequences.length; index += 1) {
		const entry = sequences[index];
		const key = `${entry.file}:${entry.line}:${entry.endLine}:${entry.fingerprint}`;
		if (seenRanges.has(key)) {
			continue;
		}
		seenRanges.add(key);
		let list = byFingerprint.get(entry.fingerprint);
		if (list === undefined) {
			list = [];
			byFingerprint.set(entry.fingerprint, list);
		}
		list.push(entry);
	}
	const reportedRanges = new Map<string, Array<{ start: number; end: number }>>();
	const duplicateGroups = Array.from(byFingerprint.values())
		.filter(list => list.length > 1)
		.sort((left, right) => {
			const leftTextLength = Math.max(...left.map(entry => entry.textLength));
			const rightTextLength = Math.max(...right.map(entry => entry.textLength));
			return rightTextLength - leftTextLength || right.length - left.length;
		});
	for (let groupIndex = 0; groupIndex < duplicateGroups.length; groupIndex += 1) {
		const list = duplicateGroups[groupIndex];
		if (list.length <= 1) {
			continue;
		}
		for (let entryIndex = 0; entryIndex < list.length; entryIndex += 1) {
			const entry = list[entryIndex];
			let ranges = reportedRanges.get(entry.file);
			if (ranges === undefined) {
				ranges = [];
				reportedRanges.set(entry.file, ranges);
			}
			if (cppStatementSequenceOverlapsReportedRange(entry, ranges)) {
				continue;
			}
			ranges.push({ start: entry.line, end: entry.endLine });
			noteQualityLedger(ledger, 'cpp_repeated_statement_sequence_candidate');
			if (!CPP_REPEATED_STATEMENT_SEQUENCE_PATTERN_ENABLED) {
				noteQualityLedger(ledger, 'skipped_cpp_repeated_statement_sequence_disabled');
				noteQualityLedger(ledger, `skipped_cpp_repeated_statement_sequence_${cppReportableStatementSequenceKind(entry)}`);
				continue;
			}
			issues.push({
				kind: repeatedStatementSequencePatternRule.name,
				file: entry.file,
				line: entry.line,
				column: entry.column,
				name: repeatedStatementSequencePatternRule.name,
				message: `${entry.statementCount} consecutive C++ statements are copied in ${list.length} reportable places. Extract the shared operation or collapse the duplicated lifecycle block.`,
			});
		}
	}
}

function cppReportableStatementSequenceKind(entry: CppStatementSequenceInfo): string {
	return entry.functionName.length === 0 ? 'disabled' : 'disabled_function_body';
}

function cppStatementSequenceOverlapsReportedRange(entry: CppStatementSequenceInfo, ranges: readonly { start: number; end: number }[]): boolean {
	for (let index = 0; index < ranges.length; index += 1) {
		const range = ranges[index];
		if (entry.line <= range.end && entry.endLine >= range.start) {
			return true;
		}
	}
	return false;
}
