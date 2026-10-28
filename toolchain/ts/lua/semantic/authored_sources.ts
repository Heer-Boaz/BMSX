import { LuaSyntaxKind, type LuaTableConstructorExpression } from '../syntax/ast';
import type { FileSemanticData } from './model';
import { appendValueMember, type FunctionValueFlowEntry, type MemberValueEntry, type SemanticValueSource, type ValueAssignmentEntry } from './value_graph';
import { LuaWrittenSourceQuery, type LuaWrittenSource, type LuaWrittenSourceBoundary, type LuaWrittenSourceInputs } from './written_sources';
import { getLuaWrittenMemberDefinitions } from './written_declarations';

export type LuaAuthoredSourceBoundary = LuaWrittenSourceBoundary | {
	readonly source: LuaWrittenSource;
	readonly reason: 'competing-writes' | 'computed-write' | 'prototype-write';
};

export type LuaAuthoredMemberRead = {
	readonly source: LuaWrittenSource;
	readonly base: LuaWrittenSource;
	readonly name: string;
	readonly origins: readonly LuaWrittenSource[];
};

/** Authored dependencies, not a certificate about runtime values or executed writes. */
export type LuaAuthoredSourceTrace = {
	readonly root: LuaWrittenSource;
	readonly sources: readonly LuaWrittenSource[];
	readonly terminals: readonly LuaWrittenSource[];
	readonly boundaries: readonly LuaAuthoredSourceBoundary[];
	readonly memberReads: readonly LuaAuthoredMemberRead[];
};

type SourceNode = {
	readonly source: LuaWrittenSource;
	readonly dependencies: Set<SourceNode>;
	readonly dependents: SourceNode[];
	readonly tables: Set<LuaTableConstructorExpression>;
	readonly writers: MemberWrite[];
	readonly readers: SourceNode[];
	readonly mutations: Mutation[];
	inputs?: LuaWrittenSourceInputs;
	ancestor?: SourceNode;
	member?: { readonly base: SourceNode; readonly name: string; readonly writes: Set<MemberWrite>; readonly tables: Set<LuaTableConstructorExpression> };
};

type MemberWrite = {
	readonly name: string;
	readonly owner: SourceNode;
	readonly source: LuaWrittenSource;
};

type Mutation = {
	readonly source: LuaWrittenSource;
	readonly owner: SourceNode;
	readonly reason: 'computed-write' | 'prototype-write' | undefined;
	readonly initialization: boolean;
};

type TableSources = {
	readonly file: FileSemanticData;
	readonly source: LuaWrittenSource;
	readonly members: Map<string, MemberWrite[]>;
	readonly readers: Map<string, SourceNode[]>;
	readonly mutations: Mutation[];
	readonly initialized: Set<string>;
};

/**
 * A snapshot-owned projection over written occurrences. Named reads join raw
 * writer receivers at the constructor occurrences reached by authored edges.
 * Calls, formal inputs and computed paths never become table identities. The
 * graph retains competing writes and receiver evidence even when their RHSs
 * converge; constructor reachability alone never closes a source read.
 */
export class LuaAuthoredSourceQuery {
	private readonly nodes = new Map<LuaWrittenSource, SourceNode>();
	private readonly pending: SourceNode[] = [];
	private readonly origins: { readonly node: SourceNode; readonly table: LuaTableConstructorExpression }[] = [];
	private readonly tables = new Map<LuaTableConstructorExpression, TableSources>();
	private readonly mutations: Mutation[] = [];
	private readonly containment: { readonly owner: SourceNode; readonly value: LuaWrittenSource }[] = [];
	private readonly traces = new Map<LuaWrittenSource, LuaAuthoredSourceTrace>();
	private readonly projections = new Map<LuaWrittenSource, Map<string, LuaWrittenSource>>();
	private indexed = false;
	private mutatedTables: ReadonlySet<LuaTableConstructorExpression> | undefined;
	private directlyMutatedTables: ReadonlySet<LuaTableConstructorExpression> | undefined;

	public constructor(private readonly files: readonly FileSemanticData[], private readonly written: LuaWrittenSourceQuery) {}

	/** A retained named projection of a written read, without manufacturing syntax. */
	public member(base: LuaWrittenSource, name: string): LuaAuthoredSourceTrace {
		let members = this.projections.get(base);
		if (members === undefined) { members = new Map(); this.projections.set(base, members); }
		let source = members.get(name);
		if (source === undefined) {
			source = { kind: 'member-base', file: base.file, read: base, value: appendValueMember(base.value, name) };
			members.set(name, source);
		}
		return this.trace(source);
	}

	public trace(root: LuaWrittenSource): LuaAuthoredSourceTrace {
		const retained = this.traces.get(root);
		if (retained !== undefined) return retained;
		const initial = this.node(root);
		this.solve();
		const sources: LuaWrittenSource[] = [];
		const terminals: LuaWrittenSource[] = [];
		const boundaries: LuaAuthoredSourceBoundary[] = [];
		const memberReads: LuaAuthoredMemberRead[] = [];
		// Evidence reaches resource/boundary owners without making the receiver
		// constructor another result of the member read.
		const states = new Map<SourceNode, number>();
		const pending: { readonly node: SourceNode; readonly value: boolean }[] = [];
		const add = (node: SourceNode, value: boolean): void => {
			const previous = states.get(node) ?? 0;
			const flag = value ? 2 : 1;
			if ((previous & flag) !== 0) return;
			states.set(node, previous | flag);
			pending.push({ node, value });
			if (previous === 0) sources.push(node.source);
		};
		add(initial, true);
		const observed = new Set<SourceNode>();
		for (let cursor = 0; cursor < pending.length; cursor += 1) {
			const { node, value } = pending[cursor];
			const inputs = node.inputs!;
			const observe = !observed.has(node);
			observed.add(node);
			if (inputs.kind === 'terminal') {
				if (value) terminals.push(node.source);
			} else if (inputs.kind === 'contributions') {
				if (observe && inputs.sources.length > 1) boundaries.push({ source: node.source, reason: 'competing-writes' });
				for (const dependency of node.dependencies) add(dependency, value);
			} else if (node.member !== undefined) {
				const member = node.member;
				add(member.base, false);
				if (observe) {
					memberReads.push({ source: node.source, base: member.base.source, name: member.name,
						origins: Array.from(member.writes, write => write.source) });
					if (member.writes.size === 0) boundaries.push({ source: node.source, reason: 'unwritten-member' });
					else if (member.writes.size > 1) boundaries.push({ source: node.source, reason: 'competing-writes' });
					const mutations = new Set<Mutation>();
					for (const table of member.base.tables) for (const mutation of this.tables.get(table)!.mutations) {
						if (mutation.reason === undefined || mutations.has(mutation)) continue;
						mutations.add(mutation);
						boundaries.push({ source: mutation.source, reason: mutation.reason });
						add(mutation.owner, false);
					}
				}
				for (const write of member.writes) {
					add(write.owner, false);
					add(this.nodes.get(write.source)!, value);
				}
			} else if (observe) {
				if (inputs.reason === 'call-result') boundaries.push({ source: node.source, reason: inputs.reason, call: inputs.call });
				else if (inputs.reason === 'member-read') boundaries.push({ source: node.source, reason: inputs.reason, base: inputs.base, name: inputs.name });
				else boundaries.push({ source: node.source, reason: inputs.reason });
			}
		}
		const trace = { root, sources, terminals, boundaries, memberReads };
		this.traces.set(root, trace);
		return trace;
	}

	/** Local storage writes, distinct from partiality inherited through contained sources. */
	public directTableMutations(): ReadonlySet<LuaTableConstructorExpression> {
		if (this.directlyMutatedTables === undefined) this.tableMutations();
		return this.directlyMutatedTables!;
	}

	/** Written descendant changes make both their target and containing sources partial. */
	public tableMutations(): ReadonlySet<LuaTableConstructorExpression> {
		if (this.mutatedTables !== undefined) return this.mutatedTables;
		this.index();
		// Constructor fields are immutable per-file facts. Scalar fields do not
		// need source graph nodes merely to establish containment.
		const parents = new Map<LuaTableConstructorExpression, Set<LuaTableConstructorExpression>>();
		for (const file of this.files) for (const [table, fields] of getLuaWrittenMemberDefinitions(file).constructors) {
			for (const write of fields.values()) {
				const value = write.source;
				if (value.root.kind === 'literal' || value.root.kind === 'unknown') continue;
				if (value.steps.length === 0 && value.root.kind === 'owned') {
					if (value.root.syntax.kind === LuaSyntaxKind.TableConstructorExpression) {
						let containing = parents.get(value.root.syntax);
						if (containing === undefined) { containing = new Set(); parents.set(value.root.syntax, containing); }
						containing.add(table);
						continue;
					}
					if (value.root.syntax.kind === LuaSyntaxKind.FunctionExpression) continue;
				}
				this.containment.push({ owner: this.node(this.written.expression(file, table)), value: this.written.write(write) });
			}
		}
		for (const { value } of this.containment) this.node(value);
		this.solve();
		for (const { owner, value } of this.containment) {
			for (const child of this.nodes.get(value)!.tables) {
				let containing = parents.get(child);
				if (containing === undefined) { containing = new Set(); parents.set(child, containing); }
				for (const parent of owner.tables) containing.add(parent);
			}
		}
		const tables = new Set<LuaTableConstructorExpression>();
		const pending: LuaTableConstructorExpression[] = [];
		const receivers: SourceNode[] = [];
		const directlyMutated = new Set<LuaTableConstructorExpression>();
		for (const mutation of this.mutations) if (!mutation.initialization) {
			receivers.push(mutation.owner);
			for (const table of mutation.owner.tables) directlyMutated.add(table);
		}
		const seen = new Set<SourceNode>();
		for (let cursor = 0; cursor < receivers.length; cursor += 1) {
			const node = receivers[cursor];
			if (seen.has(node)) continue;
			seen.add(node);
			for (const table of node.tables) if (!tables.has(table)) { tables.add(table); pending.push(table); }
			for (const dependency of node.dependencies) receivers.push(dependency);
			if (node.ancestor !== undefined) receivers.push(node.ancestor);
		}
		for (let cursor = 0; cursor < pending.length; cursor += 1) {
			const containing = parents.get(pending[cursor]);
			if (containing === undefined) continue;
			for (const table of containing) if (!tables.has(table)) { tables.add(table); pending.push(table); }
		}
		this.directlyMutatedTables = directlyMutated;
		this.mutatedTables = tables;
		return tables;
	}

	private node(source: LuaWrittenSource): SourceNode {
		let node = this.nodes.get(source);
		if (node === undefined) {
			node = { source, dependencies: new Set(), dependents: [], tables: new Set(), writers: [], readers: [], mutations: [] };
			this.nodes.set(source, node);
			this.pending.push(node);
		}
		return node;
	}

	private owner(file: FileSemanticData, read: LuaWrittenSource, value: SemanticValueSource): SourceNode {
		return this.node({ kind: 'member-base', file, read, value });
	}

	/** One pass over existing binder facts; no AST walk, callee query or per-reader scan. */
	private index(): void {
		if (this.indexed) return;
		this.indexed = true;
		for (const file of this.files) {
			this.indexMembers(file, file.memberValues);
			this.indexAssignments(file, file.valueAssignments, undefined);
			for (const flow of file.functionValueFlows) {
				this.indexMembers(file, flow.members);
				this.indexAssignments(file, flow.assignments, flow);
			}
		}
	}

	private indexMembers(file: FileSemanticData, entries: readonly MemberValueEntry[]): void {
		for (const entry of entries) {
			const writes = file.declarationValuesByDeclaration.get(entry.declId)!;
			for (const write of writes) {
				if (write.syntax.kind === LuaSyntaxKind.TableConstructorExpression) continue;
				const source = this.written.write(write);
				const owner = this.owner(file, source, entry.owner);
				const member = { name: entry.name, owner, source };
				owner.writers.push(member);
				if (write.source.root.kind !== 'literal' && write.source.root.kind !== 'unknown') this.containment.push({ owner, value: source });
				this.mutation({ source, owner, reason: undefined, initialization: false });
			}
		}
	}

	private indexAssignments(file: FileSemanticData, writes: readonly ValueAssignmentEntry[], flow: FunctionValueFlowEntry | undefined): void {
		for (const write of writes) {
			const target = write.target;
			if (write.relation === 'value' && target.steps.length === 0) continue;
			if (write.syntax.kind === LuaSyntaxKind.TableConstructorExpression && (write.source.root.kind === 'literal' || write.source.root.kind === 'unknown')
				&& target.steps[target.steps.length - 1].kind === 'element') continue;
			const source: LuaWrittenSource = { kind: 'value-transfer', file, write, flow, value: write.source };
			const step = target.steps[target.steps.length - 1];
			const ownerValue = write.relation === 'value' ? { root: target.root, steps: target.steps.slice(0, -1) } : target;
			const owner = this.owner(file, source, ownerValue);
			if (write.relation === 'value' && write.source.root.kind !== 'literal' && write.source.root.kind !== 'unknown') this.containment.push({ owner, value: source });
			if (write.syntax.kind === LuaSyntaxKind.TableConstructorExpression && step.kind === 'element') continue;
			const reason = write.relation !== 'value' ? 'prototype-write'
				: step.kind === 'index' && !(step.key.steps.length === 0 && step.key.root.kind === 'literal'
					&& step.key.root.literal.kind !== 'string') ? 'computed-write' : undefined;
			this.mutation({ source, owner, reason, initialization: write.syntax.kind === LuaSyntaxKind.TableConstructorExpression });
		}
	}

	private solve(): void {
		let cursor = 0;
		let expanded = 0;
		while (expanded < this.pending.length || cursor < this.origins.length) {
			while (expanded < this.pending.length) {
				const node = this.pending[expanded++];
				const inputs = this.written.inputs(node.source);
				node.inputs = inputs;
				if (inputs.kind === 'contributions') {
					for (const source of inputs.sources) this.dependency(node, this.node(source));
				} else if (inputs.kind === 'terminal') {
					const root = node.source.value.root;
					if (root.kind === 'owned' && root.syntax.kind === LuaSyntaxKind.TableConstructorExpression) {
						if (!this.tables.has(root.syntax)) this.tables.set(root.syntax, { file: node.source.file,
							source: this.written.expression(node.source.file, root.syntax), members: new Map(), readers: new Map(), mutations: [], initialized: new Set() });
						this.origin(node, root.syntax);
					}
				} else if (inputs.reason === 'member-read') {
					this.index();
					const base = this.node(inputs.base);
					node.member = { base, name: inputs.name, writes: new Set(), tables: new Set() };
					node.ancestor = base;
					base.readers.push(node);
					for (const table of base.tables) this.read(node, table);
				} else if (node.source.value.steps.length !== 0) {
					const value = node.source.value;
					node.ancestor = this.owner(node.source.file, node.source, { root: value.root, steps: value.steps.slice(0, -1) });
				}
			}
			if (cursor < this.origins.length) {
				const { node, table } = this.origins[cursor++];
				for (const dependent of node.dependents) this.origin(dependent, table);
				for (const writer of node.writers) this.write(writer, table);
				for (const reader of node.readers) this.read(reader, table);
				for (const mutation of node.mutations) this.tables.get(table)!.mutations.push(mutation);
			}
		}
		this.pending.length = 0;
		this.origins.length = 0;
	}

	private dependency(node: SourceNode, dependency: SourceNode): void {
		if (node.dependencies.has(dependency)) return;
		node.dependencies.add(dependency);
		dependency.dependents.push(node);
		for (const table of dependency.tables) this.origin(node, table);
	}

	private origin(node: SourceNode, table: LuaTableConstructorExpression): void {
		if (node.tables.has(table)) return;
		node.tables.add(table);
		this.origins.push({ node, table });
	}

	private write(write: MemberWrite, table: LuaTableConstructorExpression): void {
		const sources = this.tables.get(table)!;
		let writes = sources.members.get(write.name);
		if (writes === undefined) { writes = []; sources.members.set(write.name, writes); }
		writes.push(write);
		const readers = sources.readers.get(write.name);
		if (readers !== undefined) for (const reader of readers) this.linkMember(reader, write);
	}

	private read(node: SourceNode, table: LuaTableConstructorExpression): void {
		const member = node.member!;
		if (member.tables.has(table)) return;
		member.tables.add(table);
		const sources = this.tables.get(table)!;
		if (!sources.initialized.has(member.name)) {
			sources.initialized.add(member.name);
			const write = getLuaWrittenMemberDefinitions(sources.file).constructors.get(table)?.get(member.name);
			if (write !== undefined) {
				const initializer = { name: member.name, owner: this.node(sources.source), source: this.written.write(write) };
				this.write(initializer, table);
			}
		}
		let readers = sources.readers.get(member.name);
		if (readers === undefined) { readers = []; sources.readers.set(member.name, readers); }
		readers.push(node);
		const writes = sources.members.get(member.name);
		if (writes !== undefined) for (const write of writes) this.linkMember(node, write);
	}

	private linkMember(node: SourceNode, write: MemberWrite): void {
		if (node.member!.writes.has(write)) return;
		node.member!.writes.add(write);
		this.dependency(node, this.node(write.source));
	}

	private mutation(mutation: Mutation): void {
		mutation.owner.mutations.push(mutation);
		this.mutations.push(mutation);
	}
}
