import type { Decl, FileSemanticData, LuaCallSite, Ref, SymbolID } from './model';
import {
	declarationValueSource,
	WorkspaceValueGraph,
	WorkspaceValueIdentityIndex,
	type SemanticValueSource,
	type WorkspaceValueGraphInput,
} from './value_graph';
import { sourceRangesEqual } from '../source_range';
import { compareSourcePosition } from './source_range';

const EMPTY_SYMBOLS: readonly SymbolID[] = [];

function appendUniqueSymbols(target: SymbolID[], source: readonly SymbolID[]): void {
	for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
		const symbol = source[sourceIndex];
		if (!target.includes(symbol)) {
			target.push(symbol);
		}
	}
}

// A resolver belongs to exactly one immutable workspace version. File analyses
// retain lexical bindings; workspace-dependent module, value-flow and global
// bindings are resolved against this version instead of being copied back into
// every unchanged file after an edit.
export class WorkspaceSymbolResolver {
	private readonly files: readonly FileSemanticData[];
	private readonly declarations: ReadonlyMap<SymbolID, Decl>;
	private readonly globals: ReadonlyMap<string, SymbolID>;
	private readonly valueGraphInput: WorkspaceValueGraphInput;
	private valueIdentities?: WorkspaceValueIdentityIndex;
	private valueGraph?: WorkspaceValueGraph;
	private readonly referenceTargets: Map<Ref, readonly SymbolID[]> = new Map();
	private readonly callableTargets: Map<LuaCallSite, readonly SymbolID[]> = new Map();
	private readonly referencesBySymbol: Map<SymbolID, readonly Ref[]> = new Map();
	private readonly membersBySource: Map<string, readonly Decl[]> = new Map();

	constructor(options: {
		files: readonly FileSemanticData[];
		declarations: ReadonlyMap<SymbolID, Decl>;
		globals: ReadonlyMap<string, SymbolID>;
	}) {
		this.files = options.files;
		this.declarations = options.declarations;
		this.globals = options.globals;
		this.valueGraphInput = {
			files: options.files,
			globalValues: options.globals,
		};
	}

	// disable-next-line single_line_method_pattern -- declaration lookup remains owned by the immutable workspace resolver.
	public getDeclaration(symbolId: SymbolID): Decl {
		return this.declarations.get(symbolId);
	}

	public resolveReference(ref: Ref): SymbolID | undefined {
		const targets = this.resolveReferenceTargets(ref);
		return targets.length === 1 ? targets[0] : undefined;
	}

	public resolveReferenceTargets(ref: Ref): readonly SymbolID[] {
		const cached = this.referenceTargets.get(ref);
		if (cached) {
			return cached;
		}
		const targets = this.resolveReferenceTargetsUncached(ref);
		if (this.retainCallTargets(ref, targets)) {
			this.referenceTargets.clear();
			this.callableTargets.clear();
			this.referencesBySymbol.clear();
		}
		this.referenceTargets.set(ref, targets);
		return targets;
	}

	public resolveCallableTargets(callSite: LuaCallSite): readonly SymbolID[] {
		const retained = this.callableTargets.get(callSite);
		if (retained) {
			return retained;
		}
		const valueGraph = this.getValueGraph();
		const declarations = callSite.reference
			? this.resolveReferenceTargets(callSite.reference)
			: callSite.directTarget === undefined
				? EMPTY_SYMBOLS
				: [callSite.directTarget];
		const targets: SymbolID[] = [];
		for (let index = 0; index < declarations.length; index += 1) {
			appendUniqueSymbols(
				targets,
				valueGraph.resolveFunctionDeclarations(declarationValueSource(declarations[index])),
			);
		}
		if (targets.length === 0 && callSite.calleeValue !== undefined) {
			appendUniqueSymbols(targets, valueGraph.resolveFunctionDeclarations(callSite.calleeValue));
		}
		this.callableTargets.set(callSite, targets);
		return targets;
	}

	public resolveCallTargets(refs: readonly Ref[]): readonly (readonly SymbolID[])[] {
		const targetsByReference = this.resolveReferenceTargetBatch(refs);
		for (let index = 0; index < refs.length; index += 1) {
			this.referenceTargets.set(refs[index], targetsByReference[index]);
		}
		return targetsByReference;
	}

	private resolveReferenceTargetBatch(refs: readonly Ref[]): readonly (readonly SymbolID[])[] {
		const targetsByReference = new Array<readonly SymbolID[]>(refs.length);
		let hasDynamicReferences = false;
		for (let index = 0; index < refs.length; index += 1) {
			const targets = this.resolveBoundReferenceTargets(refs[index]);
			if (targets === undefined) {
				hasDynamicReferences = true;
			} else {
				targetsByReference[index] = targets;
			}
		}
		if (!hasDynamicReferences) {
			return targetsByReference;
		}
		const valueGraph = this.getValueGraph();
		let callGraphChanged: boolean;
		let retainedCallGraphChanged = false;
		do {
			callGraphChanged = false;
			for (let index = 0; index < refs.length; index += 1) {
				const targets = this.resolveReferenceTargetsUncached(refs[index], valueGraph, true);
				targetsByReference[index] = targets;
				callGraphChanged = this.retainCallTargets(refs[index], targets) || callGraphChanged;
			}
			retainedCallGraphChanged = callGraphChanged || retainedCallGraphChanged;
		} while (callGraphChanged);
		if (retainedCallGraphChanged) {
			this.referenceTargets.clear();
			this.callableTargets.clear();
			this.referencesBySymbol.clear();
		}
		return targetsByReference;
	}

	private retainCallTargets(ref: Ref, targets: readonly SymbolID[]): boolean {
		const call = ref.call;
		const valueGraph = this.valueGraph;
		if (!call || !valueGraph) {
			return false;
		}
		let changed = false;
		for (let index = 0; index < targets.length; index += 1) {
			changed = valueGraph.retainCallTarget(call, targets[index]) || changed;
		}
		return changed;
	}

	private resolveReferenceTargetsUncached(
		ref: Ref,
		valueGraph?: WorkspaceValueGraph,
		retainedCallsOnly = false,
	): readonly SymbolID[] {
		// The file binder has already resolved references whose target is exact.
		// Cross-file value flow is only needed for references that remain
		// unbound after that pass.
		const boundTargets = this.resolveBoundReferenceTargets(ref);
		if (boundTargets !== undefined) {
			return boundTargets;
		}
		if (ref.referenceKind === 'member' || ref.referenceKind === 'method') {
			if (!valueGraph) {
				valueGraph = this.getValueGraph();
			}
			const members = retainedCallsOnly && ref.isCall
				? valueGraph.resolveRetainedMembers(ref.receiverValue, ref.name)
				: valueGraph.resolveMembers(ref.receiverValue, ref.name);
			if (members.length > 0) {
				return members;
			}
		}
		if (ref.symbolKey.length === 0) {
			return EMPTY_SYMBOLS;
		}
		const global = this.globals.get(ref.symbolKey);
		return global ? [global] : EMPTY_SYMBOLS;
	}

	private resolveBoundReferenceTargets(ref: Ref): readonly SymbolID[] | undefined {
		if (ref.target) {
			return [ref.target];
		}
		if (ref.referenceKind === 'self') {
			return EMPTY_SYMBOLS;
		}
		if (ref.referenceKind === 'member' || ref.referenceKind === 'method') {
			return this.getValueIdentities().resolveStaticMembers(
				ref.receiverValue,
				ref.name,
			);
		}
		if (ref.symbolKey.length === 0) {
			return EMPTY_SYMBOLS;
		}
		const global = this.globals.get(ref.symbolKey);
		return global ? [global] : EMPTY_SYMBOLS;
	}

	private getValueIdentities(): WorkspaceValueIdentityIndex {
		if (!this.valueIdentities) {
			this.valueIdentities = new WorkspaceValueIdentityIndex(this.valueGraphInput);
		}
		return this.valueIdentities;
	}

	private getValueGraph(): WorkspaceValueGraph {
		if (!this.valueGraph) {
			const valueGraph = new WorkspaceValueGraph(this.valueGraphInput, this.getValueIdentities());
			this.valueGraph = valueGraph;
			this.retainBoundCallTargets(valueGraph);
		}
		return this.valueGraph;
	}

	private retainBoundCallTargets(valueGraph: WorkspaceValueGraph): void {
		for (let fileIndex = 0; fileIndex < this.files.length; fileIndex += 1) {
			const references = this.files[fileIndex].refs;
			for (let referenceIndex = 0; referenceIndex < references.length; referenceIndex += 1) {
				const reference = references[referenceIndex];
				if (!reference.call) {
					continue;
				}
				if (reference.target) {
					valueGraph.retainCallTarget(reference.call, reference.target);
					continue;
				}
				const targets = this.resolveBoundReferenceTargets(reference);
				if (targets === undefined) {
					continue;
				}
				for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
					valueGraph.retainCallTarget(reference.call, targets[targetIndex]);
				}
			}
		}
	}

	public getMembers(source: SemanticValueSource): readonly Decl[] {
		const identities = this.getValueIdentities();
		const key = identities.sourceKey(source);
		const cached = this.membersBySource.get(key);
		if (cached) {
			return cached;
		}
		const membersByName = new Map<string, Decl>();
		const memberIds = this.getValueGraph().resolveAllMembers(source);
		for (let index = 0; index < memberIds.length; index += 1) {
			const declaration = this.declarations.get(memberIds[index]);
			if (!membersByName.has(declaration.name)) {
				membersByName.set(declaration.name, declaration);
			}
		}
		const members = Array.from(membersByName.values());
		members.sort((left, right) => {
			const name = left.name.localeCompare(right.name);
			if (name !== 0) {
				return name;
			}
			if (left.file !== right.file) {
				return left.file.localeCompare(right.file);
			}
			return compareSourcePosition(
				left.range.start.line,
				left.range.start.column,
				right.range.start.line,
				right.range.start.column,
			);
		});
		this.membersBySource.set(key, members);
		return members;
	}

	public getReferences(symbolId: SymbolID): readonly Ref[] {
		const cached = this.referencesBySymbol.get(symbolId);
		if (cached) {
			return cached;
		}
		this.resolveReferences([symbolId]);
		return this.referencesBySymbol.get(symbolId);
	}

	public getReferencesForSymbols(symbolIds: readonly SymbolID[]): readonly Ref[] {
		if (symbolIds.length === 1) {
			return this.getReferences(symbolIds[0]);
		}
		this.resolveReferences(symbolIds);
		const references: Ref[] = [];
		const retained = new Set<Ref>();
		for (let symbolIndex = 0; symbolIndex < symbolIds.length; symbolIndex += 1) {
			const symbolReferences = this.getReferences(symbolIds[symbolIndex]);
			for (let referenceIndex = 0; referenceIndex < symbolReferences.length; referenceIndex += 1) {
				const reference = symbolReferences[referenceIndex];
				if (!retained.has(reference)) {
					retained.add(reference);
					references.push(reference);
				}
			}
		}
		references.sort((left, right) => {
			if (left.file !== right.file) {
				return left.file.localeCompare(right.file);
			}
			return compareSourcePosition(
				left.range.start.line,
				left.range.start.column,
				right.range.start.line,
				right.range.start.column,
			);
		});
		return references;
	}

	private resolveReferences(symbolIds: readonly SymbolID[]): void {
		const unresolvedSymbols = new Set<SymbolID>();
		const names = new Set<string>();
		for (let symbolIndex = 0; symbolIndex < symbolIds.length; symbolIndex += 1) {
			const symbolId = symbolIds[symbolIndex];
			if (this.referencesBySymbol.has(symbolId)) {
				continue;
			}
			unresolvedSymbols.add(symbolId);
			names.add(this.declarations.get(symbolId).name);
		}
		if (unresolvedSymbols.size === 0) {
			return;
		}
		const candidates: Ref[] = [];
		for (let fileIndex = 0; fileIndex < this.files.length; fileIndex += 1) {
			const referencesByName = this.files[fileIndex].referencesByName;
			for (const name of names) {
				const references = referencesByName.get(name);
				if (references) {
					for (let referenceIndex = 0; referenceIndex < references.length; referenceIndex += 1) {
						candidates.push(references[referenceIndex]);
					}
				}
			}
		}
		// Candidate selection and semantic confirmation extend one retained graph
		// for this immutable workspace version. Resolved calls become ordinary
		// call-graph edges instead of being rediscovered by later queries.
		const targetsByCandidate = this.resolveReferenceTargetBatch(candidates);
		const references = new Map<SymbolID, Ref[]>();
		for (const symbolId of unresolvedSymbols) {
			references.set(symbolId, []);
		}
		for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
			const candidate = candidates[candidateIndex];
			const targets = targetsByCandidate[candidateIndex];
			for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
				const target = targets[targetIndex];
				const bucket = references.get(target);
				if (bucket && !sourceRangesEqual(candidate.range, this.declarations.get(target).range)) {
					bucket.push(candidate);
				}
			}
		}
		for (const [symbolId, symbolReferences] of references) {
			this.referencesBySymbol.set(symbolId, symbolReferences);
		}
	}
}
