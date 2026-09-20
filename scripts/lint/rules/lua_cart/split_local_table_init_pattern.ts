import type { LuaStatementSequence } from '../../../../toolchain/ts/lua/syntax/statement_sequence';
import { defineLintRule } from '../../rule';
import { LuaAssignmentOperator as AssignmentOperator, LuaSyntaxKind as SyntaxKind } from '../../../../toolchain/ts/lua/syntax/ast';
import { type CartLintContext } from '../../lua_rule';
import { isIdentifier } from './impl/support/bindings';
import { pushIssue } from './impl/support/lint_context';

export const splitLocalTableInitPatternRule = defineLintRule('cart', 'split_local_table_init_pattern');

export function lintSplitLocalTableInitPattern(statements: LuaStatementSequence, lint: CartLintContext): void {
	for (const cursor = statements.cursor(); cursor.statement !== undefined; cursor.advance()) {
		const statement = cursor.statement;
		if (statement.kind !== SyntaxKind.LocalAssignmentStatement) {
			continue;
		}
		if (statement.names.length !== 1 || statement.values.length !== 0) {
			continue;
		}
		const localName = statement.names[0].name;
		for (const next = statements.cursor(cursor.index + 1); next.statement !== undefined; next.advance()) {
			const nextStatement = next.statement;
			if (nextStatement.kind === SyntaxKind.LocalAssignmentStatement) {
				if (nextStatement.names.some(name => name.name === localName)) {
					break;
				}
				continue;
			}
			if (nextStatement.kind !== SyntaxKind.AssignmentStatement) {
				continue;
			}
			if (nextStatement.operator !== AssignmentOperator.Assign || nextStatement.left.length !== 1 || nextStatement.right.length !== 1) {
				continue;
			}
			if (!isIdentifier(nextStatement.left[0], localName)) {
				continue;
			}
			if (nextStatement.right[0].kind !== SyntaxKind.TableConstructorExpression) {
				break;
			}
			pushIssue(
				lint,
				splitLocalTableInitPatternRule.name,
				statement.names[0],
				`Split local declaration + table initialization is forbidden ("${localName}"). Initialize the table in the local declaration.`,
			);
			break;
		}
	}
}
