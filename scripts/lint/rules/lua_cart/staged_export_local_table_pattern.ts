import type { LuaStatementSequence } from '../../../../toolchain/ts/lua/syntax/statement_sequence';
import { defineLintRule } from '../../rule';
import { LuaAssignmentOperator as AssignmentOperator, type LuaIdentifierExpression as IdentifierExpression, LuaSyntaxKind as SyntaxKind } from '../../../../toolchain/ts/lua/syntax/ast';
import { type CartLintContext } from '../../lua_rule';
import { countIdentifierMentionsInStatements } from './impl/support/identifier_flow';
import { getModuleFieldAssignmentBaseIdentifier, isModuleFieldAssignmentTarget } from './impl/support/object_ownership';
import { pushIssue } from './impl/support/lint_context';

export const stagedExportLocalTablePatternRule = defineLintRule('cart', 'staged_export_local_table_pattern');

export function lintStagedExportLocalTablePattern(statements: LuaStatementSequence, lint: CartLintContext): void {
	const stagedLocalTableDeclarations = new Map<string, { declaration: IdentifierExpression; declarationStatementIndex: number; }>();
	const flagged = new Set<string>();
	for (const cursor = statements.cursor(); cursor.statement !== undefined; cursor.advance()) {
		const statement = cursor.statement;
		if (statement.kind === SyntaxKind.LocalAssignmentStatement) {
			const valueCount = Math.min(statement.names.length, statement.values.length);
			for (let index = 0; index < valueCount; index += 1) {
				const name = statement.names[index];
				const value = statement.values[index];
				if (value.kind === SyntaxKind.TableConstructorExpression) {
					stagedLocalTableDeclarations.set(name.name, {
						declaration: name,
						declarationStatementIndex: cursor.index,
					});
				} else {
					stagedLocalTableDeclarations.delete(name.name);
				}
			}
			for (let index = valueCount; index < statement.names.length; index += 1) {
				stagedLocalTableDeclarations.delete(statement.names[index].name);
			}
			continue;
		}
		if (statement.kind !== SyntaxKind.AssignmentStatement || statement.operator !== AssignmentOperator.Assign) {
			continue;
		}
		const pairCount = Math.min(statement.left.length, statement.right.length);
		for (let index = 0; index < pairCount; index += 1) {
			const left = statement.left[index];
			const right = statement.right[index];
				if (right.kind !== SyntaxKind.IdentifierExpression) {
					continue;
				}
				const stagedDeclaration = stagedLocalTableDeclarations.get(right.name);
				if (!stagedDeclaration || flagged.has(right.name)) {
					continue;
				}
				if (!isModuleFieldAssignmentTarget(left)) {
				continue;
			}
			const targetBase = getModuleFieldAssignmentBaseIdentifier(left);
				if (targetBase === right.name) {
					continue;
				}
				const mentionCountAfterDeclaration = countIdentifierMentionsInStatements(
					statements,
					right.name,
					stagedDeclaration.declarationStatementIndex + 1,
				);
				if (mentionCountAfterDeclaration > 2) {
					continue;
				}
				flagged.add(right.name);
				pushIssue(
					lint,
					stagedExportLocalTablePatternRule.name,
					stagedDeclaration.declaration,
					`Staged local table export is forbidden ("${right.name}"). Build table values directly on the destination module field instead.`,
				);
			}
	}
}
