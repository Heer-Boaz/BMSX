import { defineLintRule } from '../../rule';
import { type LuaLintIssue } from '../../lua_rule';
import { pushIssue } from './impl/support/lint_context';
import { type SelfPropertyAssignmentMatch } from './impl/support/types';

export const eventHandlerFlagProxyPatternRule = defineLintRule('lua_cart', 'event_handler_flag_proxy_pattern');

export function lintEventHandlerFlagProxyPattern(assignment: SelfPropertyAssignmentMatch, issues: LuaLintIssue[]): void {
	pushIssue(
		issues,
		eventHandlerFlagProxyPatternRule.name,
		assignment.target,
		`Event handler flag-proxy pattern is forbidden (self.${assignment.propertyName}). Do not stage FSM transitions through *_requested/*_pending/*_done flags; use FSM events/timelines/input handlers directly.`,
	);
}
