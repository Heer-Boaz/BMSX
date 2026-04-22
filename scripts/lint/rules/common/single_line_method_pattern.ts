import { defineLintRule } from '../../rule';
import { type TsLintIssue as LintIssue } from '../../ts_rule';
import ts from 'typescript';

export const singleLineMethodPatternRule = defineLintRule('common', 'single_line_method_pattern');

export function reportSingleLineMethodIssue(
	node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
	sourceFile: ts.SourceFile,
	issues: LintIssue[],
): void {
	const position = sourceFile.getLineAndCharacterOfPosition(node.name?.getStart() ?? node.getStart());
	issues.push({
		kind: singleLineMethodPatternRule.name,
		file: sourceFile.fileName,
		line: position.line + 1,
		column: position.character + 1,
		name: singleLineMethodPatternRule.name,
		message: 'Single-line wrapper function/method is forbidden. Prefer direct logic over delegation wrappers.',
	});
}
