import { defineLintRule } from '../../rule';
import { LuaAssignmentOperator as AssignmentOperator, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { isIdentifier } from './impl/support/bindings';
import { pushIssue } from './impl/support/lint_context';

export const splitLocalTableInitPatternRule = defineLintRule('cart', 'split_local_table_init_pattern');

export function lintSplitLocalTableInitPattern(statements: ReadonlyArray<Statement>, issues: CartLintIssue[]): void {
	for (let index = 0; index < statements.length; index += 1) {
		const statement = statements[index];
		if (statement.kind !== SyntaxKind.LocalAssignmentStatement) {
			continue;
		}
		if (statement.names.length !== 1 || statement.values.length !== 0) {
			continue;
		}
		const localName = statement.names[0].name;
		for (let nextIndex = index + 1; nextIndex < statements.length; nextIndex += 1) {
			const nextStatement = statements[nextIndex];
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
				issues,
				splitLocalTableInitPatternRule.name,
				statement.names[0],
				`Split local declaration + table initialization is forbidden ("${localName}"). Initialize the table in the local declaration.`,
			);
			break;
		}
	}
}
