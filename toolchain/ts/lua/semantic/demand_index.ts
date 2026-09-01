import type { FileSemanticData, Ref, SymbolID } from './model';
import {
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

export type IndexedCall = SummaryCall & {
	readonly owner: FunctionSummaryID | undefined;
};

export type OwnedIndexedCall = SummaryCall & {
	readonly owner: FunctionSummaryID;
};

const EMPTY_WRITES: readonly SummaryWrite[] = [];
const EMPTY_SYMBOLS: readonly SymbolID[] = [];
const EMPTY_CALLS: readonly IndexedCall[] = [];
const EMPTY_SUMMARIES: readonly FunctionSummaryID[] = [];
const EMPTY_TERMS: readonly TermID[] = [];

// The demand index only selects retained facts. It never instantiates a call or
// publishes a function effect; those transitions belong to the query engine.
export class SemanticDemandIndex {
	public readonly aliases: readonly SummaryAlias[];
	public readonly topLevelCalls: readonly IndexedCall[];
	private readonly staticWritesByName: Map<SemanticNameID, SummaryWrite[]> = new Map();
	private readonly candidateCallsByName: Map<SemanticNameID, IndexedCall[]> = new Map();
	private readonly directTargetsByCall: Map<CallValueEntry, SymbolID[]> = new Map();
	private readonly referencesByCall: Map<CallValueEntry, Ref> = new Map();
	private readonly callsBySite: Map<CallValueEntry, IndexedCall> = new Map();
	private readonly dependentSummariesByTerm: FunctionSummaryID[][] = [];
	private readonly dependentCallsByTerm: OwnedIndexedCall[][] = [];
	private readonly callerCallsByTerm: OwnedIndexedCall[][] = [];
	private readonly topLevelCallsByAnchor: IndexedCall[][] = [];
	private readonly topLevelResultCallsByTerm: IndexedCall[][] = [];
	private readonly resultCallsByTerm: OwnedIndexedCall[][] = [];
	private readonly relatedTermsByTerm: TermID[][] = [];
	private readonly indexedSummaryTerms: number[] = [];
	private readonly indexedDependentCallTerms: number[] = [];
	private readonly indexedCallAnchors: number[] = [];
	private summaryAnchorGeneration = 0;
	private dependentCallGeneration = 0;
	private callAnchorGeneration = 0;
	private readonly memberNames: SemanticNameID[] = [];
	private readonly retainedMemberNames: Set<SemanticNameID> = new Set();
	private readonly functionNameBySummary: (SemanticNameID | undefined)[] = [];
	private readonly parameterForwardingSummaries: boolean[] = [];
	private readonly queryIndependentSummaries: boolean[] = [];
	private readonly queryIndependentFunctionNames: boolean[] = [];
	private readonly callsByEffectName: (readonly (readonly SummaryCall[])[] | undefined)[] = [];
	private readonly returnCallsBySummary: (readonly SummaryCall[] | undefined)[] = [];
	private readonly compositionCallsBySummary: (readonly SummaryCall[] | undefined)[] = [];
	private readonly dependencyTerms: TermID[] = [];
	private readonly dependencyTermContents: boolean[] = [];
	private readonly dependencyTermSeen: number[] = [];
	private readonly dependencyContentSeen: number[] = [];
	private readonly selectedCallIndices: boolean[] = [];
	private readonly parameterDependencyTerms: TermID[] = [];
	private readonly parameterDependencySeen: number[] = [];
	private readonly staticCalleeTerms: TermID[] = [];
	private readonly staticCalleeSeen: number[] = [];
	private dependencyGeneration = 0;
	private parameterDependencyGeneration = 0;
	private staticCalleeGeneration = 0;

	constructor(
		files: readonly FileSemanticData[],
		private readonly summaries: FunctionSummaryStore,
	) {
		const aliases: SummaryAlias[] = [];
		const topLevelCalls: IndexedCall[] = [];
		const functionNamesByDeclaration = new Map<SymbolID, SemanticNameID>();
		for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
			const file = files[fileIndex];
			for (let declarationIndex = 0; declarationIndex < file.decls.length; declarationIndex += 1) {
				const declaration = file.decls[declarationIndex];
				if (declaration.signature !== undefined) {
					functionNamesByDeclaration.set(
						declaration.id,
						summaries.terms.nameId(declaration.name),
					);
				}
			}
			for (let valueIndex = 0; valueIndex < file.declarationValues.length; valueIndex += 1) {
				const entry = file.declarationValues[valueIndex];
				if (summaries.ownerSummaryForDeclaration(entry.declId) !== undefined) {
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
				if (summaries.ownerSummaryForDeclaration(member.declId) !== undefined) {
					continue;
				}
				this.appendStaticWrite({
					base: summaries.terms.compileSource(member.owner),
					name: summaries.terms.nameId(member.name),
					value: summaries.terms.compileSource(declarationValueSource(member.declId)),
					declaration: member.declId,
				});
			}
			for (let callIndex = 0; callIndex < file.callValues.length; callIndex += 1) {
				const call = this.compileTopLevelCall(file.callValues[callIndex]);
				topLevelCalls.push(call);
				this.callsBySite.set(call.site, call);
				this.indexCandidateCall(call);
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
			this.indexProjectedReceiverWrites(summary);
			for (let writeIndex = 0; writeIndex < summary.writes.length; writeIndex += 1) {
				this.retainMemberName(summary.writes[writeIndex].name);
			}
			for (let callIndex = 0; callIndex < summary.calls.length; callIndex += 1) {
					const call: OwnedIndexedCall = { ...summary.calls[callIndex], owner: summary.id };
				this.callsBySite.set(call.site, call);
				this.indexCandidateCall(call);
				this.indexCallerCall(call);
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
					&& this.calleeDependsOnParameter(summary, call.callee)) {
					this.parameterForwardingSummaries[summary.id] = true;
					break;
				}
			}
		}
		for (let callIndex = 0; callIndex < topLevelCalls.length; callIndex += 1) {
			this.retainStaticCallTargets(topLevelCalls[callIndex]);
		}
		for (let summaryIndex = 0; summaryIndex < functionSummaries.length; summaryIndex += 1) {
			const calls = functionSummaries[summaryIndex].calls;
			for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
				this.retainStaticCallTargets(calls[callIndex]);
			}
		}
		this.aliases = aliases;
		this.topLevelCalls = topLevelCalls;
	}

	public staticWrites(name: SemanticNameID): readonly SummaryWrite[] {
		return this.staticWritesByName.get(name) || EMPTY_WRITES;
	}

	public candidateCalls(name: SemanticNameID): readonly IndexedCall[] {
		return this.candidateCallsByName.get(name) || EMPTY_CALLS;
	}

	public directTargets(call: CallValueEntry): readonly SymbolID[] {
		return this.directTargetsByCall.get(call) || EMPTY_SYMBOLS;
	}

	public reference(call: CallValueEntry): Ref | undefined {
		return this.referencesByCall.get(call);
	}

	public call(site: CallValueEntry): IndexedCall {
		return this.callsBySite.get(site) as IndexedCall;
	}

	public names(): readonly SemanticNameID[] {
		return this.memberNames;
	}

	public callerCallsForTerm(term: TermID): readonly OwnedIndexedCall[] {
		return this.callerCallsByTerm[term] || EMPTY_CALLS;
	}

	public dependentSummariesForTerm(term: TermID): readonly FunctionSummaryID[] {
		return this.dependentSummariesByTerm[term] || EMPTY_SUMMARIES;
	}

	public dependentCallsForTerm(term: TermID): readonly OwnedIndexedCall[] {
		return this.dependentCallsByTerm[term] || EMPTY_CALLS;
	}

	public topLevelCallsForTerm(term: TermID): readonly IndexedCall[] {
		const anchor = this.summaries.terms.anchor(term);
		return this.topLevelCallsByAnchor[anchor] || EMPTY_CALLS;
	}

	public topLevelResultCallsForTerm(term: TermID): readonly IndexedCall[] {
		return this.topLevelResultCallsByTerm[term] || EMPTY_CALLS;
	}

	public resultCallsForTerm(term: TermID): readonly OwnedIndexedCall[] {
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
				&& this.calleeDependsOnParameter(this.summaries.get(owner), call.callee);
	}

	public callsForEffect(
		summary: FunctionSummaryID,
		name: SemanticNameID,
	): readonly SummaryCall[] {
		let callsBySummary = this.callsByEffectName[name];
		if (callsBySummary === undefined) {
			callsBySummary = this.buildEffectCallSelection(name);
			this.callsByEffectName[name] = callsBySummary;
		}
		return callsBySummary[summary] || EMPTY_CALLS;
	}

	private compileTopLevelCall(call: CallValueEntry): IndexedCall {
		const args = new Array<TermID>(call.arguments.length);
		for (let argumentIndex = 0; argumentIndex < call.arguments.length; argumentIndex += 1) {
			const argument = call.arguments[argumentIndex];
			args[argumentIndex] = argument === undefined
				? this.summaries.terms.unknown()
				: this.summaries.terms.compileSource(argument);
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
				this.appendStaticWrite({
					...write,
					base: summary.receiverProjection,
					value: this.summaries.projectExternalTerm(write.value),
				});
			}
		}
	}

	private appendStaticWrite(write: SummaryWrite): void {
		let writes = this.staticWritesByName.get(write.name);
		if (!writes) {
			writes = [];
			this.staticWritesByName.set(write.name, writes);
		}
		writes.push(write);
		this.connectTerms(
			write.value,
			this.summaries.terms.member(write.base, write.name),
		);
		this.retainMemberName(write.name);
	}

	private connectTerms(left: TermID, right: TermID, bidirectional = true): void {
		if (left === right) {
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
		if (bidirectional) {
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

	private retainMemberName(name: SemanticNameID): void {
		if (this.retainedMemberNames.has(name)) {
			return;
		}
		this.retainedMemberNames.add(name);
		this.memberNames.push(name);
	}

	private indexCandidateCall(call: IndexedCall): void {
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

	private indexCallerCall(call: OwnedIndexedCall): void {
		const anchor = this.summaries.terms.anchor(call.callee);
		const anchorKind = this.summaries.terms.kind(anchor);
		if (!this.summaries.terms.isIndexableAnchor(anchor)
			|| (anchorKind !== TermKind.Root
				&& this.summaries.terms.kind(call.callee) !== TermKind.Local)) {
			return;
		}
		let calls = this.callerCallsByTerm[call.callee];
		if (!calls) {
			calls = [];
			this.callerCallsByTerm[call.callee] = calls;
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
	}

	private indexDependentCall(call: OwnedIndexedCall): void {
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

	private indexTopLevelCall(call: IndexedCall): void {
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

	private indexTopLevelCallTerm(call: IndexedCall, term: TermID): void {
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

	private buildEffectCallSelection(name: SemanticNameID): readonly (readonly SummaryCall[])[] {
		const summaries = this.summaries.list();
		const relevantSummaries: boolean[] = [];
		const selectableFunctionNames: boolean[] = [];
		const propagatingFunctionNames: boolean[] = [];
		for (let summaryIndex = 0; summaryIndex < summaries.length; summaryIndex += 1) {
			const summary = summaries[summaryIndex];
			for (let writeIndex = 0; writeIndex < summary.writes.length; writeIndex += 1) {
				if (summary.writes[writeIndex].name === name) {
					this.markRelevantSummary(
						summary.id,
						relevantSummaries,
						selectableFunctionNames,
						propagatingFunctionNames,
						true,
					);
					break;
				}
			}
		}
		for (;;) {
			let changed = false;
			for (let summaryIndex = 0; summaryIndex < summaries.length; summaryIndex += 1) {
				const summary = summaries[summaryIndex];
				for (let callIndex = 0; callIndex < summary.calls.length; callIndex += 1) {
					const call = summary.calls[callIndex];
					const direct = this.callTargetsRelevantSummary(call, relevantSummaries);
					const parameterDependent = this.calleeDependsOnParameter(summary, call.callee);
					const candidateName = this.summaries.terms.kind(call.callee) === TermKind.Member
						? this.summaries.terms.operand(call.callee) as SemanticNameID
						: undefined;
					const contextual = parameterDependent
						&& candidateName !== undefined
						&& this.callRequiresCandidateSelection(call)
						&& propagatingFunctionNames[candidateName];
					if (direct || contextual) {
						if (this.markRelevantSummary(
							summary.id,
							relevantSummaries,
							selectableFunctionNames,
							propagatingFunctionNames,
							direct,
						)) {
							changed = true;
						}
						break;
					}
				}
			}
			if (!changed) {
				break;
			}
		}
		const selected: (readonly SummaryCall[])[] = [];
		for (let summaryIndex = 0; summaryIndex < summaries.length; summaryIndex += 1) {
			const summary = summaries[summaryIndex];
			selected[summary.id] = this.selectDependencyCalls(
				summary,
				relevantSummaries,
				selectableFunctionNames,
				name,
				false,
				false,
			);
		}
		return selected;
	}

	private markRelevantSummary(
		summary: FunctionSummaryID,
		relevantSummaries: boolean[],
		selectableFunctionNames: boolean[],
		propagatingFunctionNames: boolean[],
		publishName: boolean,
	): boolean {
		let changed = !relevantSummaries[summary];
		relevantSummaries[summary] = true;
		const functionName = this.functionNameBySummary[summary];
		if (functionName !== undefined) {
			selectableFunctionNames[functionName] = true;
			if (publishName && !propagatingFunctionNames[functionName]) {
				propagatingFunctionNames[functionName] = true;
				changed = true;
			}
		}
		return changed;
	}

	private callTargetsRelevantSummary(
		call: SummaryCall,
		relevantSummaries: readonly boolean[],
	): boolean {
		const directTargets = this.directTargets(call.site);
		for (let targetIndex = 0; targetIndex < directTargets.length; targetIndex += 1) {
			const targetSummaries = this.summaries.summaryIdsForDeclaration(directTargets[targetIndex]);
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

	private callRequiresCandidateSelection(call: SummaryCall): boolean {
		return this.directTargets(call.site).length === 0
			&& this.summaries.summaryIdsForTerm(call.callee).length === 0;
	}

	private calleeDependsOnParameter(summary: FunctionSummary, callee: TermID): boolean {
		this.parameterDependencyGeneration += 1;
		this.parameterDependencyTerms.length = 1;
		this.parameterDependencyTerms[0] = callee;
		let head = 0;
		while (head < this.parameterDependencyTerms.length) {
			const term = this.parameterDependencyTerms[head];
			head += 1;
			if (this.parameterDependencySeen[term] === this.parameterDependencyGeneration) {
				continue;
			}
			this.parameterDependencySeen[term] = this.parameterDependencyGeneration;
			const kind = this.summaries.terms.kind(term);
			if (kind === TermKind.Parameter) {
				this.parameterDependencyTerms.length = 0;
				return true;
			}
			if (kind === TermKind.ContextRoot || kind >= TermKind.Member) {
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
			const anchorKind = this.summaries.terms.kind(
				this.summaries.terms.anchor(alias.target),
			);
			if (anchorKind === TermKind.Parameter || anchorKind === TermKind.Root) {
				return true;
			}
		}
		return false;
	}

	private callTargetsParameterForwardingSummary(call: SummaryCall): boolean {
		const directTargets = this.directTargets(call.site);
		for (let targetIndex = 0; targetIndex < directTargets.length; targetIndex += 1) {
			const targetSummaries = this.summaries.summaryIdsForDeclaration(directTargets[targetIndex]);
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
							&& this.callRequiresCandidateSelection(call)
							&& relevantFunctionNames[candidateName]);
				const escaping = includeEscaping
					&& (this.callTargetsRelevantSummary(call, this.queryIndependentSummaries)
						|| candidateName !== undefined
							&& this.callRequiresCandidateSelection(call)
							&& this.queryIndependentFunctionNames[candidateName]
						|| this.callTargetsParameterForwardingSummary(call)
						|| !this.isReceiverCall(call)
							&& this.calleeDependsOnParameter(summary, call.callee));
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

	private retainStaticCallTargets(call: SummaryCall): void {
		this.staticCalleeGeneration += 1;
		this.staticCalleeTerms.length = 1;
		this.staticCalleeTerms[0] = call.callee;
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
				if (declaration !== undefined) {
					this.appendDirectTarget(call.site, declaration);
				}
			}
			const related = this.relatedTerms(term);
			for (let relatedIndex = 0; relatedIndex < related.length; relatedIndex += 1) {
				this.staticCalleeTerms.push(related[relatedIndex]);
			}
			if (this.summaries.terms.kind(term) === TermKind.Member) {
				const base = this.summaries.terms.base(term);
				const relatedBases = this.relatedTerms(base);
				for (let relatedIndex = 0; relatedIndex < relatedBases.length; relatedIndex += 1) {
					this.staticCalleeTerms.push(this.summaries.terms.member(
						relatedBases[relatedIndex],
						this.summaries.terms.operand(term) as SemanticNameID,
					));
				}
			}
		}
		this.staticCalleeTerms.length = 0;
	}
}
