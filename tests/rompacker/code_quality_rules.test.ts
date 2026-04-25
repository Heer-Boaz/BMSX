import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { isSingleLineWrapperCandidate } from '../../scripts/lint/rules/ts/support/declarations';

function parseFirstFunction(source: string): ts.FunctionDeclaration {
	const sourceFile = ts.createSourceFile('sample.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const declaration = sourceFile.statements.find(ts.isFunctionDeclaration);
	assert.ok(declaration, 'expected function declaration');
	return declaration;
}

test('single-line wrapper rule catches return-await delegation', () => {
	const declaration = parseFirstFunction(`
		export async function loadAemResourceSource(path: string): Promise<string> {
			return await loadWorkspaceSourceFile(path, Runtime.instance.cartProjectRootPath);
		}
	`);
	assert.equal(isSingleLineWrapperCandidate(declaration, declaration.getSourceFile()), true);
});

test('single-line wrapper rule catches awaited statement delegation', () => {
	const declaration = parseFirstFunction(`
		export async function saveAemResourceSource(path: string, source: string): Promise<void> {
			await persistWorkspaceSourceFile(path, source, Runtime.instance.cartProjectRootPath);
		}
	`);
	assert.equal(isSingleLineWrapperCandidate(declaration, declaration.getSourceFile()), true);
});
