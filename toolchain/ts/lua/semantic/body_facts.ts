import type { LuaExpression, LuaIdentifierExpression } from '../syntax/ast';
import type { LuaSyntaxSpan } from '../syntax/source_locations';
import type { LuaBuiltinOperationSite } from './builtin_operations';
import type { Decl, LuaCallSite, MemberAccessEntry, Ref, SymbolID } from './model';
import type { ScopeID, SemanticScope } from './scope_facts';
import type { SemanticTokenFact } from './tokens';
import type { CallValueEntry, DeclarationValueEntry, FunctionValueFlowEntry, MemberValueEntry, ModuleValueEntry, OwnedSemanticValueSource, SemanticValueSource, ValueAssignmentEntry } from './value_graph';

/** Finished, pre-projection facts. No traversal scope or enclosing builder survives here. */
export type LuaBindingFacts = {
	decls: readonly Decl[];
	scopes: readonly SemanticScope[];
	scopeParents: ReadonlyMap<ScopeID, ScopeID>;
	refs: readonly Ref[];
	memberAccesses: readonly MemberAccessEntry[];
	declarationIdsBySyntax: ReadonlyMap<LuaIdentifierExpression, SymbolID>;
	referencesBySyntax: ReadonlyMap<LuaIdentifierExpression, Ref>;
	annotationFacts: readonly SemanticTokenFact[];
	callSites: readonly LuaCallSite[];
	declarationValues: readonly DeclarationValueEntry[];
	builtinOperations: readonly LuaBuiltinOperationSite[];
	readValuesBySyntax: ReadonlyMap<LuaExpression, SemanticValueSource>;
	ownedValuesBySyntax: ReadonlyMap<LuaExpression, OwnedSemanticValueSource>;
	moduleValues: readonly ModuleValueEntry[];
	memberValues: readonly MemberValueEntry[];
	functionValueFlows: readonly FunctionValueFlowEntry[];
	callValues: readonly CallValueEntry[];
	valueAssignments: readonly ValueAssignmentEntry[];
	moduleReferences: readonly { value: string; span: LuaSyntaxSpan }[];
};

export type LuaBindingWork = {
	boundFunctions: number;
	reusedFunctions: number;
	visitedStatements: number;
	visitedExpressions: number;
};

export const LUA_BINDING_ARRAYS = [
	'decls', 'scopes', 'refs', 'memberAccesses', 'annotationFacts', 'callSites',
	'declarationValues', 'builtinOperations', 'moduleValues', 'memberValues',
	'functionValueFlows', 'callValues', 'valueAssignments', 'moduleReferences',
] as const;
type ArrayKey = typeof LUA_BINDING_ARRAYS[number];
export type LuaBodyInsertion = {
	readonly facts: LuaBindingFacts;
	/** File-scope attachment used while these raw facts were produced. */
	readonly fileScope: ScopeID;
	readonly offsets: { readonly [K in ArrayKey]: number };
};

/** One flattening pass per stream; cached subtrees are not copied into other caches. */
export function composeLuaBindingFacts(own: LuaBindingFacts, bodies: readonly LuaBodyInsertion[]): LuaBindingFacts {
	if (bodies.length === 0) return own;
	const result = { ...own };
	const fileScope = own.scopes[0].id;
	for (const key of LUA_BINDING_ARRAYS) {
		if (key === 'decls') continue;
		composeArray(result, own, bodies, key);
	}
	composeArray(result, own, bodies, 'decls', (declaration, body) =>
		declaration.scope === body.fileScope && declaration.scope !== fileScope
			? { ...declaration, scope: fileScope } : declaration);
	const scopeParents = new Map(own.scopeParents);
	for (const body of bodies) for (const [scope, parent] of body.facts.scopeParents) {
		scopeParents.set(scope, parent === body.fileScope ? fileScope : parent);
	}
	result.scopeParents = scopeParents;
	result.declarationIdsBySyntax = composeMap(own.declarationIdsBySyntax, bodies, facts => facts.declarationIdsBySyntax);
	result.referencesBySyntax = composeMap(own.referencesBySyntax, bodies, facts => facts.referencesBySyntax);
	result.readValuesBySyntax = composeMap(own.readValuesBySyntax, bodies, facts => facts.readValuesBySyntax);
	result.ownedValuesBySyntax = composeMap(own.ownedValuesBySyntax, bodies, facts => facts.ownedValuesBySyntax);
	return result;
}

function composeArray<K extends ArrayKey>(result: LuaBindingFacts, own: LuaBindingFacts, bodies: readonly LuaBodyInsertion[], key: K, project?: (value: LuaBindingFacts[K][number], body: LuaBodyInsertion) => LuaBindingFacts[K][number]): void {
	let length = own[key].length;
	for (const body of bodies) length += body.facts[key].length;
	if (length === own[key].length) return;
	const values = new Array<LuaBindingFacts[K][number]>(length);
	let source = 0;
	let target = 0;
	for (const body of bodies) {
		while (source < body.offsets[key]) values[target++] = own[key][source++];
		if (project === undefined) for (const value of body.facts[key]) values[target++] = value;
		else for (const value of body.facts[key]) values[target++] = project(value, body);
	}
	while (source < own[key].length) values[target++] = own[key][source++];
	// K selects the same element representation from all three streams.
	result[key] = values as LuaBindingFacts[K];
}

function composeMap<K, V>(own: ReadonlyMap<K, V>, bodies: readonly LuaBodyInsertion[], select: (facts: LuaBindingFacts) => ReadonlyMap<K, V>): ReadonlyMap<K, V> {
	const result = new Map(own);
	for (const body of bodies) for (const [key, value] of select(body.facts)) result.set(key, value);
	return result;
}
