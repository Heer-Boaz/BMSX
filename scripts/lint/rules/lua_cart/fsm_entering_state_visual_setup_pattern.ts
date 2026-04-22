import { defineLintRule } from '../../rule';
import { type LuaStatement, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { findCallExpressionInStatements, isGlobalCall, visitCallExpressionsInStatements } from './impl/support/calls';
import { getStateNameFromStateField } from './impl/support/fsm_labels';
import { collectPrefabVisualDefaultsById, getSelfGfxStringLiteralArgument, isSelfGfxCallExpression, stateTimelinesDriveSelfGfx } from './impl/support/fsm_visual';
import { findSelfBooleanPropertyAssignmentInStatements } from './impl/support/self_properties';
import { findTableFieldByKey } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';

export const fsmEnteringStateVisualSetupPatternRule = defineLintRule('lua_cart', 'fsm_entering_state_visual_setup_pattern');

export function lintFsmEnteringStateVisualSetupPattern(
	statements: ReadonlyArray<LuaStatement>,
	issues: LuaLintIssue[],
): void {
	const prefabDefaultsById = collectPrefabVisualDefaultsById(statements);
	visitCallExpressionsInStatements(statements, (expression) => {
		if (!isGlobalCall(expression, 'define_fsm')) {
			return;
		}
		const fsmIdArgument = expression.arguments[0];
		if (!fsmIdArgument || fsmIdArgument.kind !== LuaSyntaxKind.StringLiteralExpression) {
			return;
		}
		const definition = expression.arguments[1];
		const statesField = findTableFieldByKey(definition, 'states');
		if (!statesField || statesField.value.kind !== LuaSyntaxKind.TableConstructorExpression) {
			return;
		}
		const prefabDefaults = prefabDefaultsById.get(fsmIdArgument.value);
		for (const stateField of statesField.value.fields) {
			const stateName = getStateNameFromStateField(stateField);
			if (!stateName || stateField.value.kind !== LuaSyntaxKind.TableConstructorExpression) {
				continue;
			}
			const enteringStateField = findTableFieldByKey(stateField.value, 'entering_state');
			if (!enteringStateField || enteringStateField.value.kind !== LuaSyntaxKind.FunctionExpression) {
				continue;
			}
			const body = enteringStateField.value.body.body;
			const visibleAssignment = findSelfBooleanPropertyAssignmentInStatements(body, 'visible');
			const gfxCall = findCallExpressionInStatements(body, isSelfGfxCallExpression);
			if (visibleAssignment) {
				pushIssue(
					issues,
					fsmEnteringStateVisualSetupPatternRule.name,
					visibleAssignment.target,
					`FSM state "${stateName}" must not set self.visible in entering_state. Move the object between spaces instead of hiding/showing it via visible; keep visual setup out of entering_state${gfxCall ? ', including self:gfx(...)' : ''}.`,
				);
				continue;
			}
			if (!gfxCall) {
				continue;
			}
			const gfxLiteral = getSelfGfxStringLiteralArgument(gfxCall);
			if (gfxLiteral && prefabDefaults?.imgid === gfxLiteral) {
				pushIssue(
					issues,
					fsmEnteringStateVisualSetupPatternRule.name,
					gfxCall,
					`FSM state "${stateName}" must not call self:gfx('${gfxLiteral}') in entering_state when define_prefab already sets imgid='${gfxLiteral}'. Keep the default sprite in define_prefab defaults instead of reapplying it on state entry.`,
				);
				continue;
			}
			if (!stateTimelinesDriveSelfGfx(stateField.value)) {
				continue;
			}
			pushIssue(
				issues,
				fsmEnteringStateVisualSetupPatternRule.name,
				gfxCall,
				`FSM state "${stateName}" must not seed self:gfx(...) in entering_state when the same state's timeline already drives gfx in on_frame. Let the timeline produce the visual frame instead of pre-setting gfx on entry.`,
			);
		}
	});
}
