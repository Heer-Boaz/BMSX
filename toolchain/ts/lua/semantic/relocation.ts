import { LuaSyntaxKind, type LuaSourcePosition, type LuaSourceRange, type LuaVarargExpression } from '../syntax/ast';
import { walkLuaAst } from '../syntax/ast/traversal';
import type { Decl, FileSemanticData, Ref, SemanticScope } from './model';
import type { ScopeID } from './scope_facts';
import { findLuaFunctionScopeAt, findLuaLexicalBindingAt, type LuaLexicalBinding } from './scope_query';

export type LuaRelocationBinding =
	| { readonly kind: 'identifier'; readonly reference: Ref; readonly binding: LuaLexicalBinding }
	| { readonly kind: 'vararg'; readonly expression: LuaVarargExpression; readonly scope: ScopeID };

export type LuaRelocationBindingChange =
	| { readonly kind: 'identifier'; readonly reference: Ref; readonly from: LuaLexicalBinding; readonly to: LuaLexicalBinding }
	| { readonly kind: 'vararg'; readonly expression: LuaVarargExpression; readonly fromScope: ScopeID; readonly toScope: ScopeID };

/**
 * TypeScript-style free-binding analysis of a complete current-source field or
 * expression. Retain one immutable semantic generation for all destinations.
 * This proves lexical identity only, not evaluation order or live migration.
 */
export class LuaRelocationAnalysis {
	public readonly bindings: readonly LuaRelocationBinding[];

	constructor(public readonly source: FileSemanticData, range: LuaSourceRange) {
		const locations = source.chunk.locations;
		const rangeStart = locations.offsetAt(range.start);
		const rangeEnd = locations.offsetAt(range.end);
		const bindings: LuaRelocationBinding[] = [];
		const seen = new Set<Decl | SemanticScope | string>();
		const seenVarargs = new Set<ScopeID>();
		walkLuaAst(source.chunk, node => {
			if (locations.offset(node.span.unit, node.span.end) < rangeStart
				|| locations.offset(node.span.unit, node.span.start) > rangeEnd) return false;
			if (node.kind === LuaSyntaxKind.IdentifierExpression) {
				const reference = source.referencesBySyntax.get(node);
				if (reference === undefined || (reference.referenceKind !== 'identifier' && reference.referenceKind !== 'self')) return;
				const position = locations.position(node.span.unit, node.span.start);
				const binding = findLuaLexicalBindingAt(source, reference.name, position.line, position.column);
				let identity: Decl | SemanticScope | string;
				if (binding.kind === 'declaration') {
					const declaration = binding.declaration;
					const declarationStart = locations.offset(declaration.span.unit, declaration.span.start);
					if (declarationStart >= rangeStart && declarationStart <= rangeEnd) return;
					identity = declaration;
				} else if (binding.kind === 'receiver') {
					const scope = source.scopesById.get(binding.scope)!;
					const scopeStart = locations.offset(scope.startInclusive.unit, scope.startInclusive.offset);
					if (scopeStart >= rangeStart && scopeStart <= rangeEnd) return;
					identity = scope;
				} else identity = binding.name;
				if (seen.has(identity)) return;
				seen.add(identity);
				bindings.push({ kind: 'identifier', reference, binding });
			} else if (node.kind === LuaSyntaxKind.VarargExpression) {
				const position = locations.position(node.span.unit, node.span.start);
				const scope = findLuaFunctionScopeAt(source, position.line, position.column);
				const scopeStart = locations.offset(scope.startInclusive.unit, scope.startInclusive.offset);
				if (scopeStart >= rangeStart && scopeStart <= rangeEnd || seenVarargs.has(scope.id)) return;
				seenVarargs.add(scope.id);
				bindings.push({ kind: 'vararg', expression: node, scope: scope.id });
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
				if (from.kind === 'receiver' && to.kind === 'receiver' && from.scope === to.scope) continue;
				if (from.kind === 'global' && to.kind === 'global') continue; // The query uses the same identifier name.
				changes.push({ kind: 'identifier', reference: entry.reference, from, to });
			} else {
				const toScope = findLuaFunctionScopeAt(this.source, destination.line, destination.column).id;
				if (entry.scope !== toScope) {
					changes.push({ kind: 'vararg', expression: entry.expression, fromScope: entry.scope, toScope });
				}
			}
		}
		return changes;
	}
}
