import { LuaSyntaxKind, type LuaSourcePosition, type LuaSourceRange, type LuaVarargExpression } from '../syntax/ast';
import { walkLuaAst } from '../syntax/ast/traversal';
import type { Decl, FileSemanticData, Ref, SemanticScope } from './model';
import { findLuaFunctionScopeIndexAt, findLuaLexicalBindingAt, type LuaLexicalBinding } from './scope_query';
import { compareSourcePosition, sourcePositionInRange } from './source_range';

export type LuaRelocationBinding =
	| { readonly kind: 'identifier'; readonly reference: Ref; readonly binding: LuaLexicalBinding }
	| { readonly kind: 'vararg'; readonly expression: LuaVarargExpression; readonly scopeIndex: number };

export type LuaRelocationBindingChange =
	| { readonly kind: 'identifier'; readonly reference: Ref; readonly from: LuaLexicalBinding; readonly to: LuaLexicalBinding }
	| { readonly kind: 'vararg'; readonly expression: LuaVarargExpression; readonly fromScopeIndex: number; readonly toScopeIndex: number };

/**
 * TypeScript-style free-binding analysis of a complete current-source field or
 * expression. Retain one immutable semantic generation for all destinations.
 * This proves lexical identity only, not evaluation order or live migration.
 */
export class LuaRelocationAnalysis {
	public readonly bindings: readonly LuaRelocationBinding[];

	constructor(public readonly source: FileSemanticData, range: LuaSourceRange) {
		const bindings: LuaRelocationBinding[] = [];
		const seen = new Set<Decl | SemanticScope | string | number>();
		walkLuaAst(source.chunk, node => {
			if (compareSourcePosition(node.range.end.line, node.range.end.column, range.start.line, range.start.column) < 0
				|| compareSourcePosition(node.range.start.line, node.range.start.column, range.end.line, range.end.column) > 0) return false;
			if (node.kind === LuaSyntaxKind.IdentifierExpression) {
				const reference = source.referencesBySyntax.get(node);
				if (reference === undefined || (reference.referenceKind !== 'identifier' && reference.referenceKind !== 'self')) return;
				const binding = findLuaLexicalBindingAt(source, reference.name, node.range.start.line, node.range.start.column);
				let identity: Decl | SemanticScope | string;
				if (binding.kind === 'declaration') {
					const declaration = binding.declaration;
					if (sourcePositionInRange(declaration.range.start.line, declaration.range.start.column, range)) return;
					identity = declaration;
				} else if (binding.kind === 'receiver') {
					const scope = source.scopes[binding.scopeIndex];
					if (sourcePositionInRange(scope.startInclusive.line, scope.startInclusive.column, range)) return;
					identity = scope;
				} else identity = binding.name;
				if (seen.has(identity)) return;
				seen.add(identity);
				bindings.push({ kind: 'identifier', reference, binding });
			} else if (node.kind === LuaSyntaxKind.VarargExpression) {
				const scopeIndex = findLuaFunctionScopeIndexAt(source, node.range.start.line, node.range.start.column);
				const scope = source.scopes[scopeIndex];
				if (sourcePositionInRange(scope.startInclusive.line, scope.startInclusive.column, range) || seen.has(scopeIndex)) return;
				seen.add(scopeIndex);
				bindings.push({ kind: 'vararg', expression: node, scopeIndex });
			}
		});
		this.bindings = bindings;
	}

	public getBindingChangesAt(destination: LuaSourcePosition): LuaRelocationBindingChange[] {
		const changes: LuaRelocationBindingChange[] = [];
		for (const entry of this.bindings) {
			if (entry.kind === 'identifier') {
				const to = findLuaLexicalBindingAt(this.source, entry.reference.name, destination.line, destination.column);
				const from = entry.binding;
				if (from.kind === 'declaration' && to.kind === 'declaration' && from.declaration.id === to.declaration.id) continue;
				if (from.kind === 'receiver' && to.kind === 'receiver' && from.scopeIndex === to.scopeIndex) continue;
				if (from.kind === 'global' && to.kind === 'global') continue; // The query uses the same identifier name.
				changes.push({ kind: 'identifier', reference: entry.reference, from, to });
			} else {
				const toScopeIndex = findLuaFunctionScopeIndexAt(this.source, destination.line, destination.column);
				if (entry.scopeIndex !== toScopeIndex) {
					changes.push({ kind: 'vararg', expression: entry.expression, fromScopeIndex: entry.scopeIndex, toScopeIndex });
				}
			}
		}
		return changes;
	}
}
