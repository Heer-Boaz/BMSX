import type { HashLookup } from '../../collections/hash_map';
import { LuaSyntaxKind } from '../syntax/ast';
import type { Decl, FileSemanticData, SymbolID } from './model';
import type {
	CallValueEntry,
	FunctionValueFlowEntry,
	MemberValueEntry,
	ModuleValueEntry,
	SemanticValueRoot,
	SemanticValueSource,
	ValueAssignmentEntry,
} from './value_graph';

/**
 * Definition-based value shapes for interactive IDE queries, the way a language
 * server types a program: a name means what its declarations and the
 * definitions they name say. Nothing here asks what other code may write into
 * an object or which callers reach a parameter; such values are unknown.
 *
 * Like a compiler's checker over reused source files, per-file facts are
 * derived once per `FileSemanticData` and survive snapshots; every cross-file
 * answer is computed lazily for the snapshot that asks.
 */

/** A table, function body, instance or namespace-path identity with a definition site. */
export type LuaDefinitionShape =
	| { readonly kind: 'table'; readonly key: string; readonly owned: number; readonly file: string }
	| { readonly kind: 'function'; readonly key: string; readonly flow: FunctionValueFlowEntry }
	| { readonly kind: 'instance'; readonly key: string; readonly of: LuaDefinitionShape }
	/** A member path written through without a value of its own (`function base.tools.byte()`). */
	| { readonly kind: 'path'; readonly key: string; readonly owner: LuaDefinitionShape; readonly name: string }
	/**
	 * `setmetatable(x, mt)` over a value that is not a table constructor
	 * (`setmetatable(base.new(opts), class)`): `x`'s own fields with `mt`'s
	 * prototype, replacing whatever prototype `x` had.
	 */
	| { readonly kind: 'retag'; readonly key: string; readonly retag: Retag };

type Retag = { readonly base: SemanticValueSource; readonly prototype: SemanticValueSource };

type OwnedFact =
	| { readonly kind: 'table' }
	| { readonly kind: 'function'; readonly flow: FunctionValueFlowEntry }
	| { readonly kind: 'call'; readonly call: CallValueEntry }
	| { readonly kind: 'receiver'; readonly flow: FunctionValueFlowEntry };

type MemberFact = { readonly entry: MemberValueEntry; readonly declaration: Decl };

/** A site that may give a table an `__index` prototype. */
type PrototypeSite =
	| { readonly kind: 'assignment'; readonly entry: ValueAssignmentEntry }
	| { readonly kind: 'call'; readonly call: CallValueEntry };

/** Facts of one bound file; pure functions of its `FileSemanticData`. */
type FileDefinitionFacts = {
	readonly ownedFacts: ReadonlyMap<number, OwnedFact>;
	/** Members whose owner names a table, holder declaration or class instance directly. */
	readonly membersByOwnerKey: ReadonlyMap<string, readonly MemberFact[]>;
	/** Members whose owner must be evaluated (aliases, paths, globals, call results), by name. */
	readonly indirectMembersByName: ReadonlyMap<string, readonly MemberFact[]>;
	readonly valueAssignmentsByTarget: ReadonlyMap<number, readonly ValueAssignmentEntry[]>;
	readonly receiverParameters: ReadonlyMap<SymbolID, FunctionValueFlowEntry>;
	/** Sites keyed by the declarations, globals and tables their target or arguments name. */
	readonly prototypeSitesByKey: ReadonlyMap<string, readonly PrototypeSite[]>;
	/** Declarations whose written value is exactly this table constructor. */
	readonly holdersByTable: ReadonlyMap<number, readonly Decl[]>;
	/** `setmetatable` targets that name no table directly and are not retags. */
	readonly indirectPrototypeAssignments: readonly ValueAssignmentEntry[];
	/** `setmetatable(x, mt)` call results over a non-constructor `x`, by result id. */
	readonly retagsByCall: ReadonlyMap<number, Retag>;
};

/** Parameter declarations bound to call-site argument sources for one callee body. */
type Binding = ReadonlyMap<SymbolID, SemanticValueSource>;

/** Alias, member and return hops a single lookup follows. */
const MAX_DEFINITION_DEPTH = 12;
const EMPTY_SHAPES: readonly LuaDefinitionShape[] = [];
const EMPTY_DECLS: readonly Decl[] = [];
const EMPTY_BINDING: Binding = new Map();

const factsByFile = new WeakMap<FileSemanticData, FileDefinitionFacts>();

export class LuaDefinitionTypes {
	private readonly files = new Map<string, FileSemanticData>();
	private readonly keyedMembers = new Map<string, readonly MemberFact[]>();
	private readonly moduleExports = new Map<string, readonly ModuleValueEntry[]>();
	private readonly prototypeSites = new Map<string, readonly PrototypeSite[]>();
	private readonly prototypes = new Map<string, readonly LuaDefinitionShape[]>();
	/** Retained answers of the current phase; see `enterPhase`. */
	private declarationShapes = new Map<SymbolID, readonly LuaDefinitionShape[]>();
	private sourceShapes = new Map<SemanticValueSource, readonly LuaDefinitionShape[]>();
	private membersByShape = new Map<string, ReadonlyMap<string, readonly Decl[]>>();
	private ownerShapes = new Map<MemberFact, readonly LuaDefinitionShape[]>();
	private readonly indirectByName = new Map<string, readonly MemberFact[]>();
	private allIndirect?: readonly MemberFact[];
	private indirectPrototypeSites?: ReadonlyMap<string, readonly PrototypeSite[]>;
	private readonly shapes = new Map<string, LuaDefinitionShape>();
	private readonly inProgress = new Set<SemanticValueSource | SymbolID>();
	/**
	 * `prototype` collects one table's prototypes without following prototype
	 * chains itself; `normal` answers queries. Each phase keeps its answers in
	 * its own retained maps, so neither sees the other's partial results.
	 */
	private phase: 'normal' | 'prototype' = 'normal';

	constructor(
		files: readonly FileSemanticData[],
		private readonly declarations: HashLookup<SymbolID, Decl>,
		private readonly globals: ReadonlyMap<string, SymbolID>,
	) {
		for (const file of files) this.files.set(file.file, file);
	}

	/** Shapes a value source is defined as; unknown values contribute nothing. */
	public shapesOf(source: SemanticValueSource): readonly LuaDefinitionShape[] {
		return this.evaluate(source, EMPTY_BINDING, 0);
	}

	/** Declarations of `name` found first along each shape's own members and prototype chain. */
	public lookupMember(shapes: readonly LuaDefinitionShape[], name: string): readonly Decl[] {
		const found: Decl[] = [];
		for (const shape of shapes) {
			for (const chainShape of this.chain(shape)) {
				const own = this.ownMember(chainShape, name);
				if (own.length === 0) continue;
				for (const declaration of own) if (!found.includes(declaration)) found.push(declaration);
				break;
			}
		}
		return found;
	}

	/** Every member visible on the shapes; nearer definitions shadow prototype ones. */
	public visibleMembers(shapes: readonly LuaDefinitionShape[]): ReadonlyMap<string, readonly Decl[]> {
		const members = new Map<string, Decl[]>();
		for (const shape of shapes) {
			const shadowed = new Set<string>();
			for (const chainShape of this.chain(shape)) {
				for (const [name, declarations] of this.ownMembers(chainShape)) {
					if (shadowed.has(name)) continue;
					shadowed.add(name);
					let bucket = members.get(name);
					if (!bucket) members.set(name, bucket = []);
					for (const declaration of declarations) if (!bucket.includes(declaration)) bucket.push(declaration);
				}
			}
		}
		return members;
	}

	/** Declared functions a callee source is defined as. */
	public functionDeclarations(source: SemanticValueSource): readonly SymbolID[] {
		const targets: SymbolID[] = [];
		for (const shape of this.shapesOf(source)) {
			if (shape.kind === 'function' && shape.flow.declaration !== undefined && !targets.includes(shape.flow.declaration)) {
				targets.push(shape.flow.declaration);
			}
		}
		return targets;
	}

	private facts(file: FileSemanticData): FileDefinitionFacts {
		let facts = factsByFile.get(file);
		if (!facts) {
			facts = buildFileFacts(file);
			factsByFile.set(file, facts);
		}
		return facts;
	}

	private factsFor(path: string): FileDefinitionFacts | undefined {
		const file = this.files.get(path);
		return file === undefined ? undefined : this.facts(file);
	}

	private membersKeyed(key: string): readonly MemberFact[] {
		let facts = this.keyedMembers.get(key);
		if (facts === undefined) {
			const merged: MemberFact[] = [];
			for (const file of this.files.values()) {
				const own = this.facts(file).membersByOwnerKey.get(key);
				if (own !== undefined) merged.push(...own);
			}
			this.keyedMembers.set(key, facts = merged);
		}
		return facts;
	}

	private exportsOf(module: string): readonly ModuleValueEntry[] {
		let exports = this.moduleExports.get(module);
		if (exports === undefined) {
			const merged: ModuleValueEntry[] = [];
			for (const file of this.files.values()) {
				for (const entry of file.moduleValues) if (entry.module === module) merged.push(entry);
			}
			this.moduleExports.set(module, exports = merged);
		}
		return exports;
	}

	private sitesKeyed(key: string): readonly PrototypeSite[] {
		let sites = this.prototypeSites.get(key);
		if (sites === undefined) {
			const merged: PrototypeSite[] = [];
			for (const file of this.files.values()) {
				const own = this.facts(file).prototypeSitesByKey.get(key);
				if (own !== undefined) for (const site of own) if (!merged.includes(site)) merged.push(site);
			}
			this.prototypeSites.set(key, sites = merged);
		}
		return sites;
	}

	private evaluate(source: SemanticValueSource, binding: Binding, depth: number): readonly LuaDefinitionShape[] {
		if (depth > MAX_DEFINITION_DEPTH) return EMPTY_SHAPES;
		const memoized = binding === EMPTY_BINDING;
		if (memoized) {
			const retained = this.sourceShapes.get(source);
			if (retained) return retained;
			if (this.inProgress.has(source)) return EMPTY_SHAPES;
			this.inProgress.add(source);
			// A retained answer must not depend on how deep its first caller was;
			// cycles are cut by inProgress, so the bound restarts here.
			depth = 0;
		}
		let shapes = this.evaluateRoot(source.root, binding, depth);
		for (const step of source.steps) {
			if (shapes.length === 0) break;
			const next: LuaDefinitionShape[] = [];
			switch (step.kind) {
				case 'member':
					for (const shape of shapes) {
						const values: LuaDefinitionShape[] = [];
						for (const declaration of this.lookupMember([shape], step.name)) {
							appendShapes(values, this.declarationValues(declaration.id, depth + 1));
						}
						appendShapes(next, values.length > 0 ? values : [this.path(shape, step.name)]);
					}
					break;
				case 'call':
					for (const shape of shapes) if (shape.kind === 'function') appendShapes(next, this.returns(shape.flow, depth + 1));
					break;
				case 'instance':
					for (const shape of shapes) appendShapes(next, [this.instance(shape)]);
					break;
				default:
					break;
			}
			shapes = next;
		}
		if (memoized) {
			this.inProgress.delete(source);
			this.sourceShapes.set(source, shapes);
		}
		return shapes;
	}

	private evaluateRoot(root: SemanticValueRoot, binding: Binding, depth: number): readonly LuaDefinitionShape[] {
		switch (root.kind) {
			case 'declaration': {
				const bound = binding.get(root.declId);
				if (bound !== undefined) return this.evaluate(bound, EMPTY_BINDING, depth + 1);
				return binding === EMPTY_BINDING
					? this.declarationValues(root.declId, depth + 1)
					: this.boundDeclarationValues(root.declId, binding, depth + 1);
			}
			case 'global': {
				const global = this.globals.get(root.symbolKey);
				return global === undefined ? EMPTY_SHAPES : this.declarationValues(global, depth + 1);
			}
			case 'module': {
				const shapes: LuaDefinitionShape[] = [];
				for (const exported of this.exportsOf(root.module)) appendShapes(shapes, this.evaluate(exported.source, EMPTY_BINDING, depth + 1));
				return shapes;
			}
			case 'owned':
				return this.ownedShapes(root.id, root.syntax.range.path, binding, depth);
			default:
				return EMPTY_SHAPES;
		}
	}

	private ownedShapes(id: number, path: string, binding: Binding, depth: number): readonly LuaDefinitionShape[] {
		const facts = this.factsFor(path);
		if (facts === undefined) return EMPTY_SHAPES;
		const retag = facts.retagsByCall.get(id);
		if (retag !== undefined) return [this.retagShape(id, retag)];
		const shapes: LuaDefinitionShape[] = [];
		const fact = facts.ownedFacts.get(id);
		if (fact !== undefined) {
			switch (fact.kind) {
				case 'table':
					shapes.push(this.table(id, path));
					break;
				case 'function':
					shapes.push(this.function(id, fact.flow));
					break;
				case 'receiver':
					if (fact.flow.receiverProjection !== undefined) appendShapes(shapes, this.evaluate(fact.flow.receiverProjection, EMPTY_BINDING, depth + 1));
					break;
				case 'call':
					for (const callee of this.evaluate(fact.call.callee, binding, depth + 1)) {
						if (callee.kind === 'function') appendShapes(shapes, this.returns(callee.flow, depth + 1));
					}
					break;
			}
		}
		for (const assignment of facts.valueAssignmentsByTarget.get(id) || []) appendShapes(shapes, this.evaluate(assignment.source, binding, depth + 1));
		return shapes;
	}

	private declarationValues(symbolId: SymbolID, depth: number): readonly LuaDefinitionShape[] {
		const retained = this.declarationShapes.get(symbolId);
		if (retained) return retained;
		if (this.inProgress.has(symbolId)) return EMPTY_SHAPES;
		this.inProgress.add(symbolId);
		const shapes = this.boundDeclarationValues(symbolId, EMPTY_BINDING, 0);
		this.inProgress.delete(symbolId);
		this.declarationShapes.set(symbolId, shapes);
		return shapes;
	}

	private boundDeclarationValues(symbolId: SymbolID, binding: Binding, depth: number): readonly LuaDefinitionShape[] {
		const declaration = this.declarations.get(symbolId);
		const file = declaration === undefined ? undefined : this.files.get(declaration.file);
		if (file === undefined) return EMPTY_SHAPES;
		const shapes: LuaDefinitionShape[] = [];
		const receiverFlow = this.facts(file).receiverParameters.get(symbolId);
		if (receiverFlow !== undefined) appendShapes(shapes, this.evaluate(receiverFlow.receiverProjection!, EMPTY_BINDING, depth + 1));
		for (const value of file.declarationValuesByDeclaration.get(symbolId) || []) appendShapes(shapes, this.evaluate(value.source, binding, depth + 1));
		return shapes;
	}

	private returns(flow: FunctionValueFlowEntry, depth: number): readonly LuaDefinitionShape[] {
		const shapes: LuaDefinitionShape[] = [];
		for (const returned of flow.returns) appendShapes(shapes, this.evaluate(returned.firstValue, EMPTY_BINDING, depth + 1));
		return shapes;
	}

	/**
	 * Lua lookup order for one shape: itself, then for an instance its class,
	 * then each `__index` prototype. A class also carries the fields its
	 * methods assign to `self`, which are the members of its instances.
	 */
	private chain(shape: LuaDefinitionShape): readonly LuaDefinitionShape[] {
		const chain: LuaDefinitionShape[] = [];
		const pending: LuaDefinitionShape[] = [shape];
		for (let index = 0; index < pending.length && chain.length <= MAX_DEFINITION_DEPTH; index += 1) {
			const current = pending[index];
			if (chain.some(existing => existing.key === current.key)) continue;
			chain.push(current);
			if (current.kind === 'instance') {
				pending.push(current.of);
				continue;
			}
			if (current.kind === 'retag') {
				// The retagged value keeps its own fields; its old prototypes are replaced.
				for (const base of this.shapesOf(current.retag.base)) {
					if (!chain.some(existing => existing.key === base.key)) chain.push(base);
				}
				if (this.phase === 'normal') for (const prototype of this.shapesOf(current.retag.prototype)) pending.push(prototype);
				continue;
			}
			const instance = this.instance(current);
			if (!chain.some(existing => existing.key === instance.key)) chain.push(instance);
			if (this.phase === 'normal') for (const prototype of this.prototypeShapes(current)) pending.push(prototype);
		}
		return chain;
	}

	/** Declarations of `name` defined on exactly this shape. */
	private ownMember(shape: LuaDefinitionShape, name: string): readonly Decl[] {
		const found: Decl[] = [];
		for (const key of this.ownerKeys(shape)) {
			for (const fact of this.membersKeyed(key)) if (fact.entry.name === name && !found.includes(fact.declaration)) found.push(fact.declaration);
		}
		for (const fact of this.indirectMembersNamed(name)) {
			if (this.ownersOf(fact).some(owner => owner.key === shape.key) && !found.includes(fact.declaration)) found.push(fact.declaration);
		}
		return found;
	}

	/** Every member defined on exactly this shape, by name. */
	private ownMembers(shape: LuaDefinitionShape): ReadonlyMap<string, readonly Decl[]> {
		const retained = this.membersByShape.get(shape.key);
		if (retained !== undefined) return retained;
		const members = new Map<string, Decl[]>();
		const add = (fact: MemberFact): void => {
			let declarations = members.get(fact.entry.name);
			if (!declarations) members.set(fact.entry.name, declarations = []);
			if (!declarations.includes(fact.declaration)) declarations.push(fact.declaration);
		};
		for (const key of this.ownerKeys(shape)) for (const fact of this.membersKeyed(key)) add(fact);
		for (const fact of this.allIndirectMembers()) if (this.ownersOf(fact).some(owner => owner.key === shape.key)) add(fact);
		this.membersByShape.set(shape.key, members);
		return members;
	}

	/** Shapes an indirect member's owner evaluates to, with the same rules a reader uses. */
	private ownersOf(fact: MemberFact): readonly LuaDefinitionShape[] {
		let owners = this.ownerShapes.get(fact);
		if (owners === undefined) {
			owners = this.shapesOf(fact.entry.owner);
			this.ownerShapes.set(fact, owners);
		}
		return owners;
	}

	/** Keys under which member facts name this shape directly. */
	private ownerKeys(shape: LuaDefinitionShape): readonly string[] {
		if (shape.kind === 'table') return this.tableKeys(shape);
		if (shape.kind !== 'instance' || shape.of.kind !== 'table') return [];
		const keys: string[] = [];
		for (const holder of this.factsFor(shape.of.file)?.holdersByTable.get(shape.of.owned) || EMPTY_DECLS) keys.push(instanceKey(holder.id));
		return keys;
	}

	private indirectMembersNamed(name: string): readonly MemberFact[] {
		let facts = this.indirectByName.get(name);
		if (facts === undefined) {
			const merged: MemberFact[] = [];
			for (const file of this.files.values()) {
				const own = this.facts(file).indirectMembersByName.get(name);
				if (own !== undefined) merged.push(...own);
			}
			this.indirectByName.set(name, facts = merged);
		}
		return facts;
	}

	private allIndirectMembers(): readonly MemberFact[] {
		if (this.allIndirect === undefined) {
			const all: MemberFact[] = [];
			for (const file of this.files.values()) for (const facts of this.facts(file).indirectMembersByName.values()) all.push(...facts);
			this.allIndirect = all;
		}
		return this.allIndirect;
	}

	/**
	 * Prototype assignments whose target names no table directly, grouped by
	 * the tables their targets evaluate to; once per snapshot, in the
	 * `prototype` phase, which follows no prototype chains itself.
	 */
	private indirectPrototypeSitesMap(): ReadonlyMap<string, readonly PrototypeSite[]> {
		if (this.indirectPrototypeSites !== undefined) return this.indirectPrototypeSites;
		const sites = new Map<string, PrototypeSite[]>();
		this.enterPhase('prototype', () => {
			for (const file of this.files.values()) {
				for (const entry of this.facts(file).indirectPrototypeAssignments) {
					const site: PrototypeSite = { kind: 'assignment', entry };
					for (const target of this.shapesOf(entry.target)) {
						let bucket = sites.get(target.key);
						if (!bucket) sites.set(target.key, bucket = []);
						bucket.push(site);
					}
				}
			}
		});
		this.indirectPrototypeSites = sites;
		return sites;
	}

	/** Runs `work` in `phase` with fresh retained maps, restoring the caller's afterwards. */
	private enterPhase(phase: 'prototype', work: () => void): void {
		const retained = [this.phase, this.sourceShapes, this.declarationShapes, this.membersByShape, this.ownerShapes] as const;
		this.phase = phase;
		this.sourceShapes = new Map();
		this.declarationShapes = new Map();
		this.membersByShape = new Map();
		this.ownerShapes = new Map();
		try {
			work();
		} finally {
			[this.phase, this.sourceShapes, this.declarationShapes, this.membersByShape, this.ownerShapes] = retained;
		}
	}

	/**
	 * `__index` prototypes of one table, collected lazily from the sites that
	 * name it: static `setmetatable` targets, and calls whose callee body sets
	 * a prototype through its parameters (a prototype summary such as
	 * `prefab.define({ class = director })`), bound to that call's arguments.
	 */
	private prototypeShapes(shape: LuaDefinitionShape): readonly LuaDefinitionShape[] {
		if (shape.kind !== 'table') return EMPTY_SHAPES;
		const retainedPrototypes = this.prototypes.get(shape.key);
		if (retainedPrototypes !== undefined) return retainedPrototypes;
		const sites: PrototypeSite[] = [];
		for (const key of this.tableKeys(shape)) {
			for (const site of this.sitesKeyed(key)) if (!sites.includes(site)) sites.push(site);
		}
		for (const site of this.indirectPrototypeSitesMap().get(shape.key) || []) if (!sites.includes(site)) sites.push(site);
		const prototypes: LuaDefinitionShape[] = [];
		this.prototypes.set(shape.key, prototypes);
		if (sites.length === 0) return prototypes;
		const add = (targets: readonly LuaDefinitionShape[], sources: readonly LuaDefinitionShape[]): void => {
			if (!targets.some(target => target.key === shape.key)) return;
			appendShapes(prototypes, sources.filter(source => source.key !== shape.key));
		};
		this.enterPhase('prototype', () => this.collectPrototypes(sites, add));
		return prototypes;
	}

	private collectPrototypes(
		sites: readonly PrototypeSite[],
		add: (targets: readonly LuaDefinitionShape[], sources: readonly LuaDefinitionShape[]) => void,
	): void {
		for (const site of sites) {
			if (site.kind === 'assignment') {
				add(this.shapesOf(site.entry.target), this.shapesOf(site.entry.source));
				continue;
			}
			for (const callee of this.shapesOf(site.call.callee)) {
				if (callee.kind !== 'function') continue;
				const flow = callee.flow;
				const binding = new Map<SymbolID, SemanticValueSource>();
				for (let index = 0; index < flow.parameters.length && index < site.call.arguments.length; index += 1) {
					const parameter = flow.parameters[index];
					if (parameter.root.kind === 'declaration') binding.set(parameter.root.declId, site.call.arguments[index]);
				}
				if (binding.size === 0) continue;
				for (const write of flow.assignments) {
					if (write.relation === 'prototype') add(this.evaluate(write.target, binding, 0), this.evaluate(write.source, binding, 0));
				}
			}
		}
	}

	/** Site keys that can name a table: the constructor itself and the declarations holding it. */
	private tableKeys(shape: LuaDefinitionShape & { readonly kind: 'table' }): readonly string[] {
		const keys = [ownedKey(shape.owned)];
		for (const holder of this.factsFor(shape.file)?.holdersByTable.get(shape.owned) || EMPTY_DECLS) {
			keys.push(declarationKey(holder.id));
			if (holder.isGlobal) keys.push(globalKey(holder.symbolKey));
		}
		return keys;
	}

	private table(owned: number, file: string): LuaDefinitionShape {
		const key = `t${owned}`;
		let shape = this.shapes.get(key);
		if (!shape) this.shapes.set(key, shape = { kind: 'table', key, owned, file });
		return shape;
	}

	private function(owned: number, flow: FunctionValueFlowEntry): LuaDefinitionShape {
		const key = `f${owned}`;
		let shape = this.shapes.get(key);
		if (!shape) this.shapes.set(key, shape = { kind: 'function', key, flow });
		return shape;
	}

	private path(owner: LuaDefinitionShape, name: string): LuaDefinitionShape {
		const key = `${owner.key}.${name}`;
		let shape = this.shapes.get(key);
		if (!shape) this.shapes.set(key, shape = { kind: 'path', key, owner, name });
		return shape;
	}

	private retagShape(call: number, retag: Retag): LuaDefinitionShape {
		const key = `r${call}`;
		let shape = this.shapes.get(key);
		if (!shape) this.shapes.set(key, shape = { kind: 'retag', key, retag });
		return shape;
	}

	private instance(of: LuaDefinitionShape): LuaDefinitionShape {
		if (of.kind === 'instance') return of;
		const key = `i${of.key}`;
		let shape = this.shapes.get(key);
		if (!shape) this.shapes.set(key, shape = { kind: 'instance', key, of });
		return shape;
	}
}

function buildFileFacts(file: FileSemanticData): FileDefinitionFacts {
	const declarations = new Map<SymbolID, Decl>();
	for (const declaration of file.decls) declarations.set(declaration.id, declaration);
	const ownedFacts = new Map<number, OwnedFact>();
	const membersByName = new Map<string, MemberFact[]>();
	const valueAssignmentsByTarget = new Map<number, ValueAssignmentEntry[]>();
	const receiverParameters = new Map<SymbolID, FunctionValueFlowEntry>();
	const prototypeSitesByKey = new Map<string, PrototypeSite[]>();
	const holdersByTable = new Map<number, Decl[]>();
	const addSite = (key: string | undefined, site: PrototypeSite): void => {
		if (key === undefined) return;
		let sites = prototypeSitesByKey.get(key);
		if (!sites) prototypeSitesByKey.set(key, sites = []);
		if (!sites.includes(site)) sites.push(site);
	};
	const addMembers = (entries: readonly MemberValueEntry[]): void => {
		for (const entry of entries) {
			const declaration = declarations.get(entry.declId);
			if (declaration === undefined) continue;
			let facts = membersByName.get(entry.name);
			if (!facts) membersByName.set(entry.name, facts = []);
			facts.push({ entry, declaration });
		}
	};
	const addAssignments = (entries: readonly ValueAssignmentEntry[]): void => {
		for (const entry of entries) {
			if (entry.relation === 'prototype') {
				addSite(sourceKey(entry.target), { kind: 'assignment', entry });
				continue;
			}
			if (entry.relation !== 'value' || entry.target.root.kind !== 'owned' || entry.target.steps.length !== 0) continue;
			let assignments = valueAssignmentsByTarget.get(entry.target.root.id);
			if (!assignments) valueAssignmentsByTarget.set(entry.target.root.id, assignments = []);
			assignments.push(entry);
		}
	};
	const calls: CallValueEntry[] = [];
	const addCall = (call: CallValueEntry): void => {
		calls.push(call);
		if (call.result !== undefined) ownedFacts.set(call.result.root.id, { kind: 'call', call });
	};
	for (const call of file.callValues) addCall(call);
	addMembers(file.memberValues);
	addAssignments(file.valueAssignments);
	for (const flow of file.functionValueFlows) {
		ownedFacts.set(flow.functionValue.root.id, { kind: 'function', flow });
		for (const parameter of flow.parameters) {
			if (parameter.root.kind === 'owned' && parameter.root.role === 'receiver') ownedFacts.set(parameter.root.id, { kind: 'receiver', flow });
		}
		const first = flow.parameters[0];
		if (first !== undefined && first.root.kind === 'declaration' && flow.receiverProjection !== undefined) {
			receiverParameters.set(first.root.declId, flow);
		}
		addMembers(flow.members);
		addAssignments(flow.assignments);
		for (const call of flow.calls) addCall(call);
	}
	for (const [syntax, owned] of file.ownedValuesBySyntax) {
		if (syntax.kind === LuaSyntaxKind.TableConstructorExpression && !ownedFacts.has(owned.root.id)) ownedFacts.set(owned.root.id, { kind: 'table' });
	}
	for (const [declId, values] of file.declarationValuesByDeclaration) {
		const declaration = declarations.get(declId);
		if (declaration === undefined) continue;
		for (const value of values) {
			if (value.source.root.kind !== 'owned' || value.source.steps.length !== 0) continue;
			let holders = holdersByTable.get(value.source.root.id);
			if (!holders) holdersByTable.set(value.source.root.id, holders = []);
			holders.push(declaration);
		}
	}
	// A call can apply a prototype summary to any table its arguments name,
	// directly or as a field of an argument table constructor.
	const fieldValuesByTable = new Map<number, SemanticValueSource[]>();
	for (const facts of membersByName.values()) {
		for (const fact of facts) {
			const owner = fact.entry.owner;
			if (owner.root.kind !== 'owned' || owner.steps.length !== 0) continue;
			let values = fieldValuesByTable.get(owner.root.id);
			if (!values) fieldValuesByTable.set(owner.root.id, values = []);
			for (const value of file.declarationValuesByDeclaration.get(fact.declaration.id) || []) values.push(value.source);
		}
	}
	for (const call of calls) {
		const site: PrototypeSite = { kind: 'call', call };
		for (const argument of call.arguments) {
			addSite(sourceKey(argument), site);
			if (argument.root.kind === 'owned' && argument.steps.length === 0) {
				for (const field of fieldValuesByTable.get(argument.root.id) || []) addSite(sourceKey(field), site);
			}
		}
	}
	// Key each member by an owner that names its shape directly; evaluate the rest.
	const holdsOnlyTables = (declId: SymbolID): boolean => {
		const values = file.declarationValuesByDeclaration.get(declId);
		return values !== undefined && values.length > 0 && values.every(value => value.source.steps.length === 0
			&& value.source.root.kind === 'owned' && ownedFacts.get(value.source.root.id)?.kind === 'table');
	};
	const receiverKey = (flow: FunctionValueFlowEntry): string | undefined => {
		const projection = flow.receiverProjection;
		if (projection === undefined || projection.root.kind !== 'declaration'
			|| projection.steps.length !== 1 || projection.steps[0].kind !== 'instance') return undefined;
		return holdsOnlyTables(projection.root.declId) ? instanceKey(projection.root.declId) : undefined;
	};
	const membersByOwnerKey = new Map<string, MemberFact[]>();
	const indirectMembersByName = new Map<string, MemberFact[]>();
	for (const facts of membersByName.values()) {
		for (const fact of facts) {
			const owner = fact.entry.owner;
			let key: string | undefined;
			let unknown = false;
			if (owner.steps.length === 0) {
				const root = owner.root;
				if (root.kind === 'owned') {
					const ownerFact = ownedFacts.get(root.id);
					if (ownerFact?.kind === 'receiver') key = receiverKey(ownerFact.flow);
					else if (ownerFact?.kind === 'table') key = ownedKey(root.id);
				} else if (root.kind === 'declaration') {
					const receiverFlow = receiverParameters.get(root.declId);
					if (receiverFlow !== undefined) key = receiverKey(receiverFlow);
					else if (holdsOnlyTables(root.declId)) key = declarationKey(root.declId);
					// A parameter has no definition to follow: its members name nothing.
					else unknown = declarations.get(root.declId)?.kind === 'parameter' && !file.declarationValuesByDeclaration.has(root.declId);
				}
			}
			if (unknown) continue;
			if (key === undefined) {
				let indirect = indirectMembersByName.get(fact.entry.name);
				if (!indirect) indirectMembersByName.set(fact.entry.name, indirect = []);
				indirect.push(fact);
				continue;
			}
			let keyed = membersByOwnerKey.get(key);
			if (!keyed) membersByOwnerKey.set(key, keyed = []);
			keyed.push(fact);
		}
	}
	const indirectPrototypeAssignments: ValueAssignmentEntry[] = [];
	const retagsByCall = new Map<number, Retag>();
	const callsByExpression = new Map<unknown, CallValueEntry>();
	for (const call of calls) callsByExpression.set(call.expression, call);
	const collectIndirectPrototypes = (entries: readonly ValueAssignmentEntry[]): void => {
		for (const entry of entries) {
			if (entry.relation !== 'prototype') continue;
			const target = entry.target;
			const direct = target.steps.length === 0 && (target.root.kind === 'owned'
				? ownedFacts.get(target.root.id)?.kind === 'table'
				: target.root.kind === 'declaration' && holdsOnlyTables(target.root.declId));
			if (direct) continue;
			const call = entry.syntax.kind === LuaSyntaxKind.CallExpression ? callsByExpression.get(entry.syntax) : undefined;
			if (call?.result !== undefined) {
				retagsByCall.set(call.result.root.id, { base: target, prototype: entry.source });
				continue;
			}
			indirectPrototypeAssignments.push(entry);
		}
	};
	collectIndirectPrototypes(file.valueAssignments);
	for (const flow of file.functionValueFlows) collectIndirectPrototypes(flow.assignments);
	// A retagged call result is its retag shape, not the value it was given.
	for (const id of retagsByCall.keys()) valueAssignmentsByTarget.delete(id);
	return {
		ownedFacts, membersByOwnerKey, indirectMembersByName, valueAssignmentsByTarget, receiverParameters,
		prototypeSitesByKey, holdersByTable, indirectPrototypeAssignments, retagsByCall,
	};
}

function sourceKey(source: SemanticValueSource): string | undefined {
	if (source.steps.length !== 0) return undefined;
	switch (source.root.kind) {
		case 'declaration': return declarationKey(source.root.declId);
		case 'owned': return ownedKey(source.root.id);
		case 'global': return globalKey(source.root.symbolKey);
		default: return undefined;
	}
}

function declarationKey(declId: SymbolID): string { return `d${declId}`; }
function ownedKey(owned: number): string { return `o${owned}`; }
function instanceKey(declId: SymbolID): string { return `i${declId}`; }
function globalKey(symbolKey: string): string { return `g${symbolKey}`; }

function appendShapes(target: LuaDefinitionShape[], shapes: readonly LuaDefinitionShape[]): void {
	for (const shape of shapes) if (!target.some(existing => existing.key === shape.key)) target.push(shape);
}
