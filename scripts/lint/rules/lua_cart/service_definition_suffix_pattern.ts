import { defineLintRule } from '../../rule';
import { type LuaCallExpression, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { isGlobalCall } from '../../../../src/bmsx/lua/syntax/calls';
import { containsServiceLabel } from './impl/support/fsm_labels';
import { appendSuggestionMessage } from './impl/support/general';
import { readStringFieldValueFromTable } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';

export const serviceDefinitionSuffixPatternRule = defineLintRule('lua_cart', 'service_definition_suffix_pattern');

export function lintServiceDefinitionSuffixPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (isGlobalCall(expression, 'define_service')) {
		const definitionId = readStringFieldValueFromTable(expression.arguments[0], 'def_id');
		if (definitionId && containsServiceLabel(definitionId)) {
			pushIssue(
				issues,
				serviceDefinitionSuffixPatternRule.name,
				expression.arguments[0],
				appendSuggestionMessage(
					`Service definition id must not contain "service" ("${definitionId}").`,
					definitionId,
					'service',
				),
			);
		}
		return;
	}
	if (!isGlobalCall(expression, 'create_service')) {
		return;
	}
	const definitionArgument = expression.arguments[0];
	if (!definitionArgument || definitionArgument.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return;
	}
	const definitionId = definitionArgument.value;
	if (!containsServiceLabel(definitionId)) {
		return;
	}
	pushIssue(
		issues,
		serviceDefinitionSuffixPatternRule.name,
		definitionArgument,
		appendSuggestionMessage(
			`Service definition id must not contain "service" ("${definitionId}").`,
			definitionId,
			'service',
		),
	);
}
