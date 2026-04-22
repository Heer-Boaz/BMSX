import { defineLintRule } from '../../rule';
import { type LuaFunctionExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { isVisualUpdateLikeFunctionName } from './impl/support/fsm_visual';
import { pushIssue } from './impl/support/lint_context';

export const visualUpdatePatternRule = defineLintRule('lua_cart', 'visual_update_pattern');

export function lintVisualUpdatePattern(functionName: string, functionExpression: LuaFunctionExpression, issues: LuaLintIssue[]): boolean {
	if (functionName === '<anonymous>' || !isVisualUpdateLikeFunctionName(functionName)) {
		return false;
	}
	pushIssue(
		issues,
		visualUpdatePatternRule.name,
		functionExpression,
		`update_visual/sync_*_components/apply_pose/refresh_presentation_if_changed-style code is forbidden ("${functionName}"). This is an ugly workaround pattern (update_visual <-> sync_*_components <-> apply_pose <-> refresh_presentation_if_changed). Use deterministic initialization and on-change updates.`,
	);
	return true;
}
