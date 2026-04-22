import { defineLintRule } from '../../rule';
import { type LuaExpression, type LuaTableField, LuaTableFieldKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { getExpressionKeyName } from './impl/support/expression_signatures';
import { getInjectedServiceIdPropertyNameFromTarget, isInjectedServiceIdPropertyName } from './impl/support/injected_service';
import { pushIssue } from './impl/support/lint_context';

export const injectedServiceIdPropertyPatternRule = defineLintRule('lua_cart', 'injected_service_id_property_pattern');

export function lintInjectedServiceIdPropertyAssignmentTarget(target: LuaExpression, issues: LuaLintIssue[]): void {
	const propertyName = getInjectedServiceIdPropertyNameFromTarget(target);
	if (!propertyName || !isInjectedServiceIdPropertyName(propertyName)) {
		return;
	}
	pushIssue(
		issues,
		injectedServiceIdPropertyPatternRule.name,
		target,
		`Injecting service ids via property "${propertyName}" is forbidden. Do not pass/store service ids on objects/services; resolve services directly via service('<id>').`,
	);
}

export function lintInjectedServiceIdPropertyTableField(field: LuaTableField, issues: LuaLintIssue[]): void {
	let propertyName: string | undefined;
	if (field.kind === LuaTableFieldKind.IdentifierKey) {
		propertyName = field.name;
	} else if (field.kind === LuaTableFieldKind.ExpressionKey) {
		propertyName = getExpressionKeyName(field.key);
	}
	if (!propertyName || !isInjectedServiceIdPropertyName(propertyName)) {
		return;
	}
	pushIssue(
		issues,
		injectedServiceIdPropertyPatternRule.name,
		field,
		`Injecting service ids via property "${propertyName}" is forbidden. Do not pass/store service ids on objects/services; resolve services directly via service('<id>').`,
	);
}
