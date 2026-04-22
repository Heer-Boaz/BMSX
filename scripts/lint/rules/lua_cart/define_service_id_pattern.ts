import { defineLintRule } from '../../rule';
import { type LuaCallExpression, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { isGlobalCall } from '../../../../src/bmsx/lua/syntax/calls';
import { containsServiceLabel, removeServiceLabel } from './impl/support/fsm_labels';
import { findTableFieldByKey } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';

export const defineServiceIdPatternRule = defineLintRule('lua_cart', 'define_service_id_pattern');

export function lintDefineServiceIdPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_service')) {
		return;
	}
	const definition = expression.arguments[0];
	if (!definition || definition.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	const defaultsField = findTableFieldByKey(definition, 'defaults');
	if (!defaultsField || defaultsField.value.kind !== LuaSyntaxKind.TableConstructorExpression) {
		pushIssue(
			issues,
			defineServiceIdPatternRule.name,
			definition,
			'Service id must be defined via define_service.defaults.id (string literal, no "_service" suffix).',
		);
		return;
	}
	const idField = findTableFieldByKey(defaultsField.value, 'id');
	if (!idField) {
		pushIssue(
			issues,
			defineServiceIdPatternRule.name,
			defaultsField.value,
			'Service id must be defined via define_service.defaults.id (string literal, no "_service" suffix).',
		);
		return;
	}
	if (idField.value.kind !== LuaSyntaxKind.StringLiteralExpression) {
		pushIssue(
			issues,
			defineServiceIdPatternRule.name,
			idField.value,
			'Service id in define_service.defaults.id must be a string literal and must not contain "service".',
		);
		return;
	}
	const serviceId = idField.value.value;
	if (!containsServiceLabel(serviceId)) {
		return;
	}
	const suggestedId = removeServiceLabel(serviceId);
	const suggestion = suggestedId
		? ` Use "${suggestedId}" instead.`
		: '';
	pushIssue(
		issues,
		defineServiceIdPatternRule.name,
		idField.value,
		`Service id in define_service.defaults.id must not contain "service" ("${serviceId}").${suggestion}`,
	);
}
