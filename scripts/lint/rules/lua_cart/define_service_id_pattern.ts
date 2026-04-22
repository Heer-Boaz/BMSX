import { defineLintRule } from '../../rule';
import { type LuaCallExpression as CallExpression, LuaSyntaxKind as SyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { isGlobalCall } from '../../../../src/bmsx/lua/syntax/calls';
import { containsServiceLabel } from './impl/support/fsm_labels';
import { appendSuggestionMessage } from './impl/support/general';
import { findTableFieldByKey } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';

export const defineServiceIdPatternRule = defineLintRule('cart', 'define_service_id_pattern');

export function lintDefineServiceIdPattern(expression: CallExpression, issues: CartLintIssue[]): void {
	const ruleName = defineServiceIdPatternRule.name;
	if (!isGlobalCall(expression, 'define_service')) {
		return;
	}
	const definition = expression.arguments[0];
	if (!definition || definition.kind !== SyntaxKind.TableConstructorExpression) {
		return;
	}
	const defaultsField = findTableFieldByKey(definition, 'defaults');
	if (!defaultsField || defaultsField.value.kind !== SyntaxKind.TableConstructorExpression) {
		pushIssue(
			issues,
			ruleName,
			definition,
			'Service id must be defined via define_service.defaults.id (string literal, no "_service" suffix).',
		);
		return;
	}
	const idField = findTableFieldByKey(defaultsField.value, 'id');
	if (!idField) {
		pushIssue(
			issues,
			ruleName,
			defaultsField.value,
			'Service id must be defined via define_service.defaults.id (string literal, no "_service" suffix).',
		);
		return;
	}
	if (idField.value.kind !== SyntaxKind.StringLiteralExpression) {
		pushIssue(
			issues,
			ruleName,
			idField.value,
			'Service id in define_service.defaults.id must be a string literal and must not contain "service".',
		);
		return;
	}
	const serviceId = idField.value.value;
	if (!containsServiceLabel(serviceId)) {
		return;
	}
	pushIssue(
		issues,
		ruleName,
		idField.value,
		appendSuggestionMessage(
			`Service id in define_service.defaults.id must not contain "service" ("${serviceId}").`,
			serviceId,
			'service',
		),
	);
}
