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

const LUA_BINDING_ARRAYS = [
	'decls', 'scopes', 'refs', 'memberAccesses', 'annotationFacts', 'callSites',
	'declarationValues', 'builtinOperations', 'moduleValues', 'memberValues',
	'functionValueFlows', 'callValues', 'valueAssignments', 'moduleReferences',
] as const;
type ArrayKey = typeof LUA_BINDING_ARRAYS[number];
type FactCounts = { readonly [K in ArrayKey]: number };

/** Each body stores only its own facts and edges to child contributions. */
export type LuaBindingContribution = {
	readonly own: LuaBindingFacts;
	readonly bodies: readonly LuaBodyInsertion[];
	readonly counts: FactCounts;
};

export type LuaBodyInsertion = {
	readonly contribution: LuaBindingContribution;
	readonly fileScope: ScopeID;
	readonly parentScope: ScopeID;
	readonly attachedParent: ScopeID;
	readonly offsets: FactCounts;
};

export function finishLuaBindingContribution(own: LuaBindingFacts, bodies: readonly LuaBodyInsertion[]): LuaBindingContribution {
	const counts = {} as { [K in ArrayKey]: number };
	for (const key of LUA_BINDING_ARRAYS) {
		let count = own[key].length;
		for (const body of bodies) count += body.contribution.counts[key];
		counts[key] = count;
	}
	return { own, bodies, counts };
}

/** Flatten once at the file boundary, never once per ancestor body. */
export function composeLuaBindingFacts(root: LuaBindingContribution): LuaBindingFacts {
	if (root.bodies.length === 0) return root.own;
	const result = { ...root.own };
	const fileScope = root.own.scopes[0].id;
	for (const key of LUA_BINDING_ARRAYS) composeArray(result, root, key, fileScope);
	const scopeParents = new Map(root.own.scopeParents);
	const declarationIdsBySyntax = new Map(root.own.declarationIdsBySyntax);
	const referencesBySyntax = new Map(root.own.referencesBySyntax);
	const readValuesBySyntax = new Map(root.own.readValuesBySyntax);
	const ownedValuesBySyntax = new Map(root.own.ownedValuesBySyntax);
	const addDeclaration = (id: SymbolID, syntax: LuaIdentifierExpression) => { declarationIdsBySyntax.set(syntax, id); };
	const addReference = (ref: Ref, syntax: LuaIdentifierExpression) => { referencesBySyntax.set(syntax, ref); };
	const addRead = (value: SemanticValueSource, syntax: LuaExpression) => { readValuesBySyntax.set(syntax, value); };
	const addOwned = (value: OwnedSemanticValueSource, syntax: LuaExpression) => { ownedValuesBySyntax.set(syntax, value); };
	function appendMaps(body: LuaBodyInsertion): void {
		const facts = body.contribution.own;
		for (const [scope, parent] of facts.scopeParents) {
			scopeParents.set(scope, parent === body.parentScope
				? (body.attachedParent === body.fileScope ? fileScope : body.attachedParent)
				: parent === body.fileScope ? fileScope : parent);
		}
		facts.declarationIdsBySyntax.forEach(addDeclaration);
		facts.referencesBySyntax.forEach(addReference);
		facts.readValuesBySyntax.forEach(addRead);
		facts.ownedValuesBySyntax.forEach(addOwned);
		for (const child of body.contribution.bodies) appendMaps(child);
	}
	for (const body of root.bodies) appendMaps(body);
	result.scopeParents = scopeParents;
	result.declarationIdsBySyntax = declarationIdsBySyntax;
	result.referencesBySyntax = referencesBySyntax;
	result.readValuesBySyntax = readValuesBySyntax;
	result.ownedValuesBySyntax = ownedValuesBySyntax;
	return result;
}

function composeArray<K extends ArrayKey>(result: LuaBindingFacts, root: LuaBindingContribution, key: K, fileScope: ScopeID): void {
	if (root.counts[key] === root.own[key].length) return;
	const values = new Array<LuaBindingFacts[K][number]>(root.counts[key]);
	let target = 0;
	function append(contribution: LuaBindingContribution, previousFileScope: ScopeID): void {
		if (contribution.counts[key] === 0) return;
		const own = contribution.own[key];
		const bodies = contribution.bodies;
		let source = 0;
		for (let index = 0; index <= bodies.length; index++) {
			const end = index === bodies.length ? own.length : bodies[index].offsets[key];
			if (key === 'decls') {
				while (source < end) {
					const declaration = contribution.own.decls[source++];
					values[target++] = declaration.scope === previousFileScope && declaration.scope !== fileScope
						? { ...declaration, scope: fileScope } : declaration;
				}
			} else while (source < end) values[target++] = own[source++];
			if (index < bodies.length) append(bodies[index].contribution, bodies[index].fileScope);
		}
	}
	append(root, fileScope);
	// K selects the same element representation in every contribution.
	result[key] = values as LuaBindingFacts[K];
}
