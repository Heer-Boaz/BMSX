import { defineLintRule } from '../../rule';
import { LuaAssignmentOperator, type LuaStatement, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { isIdentifier } from './impl/support/bindings';
import { pushIssue } from './impl/support/lint_context';

export const splitLocalTableInitPatternRule = defineLintRule('lua_cart', 'split_local_table_init_pattern');

export function lintSplitLocalTableInitPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	for (let index = 0; index < statements.length; index += 1) {
		const statement = statements[index];
		if (statement.kind !== LuaSyntaxKind.LocalAssignmentStatement) {
			continue;
		}
		if (statement.names.length !== 1 || statement.values.length !== 0) {
			continue;
		}
		const localName = statement.names[0].name;
		for (let nextIndex = index + 1; nextIndex < statements.length; nextIndex += 1) {
			const nextStatement = statements[nextIndex];
			if (nextStatement.kind === LuaSyntaxKind.LocalAssignmentStatement) {
				if (nextStatement.names.some(name => name.name === localName)) {
					break;
				}
				continue;
			}
			if (nextStatement.kind !== LuaSyntaxKind.AssignmentStatement) {
				continue;
			}
			if (nextStatement.operator !== LuaAssignmentOperator.Assign || nextStatement.left.length !== 1 || nextStatement.right.length !== 1) {
				continue;
			}
			if (!isIdentifier(nextStatement.left[0], localName)) {
				continue;
			}
			if (nextStatement.right[0].kind !== LuaSyntaxKind.TableConstructorExpression) {
				break;
			}
			pushIssue(
				issues,
				splitLocalTableInitPatternRule.name,
				statement.names[0],
				`Split local declaration + table initialization is forbidden ("${localName}"). Initialize the table in the local declaration.`,
			);
			break;
		}
	}
}
