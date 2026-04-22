import { defineLintRule } from '../../rule';
import { type LuaCallExpression, type LuaStatement, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { isEventsEmitCallExpression } from './impl/support/fsm_events';
import { pushIssue } from './impl/support/lint_context';

export const contiguousMultiEmitPatternRule = defineLintRule('lua_cart', 'contiguous_multi_emit_pattern');

export function lintContiguousMultiEmitPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	let firstEmitCall: LuaCallExpression | undefined;
	let emitCount = 0;

	const flush = (): void => {
		if (!firstEmitCall || emitCount <= 1) {
			firstEmitCall = undefined;
			emitCount = 0;
			return;
		}
		pushIssue(
			issues,
			contiguousMultiEmitPatternRule.name,
			firstEmitCall,
			`${emitCount} consecutive events:emit(...) calls in one straight-line block are forbidden. Emit one canonical event and let other systems react to it instead of alias/fanout event chains.`,
		);
		firstEmitCall = undefined;
		emitCount = 0;
	};

	for (const statement of statements) {
		if (statement.kind === LuaSyntaxKind.CallStatement && isEventsEmitCallExpression(statement.expression)) {
			if (!firstEmitCall) {
				firstEmitCall = statement.expression;
			}
			emitCount += 1;
			continue;
		}
		flush();
	}
	flush();
}
