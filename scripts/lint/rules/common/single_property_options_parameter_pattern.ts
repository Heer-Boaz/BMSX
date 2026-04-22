import ts from 'typescript';
import type { CppClassRange } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import { cppRangeHas } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushLintIssue, type CppLintIssue } from '../cpp/support/diagnostics';
import { defineLintRule } from '../../rule';
import { pushTsLintIssue, type TsLintIssue } from '../../ts_rule';
import { type LuaFunctionExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { collectLuaOptionsParameterUseInStatements } from '../lua_cart/impl/support/functions';
import { LuaOptionsParameterUse } from '../lua_cart/impl/support/types';
import { pushIssue } from '../lua_cart/impl/support/lint_context';

export const singlePropertyOptionsParameterPatternRule = defineLintRule('common', 'single_property_options_parameter_pattern');

export type TsFunctionWithParameters =
	ts.FunctionDeclaration |
	ts.MethodDeclaration |
	ts.FunctionExpression |
	ts.ArrowFunction;

export function isSinglePropertyOptionsType(type: ts.TypeNode | undefined): boolean {
	if (type === undefined || !ts.isTypeLiteralNode(type)) {
		return false;
	}
	let propertyCount = 0;
	for (let index = 0; index < type.members.length; index += 1) {
		if (!ts.isPropertySignature(type.members[index])) {
			return false;
		}
		propertyCount += 1;
	}
	return propertyCount === 1;
}

export function lintSinglePropertyOptionsParameterPattern(
	node: TsFunctionWithParameters,
	sourceFile: ts.SourceFile,
	issues: TsLintIssue[],
	isIgnoredMethod: (node: ts.MethodDeclaration) => boolean,
): void {
	if (ts.isMethodDeclaration(node) && (node.body === undefined || isIgnoredMethod(node))) {
		return;
	}
	if (ts.isFunctionDeclaration(node) && node.body === undefined) {
		return;
	}
	for (let index = 0; index < node.parameters.length; index += 1) {
		const parameter = node.parameters[index];
		if (!ts.isIdentifier(parameter.name)) {
			continue;
		}
		const name = parameter.name.text;
		if (name !== 'opts' && name !== 'options') {
			continue;
		}
		if (!isSinglePropertyOptionsType(parameter.type)) {
			continue;
		}
		pushTsLintIssue(
			issues,
			sourceFile,
			parameter.name,
			singlePropertyOptionsParameterPatternRule.name,
			'Single-property opts/options parameters are forbidden. Use a direct parameter or split the operation instead of implying future extensibility.',
		);
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
			singlePropertyOptionsParameterPatternRule.name,
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

export function lintSinglePropertyOptionsParameter(functionExpression: LuaFunctionExpression, issues: LuaLintIssue[]): void {
	for (const parameter of functionExpression.parameters) {
		if (parameter.name !== 'opts' && parameter.name !== 'options') {
			continue;
		}
		const use: LuaOptionsParameterUse = {
			fields: new Set<string>(),
			bareReads: 0,
			dynamicReads: 0,
		};
		collectLuaOptionsParameterUseInStatements(functionExpression.body.body, parameter.name, use);
		if (use.fields.size !== 1 || use.bareReads !== 0 || use.dynamicReads !== 0) {
			continue;
		}
		pushIssue(
			issues,
			singlePropertyOptionsParameterPatternRule.name,
			parameter,
			`Single-property options parameter "${parameter.name}" is forbidden. Use a direct parameter or split the operation instead of implying future extensibility.`,
		);
	}
}
