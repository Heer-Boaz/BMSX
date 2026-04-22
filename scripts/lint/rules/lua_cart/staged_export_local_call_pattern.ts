import { defineLintRule } from '../../rule';
import { LuaAssignmentOperator as AssignmentOperator, type LuaIdentifierExpression as IdentifierExpression, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { isModuleFieldAssignmentTarget } from './impl/support/object_ownership';
import { isSingleUseLocalCandidateValue } from './impl/support/single_use_local';
import { pushIssue } from './impl/support/lint_context';

export const stagedExportLocalCallPatternRule = defineLintRule('cart', 'staged_export_local_call_pattern');

export function lintStagedExportLocalCallPattern(statements: ReadonlyArray<Statement>, issues: CartLintIssue[]): void {
	const stagedLocalCallDeclarations = new Map<string, IdentifierExpression>();
	const flagged = new Set<string>();
	for (const statement of statements) {
		if (statement.kind === SyntaxKind.LocalAssignmentStatement) {
			const valueCount = Math.min(statement.names.length, statement.values.length);
			for (let index = 0; index < valueCount; index += 1) {
				const name = statement.names[index];
				const value = statement.values[index];
				if (isSingleUseLocalCandidateValue(value)) {
					stagedLocalCallDeclarations.set(name.name, name);
				} else {
					stagedLocalCallDeclarations.delete(name.name);
				}
			}
			for (let index = valueCount; index < statement.names.length; index += 1) {
				stagedLocalCallDeclarations.delete(statement.names[index].name);
			}
			continue;
		}
		if (statement.kind !== SyntaxKind.AssignmentStatement) {
			continue;
		}
		if (statement.operator !== AssignmentOperator.Assign) {
			continue;
		}
		const pairCount = Math.min(statement.left.length, statement.right.length);
		for (let index = 0; index < pairCount; index += 1) {
			const left = statement.left[index];
			const right = statement.right[index];
			if (right.kind !== SyntaxKind.IdentifierExpression) {
				continue;
			}
			const declaration = stagedLocalCallDeclarations.get(right.name);
			if (!declaration || flagged.has(right.name)) {
				continue;
			}
			if (!isModuleFieldAssignmentTarget(left)) {
				continue;
			}
			flagged.add(right.name);
			pushIssue(
				issues,
				stagedExportLocalCallPatternRule.name,
				declaration,
				`Staged local call-result export is forbidden ("${right.name}"). Assign call results directly to the module field and use that field directly.`,
			);
		}
	}
}
