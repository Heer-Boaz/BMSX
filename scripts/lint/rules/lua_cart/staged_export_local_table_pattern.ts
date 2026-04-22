import { defineLintRule } from '../../rule';
import { LuaAssignmentOperator as AssignmentOperator, type LuaIdentifierExpression as IdentifierExpression, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { countIdentifierMentionsInStatements } from './impl/support/identifier_flow';
import { getModuleFieldAssignmentBaseIdentifier, isModuleFieldAssignmentTarget } from './impl/support/object_ownership';
import { pushIssue } from './impl/support/lint_context';

export const stagedExportLocalTablePatternRule = defineLintRule('cart', 'staged_export_local_table_pattern');

export function lintStagedExportLocalTablePattern(statements: ReadonlyArray<Statement>, issues: CartLintIssue[]): void {
	const stagedLocalTableDeclarations = new Map<string, { declaration: IdentifierExpression; declarationStatementIndex: number; }>();
	const flagged = new Set<string>();
	for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
		const statement = statements[statementIndex];
		if (statement.kind === SyntaxKind.LocalAssignmentStatement) {
			const valueCount = Math.min(statement.names.length, statement.values.length);
			for (let index = 0; index < valueCount; index += 1) {
				const name = statement.names[index];
				const value = statement.values[index];
				if (value.kind === SyntaxKind.TableConstructorExpression) {
					stagedLocalTableDeclarations.set(name.name, {
						declaration: name,
						declarationStatementIndex: statementIndex,
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
					statements.slice(stagedDeclaration.declarationStatementIndex + 1),
					right.name,
				);
				if (mentionCountAfterDeclaration > 2) {
					continue;
				}
				flagged.add(right.name);
				pushIssue(
					issues,
					stagedExportLocalTablePatternRule.name,
					stagedDeclaration.declaration,
					`Staged local table export is forbidden ("${right.name}"). Build table values directly on the destination module field instead.`,
				);
			}
	}
}
