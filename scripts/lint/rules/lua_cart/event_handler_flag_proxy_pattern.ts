import { defineLintRule } from '../../rule';
import { type LuaStatement } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { isEventProxyFlagPropertyName } from './impl/support/general';
import { pushIssue } from './impl/support/lint_context';
import { findSelfPropertyAssignmentInStatements } from './impl/support/self_properties';

export const eventHandlerFlagProxyPatternRule = defineLintRule('lua_cart', 'event_handler_flag_proxy_pattern');

export function lintEventHandlerFlagProxyPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	const assignment = findSelfPropertyAssignmentInStatements(statements, isEventProxyFlagPropertyName);
	if (!assignment) {
		return;
	}
	pushIssue(
		issues,
		eventHandlerFlagProxyPatternRule.name,
		assignment.target,
		`Event handler flag-proxy pattern is forbidden (self.${assignment.propertyName}). Do not stage FSM transitions through *_requested/*_pending/*_done flags; use FSM events/timelines/input handlers directly.`,
	);
}
