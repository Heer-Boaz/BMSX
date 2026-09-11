import type { FileSemanticData, SymbolID } from './model';
import { LuaCompletion } from '../analysis/completion';
import { WorkspaceValueIdentityIndex, type SemanticRootID } from './identity';
import { SemanticDependencyIndex, SemanticQueryDependencies } from './query_dependencies';
import {
	declarationValueSource,
	NIL_VALUE_SOURCE,
	type CallValueEntry,
	type DeclarationValueEntry,
	type FunctionValueFlowEntry,
	type SemanticValueRoot,
	type SemanticValueSource,
	type ValueAssignmentEntry,
} from './value_graph';

declare const semanticTermBrand: unique symbol;
declare const semanticNameBrand: unique symbol;
declare const functionSummaryBrand: unique symbol;

export type TermID = number & { readonly [semanticTermBrand]: true };
export type SemanticNameID = number & { readonly [semanticNameBrand]: true };
export type FunctionSummaryID = number & { readonly [functionSummaryBrand]: true };

export const enum TermKind {
	Root,
	/** Immutable value supplied at function entry, not a writable source binding. */
	Parameter,
	Local,
	ContextRoot,
	Member,
	Index,
	Element,
	Call,
	Instance,
	Metatable,
}

const enum TermIdentityKind {
	Unknown,
	Literal,
	Location,
}

type RootOwner = {
	readonly summary: FunctionSummaryID;
	readonly index: number;
};

export type SummaryWrite = {
	readonly base: TermID;
	readonly name: SemanticNameID;
	readonly value: TermID;
	readonly declaration: SymbolID;
};

export type SummaryAlias = {
	readonly target: TermID;
	readonly source: TermID;
	readonly relation: ValueAssignmentEntry['relation'];
};

export type SummaryCall = {
	readonly owner: FunctionSummaryID | undefined;
	readonly site: CallValueEntry;
	readonly callee: TermID;
	readonly arguments: readonly TermID[];
	readonly result: TermID | undefined;
};

export type FunctionCall = SummaryCall & { readonly owner: FunctionSummaryID };

export type FunctionSummary = {
	readonly id: FunctionSummaryID;
	readonly source: FunctionValueFlowEntry;
	readonly functionValue: TermID;
	readonly lexicalOwner: FunctionSummaryID | undefined;
	/** Immutable entry values; written source bindings are initialized Local terms. */
	readonly parameters: readonly TermID[];
	readonly receiverProjection: TermID | undefined;
	readonly writes: readonly SummaryWrite[];
	readonly calls: readonly FunctionCall[];
	readonly returns: readonly TermID[];
	readonly aliases: readonly SummaryAlias[];
};

const EMPTY_SUMMARY_IDS: readonly FunctionSummaryID[] = [];
const EMPTY_TERM_IDS: readonly TermID[] = [];

export class SemanticTermStore {
	public readonly dependencies = new SemanticQueryDependencies();
	private readonly accessPaths = new SemanticDependencyIndex(this.dependencies);
	private readonly kinds: TermKind[] = [];
	private readonly left: number[] = [];
	private readonly right: number[] = [];
	private readonly rootTerms: TermID[] = [];
	/** Binding owners and module unions are fixed before this snapshot compiles any terms. */
	private readonly compiledRoots: TermID[] = [];
	private readonly indexableRootTerms: boolean[] = [];
	private readonly moduleRootTerms: boolean[] = [];
	private readonly nonSelectiveRootTerms: boolean[] = [];
	private readonly stringLiteralTerms: boolean[] = [];
	private readonly numericLiteralTerms: boolean[] = [];
	private readonly identityKinds: TermIdentityKind[] = [];
	private readonly parameterTerms: TermID[][] = [];
	private readonly localTerms: TermID[][] = [];
	private readonly contextTermsByRoot: Map<TermID, TermID[]> = new Map();
	private readonly membersByBase: Map<TermID, TermID[]> = new Map();
	private readonly indicesByBase: Map<TermID, TermID[]> = new Map();
	private readonly elementByBase: TermID[] = [];
	private readonly callByBase: TermID[] = [];
	private readonly instanceByBase: TermID[] = [];
	private readonly metatableByBase: TermID[] = [];
	private readonly nameIds: Map<string, SemanticNameID> = new Map();
	private readonly names: string[] = [];
	private readonly parameterOwnerByRoot: ReadonlyMap<SemanticRootID, RootOwner>;
	private readonly localOwnerByRoot: ReadonlyMap<SemanticRootID, RootOwner>;
	private readonly identities: WorkspaceValueIdentityIndex;
	private readonly unknownRoot: SemanticRootID;

	constructor(
		identities: WorkspaceValueIdentityIndex,
		parameterOwnerByRoot: ReadonlyMap<SemanticRootID, RootOwner>,
		localOwnerByRoot: ReadonlyMap<SemanticRootID, RootOwner>,
	) {
		this.identities = identities;
		this.parameterOwnerByRoot = parameterOwnerByRoot;
		this.localOwnerByRoot = localOwnerByRoot;
		this.unknownRoot = identities.canonicalRoot(identities.rawRootId({ kind: 'unknown' }));
	}

	public nameId(name: string): SemanticNameID {
		const retained = this.nameIds.get(name);
		if (retained !== undefined) {
			return retained;
		}
		const id = this.names.length as SemanticNameID;
		this.names.push(name);
		this.nameIds.set(name, id);
		return id;
	}

	public name(id: SemanticNameID): string {
		return this.names[id];
	}

	public unknown(): TermID {
		return this.compileRoot({ kind: 'unknown' });
	}

	public compileSource(source: SemanticValueSource): TermID {
		let term = this.compileRoot(source.root);
		for (let stepIndex = 0; stepIndex < source.steps.length; stepIndex += 1) {
			const step = source.steps[stepIndex];
			switch (step.kind) {
				case 'member':
					term = this.member(term, this.nameId(step.name));
					break;
				case 'index':
					term = this.index(term, this.compileSource(step.key));
					break;
				case 'element':
					term = this.element(term);
					break;
				case 'call':
					term = this.call(term);
					break;
				case 'instance':
					term = this.instance(term);
					break;
				case 'metatable':
					term = this.metatable(term);
					break;
			}
		}
		return term;
	}

	public root(root: SemanticValueRoot): TermID {
		return this.compileRoot(root);
	}

	public parameter(summary: FunctionSummaryID, index: number): TermID {
		let terms = this.parameterTerms[summary];
		if (!terms) {
			terms = [];
			this.parameterTerms[summary] = terms;
		}
		let term = terms[index];
		if (term === undefined) {
			term = this.create(TermKind.Parameter, summary, index);
			terms[index] = term;
		}
		return term;
	}

	public local(summary: FunctionSummaryID, index: number): TermID {
		let terms = this.localTerms[summary];
		if (!terms) {
			terms = [];
			this.localTerms[summary] = terms;
		}
		let term = terms[index];
		if (term === undefined) {
			term = this.create(TermKind.Local, summary, index);
			terms[index] = term;
		}
		return term;
	}

	public contextRoot(root: TermID, frame: number): TermID {
		let terms = this.contextTermsByRoot.get(root);
		if (!terms) {
			terms = [];
			this.contextTermsByRoot.set(root, terms);
		}
		for (let index = 0; index < terms.length; index += 1) {
			const term = terms[index];
			if (this.right[term] === frame) {
				return term;
			}
		}
		const term = this.create(TermKind.ContextRoot, root, frame);
		terms.push(term);
		return term;
	}

	public member(base: TermID, name: SemanticNameID): TermID {
		let terms = this.membersByBase.get(base);
		if (!terms) {
			terms = [];
			this.membersByBase.set(base, terms);
		}
		for (let index = 0; index < terms.length; index += 1) {
			const term = terms[index];
			if (this.right[term] === name) {
				return term;
			}
		}
		const term = this.create(TermKind.Member, base, name);
		terms.push(term);
		this.accessPaths.changed(base);
		return term;
	}

	public index(base: TermID, key: TermID): TermID {
		if (this.isUnknown(key)) {
			return this.element(base);
		}
		let terms = this.indicesByBase.get(base);
		if (!terms) {
			terms = [];
			this.indicesByBase.set(base, terms);
		}
		for (let index = 0; index < terms.length; index += 1) {
			const term = terms[index];
			if (this.right[term] === key) {
				return term;
			}
		}
		const term = this.create(TermKind.Index, base, key);
		terms.push(term);
		this.accessPaths.changed(base);
		return term;
	}

	public element(base: TermID): TermID {
		return this.unary(TermKind.Element, base, this.elementByBase);
	}

	public call(base: TermID): TermID {
		return this.unary(TermKind.Call, base, this.callByBase);
	}

	public instance(base: TermID): TermID {
		return this.unary(TermKind.Instance, base, this.instanceByBase);
	}

	public metatable(base: TermID): TermID {
		return this.unary(TermKind.Metatable, base, this.metatableByBase);
	}

	public retainedMetatable(base: TermID): TermID | undefined {
		this.accessPaths.read(base);
		return this.metatableByBase[base];
	}

	public retainedInstance(base: TermID): TermID | undefined {
		this.accessPaths.read(base);
		return this.instanceByBase[base];
	}

	public retainedMember(base: TermID, name: SemanticNameID): TermID | undefined {
		this.accessPaths.read(base);
		const members = this.membersByBase.get(base);
		if (members) {
			for (let index = 0; index < members.length; index += 1) {
				if (this.right[members[index]] === name) return members[index];
			}
		}
		return undefined;
	}

	public retainedElement(base: TermID): TermID | undefined {
		this.accessPaths.read(base);
		return this.elementByBase[base];
	}

	/** Look up an existing access path over another base, without synthesizing paths. */
	public retainedAccessWithBase(term: TermID, base: TermID): TermID | undefined {
		switch (this.kinds[term]) {
			case TermKind.Member:
				return this.retainedMember(base, this.right[term] as SemanticNameID);
			case TermKind.Index:
				return this.retainedIndex(base, this.right[term] as TermID);
			case TermKind.Element:
				return this.retainedElement(base);
			case TermKind.Call:
				this.accessPaths.read(base);
				return this.callByBase[base];
			case TermKind.Instance:
				return this.retainedInstance(base);
			case TermKind.Metatable:
				return this.retainedMetatable(base);
			case TermKind.Root:
			case TermKind.Parameter:
			case TermKind.Local:
			case TermKind.ContextRoot:
				return undefined;
		}
	}

	public kind(term: TermID): TermKind {
		return this.kinds[term];
	}

	public base(term: TermID): TermID {
		return this.left[term] as TermID;
	}

	public operand(term: TermID): number {
		return this.right[term];
	}

	public summaryOwner(term: TermID): FunctionSummaryID | undefined {
		switch (this.kinds[term]) {
			case TermKind.Parameter:
			case TermKind.Local:
				return this.left[term] as FunctionSummaryID;
			case TermKind.ContextRoot:
				return this.summaryOwner(this.left[term] as TermID);
			case TermKind.Member:
			case TermKind.Index:
			case TermKind.Element:
			case TermKind.Call:
			case TermKind.Instance:
			case TermKind.Metatable:
				return this.summaryOwner(this.left[term] as TermID);
			case TermKind.Root:
				return undefined;
		}
	}

	public anchor(term: TermID): TermID {
		let current = term;
		for (;;) {
			switch (this.kinds[current]) {
				case TermKind.Member:
				case TermKind.Index:
				case TermKind.Element:
				case TermKind.Call:
				case TermKind.Instance:
				case TermKind.Metatable:
					current = this.left[current] as TermID;
					break;
				case TermKind.ContextRoot:
					current = this.left[current] as TermID;
					break;
				case TermKind.Root:
				case TermKind.Parameter:
				case TermKind.Local:
					return current;
			}
		}
	}

	public isBasedOn(term: TermID, base: TermID): boolean {
		let current = term;
		for (;;) {
			if (current === base) {
				return true;
			}
			const kind = this.kinds[current];
			if (kind === TermKind.ContextRoot || kind >= TermKind.Member) {
				current = this.left[current] as TermID;
				continue;
			}
			return false;
		}
	}

	public isIndexableAnchor(term: TermID): boolean {
		const kind = this.kinds[term];
		return kind === TermKind.Parameter
			|| kind === TermKind.Local
			|| (kind === TermKind.Root
				&& this.indexableRootTerms[term]
				&& !this.nonSelectiveRootTerms[term]);
	}

	public isModuleAnchor(term: TermID): boolean {
		return this.kinds[term] === TermKind.Root && this.moduleRootTerms[term];
	}

	public isStringLiteralAnchor(term: TermID): boolean {
		return this.kinds[term] === TermKind.Root && this.stringLiteralTerms[term];
	}

	public indices(base: TermID): readonly TermID[] {
		this.accessPaths.read(base);
		return this.indicesByBase.get(base) || EMPTY_TERM_IDS;
	}

	/** Read an existing indexed location without growing symbolic access paths. */
	public retainedIndex(base: TermID, key: TermID): TermID | undefined {
		this.accessPaths.read(base);
		if (this.isUnknown(key)) return this.elementByBase[base];
		const indices = this.indicesByBase.get(base);
		if (indices) {
			for (let index = 0; index < indices.length; index += 1) {
				if (this.right[indices[index]] === key) return indices[index];
			}
		}
		return undefined;
	}

	public isUnknown(term: TermID): boolean {
		return this.identityKinds[term] === TermIdentityKind.Unknown;
	}

	public hasLocationIdentity(term: TermID): boolean {
		return this.identityKinds[term] === TermIdentityKind.Location;
	}

	public isNumericLiteral(term: TermID): boolean {
		return this.numericLiteralTerms[term];
	}

	private compileRoot(root: SemanticValueRoot): TermID {
		const rawRoot = this.identities.rawRootId(root);
		const retained = this.compiledRoots[rawRoot];
		if (retained !== undefined) return retained;
		const parameterOwner = this.parameterOwnerByRoot.get(rawRoot);
		if (parameterOwner) {
			return this.compiledRoots[rawRoot] = this.parameter(parameterOwner.summary, parameterOwner.index);
		}
		const localOwner = this.localOwnerByRoot.get(rawRoot);
		if (localOwner) {
			return this.compiledRoots[rawRoot] = this.local(localOwner.summary, localOwner.index);
		}
		const identity = this.identities.canonicalRoot(rawRoot);
		let term = this.rootTerms[identity];
		if (term === undefined) {
			term = this.create(TermKind.Root, identity, 0);
			this.rootTerms[identity] = term;
			this.stringLiteralTerms[term] = false;
			this.numericLiteralTerms[term] = false;
		}
		if (root.kind === 'literal' && root.literal.kind === 'string') {
			this.stringLiteralTerms[term] = true;
		}
		if (root.kind === 'literal' && root.literal.kind === 'number') {
			this.numericLiteralTerms[term] = true;
		}
		if (root.kind === 'declaration' || root.kind === 'module' || root.kind === 'owned') {
			this.indexableRootTerms[term] = true;
		}
		if (root.kind === 'module') {
			this.moduleRootTerms[term] = true;
		}
		if (root.kind === 'global'
			|| root.kind === 'unknown'
			|| root.kind === 'literal') {
			this.nonSelectiveRootTerms[term] = true;
		}
		return this.compiledRoots[rawRoot] = term;
	}

	private unary(kind: TermKind, base: TermID, terms: TermID[]): TermID {
		let term = terms[base];
		if (term === undefined) {
			term = this.create(kind, base, 0);
			terms[base] = term;
			this.accessPaths.changed(base);
		}
		return term;
	}

	private create(kind: TermKind, left: number, right: number): TermID {
		const term = this.kinds.length as TermID;
		this.identityKinds.push(kind === TermKind.Root
			? left === this.unknownRoot ? TermIdentityKind.Unknown
				: this.identities.isLiteralRoot(left as SemanticRootID) ? TermIdentityKind.Literal : TermIdentityKind.Location
			: kind >= TermKind.ContextRoot ? this.identityKinds[left] : TermIdentityKind.Location);
		this.kinds.push(kind);
		this.left.push(left);
		this.right.push(right);
		return term;
	}
}

export class FunctionSummaryStore {
	public readonly terms: SemanticTermStore;
	private readonly summaries: FunctionSummary[] = [];
	private readonly declarationsBySummary: (SymbolID | undefined)[] = [];
	private readonly summaryIdByFlow: Map<FunctionValueFlowEntry, FunctionSummaryID> = new Map();
	private readonly summaryIdsByFunctionTerm: Map<TermID, FunctionSummaryID[]> = new Map();
	private readonly summaryByDeclaration: Map<SymbolID, FunctionSummaryID[]> = new Map();
	private readonly receiverProjectionByParameter: Map<TermID, TermID> = new Map();

	constructor(
		files: readonly FileSemanticData[],
		identities: WorkspaceValueIdentityIndex,
	) {
		const flows: FunctionValueFlowEntry[] = [];
		const valuesByFlow = new Map<FunctionValueFlowEntry, DeclarationValueEntry[]>();
		for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
			const file = files[fileIndex];
			for (let flowIndex = 0; flowIndex < file.functionValueFlows.length; flowIndex += 1) {
				const flow = file.functionValueFlows[flowIndex];
				const id = (flows.length + 1) as FunctionSummaryID;
				flows.push(flow);
				valuesByFlow.set(flow, []);
				this.summaryIdByFlow.set(flow, id);
			}
		}

		const parameterOwnerByRoot = new Map<SemanticRootID, RootOwner>();
		const localOwnerByRoot = new Map<SemanticRootID, RootOwner>();
		for (let flowIndex = 0; flowIndex < flows.length; flowIndex += 1) {
			const flow = flows[flowIndex];
			const summary = (flowIndex + 1) as FunctionSummaryID;
			for (let parameterIndex = 0; parameterIndex < flow.parameters.length; parameterIndex += 1) {
				parameterOwnerByRoot.set(
					identities.rawRootId(flow.parameters[parameterIndex].root),
					{ summary, index: parameterIndex },
				);
			}
		}
		for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
			const file = files[fileIndex];
			const values = file.declarationValues;
			for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
				const entry = values[valueIndex];
				if (entry.flow !== undefined) {
					valuesByFlow.get(entry.flow)!.push(entry);
				}
			}
			// A binding may be written by a nested closure, or with an RHS that
			// has no modeled value. Use binding writes, not known-value aliases.
			for (let referenceIndex = 0; referenceIndex < file.refs.length; referenceIndex += 1) {
				const reference = file.refs[referenceIndex];
				if (reference.isWrite && reference.binding !== undefined) {
					parameterOwnerByRoot.delete(identities.rawRootId(reference.binding.root));
				}
			}
		}
		for (let flowIndex = 0; flowIndex < flows.length; flowIndex += 1) {
			const flow = flows[flowIndex];
			const summary = (flowIndex + 1) as FunctionSummaryID;
			let localIndex = 0;
			for (let declarationIndex = 0; declarationIndex < flow.declarationIds.length; declarationIndex += 1) {
				const declId = flow.declarationIds[declarationIndex];
				const root = identities.rawRootId({ kind: 'declaration', declId });
				if (!parameterOwnerByRoot.has(root)) {
					localOwnerByRoot.set(root, { summary, index: localIndex });
					localIndex += 1;
				}
			}
			for (let ownedIndex = 0; ownedIndex < flow.ownedValues.length; ownedIndex += 1) {
				const root = identities.rawRootId(flow.ownedValues[ownedIndex].root);
				if (!parameterOwnerByRoot.has(root) && !localOwnerByRoot.has(root)) {
					localOwnerByRoot.set(root, { summary, index: localIndex });
					localIndex += 1;
				}
			}
		}

		this.terms = new SemanticTermStore(
			identities,
			parameterOwnerByRoot,
			localOwnerByRoot,
		);

		for (let flowIndex = 0; flowIndex < flows.length; flowIndex += 1) {
			const flow = flows[flowIndex];
			const id = (flowIndex + 1) as FunctionSummaryID;
			const summary = this.buildSummary(id, flow, valuesByFlow.get(flow)!);
			this.summaries[id] = summary;
			this.appendSummary(this.summaryIdsByFunctionTerm, summary.functionValue, id);
			if (flow.declaration !== undefined) {
				this.appendSummary(this.summaryByDeclaration, flow.declaration, id);
				this.declarationsBySummary[id] = flow.declaration;
			}
			if (summary.parameters.length > 0 && summary.receiverProjection !== undefined) {
				this.receiverProjectionByParameter.set(summary.parameters[0], summary.receiverProjection);
			}
		}
	}

	public get(id: FunctionSummaryID): FunctionSummary {
		return this.summaries[id];
	}

	public list(): readonly FunctionSummary[] {
		return this.summaries.slice(1);
	}

	public get count(): number {
		return this.summaries.length - 1;
	}

	public summaryIdsForTerm(term: TermID): readonly FunctionSummaryID[] {
		if (this.terms.kind(term) === TermKind.ContextRoot) {
			term = this.terms.base(term);
		}
		return this.summaryIdsByFunctionTerm.get(term) || EMPTY_SUMMARY_IDS;
	}

	public summaryIdsForDeclaration(declId: SymbolID): readonly FunctionSummaryID[] {
		return this.summaryByDeclaration.get(declId) || EMPTY_SUMMARY_IDS;
	}

	public declarationForSummary(summary: FunctionSummaryID): SymbolID | undefined {
		return this.declarationsBySummary[summary];
	}

	public projectExternalTerm(term: TermID): TermID {
		const kind = this.terms.kind(term);
		if (kind === TermKind.Parameter) {
			return this.receiverProjectionByParameter.get(term) || term;
		}
		if (kind < TermKind.Member) {
			return term;
		}
		const projectedBase = this.projectExternalTerm(this.terms.base(term));
		const base = this.terms.base(term);
		if (projectedBase === base && kind !== TermKind.Index) {
			return term;
		}
		switch (kind) {
			case TermKind.Member:
				return this.terms.member(projectedBase, this.terms.operand(term) as SemanticNameID);
			case TermKind.Index: {
				const key = this.terms.operand(term) as TermID;
				const projectedKey = this.projectExternalTerm(key);
				return projectedBase === base && projectedKey === key
					? term
					: this.terms.index(projectedBase, projectedKey);
			}
			case TermKind.Element:
				return this.terms.element(projectedBase);
			case TermKind.Call:
				return this.terms.call(projectedBase);
			case TermKind.Instance:
				return this.terms.instance(projectedBase);
			case TermKind.Metatable:
				return this.terms.metatable(projectedBase);
			default:
				return term;
		}
	}

	private buildSummary(
		id: FunctionSummaryID,
		flow: FunctionValueFlowEntry,
		declarationValues: readonly DeclarationValueEntry[],
	): FunctionSummary {
		const valuesByDeclaration = new Map<SymbolID, TermID[]>();
		for (let valueIndex = 0; valueIndex < declarationValues.length; valueIndex += 1) {
			const entry = declarationValues[valueIndex];
			let values = valuesByDeclaration.get(entry.declId);
			if (!values) {
				values = [];
				valuesByDeclaration.set(entry.declId, values);
			}
			const value = this.terms.compileSource(entry.source);
			if (!values.includes(value)) values.push(value);
		}

		const writes: SummaryWrite[] = [];
		for (let memberIndex = 0; memberIndex < flow.members.length; memberIndex += 1) {
			const member = flow.members[memberIndex];
			const values = valuesByDeclaration.get(member.declId);
			if (values === undefined) {
				writes.push({
					base: this.terms.compileSource(member.owner),
					name: this.terms.nameId(member.name),
					value: this.terms.compileSource(declarationValueSource(member.declId)),
					declaration: member.declId,
				});
				continue;
			}
			for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
				writes.push({
					base: this.terms.compileSource(member.owner),
					name: this.terms.nameId(member.name),
					value: values[valueIndex],
					declaration: member.declId,
				});
			}
		}

		const aliases: SummaryAlias[] = [];
		const parameters = new Array<TermID>(flow.parameters.length);
		for (let parameterIndex = 0; parameterIndex < flow.parameters.length; parameterIndex += 1) {
			const parameter = this.terms.parameter(id, parameterIndex);
			parameters[parameterIndex] = parameter;
			const binding = this.terms.compileSource(flow.parameters[parameterIndex]);
			if (binding !== parameter) {
				aliases.push({ target: binding, source: parameter, relation: 'value' });
			}
		}
		for (const [declId, values] of valuesByDeclaration) {
			const target = this.terms.compileSource(declarationValueSource(declId));
			for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
				aliases.push({ target, source: values[valueIndex], relation: 'value' });
			}
		}
		for (let assignmentIndex = 0; assignmentIndex < flow.assignments.length; assignmentIndex += 1) {
			const assignment = flow.assignments[assignmentIndex];
			aliases.push({
				target: this.terms.compileSource(assignment.target),
				source: this.terms.compileSource(assignment.source),
				relation: assignment.relation,
			});
		}

		const calls = new Array<FunctionCall>(flow.calls.length);
		for (let callIndex = 0; callIndex < flow.calls.length; callIndex += 1) {
			const call = flow.calls[callIndex];
			const args = new Array<TermID>(call.arguments.length);
			for (let argumentIndex = 0; argumentIndex < call.arguments.length; argumentIndex += 1) {
				args[argumentIndex] = this.terms.compileSource(call.arguments[argumentIndex]);
			}
			calls[callIndex] = {
				owner: id,
				site: call,
				callee: this.terms.compileSource(call.callee),
				arguments: args,
				result: call.result === undefined
					? undefined
					: this.terms.compileSource(call.result),
			};
		}

		const returns: TermID[] = [];
		for (let returnIndex = 0; returnIndex < flow.returns.length; returnIndex += 1) {
			const value = flow.returns[returnIndex].firstValue;
			const term = this.terms.compileSource(value);
			if (!returns.includes(term)) returns.push(term);
		}
		if (flow.completion & LuaCompletion.Fallthrough) {
			const nil = this.terms.compileSource(NIL_VALUE_SOURCE);
			if (!returns.includes(nil)) returns.push(nil);
		}
		if (flow.completion & LuaCompletion.Unresolved) {
			const unknown = this.terms.unknown();
			if (!returns.includes(unknown)) returns.push(unknown);
		}

		return {
			id,
			source: flow,
			functionValue: this.terms.compileSource(flow.functionValue),
			lexicalOwner: flow.lexicalOwner
				? this.summaryIdByFlow.get(flow.lexicalOwner)
				: undefined,
			parameters,
			receiverProjection: flow.receiverProjection
				? this.terms.compileSource(flow.receiverProjection)
				: undefined,
			writes,
			calls,
			returns,
			aliases,
		};
	}

	private appendSummary<Key>(
		map: Map<Key, FunctionSummaryID[]>,
		key: Key,
		summary: FunctionSummaryID,
	): void {
		let summaries = map.get(key);
		if (!summaries) {
			summaries = [];
			map.set(key, summaries);
		}
		summaries.push(summary);
	}
}
