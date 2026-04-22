import ts from 'typescript';
import { type LintRuleName } from './rule';

export type TsLintIssue = {
	kind: LintRuleName;
	file: string;
	line: number;
	column: number;
	name: string;
	message: string;
};

export function pushTsLintIssue(
	issues: TsLintIssue[],
	sourceFile: ts.SourceFile,
	node: ts.Node,
	kind: LintRuleName,
	message: string,
	name = kind,
): void {
	const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
	issues.push({
		kind,
		file: sourceFile.fileName,
		line: position.line + 1,
		column: position.character + 1,
		name,
		message,
	});
}

export function tsNodeStartLine(sourceFile: ts.SourceFile, node: ts.Node): number {
	return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}
