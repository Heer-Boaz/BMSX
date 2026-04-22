import { defineLintRule } from '../../rule';
import { type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { isSingleBranchConditionalAssignment, statementUsesIdentifierUnsafelyInCurrentScope } from './impl/support/identifier_flow';
import { pushIssue } from './impl/support/lint_context';

export const branchUninitializedLocalPatternRule = defineLintRule('cart', 'branch_uninitialized_local_pattern');

export function lintBranchUninitializedLocalPattern(statements: ReadonlyArray<Statement>, issues: CartLintIssue[]): void {
	for (let index = 0; index + 2 < statements.length; index += 1) {
		const declaration = statements[index];
		if (declaration.kind !== SyntaxKind.LocalAssignmentStatement) {
			continue;
		}
		if (declaration.names.length !== 1 || declaration.values.length !== 0) {
			continue;
		}
		const name = declaration.names[0].name;
		const firstStatement = statements[index + 1];
		if (firstStatement.kind !== SyntaxKind.IfStatement) {
			continue;
		}
		if (!isSingleBranchConditionalAssignment(firstStatement, name)) {
			continue;
		}
		let usedAfter = false;
		for (let scan = index + 2; scan < statements.length; scan += 1) {
			if (statementUsesIdentifierUnsafelyInCurrentScope(statements[scan], name)) {
				usedAfter = true;
				break;
			}
		}
		if (!usedAfter) {
			continue;
		}
		pushIssue(
			issues,
			branchUninitializedLocalPatternRule.name,
			declaration.names[0],
			`Local "${name}" is declared without initialization and only conditionally assigned before use. Assign deterministically or assign in all branches before use.`,
		);
	}
}
