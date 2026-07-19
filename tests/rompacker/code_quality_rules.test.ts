import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { createQualityLedger } from '../../scripts/analysis/quality_ledger';
import type { LintIssue } from '../../scripts/analysis/cpp_quality/diagnostics';
import {
	addTokenRepeatedStatementSequenceIssues,
	collectTokenRepeatedStatementSequences,
	type TokenStatementSequenceInfo,
} from '../../scripts/lint/rules/common/repeated_statement_sequence_pattern';
import { isSingleLineWrapperCandidate } from '../../scripts/lint/rules/ts/support/declarations';
import { collectFunctionDefinitions } from '../../scripts/lint/language/cpp/syntax/declarations';
import { buildPairMap, tokenize } from '../../scripts/lint/language/cpp/syntax/tokens';

function parseFirstFunction(source: string): ts.FunctionDeclaration {
	const sourceFile = ts.createSourceFile('sample.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const declaration = sourceFile.statements.find(ts.isFunctionDeclaration);
	assert.ok(declaration, 'expected function declaration');
	return declaration;
}

function repeatedCppStatementIssues(source: string): LintIssue[] {
	const tokens = tokenize(source);
	const pairs = buildPairMap(tokens);
	const sequences: TokenStatementSequenceInfo[] = [];
	const functions = collectFunctionDefinitions(tokens, pairs, []);
	for (let index = 0; index < functions.length; index += 1) {
		collectTokenRepeatedStatementSequences('sample.cpp', tokens, functions[index], [], sequences);
	}
	const issues: LintIssue[] = [];
	addTokenRepeatedStatementSequenceIssues(sequences, issues, createQualityLedger());
	return issues;
}

test('single-line wrapper rule catches return-await delegation', () => {
	const declaration = parseFirstFunction(`
		export async function loadAemResourceSource(runtime: Runtime, path: string): Promise<string> {
			return await loadWorkspaceSourceFile(path, runtime.cartProjectRootPath);
		}
	`);
	assert.equal(isSingleLineWrapperCandidate(declaration, declaration.getSourceFile()), true);
});

test('single-line wrapper rule catches awaited statement delegation', () => {
	const declaration = parseFirstFunction(`
		export async function saveAemResourceSource(runtime: Runtime, path: string, source: string): Promise<void> {
			await persistWorkspaceSourceFile(path, source, runtime.cartProjectRootPath);
		}
	`);
	assert.equal(isSingleLineWrapperCandidate(declaration, declaration.getSourceFile()), true);
});

test('C++ repeated statement sequences preserve distinct guard topology', () => {
	const issues = repeatedCppStatementIssues(`
		void progressiveScanout() {
			prepareScanoutFramebufferAndRetainedState();
			if (backgroundRequired) {
				publishBackgroundColorToFramebufferClearState();
				clearCompleteFramebufferColorAttachment();
			}
			enableScanoutScissorForCircuitComposition();
		}

		void interlacedScanout() {
			prepareScanoutFramebufferAndRetainedState();
			if (invalidFields || backgroundRequired) {
				publishBackgroundColorToFramebufferClearState();
			}
			if (invalidFields) {
				clearCompleteFramebufferColorAttachment();
			}
			enableScanoutScissorForCircuitComposition();
		}
	`);
	assert.equal(issues.length, 0);
});

test('C++ repeated statement sequences still report matching guarded blocks', () => {
	const issues = repeatedCppStatementIssues(`
		void firstScanout() {
			prepareScanoutFramebufferAndRetainedState();
			if (backgroundRequired) {
				publishBackgroundColorToFramebufferClearState();
				clearCompleteFramebufferColorAttachment();
			}
			enableScanoutScissorForCircuitComposition();
		}

		void secondScanout() {
			prepareScanoutFramebufferAndRetainedState();
			if (backgroundRequired) {
				publishBackgroundColorToFramebufferClearState();
				clearCompleteFramebufferColorAttachment();
			}
			enableScanoutScissorForCircuitComposition();
		}
	`);
	assert.equal(issues.length, 2);
});
