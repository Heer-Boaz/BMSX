import type { FileSemanticData, Ref, SymbolID } from './model';
import { SemanticEffectIndex, type EffectRelevance } from './effect_index';
import {
	type FunctionCall,
	type FunctionSummary,
	type FunctionSummaryID,
	FunctionSummaryStore,
	type SemanticNameID,
	type SummaryAlias,
	type SummaryCall,
	type SummaryWrite,
	type TermID,
	TermKind,
} from './function_summary';
import {
	declarationValueSource,
	moduleValueSource,
	type CallValueEntry,
} from './value_graph';

type EffectCallSelection = EffectRelevance & {
	readonly calls: (readonly SummaryCall[] | undefined)[];
};

const EMPTY_WRITES: readonly SummaryWrite[] = [];
const EMPTY_SYMBOLS: readonly SymbolID[] = [];
const EMPTY_CALLS: readonly SummaryCall[] = [];
const EMPTY_SUMMARIES: readonly FunctionSummaryID[] = [];
const EMPTY_TERMS: readonly TermID[] = [];
const EMPTY_NAMES: readonly SemanticNameID[] = [];
const EMPTY_RELEVANCE: readonly boolean[] = [];

// The demand index only selects retained facts. It never instantiates a call or
// publishes a function effect; those transitions belong to the query engine.
export class SemanticDemandIndex {
	public readonly aliases: readonly SummaryAlias[];
	public readonly topLevelCalls: readonly SummaryCall[];
	private readonly staticWritesByName: Map<SemanticNameID, SummaryWrite[]> = new Map();
	private readonly memberNamesByBase: SemanticNameID[][] = [];
	private readonly memberNamesByParameter: SemanticNameID[][] = [];
	private readonly receiverWritersByName: Map<SemanticNameID, FunctionSummaryID[]> = new Map();
	private readonly candidateCallsByName: Map<SemanticNameID, SummaryCall[]> = new Map();
	private readonly directTargetsByCall: Map<CallValueEntry, SymbolID[]> = new Map();
	private readonly candidateTargetsByCall: Map<CallValueEntry, readonly SymbolID[]> = new Map();
	private readonly referencesByCall: Map<CallValueEntry, Ref> = new Map();
	private readonly callsBySite: Map<CallValueEntry, SummaryCall> = new Map();
	private readonly dependentSummariesByTerm: FunctionSummaryID[][] = [];
	private readonly indexedWritersByAnchor: FunctionSummaryID[][] = [];
	private readonly dependentCallsByTerm: FunctionCall[][] = [];
	private readonly calleeCallsByTerm: SummaryCall[][] = [];
	private readonly topLevelCallsByAnchor: SummaryCall[][] = [];
	private readonly topLevelResultCallsByTerm: SummaryCall[][] = [];
	private readonly resultCallsByTerm: FunctionCall[][] = [];
	private readonly relatedTermsByTerm: TermID[][] = [];
	private readonly identifiersByTerm: (readonly TermID[] | undefined)[] = [];
	private readonly identifierTerms: TermID[] = [];
	private readonly identifierSeen: number[] = [];
	private identifierGeneration = 0;
	private readonly indexedSummaryTerms: number[] = [];
	private readonly indexedDependentCallTerms: number[] = [];
	private readonly indexedCallAnchors: number[] = [];
	private summaryAnchorGeneration = 0;
	private dependentCallGeneration = 0;
	private callAnchorGeneration = 0;
	private readonly functionNameBySummary: (SemanticNameID | undefined)[] = [];
	private readonly parameterForwardingSummaries: boolean[] = [];
	private readonly queryIndependentSummaries: boolean[] = [];
	private readonly queryIndependentFunctionNames: boolean[] = [];
	private readonly callsByEffectName: (EffectCallSelection | undefined)[] = [];
	private readonly forwardingCallsBySummary: (readonly SummaryCall[] | undefined)[] = [];
	private effectIndex: SemanticEffectIndex | undefined;
	private readonly returnCallsBySummary: (readonly SummaryCall[] | undefined)[] = [];
	private readonly compositionCallsBySummary: (readonly SummaryCall[] | undefined)[] = [];
	private readonly dependencyTerms: TermID[] = [];
	private readonly dependencyTermContents: boolean[] = [];
	private readonly dependencyTermSeen: number[] = [];
	private readonly dependencyContentSeen: number[] = [];
	private readonly selectedCallIndices: boolean[] = [];
	private readonly parameterDependencyTerms: TermID[] = [];
	private readonly parameterDependencySeen: number[] = [];
	private readonly keyedParametersBySummary: (readonly number[] | undefined)[] = [];
	private readonly staticCalleeTerms: TermID[] = [];
	private readonly staticCalleeSeen: number[] = [];
	private readonly staticReceiverTerms: TermID[] = [];
	private readonly staticReceiverSeen: number[] = [];
	private staticReceiverGeneration = 0;
	private readonly staticTargetsByTerm: (readonly SymbolID[] | undefined)[] = [];
	private staticCalleeQueries = 0;
	private selectedEffectBodies = 0;
	private dependencyGeneration = 0;
	private parameterDependencyGeneration = 0;
	private staticCalleeGeneration = 0;

	constructor(
		files: readonly FileSemanticData[],
		private readonly summaries: FunctionSummaryStore,
	) {
		const aliases: SummaryAlias[] = [];
		const topLevelCalls: SummaryCall[] = [];
		const functionNamesByDeclaration = new Map<SymbolID, SemanticNameID>();
		for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
			const file = files[fileIndex];
			for (let declarationIndex = 0; declarationIndex < file.decls.length; declarationIndex += 1) {
				const declaration = file.decls[declarationIndex];
				if (summaries.summaryIdsForDeclaration(declaration.id).length !== 0) {
					functionNamesByDeclaration.set(
						declaration.id,
						summaries.terms.nameId(declaration.name),
					);
				}
			}
			for (let valueIndex = 0; valueIndex < file.declarationValues.length; valueIndex += 1) {
				const entry = file.declarationValues[valueIndex];
				if (entry.flow !== undefined) {
					continue;
				}
				const alias: SummaryAlias = {
					target: summaries.terms.compileSource(declarationValueSource(entry.declId)),
					source: summaries.terms.compileSource(entry.source),
					relation: 'value',
				};
				aliases.push(alias);
				this.connectTerms(
					alias.target,
					alias.source,
					!summaries.terms.isModuleAnchor(summaries.terms.anchor(alias.source)),
				);
			}
			for (let moduleIndex = 0; moduleIndex < file.moduleValues.length; moduleIndex += 1) {
				const entry = file.moduleValues[moduleIndex];
				const alias: SummaryAlias = {
					target: summaries.terms.compileSource(moduleValueSource(entry.module)),
					source: summaries.terms.compileSource(entry.source),
					relation: 'value',
				};
				aliases.push(alias);
				this.connectTerms(alias.target, alias.source);
			}
			for (let assignmentIndex = 0; assignmentIndex < file.valueAssignments.length; assignmentIndex += 1) {
				const assignment = file.valueAssignments[assignmentIndex];
				const alias: SummaryAlias = {
					target: summaries.terms.compileSource(assignment.target),
					source: summaries.terms.compileSource(assignment.source),
					relation: assignment.relation,
				};
				aliases.push(alias);
				if (alias.relation === 'value') {
					this.connectTerms(alias.target, alias.source);
				}
			}
			for (let memberIndex = 0; memberIndex < file.memberValues.length; memberIndex += 1) {
				const member = file.memberValues[memberIndex];
				const base = summaries.terms.compileSource(member.owner);
				const name = summaries.terms.nameId(member.name);
				const value = summaries.terms.compileSource(declarationValueSource(member.declId));
				const sources = file.declarationValuesByDeclaration.get(member.declId);
				let authored = false;
				if (sources !== undefined) for (const source of sources) {
					if (source.flow !== undefined) continue;
					authored = true;
					this.appendStaticWrite({ base, name, value, declaration: member.declId, source });
				}
				if (!authored) this.appendStaticWrite({ base, name, value, declaration: member.declId, source: undefined });
			}
			for (let callIndex = 0; callIndex < file.callValues.length; callIndex += 1) {
				const call = this.compileTopLevelCall(file.callValues[callIndex]);
				topLevelCalls.push(call);
				this.indexCall(call);
				this.indexTopLevelCall(call);
			}
			for (let referenceIndex = 0; referenceIndex < file.refs.length; referenceIndex += 1) {
				const reference = file.refs[referenceIndex];
				if (!reference.call) {
					continue;
				}
				this.referencesByCall.set(reference.call, reference);
				if (reference.target) {
					this.appendDirectTarget(reference.call, reference.target);
				}
			}
			for (let callSiteIndex = 0; callSiteIndex < file.callSites.length; callSiteIndex += 1) {
				const callSite = file.callSites[callSiteIndex];
				const call = callSite.reference?.call;
				if (call && callSite.directTarget !== undefined) {
					this.appendDirectTarget(call, callSite.directTarget);
				}
			}
		}

		const functionSummaries = summaries.list();
		for (let summaryIndex = 0; summaryIndex < functionSummaries.length; summaryIndex += 1) {
			const summary = functionSummaries[summaryIndex];
			const declaration = summaries.declarationForSummary(summary.id);
			this.functionNameBySummary[summary.id] = declaration === undefined
				? undefined
				: functionNamesByDeclaration.get(declaration);
			this.indexSummaryDependencies(summary);
			for (const alias of summary.aliases) {
				if (summaries.terms.kind(alias.target) !== TermKind.Index) continue;
				const anchor = summaries.terms.anchor(alias.target);
				if (summaries.terms.kind(anchor) !== TermKind.Root || !summaries.terms.isIndexableAnchor(anchor)) continue;
				let writers = this.indexedWritersByAnchor[anchor];
				if (!writers) this.indexedWritersByAnchor[anchor] = writers = [];
				if (writers[writers.length - 1] !== summary.id) writers.push(summary.id);
			}
			this.indexProjectedReceiverWrites(summary);
			for (let writeIndex = 0; writeIndex < summary.writes.length; writeIndex += 1) {
				const write = summary.writes[writeIndex];
				this.indexMemberName(write.base, write.name);
				this.indexMemberName(summaries.projectExternalTerm(write.base), write.name);
			}
			for (let callIndex = 0; callIndex < summary.calls.length; callIndex += 1) {
				const call = summary.calls[callIndex];
				this.indexCall(call);
				this.indexDependentCall(call);
			}
		}
		for (let summaryIndex = 0; summaryIndex < functionSummaries.length; summaryIndex += 1) {
			const summary = functionSummaries[summaryIndex];
			if (this.summaryHasQueryIndependentEffects(summary)) {
				this.queryIndependentSummaries[summary.id] = true;
				const functionName = this.functionNameBySummary[summary.id];
				if (functionName !== undefined) {
					this.queryIndependentFunctionNames[functionName] = true;
				}
			}
			for (let callIndex = 0; callIndex < summary.calls.length; callIndex += 1) {
				const call = summary.calls[callIndex];
				if (!this.isReceiverCall(call)
					&& this.dependsOnParameter(summary, call.callee)) {
					this.parameterForwardingSummaries[summary.id] = true;
					break;
				}
			}
		}
		for (let callIndex = 0; callIndex < topLevelCalls.length; callIndex += 1) {
			this.retainCandidateTargets(topLevelCalls[callIndex]);
		}
		for (let summaryIndex = 0; summaryIndex < functionSummaries.length; summaryIndex += 1) {
			const calls = functionSummaries[summaryIndex].calls;
			for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
				this.retainCandidateTargets(calls[callIndex]);
			}
		}
		this.aliases = aliases;
		this.topLevelCalls = topLevelCalls;
		// All module aliases are known now, including constants declared in a
		// different file. Index the value of a key rather than its local spelling.
		for (const call of topLevelCalls) this.indexCallIdentifiers(call, this.topLevelCallsByAnchor);
		for (const summary of functionSummaries) {
			for (const call of summary.calls) this.indexCallIdentifiers(call, this.dependentCallsByTerm);
		}
	}

	public stringIdentifiers(term: TermID): readonly TermID[] {
		if (this.summaries.terms.kind(term) !== TermKind.Root) return EMPTY_TERMS;
		const retained = this.identifiersByTerm[term];
		if (retained !== undefined) return retained;
		const identifiers: TermID[] = [];
		const generation = ++this.identifierGeneration;
		const pending = this.identifierTerms;
		pending.length = 1;
		pending[0] = term;
		for (let head = 0; head < pending.length; head += 1) {
			const current = pending[head];
			if (this.identifierSeen[current] === generation) continue;
			this.identifierSeen[current] = generation;
			if (this.summaries.terms.isStringLiteralAnchor(current)) identifiers.push(current);
			for (const related of this.relatedTerms(current)) {
				if (this.summaries.terms.kind(related) === TermKind.Root) pending.push(related);
			}
		}
		this.identifiersByTerm[term] = identifiers;
		return identifiers;
	}

	private indexCallIdentifiers<T extends SummaryCall>(call: T, index: T[][]): void {
		for (const argument of call.arguments) {
			for (const identifier of this.stringIdentifiers(argument)) {
				let calls = index[identifier];
				if (calls === undefined) {
					calls = [];
					index[identifier] = calls;
				}
				if (!calls.includes(call)) calls.push(call);
			}
		}
	}

	/** Module-owned writes only. Inferred receiver shapes are not module effects. */
	public staticWrites(name: SemanticNameID): readonly SummaryWrite[] {
		return this.staticWritesByName.get(name) || EMPTY_WRITES;
	}

	/** Selects bodies for source projection, without publishing a write or call. */
	public receiverWriters(name: SemanticNameID): readonly FunctionSummaryID[] {
		return this.receiverWritersByName.get(name) || EMPTY_SUMMARIES;
	}

	public candidateCalls(name: SemanticNameID): readonly SummaryCall[] {
		return this.candidateCallsByName.get(name) || EMPTY_CALLS;
	}

	/** Lexically bound targets only; selection candidates must pass value resolution. */
	public directTargets(call: CallValueEntry): readonly SymbolID[] {
		return this.directTargetsByCall.get(call) || EMPTY_SYMBOLS;
	}

	public reference(call: CallValueEntry): Ref | undefined {
		return this.referencesByCall.get(call);
	}

	public call(site: CallValueEntry): SummaryCall {
		return this.callsBySite.get(site) as SummaryCall;
	}

	public memberNamesForBase(base: TermID): readonly SemanticNameID[] {
		if (this.summaries.terms.kind(base) === TermKind.Parameter) {
			return this.namesForParameter(base);
		}
		return this.memberNamesByBase[base] || EMPTY_NAMES;
	}

	/** Candidate names follow direct aliases and calls; child fields are separate receivers. */
	private namesForParameter(parameter: TermID): readonly SemanticNameID[] {
		const retained = this.memberNamesByParameter[parameter];
		if (retained !== undefined) return retained;
		if (!this.effectIndex) this.effectIndex = this.buildEffectIndex();
		const names: SemanticNameID[] = [];
		const pending = [parameter];
		const seen: boolean[] = [];
		const terms = this.summaries.terms;
		for (let head = 0; head < pending.length; head += 1) {
			const current = pending[head];
			if (seen[current]) continue;
			seen[current] = true;
			const summary = this.summaries.get(terms.summaryOwner(current)!);
			for (const write of summary.writes) {
				if (!names.includes(write.name) && this.dependsOnParameter(summary, write.base, current, false)) names.push(write.name);
			}
			for (const call of summary.calls) {
				for (let argument = 0; argument < call.arguments.length; argument += 1) {
					if (!this.dependsOnParameter(summary, call.arguments[argument], current, false)) continue;
					for (const target of this.candidateTargets(call.site)) {
						for (const callee of this.summaries.summaryIdsForDeclaration(target)) {
							const formal = this.summaries.get(callee).parameters[argument];
							if (formal !== undefined) pending.push(formal);
						}
					}
					for (const callee of this.summaries.summaryIdsForTerm(call.callee)) {
						const formal = this.summaries.get(callee).parameters[argument];
						if (formal !== undefined) pending.push(formal);
					}
					if (terms.kind(call.callee) === TermKind.Member && this.callRequiresNamedSelection(call)) {
						for (const callee of this.effectIndex.candidates(terms.operand(call.callee) as SemanticNameID)) {
							const formal = this.summaries.get(callee).parameters[argument];
							if (formal !== undefined) pending.push(formal);
						}
					}
				}
			}
		}
		this.memberNamesByParameter[parameter] = names;
		return names;
	}

	private indexMemberName(base: TermID, name: SemanticNameID): void {
		let names = this.memberNamesByBase[base];
		if (!names) this.memberNamesByBase[base] = names = [];
		if (!names.includes(name)) names.push(name);
	}

	public calleeCallsForTerm(term: TermID): readonly SummaryCall[] {
		return this.calleeCallsByTerm[term] || EMPTY_CALLS;
	}

	public dependentSummariesForTerm(term: TermID): readonly FunctionSummaryID[] {
		return this.dependentSummariesByTerm[term] || EMPTY_SUMMARIES;
	}

	public indexedWriters(term: TermID): readonly FunctionSummaryID[] {
		return this.indexedWritersByAnchor[this.summaries.terms.anchor(term)] || EMPTY_SUMMARIES;
	}

	public dependentCallsForTerm(term: TermID): readonly FunctionCall[] {
		return this.dependentCallsByTerm[term] || EMPTY_CALLS;
	}

	public topLevelCallsForTerm(term: TermID): readonly SummaryCall[] {
		const anchor = this.summaries.terms.anchor(term);
		return this.topLevelCallsByAnchor[anchor] || EMPTY_CALLS;
	}

	public topLevelResultCallsForTerm(term: TermID): readonly SummaryCall[] {
		return this.topLevelResultCallsByTerm[term] || EMPTY_CALLS;
	}

	public resultCallsForTerm(term: TermID): readonly FunctionCall[] {
		return this.resultCallsByTerm[term] || EMPTY_CALLS;
	}

	public relatedTerms(term: TermID): readonly TermID[] {
		return this.relatedTermsByTerm[term] || EMPTY_TERMS;
	}

	public returnCalls(summary: FunctionSummaryID): readonly SummaryCall[] {
		let retained = this.returnCallsBySummary[summary];
		if (retained === undefined) {
			retained = this.selectDependencyCalls(
				this.summaries.get(summary),
				undefined,
				undefined,
				undefined,
				true,
				false,
			);
			this.returnCallsBySummary[summary] = retained;
		}
		return retained;
	}

	public compositionCalls(summary: FunctionSummaryID): readonly SummaryCall[] {
		let retained = this.compositionCallsBySummary[summary];
		if (retained === undefined) {
			retained = this.selectDependencyCalls(
				this.summaries.get(summary),
				undefined,
				undefined,
				undefined,
				false,
				true,
			);
			this.compositionCallsBySummary[summary] = retained;
		}
		return retained;
	}

	public propagatesComposition(
		owner: FunctionSummaryID,
		call: SummaryCall,
		callee: FunctionSummaryID,
	): boolean {
		return this.queryIndependentSummaries[callee]
			|| this.parameterForwardingSummaries[callee]
			|| !this.isReceiverCall(call)
				&& this.dependsOnParameter(this.summaries.get(owner), call.callee);
	}

	public callsForEffect(
		summary: FunctionSummaryID,
		name: SemanticNameID,
	): readonly SummaryCall[] {
		let selection = this.callsByEffectName[name];
		if (selection === undefined) {
			if (!this.effectIndex) this.effectIndex = this.buildEffectIndex();
			const relevance = this.effectIndex.select(name);
			selection = { ...relevance, calls: [] };
			this.callsByEffectName[name] = selection;
		}
		if (!selection.summaries[summary]) {
			// No path in the candidate graph writes this name. Callback forwarding
			// is name-independent and its dependency slice is shared across queries.
			let forwarding = this.forwardingCallsBySummary[summary];
			if (forwarding === undefined) {
				this.selectedEffectBodies += 1;
				forwarding = this.selectDependencyCalls(this.summaries.get(summary), EMPTY_RELEVANCE, EMPTY_RELEVANCE);
				this.forwardingCallsBySummary[summary] = forwarding;
			}
			return forwarding;
		}
		let calls = selection.calls[summary];
		if (calls === undefined) {
			this.selectedEffectBodies += 1;
			calls = this.selectDependencyCalls(this.summaries.get(summary), selection.summaries, selection.names, name);
			selection.calls[summary] = calls;
		}
		return calls;
	}

	public get staticCalleeEvaluations(): number { return this.staticCalleeQueries; }
	public get effectBodyEvaluations(): number { return this.selectedEffectBodies; }

	private compileTopLevelCall(call: CallValueEntry): SummaryCall {
		const args = new Array<TermID>(call.arguments.length);
		for (let argumentIndex = 0; argumentIndex < call.arguments.length; argumentIndex += 1) {
			args[argumentIndex] = this.summaries.terms.compileSource(call.arguments[argumentIndex]);
		}
		return {
			owner: undefined,
			site: call,
			callee: this.summaries.terms.compileSource(call.callee),
			arguments: args,
			result: call.result === undefined
				? undefined
				: this.summaries.terms.compileSource(call.result),
		};
	}

	private indexProjectedReceiverWrites(summary: FunctionSummary): void {
		if (summary.parameters.length === 0 || summary.receiverProjection === undefined) {
			return;
		}
		const receiver = summary.parameters[0];
		for (let writeIndex = 0; writeIndex < summary.writes.length; writeIndex += 1) {
			const write = summary.writes[writeIndex];
			if (write.base === receiver) {
				let writers = this.receiverWritersByName.get(write.name);
				if (!writers) {
					writers = [];
					this.receiverWritersByName.set(write.name, writers);
				}
				if (writers[writers.length - 1] !== summary.id) {
					writers.push(summary.id);
				}
				this.connectTerms(
					this.summaries.terms.member(summary.receiverProjection, write.name),
					this.summaries.projectExternalTerm(write.value),
				);
			}
		}
	}

	private appendStaticWrite(write: SummaryWrite): void {
		this.indexMemberName(write.base, write.name);
		let writes = this.staticWritesByName.get(write.name);
		if (!writes) {
			writes = [];
			this.staticWritesByName.set(write.name, writes);
		}
		writes.push(write);
		this.connectTerms(
			this.summaries.terms.member(write.base, write.name),
			write.value,
		);
	}

	/** Assignment order: storage on the left, its value on the right. */
	private connectTerms(left: TermID, right: TermID, bidirectional = true): void {
		// Unknown has no producer; concrete scalar values can select keyed calls
		// in the forward direction, but do not make their storage owners aliases.
		if (left === right || this.summaries.terms.isUnknown(left) || this.summaries.terms.isUnknown(right)) {
			return;
		}
		let leftTerms = this.relatedTermsByTerm[left];
		if (!leftTerms) {
			leftTerms = [];
			this.relatedTermsByTerm[left] = leftTerms;
		}
		if (!leftTerms.includes(right)) {
			leftTerms.push(right);
		}
		if (bidirectional && this.summaries.terms.hasLocationIdentity(right)) {
			let rightTerms = this.relatedTermsByTerm[right];
			if (!rightTerms) {
				rightTerms = [];
				this.relatedTermsByTerm[right] = rightTerms;
			}
			if (!rightTerms.includes(left)) {
				rightTerms.push(left);
			}
		}
	}

	private indexCall(call: SummaryCall): void {
		this.callsBySite.set(call.site, call);
		let uses = this.calleeCallsByTerm[call.callee];
		if (uses === undefined) {
			uses = [];
			this.calleeCallsByTerm[call.callee] = uses;
		}
		uses.push(call);
		if (this.summaries.terms.kind(call.callee) !== TermKind.Member) {
			return;
		}
		const name = this.summaries.terms.operand(call.callee) as SemanticNameID;
		let calls = this.candidateCallsByName.get(name);
		if (!calls) {
			calls = [];
			this.candidateCallsByName.set(name, calls);
		}
		calls.push(call);
	}

	private indexSummaryDependencies(summary: FunctionSummary): void {
		this.summaryAnchorGeneration += 1;
		for (let aliasIndex = 0; aliasIndex < summary.aliases.length; aliasIndex += 1) {
			this.indexSummaryDependency(summary.id, summary.aliases[aliasIndex].target);
			this.indexSummaryDependency(summary.id, summary.aliases[aliasIndex].source);
		}
		for (let writeIndex = 0; writeIndex < summary.writes.length; writeIndex += 1) {
			this.indexSummaryDependency(summary.id, summary.writes[writeIndex].base);
			this.indexSummaryDependency(summary.id, summary.writes[writeIndex].value);
		}
		for (let returnIndex = 0; returnIndex < summary.returns.length; returnIndex += 1) {
			this.indexSummaryDependency(summary.id, summary.returns[returnIndex]);
		}
		for (const call of summary.calls) {
			for (const argument of call.arguments) this.indexSummaryDependency(summary.id, argument);
		}
	}

	private indexSummaryDependency(summary: FunctionSummaryID, term: TermID): void {
		const anchor = this.summaries.terms.anchor(term);
		if (this.summaries.terms.kind(anchor) !== TermKind.Root
			|| !this.summaries.terms.isIndexableAnchor(anchor)
			|| this.indexedSummaryTerms[term] === this.summaryAnchorGeneration) {
			return;
		}
		this.indexedSummaryTerms[term] = this.summaryAnchorGeneration;
		let summaries = this.dependentSummariesByTerm[term];
		if (!summaries) {
			summaries = [];
			this.dependentSummariesByTerm[term] = summaries;
		}
		summaries.push(summary);
		if (anchor !== term) this.indexSummaryDependency(summary, anchor);
	}

	private indexDependentCall(call: FunctionCall): void {
		if (call.result !== undefined) {
			let calls = this.resultCallsByTerm[call.result];
			if (!calls) {
				calls = [];
				this.resultCallsByTerm[call.result] = calls;
			}
			calls.push(call);
		}
		this.dependentCallGeneration += 1;
		for (let argumentIndex = 0; argumentIndex < call.arguments.length; argumentIndex += 1) {
			const term = call.arguments[argumentIndex];
			const anchor = this.summaries.terms.anchor(term);
			if (this.summaries.terms.kind(anchor) !== TermKind.Root
				|| (!this.summaries.terms.isIndexableAnchor(anchor)
					&& !this.summaries.terms.isStringLiteralAnchor(anchor))
				|| this.indexedDependentCallTerms[term] === this.dependentCallGeneration) {
				continue;
			}
			this.indexedDependentCallTerms[term] = this.dependentCallGeneration;
			let calls = this.dependentCallsByTerm[term];
			if (!calls) {
				calls = [];
				this.dependentCallsByTerm[term] = calls;
			}
			calls.push(call);
		}
	}

	private indexTopLevelCall(call: SummaryCall): void {
		this.callAnchorGeneration += 1;
		this.indexTopLevelCallTerm(call, call.callee);
		for (let argumentIndex = 0; argumentIndex < call.arguments.length; argumentIndex += 1) {
			this.indexTopLevelCallTerm(call, call.arguments[argumentIndex]);
		}
		if (call.result !== undefined) {
			this.indexTopLevelCallTerm(call, call.result);
			let calls = this.topLevelResultCallsByTerm[call.result];
			if (!calls) {
				calls = [];
				this.topLevelResultCallsByTerm[call.result] = calls;
			}
			calls.push(call);
		}
	}

	private indexTopLevelCallTerm(call: SummaryCall, term: TermID): void {
		const anchor = this.summaries.terms.anchor(term);
		if ((!this.summaries.terms.isIndexableAnchor(anchor)
				&& !this.summaries.terms.isStringLiteralAnchor(anchor))
			|| this.indexedCallAnchors[anchor] === this.callAnchorGeneration) {
			return;
		}
		this.indexedCallAnchors[anchor] = this.callAnchorGeneration;
		let calls = this.topLevelCallsByAnchor[anchor];
		if (!calls) {
			calls = [];
			this.topLevelCallsByAnchor[anchor] = calls;
		}
		calls.push(call);
	}

	private buildEffectIndex(): SemanticEffectIndex {
		const index = new SemanticEffectIndex(this.functionNameBySummary);
		const summaries = this.summaries.list();
		for (let summaryIndex = 0; summaryIndex < summaries.length; summaryIndex += 1) {
			const summary = summaries[summaryIndex];
			for (const write of summary.writes) index.addWriter(write.name, summary.id);
			for (const call of summary.calls) {
				const candidates = this.candidateTargets(call.site);
				for (const target of candidates) {
					for (const callee of this.summaries.summaryIdsForDeclaration(target)) index.addCaller(callee, summary.id);
				}
				const exact = this.summaries.summaryIdsForTerm(call.callee);
				for (const callee of exact) index.addCaller(callee, summary.id);
				if (candidates.length === 0 && exact.length === 0
					&& this.summaries.terms.kind(call.callee) === TermKind.Member) {
					index.addNamedCaller(this.summaries.terms.operand(call.callee) as SemanticNameID, summary.id);
				}
			}
		}
		return index;
	}

	private callTargetsRelevantSummary(
		call: SummaryCall,
		relevantSummaries: readonly boolean[],
	): boolean {
		const candidates = this.candidateTargets(call.site);
		for (let targetIndex = 0; targetIndex < candidates.length; targetIndex += 1) {
			const targetSummaries = this.summaries.summaryIdsForDeclaration(candidates[targetIndex]);
			for (let summaryIndex = 0; summaryIndex < targetSummaries.length; summaryIndex += 1) {
				if (relevantSummaries[targetSummaries[summaryIndex]]) {
					return true;
				}
			}
		}
		const exactSummaries = this.summaries.summaryIdsForTerm(call.callee);
		for (let summaryIndex = 0; summaryIndex < exactSummaries.length; summaryIndex += 1) {
			if (relevantSummaries[exactSummaries[summaryIndex]]) {
				return true;
			}
		}
		return false;
	}

	private callRequiresNamedSelection(call: SummaryCall): boolean {
		return this.candidateTargets(call.site).length === 0
			&& this.summaries.summaryIdsForTerm(call.callee).length === 0;
	}

	/** Indexed storage must keep the value used to derive its key in one call context. */
	public keyedParameters(summaryId: FunctionSummaryID): readonly number[] {
		const retained = this.keyedParametersBySummary[summaryId];
		if (retained !== undefined) return retained;
		const summary = this.summaries.get(summaryId);
		const parameters: number[] = [];
		const terms = this.summaries.terms;
		for (let index = 0; index < summary.parameters.length; index += 1) {
			for (const alias of summary.aliases) {
				if (terms.kind(alias.target) === TermKind.Index
					&& this.dependsOnParameter(summary, terms.operand(alias.target) as TermID, summary.parameters[index])) {
					parameters.push(index);
					break;
				}
			}
		}
		this.keyedParametersBySummary[summaryId] = parameters;
		return parameters;
	}

	private dependsOnParameter(summary: FunctionSummary, value: TermID, parameter?: TermID, throughAccess = true): boolean {
		this.parameterDependencyGeneration += 1;
		this.parameterDependencyTerms.length = 1;
		this.parameterDependencyTerms[0] = value;
		let head = 0;
		while (head < this.parameterDependencyTerms.length) {
			const term = this.parameterDependencyTerms[head];
			head += 1;
			if (this.parameterDependencySeen[term] === this.parameterDependencyGeneration) {
				continue;
			}
			this.parameterDependencySeen[term] = this.parameterDependencyGeneration;
			const kind = this.summaries.terms.kind(term);
			if (kind === TermKind.Parameter && (parameter === undefined || term === parameter)) {
				this.parameterDependencyTerms.length = 0;
				return true;
			}
			if (kind === TermKind.ContextRoot || throughAccess && kind >= TermKind.Member) {
				this.parameterDependencyTerms.push(this.summaries.terms.base(term));
				if (kind === TermKind.Index) {
					this.parameterDependencyTerms.push(this.summaries.terms.operand(term) as TermID);
				}
			}
			for (let aliasIndex = 0; aliasIndex < summary.aliases.length; aliasIndex += 1) {
				if (summary.aliases[aliasIndex].target === term) {
					this.parameterDependencyTerms.push(summary.aliases[aliasIndex].source);
				}
			}
			// A callback selected by lookup(parameter) still depends on that
			// parameter. This only schedules the call; resolution owns its effects.
			for (const call of this.resultCallsForTerm(term)) {
				this.parameterDependencyTerms.push(call.callee);
				for (const argument of call.arguments) this.parameterDependencyTerms.push(argument);
			}
		}
		this.parameterDependencyTerms.length = 0;
		return false;
	}

	private isReceiverCall(call: SummaryCall): boolean {
		return this.summaries.terms.kind(call.callee) === TermKind.Member
			&& call.arguments.length > 0
			&& call.arguments[0] === this.summaries.terms.base(call.callee);
	}

	private summaryHasQueryIndependentEffects(summary: FunctionSummary): boolean {
		for (let aliasIndex = 0; aliasIndex < summary.aliases.length; aliasIndex += 1) {
			const alias = summary.aliases[aliasIndex];
			const anchor = this.summaries.terms.anchor(alias.target);
			const anchorKind = this.summaries.terms.kind(anchor);
			if (anchorKind === TermKind.Parameter || anchorKind === TermKind.Root
				|| anchorKind === TermKind.Local && this.summaries.terms.summaryOwner(anchor) !== summary.id) {
				return true;
			}
			const targetKind = this.summaries.terms.kind(alias.target);
			const object = targetKind >= TermKind.Member ? this.summaries.terms.base(alias.target) : alias.target;
			if ((alias.relation !== 'value' || targetKind >= TermKind.Member)
				&& this.dependsOnParameter(summary, object)) {
				return true;
			}
		}
		return false;
	}

	private callTargetsParameterForwardingSummary(call: SummaryCall): boolean {
		const candidates = this.candidateTargets(call.site);
		for (let targetIndex = 0; targetIndex < candidates.length; targetIndex += 1) {
			const targetSummaries = this.summaries.summaryIdsForDeclaration(candidates[targetIndex]);
			for (let summaryIndex = 0; summaryIndex < targetSummaries.length; summaryIndex += 1) {
				if (this.parameterForwardingSummaries[targetSummaries[summaryIndex]]) {
					return true;
				}
			}
		}
		const exactSummaries = this.summaries.summaryIdsForTerm(call.callee);
		for (let summaryIndex = 0; summaryIndex < exactSummaries.length; summaryIndex += 1) {
			if (this.parameterForwardingSummaries[exactSummaries[summaryIndex]]) {
				return true;
			}
		}
		return false;
	}

	private selectDependencyCalls(
		summary: FunctionSummary,
		relevantSummaries: readonly boolean[] | undefined,
		relevantFunctionNames: readonly boolean[] | undefined,
		effectName?: SemanticNameID,
		includeReturns = false,
		includeEscaping = false,
	): readonly SummaryCall[] {
		this.dependencyGeneration += 1;
		this.dependencyTerms.length = 0;
		this.dependencyTermContents.length = 0;
		this.selectedCallIndices.length = summary.calls.length;
		this.selectedCallIndices.fill(false);
		if (includeReturns) {
			for (let returnIndex = 0; returnIndex < summary.returns.length; returnIndex += 1) {
				this.appendDependencyTerm(summary.returns[returnIndex], false);
			}
		}
		if (effectName !== undefined) {
			for (let writeIndex = 0; writeIndex < summary.writes.length; writeIndex += 1) {
				const write = summary.writes[writeIndex];
				if (write.name === effectName) {
					this.appendDependencyTerm(write.base, false);
					this.appendDependencyTerm(write.value, false);
				}
			}
		}
		if (includeEscaping
			|| relevantSummaries !== undefined && relevantFunctionNames !== undefined) {
			for (let callIndex = 0; callIndex < summary.calls.length; callIndex += 1) {
				const call = summary.calls[callIndex];
				const candidateName = this.summaries.terms.kind(call.callee) === TermKind.Member
					? this.summaries.terms.operand(call.callee) as SemanticNameID
					: undefined;
				const queryRelevant = relevantSummaries !== undefined
					&& relevantFunctionNames !== undefined
					&& (this.callTargetsRelevantSummary(call, relevantSummaries)
						|| this.callTargetsParameterForwardingSummary(call)
						|| candidateName !== undefined
							&& this.callRequiresNamedSelection(call)
							&& relevantFunctionNames[candidateName]);
				const escaping = includeEscaping
					&& (this.callTargetsRelevantSummary(call, this.queryIndependentSummaries)
						|| candidateName !== undefined
							&& this.callRequiresNamedSelection(call)
							&& this.queryIndependentFunctionNames[candidateName]
						|| this.callTargetsParameterForwardingSummary(call)
						|| !this.isReceiverCall(call)
							&& this.dependsOnParameter(summary, call.callee));
				if (queryRelevant || escaping) {
					this.selectCallDependencies(call, callIndex);
				}
			}
		}
		let head = 0;
		while (head < this.dependencyTerms.length) {
			const term = this.dependencyTerms[head];
			const includeContents = this.dependencyTermContents[head];
			head += 1;
			if (this.dependencyTermSeen[term] === this.dependencyGeneration
				&& (!includeContents || this.dependencyContentSeen[term] === this.dependencyGeneration)) {
				continue;
			}
			this.dependencyTermSeen[term] = this.dependencyGeneration;
			if (includeContents) {
				this.dependencyContentSeen[term] = this.dependencyGeneration;
			}
			const kind = this.summaries.terms.kind(term);
			if (kind >= TermKind.Member) {
				this.appendDependencyTerm(this.summaries.terms.base(term), false);
				if (kind === TermKind.Index) {
					this.appendDependencyTerm(this.summaries.terms.operand(term) as TermID, false);
				}
			}
			for (let aliasIndex = 0; aliasIndex < summary.aliases.length; aliasIndex += 1) {
				if (summary.aliases[aliasIndex].target === term
					|| includeContents
						&& this.summaries.terms.isBasedOn(summary.aliases[aliasIndex].target, term)) {
					this.appendDependencyTerm(summary.aliases[aliasIndex].source, includeContents);
				}
			}
			if (includeContents) {
				for (let writeIndex = 0; writeIndex < summary.writes.length; writeIndex += 1) {
					const write = summary.writes[writeIndex];
					if (write.base === term || this.summaries.terms.isBasedOn(write.base, term)) {
						this.appendDependencyTerm(write.value, true);
					}
				}
			}
			for (let callIndex = 0; callIndex < summary.calls.length; callIndex += 1) {
				if (summary.calls[callIndex].result === term) {
					this.selectCallDependencies(summary.calls[callIndex], callIndex);
				}
			}
		}
		const calls: SummaryCall[] = [];
		for (let callIndex = 0; callIndex < summary.calls.length; callIndex += 1) {
			if (this.selectedCallIndices[callIndex]) {
				calls.push(summary.calls[callIndex]);
			}
		}
		return calls;
	}

	private selectCallDependencies(call: SummaryCall, callIndex: number): void {
		if (this.selectedCallIndices[callIndex]) {
			return;
		}
		this.selectedCallIndices[callIndex] = true;
		this.appendDependencyTerm(call.callee, false);
		for (let argumentIndex = 0; argumentIndex < call.arguments.length; argumentIndex += 1) {
			this.appendDependencyTerm(call.arguments[argumentIndex], true);
		}
	}

	private appendDependencyTerm(term: TermID, includeContents: boolean): void {
		this.dependencyTerms.push(term);
		this.dependencyTermContents.push(includeContents);
	}

	private appendDirectTarget(call: CallValueEntry, target: SymbolID): void {
		let targets = this.directTargetsByCall.get(call);
		if (!targets) {
			targets = [];
			this.directTargetsByCall.set(call, targets);
		}
		if (!targets.includes(target)) {
			targets.push(target);
		}
	}

	/** Candidate reachability is never evidence for a call application. */
	private candidateTargets(call: CallValueEntry): readonly SymbolID[] {
		return this.candidateTargetsByCall.get(call) || this.directTargets(call);
	}

	private retainCandidateTargets(call: SummaryCall): void {
		let targets = this.staticTargetsByTerm[call.callee];
		if (targets === undefined) {
			targets = this.collectCandidateTargets(call.callee);
			this.staticTargetsByTerm[call.callee] = targets;
		}
		const direct = this.directTargets(call.site);
		let candidates: SymbolID[] | undefined;
		for (const target of targets) {
			if ((candidates || direct).includes(target)) continue;
			if (candidates === undefined) candidates = direct.slice();
			candidates.push(target);
		}
		if (candidates !== undefined) this.candidateTargetsByCall.set(call.site, candidates);
	}

	private collectCandidateTargets(callee: TermID): readonly SymbolID[] {
		this.staticCalleeQueries += 1;
		const targets: SymbolID[] = [];
		this.staticCalleeGeneration += 1;
		this.staticCalleeTerms.length = 1;
		this.staticCalleeTerms[0] = callee;
		let head = 0;
		while (head < this.staticCalleeTerms.length) {
			const term = this.staticCalleeTerms[head];
			head += 1;
			if (this.staticCalleeSeen[term] === this.staticCalleeGeneration) {
				continue;
			}
			this.staticCalleeSeen[term] = this.staticCalleeGeneration;
			const summaryIds = this.summaries.summaryIdsForTerm(term);
			for (let summaryIndex = 0; summaryIndex < summaryIds.length; summaryIndex += 1) {
				const declaration = this.summaries.declarationForSummary(summaryIds[summaryIndex]);
				if (declaration !== undefined && !targets.includes(declaration)) {
					targets.push(declaration);
				}
			}
			const related = this.relatedTerms(term);
			for (let relatedIndex = 0; relatedIndex < related.length; relatedIndex += 1) {
				this.staticCalleeTerms.push(related[relatedIndex]);
			}
			if (this.summaries.terms.kind(term) === TermKind.Member) {
				// A missing intermediate member is not storage. Walk the base aliases
				// independently, then consume only member paths retained by producers.
				const terms = this.summaries.terms;
				const name = terms.operand(term) as SemanticNameID;
				const bases = this.staticReceiverTerms;
				const generation = ++this.staticReceiverGeneration;
				bases.length = 1;
				bases[0] = terms.base(term);
				this.staticReceiverSeen[bases[0]] = generation;
				for (let baseIndex = 0; baseIndex < bases.length; baseIndex += 1) {
					const relatedBases = this.relatedTerms(bases[baseIndex]);
					for (let index = 0; index < relatedBases.length; index += 1) {
						const base = relatedBases[index];
						if (this.staticReceiverSeen[base] === generation) continue;
						this.staticReceiverSeen[base] = generation;
						bases.push(base);
						const member = terms.retainedMember(base, name);
						if (member !== undefined) this.staticCalleeTerms.push(member);
					}
				}
			}
		}
		this.staticCalleeTerms.length = 0;
		return targets;
	}
}
