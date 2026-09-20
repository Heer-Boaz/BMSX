import type { LuaStatementSequence } from '../../../../toolchain/ts/lua/syntax/statement_sequence';
import { defineLintRule } from '../../rule';
import { LuaSyntaxKind as SyntaxKind } from '../../../../toolchain/ts/lua/syntax/ast';
import { type CartLintContext } from '../../lua_rule';
import { isSingleBranchConditionalAssignment, statementUsesIdentifierUnsafelyInCurrentScope } from './impl/support/identifier_flow';
import { pushIssue } from './impl/support/lint_context';

export const branchUninitializedLocalPatternRule = defineLintRule('cart', 'branch_uninitialized_local_pattern');

export function lintBranchUninitializedLocalPattern(statements: LuaStatementSequence, lint: CartLintContext): void {
	for (const cursor = statements.cursor(); cursor.index + 2 < statements.length; cursor.advance()) {
		const declaration = cursor.statement!;
		if (declaration.kind !== SyntaxKind.LocalAssignmentStatement) {
			continue;
		}
		if (declaration.names.length !== 1 || declaration.values.length !== 0) {
			continue;
		}
		const name = declaration.names[0].name;
		const following = statements.cursor(cursor.index + 1);
		const firstStatement = following.statement!;
		if (firstStatement.kind !== SyntaxKind.IfStatement) {
			continue;
		}
		if (!isSingleBranchConditionalAssignment(firstStatement, name)) {
			continue;
		}
		let usedAfter = false;
		while (following.advance()) {
			if (statementUsesIdentifierUnsafelyInCurrentScope(following.statement!, name)) {
				usedAfter = true;
				break;
			}
		}
		if (!usedAfter) {
			continue;
		}
		pushIssue(
			lint,
			branchUninitializedLocalPatternRule.name,
			declaration.names[0],
			`Local "${name}" is declared without initialization and only conditionally assigned before use. Assign deterministically or assign in all branches before use.`,
		);
	}
}
