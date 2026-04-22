import ts from 'typescript';
import { countTopLevelDataMembers, type ClassRange } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import type { Token } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushTokenLintIssue } from '../cpp/support/diagnostics';
import { defineLintRule } from '../../rule';
import { pushLintIssue, type LintIssue } from '../ts/support/ast';
import { type LuaFunctionExpression as CartFunctionExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { collectOptionsParameterUseInStatements } from '../lua_cart/impl/support/functions';
import { OptionsParameterUse } from '../lua_cart/impl/support/types';
import { pushIssue } from '../lua_cart/impl/support/lint_context';

export const singlePropertyOptionsParameterPatternRule = defineLintRule('common', 'single_property_options_parameter_pattern');

export type FunctionWithParameters =
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
	node: FunctionWithParameters,
	sourceFile: ts.SourceFile,
	issues: LintIssue[],
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
		if (!isOptionsParameterName(name)) {
			continue;
		}
		if (!isSinglePropertyOptionsType(parameter.type)) {
			continue;
		}
		pushLintIssue(
			issues,
			sourceFile,
			parameter.name,
			singlePropertyOptionsParameterPatternRule.name,
			'Single-property opts/options parameters are forbidden. Use a direct parameter or split the operation instead of implying future extensibility.',
		);
	}
}

export function lintSinglePropertyOptionsTypes(file: string, tokens: readonly Token[], classRanges: readonly ClassRange[], issues: LintIssue[]): void {
	for (let index = 0; index < classRanges.length; index += 1) {
		const range = classRanges[index];
		if (!/(?:Options|Opts)$/.test(range.name)) {
			continue;
		}
		const memberCount = countTopLevelDataMembers(tokens, range.start + 1, range.end);
		if (memberCount !== 1) {
			continue;
		}
		pushTokenLintIssue(
			issues,
			file,
			tokens[range.nameToken],
			singlePropertyOptionsParameterPatternRule.name,
			`Single-property options type "${range.name}" is forbidden. Use a direct parameter or split the operation instead of implying future extensibility.`,
		);
	}
}

export function lintSinglePropertyOptionsParameter(functionExpression: CartFunctionExpression, issues: CartLintIssue[]): void {
	for (const parameter of functionExpression.parameters) {
		if (!isOptionsParameterName(parameter.name)) {
			continue;
		}
		const use: OptionsParameterUse = {
			fields: new Set<string>(),
			bareReads: 0,
			dynamicReads: 0,
		};
		collectOptionsParameterUseInStatements(functionExpression.body.body, parameter.name, use);
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

function isOptionsParameterName(name: string): boolean {
	switch (name) {
		case 'opts':
		case 'options':
			return true;
		default:
			return false;
	}
}
