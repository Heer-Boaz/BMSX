import { defineLintRule } from '../../rule';
import { type LuaCallExpression as CallExpression, LuaSyntaxKind as SyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { isGlobalCall } from '../../../../src/bmsx/lua/syntax/calls';
import { findStateNameMirrorAssignmentInExpression, getStateNameFromStateField, normalizeStateNameToken } from './impl/support/fsm_labels';
import { findTableFieldByKey } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';

export const fsmStateNameMirrorAssignmentPatternRule = defineLintRule('cart', 'fsm_state_name_mirror_assignment_pattern');

export function lintFsmStateNameMirrorAssignmentPattern(expression: CallExpression, issues: CartLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const definition = expression.arguments[1];
	const statesField = findTableFieldByKey(definition, 'states');
	if (!statesField || statesField.value.kind !== SyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const stateField of statesField.value.fields) {
		const stateNameRaw = getStateNameFromStateField(stateField);
		if (!stateNameRaw || stateField.value.kind !== SyntaxKind.TableConstructorExpression) {
			continue;
		}
		const stateName = normalizeStateNameToken(stateNameRaw);
		if (!stateName) {
			continue;
		}
		const mirror = findStateNameMirrorAssignmentInExpression(stateField.value, stateName);
		if (!mirror) {
			continue;
		}
		pushIssue(
			issues,
			fsmStateNameMirrorAssignmentPatternRule.name,
			mirror.valueNode,
			`FSM state "${stateName}" must not be mirrored into self.${mirror.propertyName} using the same string literal. Derive behavior from the active state instead of duplicating state-name strings in properties.`,
		);
	}
}
