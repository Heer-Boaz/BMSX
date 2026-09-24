import type { Decl, FileSemanticData, SemanticScope, SymbolID } from './model';
import type { ScopeID } from './scope_facts';
import type { CallValueEntry, SemanticValueSource } from './value_graph';

export function findInnermostScope(
	source: FileSemanticData,
	line: number,
	column: number,
): SemanticScope | undefined {
	return findInnermostScopeAtOffset(source, source.chunk.locations.offsetAt({ line, column }));
}

export function findInnermostScopeAtOffset(source: FileSemanticData, offset: number): SemanticScope | undefined {
	const locations = source.chunk.locations;
	const scopes = source.scopes;
	let low = 0;
	let high = scopes.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		const start = scopes[middle].startInclusive;
		if (locations.offset(start.unit, start.offset) <= offset) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	let scope: SemanticScope | undefined = scopes[low - 1];
	while (scope !== undefined) {
		const end = scope.endExclusive;
		if (offset < locations.offset(end.unit, end.offset)) {
			return scope;
		}
		const parent = source.scopeParents.get(scope.id);
		scope = parent === undefined ? undefined : source.scopesById.get(parent)!;
	}
	return undefined;
}

export type LuaLexicalBinding =
	| { readonly kind: 'declaration'; readonly declaration: Decl }
	| { readonly kind: 'receiver'; readonly scope: ScopeID }
	| { readonly kind: 'global'; readonly name: string };

/** Lexical storage identity, not a declaration's inferred value or receiver class. */
export function findLuaLexicalBindingAt(
	source: FileSemanticData,
	name: string,
	line: number,
	column: number,
): LuaLexicalBinding {
	const locations = source.chunk.locations;
	const offset = locations.offsetAt({ line, column });
	let scope = findInnermostScopeAtOffset(source, offset);
	while (scope !== undefined) {
		for (let index = scope.declarations.length - 1; index >= 0; index -= 1) {
			const declaration = scope.declarations[index];
			if (declaration.name === name
				&& offset > locations.offset(declaration.visibleFrom.unit, declaration.visibleFrom.offset)) {
				return { kind: 'declaration', declaration };
			}
		}
		if (name === 'self' && scope.kind === 'method') return { kind: 'receiver', scope: scope.id };
		const parent = source.scopeParents.get(scope.id);
		scope = parent === undefined ? undefined : source.scopesById.get(parent)!;
	}
	return { kind: 'global', name };
}

/** Varargs belong to the nearest function, never to an enclosing variadic one. */
export function findLuaFunctionScopeAt(source: FileSemanticData, line: number, column: number): SemanticScope {
	let scope = findInnermostScope(source, line, column)!;
	while (scope.kind === 'block' || scope.kind === 'loop') {
		scope = source.scopesById.get(source.scopeParents.get(scope.id)!)!;
	}
	return scope;
}

export function findImplicitSelfValueAt(
	source: FileSemanticData,
	line: number,
	column: number,
): SemanticValueSource | undefined {
	const binding = findLuaLexicalBindingAt(source, 'self', line, column);
	return binding.kind === 'receiver' ? source.scopesById.get(binding.scope)!.implicitSelfValue : undefined;
}

export function collectVisibleDeclarationsAt(
	source: FileSemanticData,
	line: number,
	column: number,
): readonly Decl[] {
	const locations = source.chunk.locations;
	const offset = locations.offsetAt({ line, column });
	let scope = findInnermostScopeAtOffset(source, offset);
	if (scope === undefined) {
		return [];
	}
	const declarations: Decl[] = [];
	const names = new Set<string>();
	while (scope !== undefined) {
		for (let index = scope.declarations.length - 1; index >= 0; index -= 1) {
			const declaration = scope.declarations[index];
			if (names.has(declaration.name)
				|| offset <= locations.offset(declaration.visibleFrom.unit, declaration.visibleFrom.offset)) {
				continue;
			}
			names.add(declaration.name);
			declarations.push(declaration);
		}
		if (scope.kind === 'method') names.add('self');
		const parent = source.scopeParents.get(scope.id);
		scope = parent === undefined ? undefined : source.scopesById.get(parent)!;
	}
	return declarations;
}

const callHierarchyCallers = new WeakMap<FileSemanticData, ReadonlyMap<CallValueEntry, SymbolID>>();

/** Named presentation owner, derived from this generation's lexical attachments.
 * An anonymous callback has its own execution flow, but is displayed under the
 * nearest named enclosing function. It must not capture that ancestor in Ref.
 */
export function getLuaCallHierarchyCallers(source: FileSemanticData): ReadonlyMap<CallValueEntry, SymbolID> {
	const retained = callHierarchyCallers.get(source);
	if (retained !== undefined) return retained;
	const declarations = new Map<ScopeID, SymbolID>();
	for (const flow of source.functionValueFlows) {
		if (flow.declaration !== undefined) declarations.set(flow.id, flow.declaration);
	}
	const callers = new Map<CallValueEntry, SymbolID>();
	for (const flow of source.functionValueFlows) {
		if (flow.calls.length === 0) continue;
		let caller = flow.declaration;
		let parent = source.scopeParents.get(flow.id);
		while (caller === undefined && parent !== undefined) {
			caller = declarations.get(parent);
			parent = source.scopeParents.get(parent);
		}
		if (caller !== undefined) for (const call of flow.calls) callers.set(call, caller);
	}
	callHierarchyCallers.set(source, callers);
	return callers;
}
