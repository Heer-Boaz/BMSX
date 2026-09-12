import { LuaSyntaxKind, type LuaExpression } from '../syntax/ast';
import { walkLuaAst } from '../syntax/ast/traversal';
import type { FileSemanticData } from './model';

export type LuaSourceEvaluation = {
	readonly kind: 'call' | 'read' | 'access' | 'operation' | 'vararg';
	readonly expression: LuaExpression;
};

/**
 * Potential eager evaluation of written source, not a purity/effect verdict.
 * Closure creation does not execute its body. Short-circuit operands may run;
 * this query does not execute conditions or follow an alias's initializer.
 */
export function collectLuaSourceEvaluation(file: FileSemanticData, expression: LuaExpression): readonly LuaSourceEvaluation[] {
	const evaluation: LuaSourceEvaluation[] = [];
	walkLuaAst(expression, node => {
		switch (node.kind) {
			case LuaSyntaxKind.FunctionExpression:
			case LuaSyntaxKind.SizeOfExpression:
			case LuaSyntaxKind.OffsetOfExpression: return false;
			case LuaSyntaxKind.CallExpression: evaluation.push({ kind: 'call', expression: node }); break;
			case LuaSyntaxKind.IdentifierExpression: {
				const reference = file.referencesBySyntax.get(node);
				if (reference?.referenceKind === 'identifier' || reference?.referenceKind === 'self') {
					evaluation.push({ kind: 'read', expression: node });
				}
				break;
			}
			case LuaSyntaxKind.MemberExpression:
			case LuaSyntaxKind.IndexExpression: evaluation.push({ kind: 'access', expression: node }); break;
			case LuaSyntaxKind.BinaryExpression:
			case LuaSyntaxKind.UnaryExpression: evaluation.push({ kind: 'operation', expression: node }); break;
			case LuaSyntaxKind.VarargExpression: evaluation.push({ kind: 'vararg', expression: node }); break;
		}
	});
	return evaluation;
}
