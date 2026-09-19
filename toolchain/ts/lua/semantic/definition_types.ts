import { LuaSyntaxKind } from '../syntax/ast';
import type { Decl, FileSemanticData, SymbolID } from './model';
import type {
	CallValueEntry,
	FunctionValueFlowEntry,
	MemberValueEntry,
	ModuleValueEntry,
	SemanticValueSource,
	ValueAssignmentEntry,
} from './value_graph';

/**
 * Definition-based value shapes for interactive IDE queries, the way a language
 * server types a program: a name means what its declarations and the
 * definitions they name say. Nothing here asks what other code may write into
 * an object or which callers reach a parameter; such values are unknown.
 */

/** A table, function body or instance identity with a definition site. */
export type LuaDefinitionShape =
	| { readonly kind: 'table'; readonly key: string; readonly owned: number }
	| { readonly kind: 'function'; readonly key: string; readonly flow: FunctionValueFlowEntry }
	| { readonly kind: 'instance'; readonly key: string; readonly of: LuaDefinitionShape }
	/** A member path written through without a value of its own (`function base.tools.byte()`). */
	| { readonly kind: 'path'; readonly key: string; readonly owner: LuaDefinitionShape; readonly name: string };

type OwnedFact =
	| { readonly kind: 'table' }
	| { readonly kind: 'function'; readonly flow: FunctionValueFlowEntry }
	| { readonly kind: 'call'; readonly call: CallValueEntry }
	| { readonly kind: 'receiver'; readonly flow: FunctionValueFlowEntry };

type MemberFact = { readonly entry: MemberValueEntry; readonly declaration: Decl };

/** Parameter declarations bound to call-site argument sources for one callee body. */
type Binding = ReadonlyMap<SymbolID, SemanticValueSource>;

/** Alias, member and return hops a single lookup follows. */
const MAX_DEFINITION_DEPTH = 12;
const EMPTY_SHAPES: readonly LuaDefinitionShape[] = [];
const EMPTY_BINDING: Binding = new Map();

export class LuaDefinitionTypes {
	private readonly ownedFacts = new Map<number, OwnedFact>();
	private readonly valuesByDeclaration = new Map<SymbolID, SemanticValueSource[]>();
	private readonly membersByName = new Map<string, MemberFact[]>();
	private readonly moduleExports = new Map<string, ModuleValueEntry[]>();
	private readonly assignmentsByTarget = new Map<number, ValueAssignmentEntry[]>();
	private readonly prototypeAssignments: ValueAssignmentEntry[] = [];
	private readonly allCalls: CallValueEntry[] = [];
	private readonly declarationShapes = new Map<SymbolID, readonly LuaDefinitionShape[]>();
	private readonly sourceShapes = new Map<SemanticValueSource, readonly LuaDefinitionShape[]>();
	private readonly ownerShapes = new Map<MemberFact, readonly LuaDefinitionShape[]>();
	private readonly instances = new Map<string, LuaDefinitionShape>();
	private readonly tables = new Map<number, LuaDefinitionShape>();
	private readonly functions = new Map<number, LuaDefinitionShape>();
	private readonly paths = new Map<string, LuaDefinitionShape>();
	/** Explicit `self` parameters of bodies the binder projects onto a receiver. */
	private readonly receiverParameters = new Map<SymbolID, FunctionValueFlowEntry>();
	private readonly inProgress = new Set<SemanticValueSource | SymbolID>();
	private prototypes?: Map<string, LuaDefinitionShape[]>;
	/** While prototype edges are collected, lookups see own members only and nothing is retained. */
	private collectingPrototypes = false;

	constructor(
		files: readonly FileSemanticData[],
		private readonly declarations: ReadonlyMap<SymbolID, Decl>,
		private readonly globals: ReadonlyMap<string, SymbolID>,
	) {
		for (const file of files) {
			for (const entry of file.moduleValues) {
				let exports = this.moduleExports.get(entry.module);
				if (!exports) this.moduleExports.set(entry.module, exports = []);
				exports.push(entry);
			}
			for (const [declId, values] of file.declarationValuesByDeclaration) {
				let sources = this.valuesByDeclaration.get(declId);
				if (!sources) this.valuesByDeclaration.set(declId, sources = []);
				for (const value of values) sources.push(value.source);
			}
			this.indexMembers(file.memberValues);
			this.indexAssignments(file.valueAssignments);
			for (const call of file.callValues) this.indexCall(call);
			for (const flow of file.functionValueFlows) {
				this.ownedFacts.set(flow.functionValue.root.id, { kind: 'function', flow });
				for (const parameter of flow.parameters) {
					if (parameter.root.kind === 'owned' && parameter.root.role === 'receiver') {
						this.ownedFacts.set(parameter.root.id, { kind: 'receiver', flow });
					}
				}
				const first = flow.parameters[0];
				if (first !== undefined && first.root.kind === 'declaration' && flow.receiverProjection !== undefined) {
					this.receiverParameters.set(first.root.declId, flow);
				}
				this.indexMembers(flow.members);
				this.indexAssignments(flow.assignments);
				for (const call of flow.calls) this.indexCall(call);
			}
			for (const [syntax, owned] of file.ownedValuesBySyntax) {
				if (syntax.kind === LuaSyntaxKind.TableConstructorExpression && !this.ownedFacts.has(owned.root.id)) {
					this.ownedFacts.set(owned.root.id, { kind: 'table' });
				}
			}
		}
	}

	/** Shapes a value source is defined as; unknown values contribute nothing. */
	public shapesOf(source: SemanticValueSource): readonly LuaDefinitionShape[] {
		return this.evaluate(source, EMPTY_BINDING, 0);
	}

	/** Declarations of `name` found first along each shape's own members and prototype chain. */
	public lookupMember(shapes: readonly LuaDefinitionShape[], name: string): readonly Decl[] {
		const found: Decl[] = [];
		for (const shape of shapes) {
			for (const declaration of this.lookupOnShape(shape, name, new Set(), 0)) {
				if (!found.includes(declaration)) found.push(declaration);
			}
		}
		return found;
	}

	/** Every member visible on the shapes; nearer definitions shadow prototype ones. */
	public visibleMembers(shapes: readonly LuaDefinitionShape[]): ReadonlyMap<string, readonly Decl[]> {
		const members = new Map<string, Decl[]>();
		for (const shape of shapes) {
			const seen = new Set<string>();
			for (const chainShape of this.chain(shape)) {
				for (const [name, facts] of this.membersByName) {
					if (seen.has(name)) continue;
					const declarations = this.ownMembers(chainShape, facts);
					if (declarations.length === 0) continue;
					seen.add(name);
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

	private indexMembers(entries: readonly MemberValueEntry[]): void {
		for (const entry of entries) {
			const declaration = this.declarations.get(entry.declId);
			if (declaration === undefined) continue;
			let facts = this.membersByName.get(entry.name);
			if (!facts) this.membersByName.set(entry.name, facts = []);
			facts.push({ entry, declaration });
		}
	}

	private indexAssignments(entries: readonly ValueAssignmentEntry[]): void {
		for (const entry of entries) {
			if (entry.relation === 'prototype') {
				this.prototypeAssignments.push(entry);
				continue;
			}
			if (entry.relation !== 'value' || entry.target.root.kind !== 'owned' || entry.target.steps.length !== 0) continue;
			let assignments = this.assignmentsByTarget.get(entry.target.root.id);
			if (!assignments) this.assignmentsByTarget.set(entry.target.root.id, assignments = []);
			assignments.push(entry);
		}
	}

	private indexCall(call: CallValueEntry): void {
		this.allCalls.push(call);
		if (call.result !== undefined) this.ownedFacts.set(call.result.root.id, { kind: 'call', call });
	}

	private evaluate(source: SemanticValueSource, binding: Binding, depth: number): readonly LuaDefinitionShape[] {
		if (depth > MAX_DEFINITION_DEPTH) return EMPTY_SHAPES;
		const memoized = binding === EMPTY_BINDING && !this.collectingPrototypes;
		if (memoized) {
			const retained = this.sourceShapes.get(source);
			if (retained) return retained;
			if (this.inProgress.has(source)) return EMPTY_SHAPES;
			this.inProgress.add(source);
			// A retained answer must not depend on how deep its first caller was;
			// cycles are cut by inProgress, so the bound restarts here.
			depth = 0;
		}
		let shapes = this.evaluateRoot(source, binding, depth);
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
					for (const shape of shapes) if (shape.kind === 'function') appendShapes(next, this.returns(shape.flow, EMPTY_BINDING, depth + 1));
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

	private evaluateRoot(source: SemanticValueSource, binding: Binding, depth: number): readonly LuaDefinitionShape[] {
		const root = source.root;
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
				for (const exported of this.moduleExports.get(root.module) || []) appendShapes(shapes, this.evaluate(exported.source, EMPTY_BINDING, depth + 1));
				return shapes;
			}
			case 'owned':
				return this.ownedShapes(root.id, binding, depth);
			default:
				return EMPTY_SHAPES;
		}
	}

	private ownedShapes(id: number, binding: Binding, depth: number): readonly LuaDefinitionShape[] {
		const shapes: LuaDefinitionShape[] = [];
		const fact = this.ownedFacts.get(id);
		if (fact !== undefined) {
			switch (fact.kind) {
				case 'table':
					shapes.push(this.table(id));
					break;
				case 'function':
					shapes.push(this.function(id, fact.flow));
					break;
				case 'receiver':
					if (fact.flow.receiverProjection !== undefined) appendShapes(shapes, this.evaluate(fact.flow.receiverProjection, EMPTY_BINDING, depth + 1));
					break;
				case 'call':
					for (const callee of this.evaluate(fact.call.callee, binding, depth + 1)) {
						if (callee.kind === 'function') appendShapes(shapes, this.returns(callee.flow, EMPTY_BINDING, depth + 1));
					}
					break;
			}
		}
		for (const assignment of this.assignmentsByTarget.get(id) || []) appendShapes(shapes, this.evaluate(assignment.source, binding, depth + 1));
		return shapes;
	}

	private declarationValues(symbolId: SymbolID, depth: number): readonly LuaDefinitionShape[] {
		if (this.collectingPrototypes) return this.boundDeclarationValues(symbolId, EMPTY_BINDING, depth);
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
		const shapes: LuaDefinitionShape[] = [];
		const receiverFlow = this.receiverParameters.get(symbolId);
		if (receiverFlow !== undefined) appendShapes(shapes, this.evaluate(receiverFlow.receiverProjection!, EMPTY_BINDING, depth + 1));
		for (const source of this.valuesByDeclaration.get(symbolId) || []) appendShapes(shapes, this.evaluate(source, binding, depth + 1));
		return shapes;
	}

	private returns(flow: FunctionValueFlowEntry, binding: Binding, depth: number): readonly LuaDefinitionShape[] {
		const shapes: LuaDefinitionShape[] = [];
		for (const returned of flow.returns) appendShapes(shapes, this.evaluate(returned.firstValue, binding, depth + 1));
		return shapes;
	}

	private lookupOnShape(shape: LuaDefinitionShape, name: string, visited: Set<string>, depth: number): readonly Decl[] {
		const facts = this.membersByName.get(name);
		for (const chainShape of this.chain(shape)) {
			if (visited.has(chainShape.key)) continue;
			visited.add(chainShape.key);
			if (facts === undefined) continue;
			const own = this.ownMembers(chainShape, facts);
			if (own.length > 0) return own;
		}
		return [];
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
			const instance = this.instance(current);
			if (!chain.some(existing => existing.key === instance.key)) chain.push(instance);
			if (!this.collectingPrototypes) for (const prototype of this.prototypeShapes(current)) pending.push(prototype);
		}
		return chain;
	}

	private ownMembers(shape: LuaDefinitionShape, facts: readonly MemberFact[]): readonly Decl[] {
		const found: Decl[] = [];
		for (const fact of facts) {
			let owners = this.ownerShapes.get(fact);
			if (owners === undefined) {
				owners = this.shapesOf(fact.entry.owner);
				if (!this.collectingPrototypes) this.ownerShapes.set(fact, owners);
			}
			if (owners.some(owner => owner.key === shape.key) && !found.includes(fact.declaration)) found.push(fact.declaration);
		}
		return found;
	}

	private prototypeShapes(shape: LuaDefinitionShape): readonly LuaDefinitionShape[] {
		if (this.prototypes === undefined) this.prototypes = this.buildPrototypes();
		return this.prototypes.get(shape.key) || EMPTY_SHAPES;
	}

	/**
	 * `__index` prototypes from static `setmetatable` sites, plus prototype
	 * summaries: a callee body that sets a prototype through its parameters,
	 * applied at call sites with the call's own argument sources.
	 */
	private buildPrototypes(): Map<string, LuaDefinitionShape[]> {
		const prototypes = new Map<string, LuaDefinitionShape[]>();
		const add = (targets: readonly LuaDefinitionShape[], sources: readonly LuaDefinitionShape[]): void => {
			for (const target of targets) {
				let bucket = prototypes.get(target.key);
				if (!bucket) prototypes.set(target.key, bucket = []);
				appendShapes(bucket, sources.filter(source => source.key !== target.key));
			}
		};
		this.collectingPrototypes = true;
		for (const assignment of this.prototypeAssignments) {
			add(this.shapesOf(assignment.target), this.shapesOf(assignment.source));
		}
		for (const call of this.allCalls) {
			for (const callee of this.shapesOf(call.callee)) {
				if (callee.kind !== 'function') continue;
				const flow = callee.flow;
				const prototypeWrites = flow.assignments.filter(entry => entry.relation === 'prototype');
				if (prototypeWrites.length === 0) continue;
				const binding = new Map<SymbolID, SemanticValueSource>();
				for (let index = 0; index < flow.parameters.length && index < call.arguments.length; index += 1) {
					const parameter = flow.parameters[index];
					if (parameter.root.kind === 'declaration') binding.set(parameter.root.declId, call.arguments[index]);
				}
				if (binding.size === 0) continue;
				for (const write of prototypeWrites) add(this.evaluate(write.target, binding, 0), this.evaluate(write.source, binding, 0));
			}
		}
		this.collectingPrototypes = false;
		return prototypes;
	}

	private table(owned: number): LuaDefinitionShape {
		let shape = this.tables.get(owned);
		if (!shape) this.tables.set(owned, shape = { kind: 'table', key: `t${owned}`, owned });
		return shape;
	}

	private function(owned: number, flow: FunctionValueFlowEntry): LuaDefinitionShape {
		let shape = this.functions.get(owned);
		if (!shape) this.functions.set(owned, shape = { kind: 'function', key: `f${owned}`, flow });
		return shape;
	}

	private path(owner: LuaDefinitionShape, name: string): LuaDefinitionShape {
		const key = `${owner.key}.${name}`;
		let shape = this.paths.get(key);
		if (!shape) this.paths.set(key, shape = { kind: 'path', key, owner, name });
		return shape;
	}

	private instance(of: LuaDefinitionShape): LuaDefinitionShape {
		if (of.kind === 'instance') return of;
		let shape = this.instances.get(of.key);
		if (!shape) this.instances.set(of.key, shape = { kind: 'instance', key: `i${of.key}`, of });
		return shape;
	}
}

function appendShapes(target: LuaDefinitionShape[], shapes: readonly LuaDefinitionShape[]): void {
	for (const shape of shapes) if (!target.some(existing => existing.key === shape.key)) target.push(shape);
}
