import ts from 'typescript';
import type { CppFunctionInfo } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import type { CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushLintIssue, type CppLintIssue } from '../cpp/support/diagnostics';
import { defineLintRule } from '../../rule';
import { pushTsLintIssue, type TsLintIssue } from '../../ts_rule';

export const uselessTerminalReturnPatternRule = defineLintRule('common', 'useless_terminal_return_pattern');

export type TsFunctionWithBlockBody =
	ts.FunctionDeclaration |
	ts.MethodDeclaration |
	ts.FunctionExpression |
	ts.ArrowFunction;

export function lintUselessTerminalReturnPattern(
	node: TsFunctionWithBlockBody,
	sourceFile: ts.SourceFile,
	issues: TsLintIssue[],
): void {
	const body = node.body;
	if (body === undefined || !ts.isBlock(body) || body.statements.length === 0) {
		return;
	}
	const lastStatement = body.statements[body.statements.length - 1];
	if (!ts.isReturnStatement(lastStatement) || lastStatement.expression !== undefined) {
		return;
	}
	pushTsLintIssue(
		issues,
		sourceFile,
		lastStatement,
		uselessTerminalReturnPatternRule.name,
		'Terminal `return;` is forbidden. Remove no-op returns instead of padding the body.',
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
		uselessTerminalReturnPatternRule.name,
		'Terminal `return;` is forbidden. Remove no-op returns instead of padding the body.',
	);
}
