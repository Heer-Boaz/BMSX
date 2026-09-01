import type { Decl, FileSemanticData, LuaCallSite, Ref, SymbolID } from './model';
import { LuaSemanticQueryStore, type LuaSemanticQueryMetrics } from './query_store';
import {
	declarationValueSource,
	type SemanticValueSource,
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

// A resolver belongs to exactly one immutable workspace version. The retained
// query store owns semantic summaries, instantiations and call facts for that
// version; unchanged FileSemanticData remains binder input rather than a heap.
export class WorkspaceSymbolResolver {
	private readonly files: readonly FileSemanticData[];
	private readonly declarations: ReadonlyMap<SymbolID, Decl>;
	private readonly globals: ReadonlyMap<string, SymbolID>;
	private queryStore?: LuaSemanticQueryStore;
	private readonly referenceTargets: Map<Ref, readonly SymbolID[]> = new Map();
	private readonly referenceFunctionTargets: Map<Ref, readonly SymbolID[]> = new Map();
	private readonly callableTargets: Map<LuaCallSite, readonly SymbolID[]> = new Map();
	private readonly referencesBySymbol: Map<SymbolID, readonly Ref[]> = new Map();
	private readonly membersBySource: Map<SemanticValueSource, readonly Decl[]> = new Map();
	private readonly incomingCallsBySymbol: Map<SymbolID, readonly Ref[]> = new Map();
	private readonly outgoingCallsBySymbol:
		Map<SymbolID, readonly { readonly reference: Ref; readonly callee: SymbolID }[]> = new Map();

	constructor(options: {
		files: readonly FileSemanticData[];
		declarations: ReadonlyMap<SymbolID, Decl>;
		globals: ReadonlyMap<string, SymbolID>;
	}) {
		this.files = options.files;
		this.declarations = options.declarations;
		this.globals = options.globals;
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
		this.referenceTargets.set(ref, targets);
		return targets;
	}

	public resolveCallableTargets(callSite: LuaCallSite): readonly SymbolID[] {
		const retained = this.callableTargets.get(callSite);
		if (retained) {
			return retained;
		}
		const targets: SymbolID[] = [];
		const call = callSite.reference?.call;
		if (call) {
			const facts = this.getQueryStore().callee(call);
			for (let factIndex = 0; factIndex < facts.length; factIndex += 1) {
				if (!targets.includes(facts[factIndex].calleeFn)) {
					targets.push(facts[factIndex].calleeFn);
				}
			}
		} else if (callSite.directTarget !== undefined) {
			appendUniqueSymbols(
				targets,
				this.getQueryStore().functions(declarationValueSource(callSite.directTarget)),
			);
		} else if (callSite.calleeValue !== undefined) {
			appendUniqueSymbols(targets, this.getQueryStore().functions(callSite.calleeValue));
		}
		this.callableTargets.set(callSite, targets);
		return targets;
	}

	public resolveReferenceFunctionTargets(reference: Ref): readonly SymbolID[] {
		const retained = this.referenceFunctionTargets.get(reference);
		if (retained) {
			return retained;
		}
		const targets: SymbolID[] = [];
		if (reference.call) {
			const facts = this.getQueryStore().callee(reference.call);
			for (let factIndex = 0; factIndex < facts.length; factIndex += 1) {
				if (!targets.includes(facts[factIndex].calleeFn)) {
					targets.push(facts[factIndex].calleeFn);
				}
			}
		} else {
			const declarations = this.resolveReferenceTargets(reference);
			for (let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex += 1) {
				appendUniqueSymbols(
					targets,
					this.getQueryStore().functions(declarationValueSource(declarations[declarationIndex])),
				);
			}
		}
		this.referenceFunctionTargets.set(reference, targets);
		return targets;
	}

	public getMembers(source: SemanticValueSource): readonly Decl[] {
		const cached = this.membersBySource.get(source);
		if (cached) {
			return cached;
		}
		const membersByName = new Map<string, Decl>();
		const memberIds = this.getQueryStore().allMembers(source);
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
		this.membersBySource.set(source, members);
		return members;
	}

	public getReferences(symbolId: SymbolID): readonly Ref[] {
		const cached = this.referencesBySymbol.get(symbolId);
		if (cached) {
			return cached;
		}
		this.resolveReferences([symbolId]);
		return this.referencesBySymbol.get(symbolId) as readonly Ref[];
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

	public incomingCalls(symbolId: SymbolID): readonly Ref[] {
		const cached = this.incomingCallsBySymbol.get(symbolId);
		if (cached) {
			return cached;
		}
		const facts = this.getQueryStore().incoming(symbolId, this.declarations.get(symbolId).name);
		const references = new Array<Ref>(facts.length);
		for (let factIndex = 0; factIndex < facts.length; factIndex += 1) {
			references[factIndex] = facts[factIndex].reference;
		}
		this.incomingCallsBySymbol.set(symbolId, references);
		return references;
	}

	public outgoingCalls(symbolId: SymbolID): readonly { readonly reference: Ref; readonly callee: SymbolID }[] {
		const cached = this.outgoingCallsBySymbol.get(symbolId);
		if (cached) {
			return cached;
		}
		const facts = this.getQueryStore().outgoing(symbolId);
		const calls = new Array<{ readonly reference: Ref; readonly callee: SymbolID }>(facts.length);
		for (let factIndex = 0; factIndex < facts.length; factIndex += 1) {
			calls[factIndex] = {
				reference: facts[factIndex].reference,
				callee: facts[factIndex].calleeFn,
			};
		}
		this.outgoingCallsBySymbol.set(symbolId, calls);
		return calls;
	}

	public getSemanticQueryMetrics(): LuaSemanticQueryMetrics {
		return this.getQueryStore().metrics();
	}

	private resolveReferenceTargetsUncached(ref: Ref): readonly SymbolID[] {
		if (ref.target) {
			return [ref.target];
		}
		if (ref.referenceKind === 'self') {
			return EMPTY_SYMBOLS;
		}
		if (ref.referenceKind === 'member' || ref.referenceKind === 'method') {
			return this.getQueryStore().member(ref.receiverValue, ref.name);
		}
		if (ref.symbolKey.length === 0) {
			return EMPTY_SYMBOLS;
		}
		const global = this.globals.get(ref.symbolKey);
		return global ? [global] : EMPTY_SYMBOLS;
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
		const references = new Map<SymbolID, Ref[]>();
		for (const symbolId of unresolvedSymbols) {
			references.set(symbolId, []);
		}
		for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
			const candidate = candidates[candidateIndex];
			const targets = this.resolveReferenceTargets(candidate);
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

	private getQueryStore(): LuaSemanticQueryStore {
		if (!this.queryStore) {
			this.queryStore = new LuaSemanticQueryStore(this.files, this.globals);
		}
		return this.queryStore;
	}
}
