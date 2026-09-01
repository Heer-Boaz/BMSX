import { SemanticDemandIndex } from './demand_index';
import {
	type FunctionSummaryID,
	FunctionSummaryStore,
	type SemanticNameID,
	type SummaryCall,
	type TermID,
	TermKind,
} from './function_summary';
import { SemanticInstantiationQuery, type TermRelation } from './instantiate';
import { SemanticMemberQuery } from './member_query';
import type { Ref, SymbolID } from './model';
import { declarationValueSource, type CallValueEntry } from './value_graph';

export type CallFact = {
	readonly site: CallValueEntry;
	readonly reference: Ref;
	readonly calleeFn: SymbolID;
};

const EMPTY_CALL_FACTS: readonly CallFact[] = [];

export class SemanticCallWorklist {
	private readonly calls: SummaryCall[] = [];
	private readonly ownerFrames: number[] = [];
	private readonly processedRevisions: number[] = [];
	private readonly itemsBySite: Map<CallValueEntry, number[]> = new Map();

	public enqueue(call: SummaryCall, ownerFrame: number): void {
		let items = this.itemsBySite.get(call.site);
		if (!items) {
			items = [];
			this.itemsBySite.set(call.site, items);
		}
		for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
			if (this.ownerFrames[items[itemIndex]] === ownerFrame) {
				return;
			}
		}
		const item = this.calls.length;
		this.calls.push(call);
		this.ownerFrames.push(ownerFrame);
		this.processedRevisions.push(-1);
		items.push(item);
	}

	public get length(): number {
		return this.calls.length;
	}

	public call(item: number): SummaryCall {
		return this.calls[item];
	}

	public ownerFrame(item: number): number {
		return this.ownerFrames[item];
	}

	public processedRevision(item: number): number {
		return this.processedRevisions[item];
	}

	public markProcessed(item: number, revision: number): void {
		this.processedRevisions[item] = revision;
	}
}

export class SemanticCallGraph {
	private readonly factsByCall: Map<CallValueEntry, CallFact[]> = new Map();
	private readonly incomingByFunction: Map<SymbolID, CallFact[]> = new Map();
	private readonly outgoingByFunction: Map<SymbolID, CallFact[]> = new Map();
	private readonly callArguments: TermID[] = [];
	private readonly callableSummaries: FunctionSummaryID[] = [];
	private readonly callableDeclarations: (SymbolID | undefined)[] = [];
	private readonly callableTerms: TermID[] = [];
	private readonly producerTerms: TermID[] = [];
	private readonly producerSeen: number[] = [];
	private readonly activatedProducerTerms: boolean[] = [];
	private readonly callerActivationTerms: TermID[] = [];
	private readonly callerActivationSeen: number[] = [];
	private readonly identifierTerms: TermID[] = [];
	private readonly identifierSeen: number[] = [];
	private readonly valueProducerTerms: TermID[] = [];
	private readonly valueProducerSeen: number[] = [];
	private readonly activatedFrames: boolean[] = [];
	private readonly queriedCallsBySummary: SummaryCall[][] = [];
	private producerGeneration = 0;
	private callerActivationGeneration = 0;
	private identifierGeneration = 0;
	private valueProducerGeneration = 0;
	private producerHead = 0;
	private activatingProducers = false;
	private solvePasses = 0;

	constructor(
		private readonly summaries: FunctionSummaryStore,
		private readonly demand: SemanticDemandIndex,
		private readonly instantiation: SemanticInstantiationQuery,
		private readonly members: SemanticMemberQuery,
		private readonly worklist: SemanticCallWorklist,
	) {
		for (let callIndex = 0; callIndex < demand.topLevelCalls.length; callIndex += 1) {
			this.retainDirectFacts(demand.topLevelCalls[callIndex]);
		}
		const retainedSummaries = summaries.list();
		for (let summaryIndex = 0; summaryIndex < retainedSummaries.length; summaryIndex += 1) {
			const calls = retainedSummaries[summaryIndex].calls;
			for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
				this.retainDirectFacts(calls[callIndex]);
			}
		}
	}

	public solve(): void {
		for (;;) {
			let processed = false;
			for (let item = 0; item < this.worklist.length; item += 1) {
				const revision = this.instantiation.getRevision();
				if (this.worklist.processedRevision(item) === revision) {
					continue;
				}
				this.processCall(this.worklist.call(item), this.worklist.ownerFrame(item));
				this.worklist.markProcessed(item, this.instantiation.getRevision());
				processed = true;
			}
			if (!processed) {
				return;
			}
			this.solvePasses += 1;
		}
	}

	public getSolvePasses(): number {
		return this.solvePasses;
	}

	public compose(summary: FunctionSummaryID): void {
		if (!this.instantiation.compose(summary)) {
			return;
		}
		const retained = this.summaries.get(summary);
		if (retained.receiverProjection !== undefined) {
			this.queueProducerTerm(retained.receiverProjection);
		} else {
			this.activateCallers(retained.functionValue);
		}
		this.drainProducerTerms();
	}

	public querySummary(summary: FunctionSummaryID): void {
		this.compose(summary);
		this.instantiation.enqueueSummaryQueries(summary);
	}

	public activate(term: TermID): void {
		this.activateDependencies(term);
		const projected = this.summaries.projectExternalTerm(term);
		this.activateDependencies(projected);
		this.activateDependencies(this.summaries.terms.anchor(term));
		this.activateDependencies(this.summaries.terms.anchor(projected));
		this.queueProducerTerm(term);
		this.queueProducerTerm(projected);
		this.drainProducerTerms();
		this.activateValueProducers(term);
		if (projected !== term) {
			this.activateValueProducers(projected);
		}
	}

	public callee(call: CallValueEntry): readonly CallFact[] {
		const indexed = this.demand.call(call);
		if (indexed.owner !== undefined) {
			let queriedCalls = this.queriedCallsBySummary[indexed.owner];
			if (!queriedCalls) {
				queriedCalls = [];
				this.queriedCallsBySummary[indexed.owner] = queriedCalls;
			}
			if (!queriedCalls.includes(indexed)) {
				queriedCalls.push(indexed);
			}
			this.compose(indexed.owner);
			this.worklist.enqueue(indexed, -indexed.owner);
			for (
				let frame = this.instantiation.frames.first(indexed.owner);
				frame !== 0;
				frame = this.instantiation.frames.next(frame)
			) {
				this.worklist.enqueue(indexed, frame);
			}
		} else {
			this.enqueueContextCall(indexed);
		}
		this.solve();
		return this.factsByCall.get(call) || EMPTY_CALL_FACTS;
	}

	public incoming(symbol: SymbolID, name: SemanticNameID): readonly CallFact[] {
		if (this.summaries.summaryIdsForDeclaration(symbol).length === 0) {
			return this.incomingByFunction.get(symbol) || EMPTY_CALL_FACTS;
		}
		const candidates = this.demand.candidateCalls(name);
		for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
			this.callee(candidates[candidateIndex].site);
		}
		return this.incomingByFunction.get(symbol) || EMPTY_CALL_FACTS;
	}

	public outgoing(symbol: SymbolID): readonly CallFact[] {
		const summaryIds = this.summaries.summaryIdsForDeclaration(symbol);
		for (let summaryIndex = 0; summaryIndex < summaryIds.length; summaryIndex += 1) {
			const summaryId = summaryIds[summaryIndex];
			this.compose(summaryId);
			const calls = this.summaries.get(summaryId).calls;
			for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
				this.worklist.enqueue(calls[callIndex], -summaryId);
			}
		}
		this.solve();
		return this.outgoingByFunction.get(symbol) || EMPTY_CALL_FACTS;
	}

	private processCall(call: SummaryCall, ownerFrame: number): void {
		const callerFrame = ownerFrame > 0 ? ownerFrame : 0;
		const compositionOwner = callerFrame === 0
			? undefined
			: this.instantiation.frames.summary(callerFrame);
		const compositionCall = compositionOwner !== undefined
			&& this.demand.compositionCalls(compositionOwner).includes(call);
		let result: TermID | undefined;
		if (ownerFrame < 0) {
			this.callArguments.length = call.arguments.length;
			for (let argumentIndex = 0; argumentIndex < call.arguments.length; argumentIndex += 1) {
				this.callArguments[argumentIndex] = this.summaries.projectExternalTerm(
					call.arguments[argumentIndex],
				);
			}
			result = call.result === undefined
				? undefined
				: this.summaries.projectExternalTerm(call.result);
		} else {
			this.instantiation.contextualizeCallArguments(call, ownerFrame, this.callArguments);
			result = this.instantiation.contextualizeCallResult(call, ownerFrame);
		}
		const targets = this.demand.directTargets(call.site);
		if (targets.length > 0) {
			for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
				let target = this.summaries.terms.compileSource(declarationValueSource(targets[targetIndex]));
				if (ownerFrame < 0) {
					target = this.summaries.projectExternalTerm(target);
				} else if (ownerFrame !== 0) {
					target = this.instantiation.contextualize(target, ownerFrame);
				}
				this.activateValueProducers(target);
				this.processCallable(
					target,
					call,
					callerFrame,
					result,
					compositionCall ? compositionOwner : undefined,
					ownerFrame === 0,
				);
			}
			return;
		}
		const callee = ownerFrame < 0
			? this.summaries.projectExternalTerm(call.callee)
			: this.instantiation.contextualizeCallCallee(call, ownerFrame);
		this.activateValueProducers(callee);
		this.processCallable(
			callee,
			call,
			callerFrame,
			result,
			compositionCall ? compositionOwner : undefined,
			ownerFrame === 0,
		);
	}

	private processCallable(
		callee: TermID,
		call: SummaryCall,
		callerFrame: number,
		result: TermID | undefined,
		compositionOwner: FunctionSummaryID | undefined,
		propagateResult: boolean,
	): void {
		this.members.resolveCallable(
			callee,
			this.callableSummaries,
			this.callableDeclarations,
			this.callableTerms,
		);
		for (let callableIndex = 0; callableIndex < this.callableSummaries.length; callableIndex += 1) {
			const summary = this.callableSummaries[callableIndex];
			const declaration = this.callableDeclarations[callableIndex];
			if (declaration !== undefined) {
				this.retainFact(call.site, declaration);
			}
			if (callerFrame === 0
				|| compositionOwner !== undefined
					&& this.demand.propagatesComposition(compositionOwner, call, summary)) {
				this.instantiation.compose(summary);
			}
			const frame = this.instantiation.instantiate(
				call.site,
				summary,
				this.instantiation.closureForCallable(this.callableTerms[callableIndex]),
				callerFrame,
				this.callArguments,
				result,
			);
			this.activateFrameIdentifiers(summary, frame);
			const queriedCalls = this.queriedCallsBySummary[summary];
			if (queriedCalls) {
				for (let callIndex = 0; callIndex < queriedCalls.length; callIndex += 1) {
					this.worklist.enqueue(queriedCalls[callIndex], frame);
				}
			}
		}
		if (propagateResult && result !== undefined && this.callableSummaries.length > 0) {
			this.queueProducerTerm(result);
			this.drainProducerTerms();
		}
	}

	private activateFrameIdentifiers(summaryId: FunctionSummaryID, frame: number): void {
		if (this.activatedFrames[frame]) {
			return;
		}
		this.activatedFrames[frame] = true;
		const summary = this.summaries.get(summaryId);
		for (let aliasIndex = 0; aliasIndex < summary.aliases.length; aliasIndex += 1) {
			const source = this.instantiation.contextualize(summary.aliases[aliasIndex].source, frame);
			const anchor = this.summaries.terms.anchor(source);
			let stringIdentifier = this.summaries.terms.isStringLiteralAnchor(anchor);
			const related = this.demand.relatedTerms(source);
			for (let relatedIndex = 0; relatedIndex < related.length && !stringIdentifier; relatedIndex += 1) {
				stringIdentifier = this.summaries.terms.isStringLiteralAnchor(
					this.summaries.terms.anchor(related[relatedIndex]),
				);
			}
			if (stringIdentifier) {
				this.activateIdentifierUses(source);
			}
		}
	}

	private queueProducerTerm(term: TermID): void {
		this.producerTerms.push(term);
	}

	private enqueueContextCall(call: SummaryCall): void {
		this.worklist.enqueue(call, 0);
		this.queueProducerTerm(call.callee);
		for (let argumentIndex = 0; argumentIndex < call.arguments.length; argumentIndex += 1) {
			this.queueProducerTerm(call.arguments[argumentIndex]);
		}
		if (call.result !== undefined) {
			this.queueProducerTerm(call.result);
		}
	}

	private activateDependencies(term: TermID): void {
		const summaries = this.demand.dependentSummariesForTerm(term);
		for (let summaryIndex = 0; summaryIndex < summaries.length; summaryIndex += 1) {
			this.compose(summaries[summaryIndex]);
		}
	}

	private activateCallers(term: TermID): void {
		this.callerActivationGeneration += 1;
		this.callerActivationTerms.length = 1;
		this.callerActivationTerms[0] = term;
		let head = 0;
		while (head < this.callerActivationTerms.length) {
			const current = this.callerActivationTerms[head];
			head += 1;
			if (this.callerActivationSeen[current] === this.callerActivationGeneration) {
				continue;
			}
			this.callerActivationSeen[current] = this.callerActivationGeneration;
			const anchor = this.summaries.terms.anchor(current);
			if (anchor !== current) {
				this.callerActivationTerms.push(anchor);
			}
			const calls = this.demand.callerCallsForTerm(current);
			for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
				const call = calls[callIndex];
				this.instantiation.compose(call.owner);
				this.worklist.enqueue(call, -call.owner);
				for (let argumentIndex = 0; argumentIndex < call.arguments.length; argumentIndex += 1) {
					this.queueProducerTerm(
						this.summaries.projectExternalTerm(call.arguments[argumentIndex]),
					);
				}
			}
			const topLevelCalls = this.demand.topLevelCallsForTerm(current);
			for (let callIndex = 0; callIndex < topLevelCalls.length; callIndex += 1) {
				this.enqueueContextCall(topLevelCalls[callIndex]);
			}
			const related = this.demand.relatedTerms(current);
			for (let relatedIndex = 0; relatedIndex < related.length; relatedIndex += 1) {
				this.callerActivationTerms.push(related[relatedIndex]);
			}
		}
		this.callerActivationTerms.length = 0;
	}

	private activateIdentifierUses(term: TermID): void {
		this.identifierGeneration += 1;
		this.identifierTerms.length = 1;
		this.identifierTerms[0] = term;
		let head = 0;
		while (head < this.identifierTerms.length) {
			const current = this.identifierTerms[head];
			head += 1;
			if (this.identifierSeen[current] === this.identifierGeneration) {
				continue;
			}
			this.identifierSeen[current] = this.identifierGeneration;
			const calls = this.demand.dependentCallsForTerm(current);
			const stringAnchor = this.summaries.terms.isStringLiteralAnchor(
				this.summaries.terms.anchor(current),
			);
			for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
				const call = calls[callIndex];
				this.instantiation.compose(call.owner);
				this.worklist.enqueue(call, -call.owner);
			}
			if (stringAnchor) {
				const topLevelCalls = this.demand.topLevelCallsForTerm(current);
				for (let callIndex = 0; callIndex < topLevelCalls.length; callIndex += 1) {
					this.enqueueContextCall(topLevelCalls[callIndex]);
				}
			}
			const related = this.demand.relatedTerms(current);
			for (let relatedIndex = 0; relatedIndex < related.length; relatedIndex += 1) {
				this.identifierTerms.push(related[relatedIndex]);
			}
		}
		this.identifierTerms.length = 0;
	}

	private drainProducerTerms(): void {
		if (this.activatingProducers) {
			return;
		}
		this.activatingProducers = true;
		this.producerGeneration += 1;
		this.producerHead = 0;
		while (this.producerHead < this.producerTerms.length) {
			const term = this.producerTerms[this.producerHead];
			this.producerHead += 1;
			if (this.producerSeen[term] === this.producerGeneration) {
				continue;
			}
			this.producerSeen[term] = this.producerGeneration;
			const anchor = this.summaries.terms.anchor(term);
			if (anchor !== term) {
				this.queueProducerTerm(anchor);
			}
			const relatedTerms = this.demand.relatedTerms(term);
			for (let termIndex = 0; termIndex < relatedTerms.length; termIndex += 1) {
				this.queueProducerTerm(relatedTerms[termIndex]);
			}
			if (!this.activatedProducerTerms[term]
				&& (this.summaries.terms.isIndexableAnchor(anchor)
					|| this.summaries.terms.isStringLiteralAnchor(anchor))) {
				this.activatedProducerTerms[term] = true;
				const calls = this.demand.topLevelCallsForTerm(term);
				for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
					this.enqueueContextCall(calls[callIndex]);
				}
			}
			this.queueForwardProducerTerms(this.instantiation.values, term);
			this.queueReverseProducerTerms(this.instantiation.prototypes, term);
		}
		this.producerTerms.length = 0;
		this.producerHead = 0;
		this.activatingProducers = false;
	}

	private activateValueProducers(term: TermID): void {
		this.valueProducerGeneration += 1;
		this.valueProducerTerms.length = 1;
		this.valueProducerTerms[0] = term;
		let head = 0;
		while (head < this.valueProducerTerms.length) {
			const current = this.valueProducerTerms[head];
			head += 1;
			if (this.valueProducerSeen[current] === this.valueProducerGeneration) {
				continue;
			}
			this.valueProducerSeen[current] = this.valueProducerGeneration;
			const kind = this.summaries.terms.kind(current);
			if (kind >= TermKind.Member) {
				this.valueProducerTerms.push(this.summaries.terms.base(current));
			}
			const calls = this.demand.topLevelResultCallsForTerm(current);
			for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
				this.worklist.enqueue(calls[callIndex], 0);
			}
			if (kind === TermKind.ContextRoot) {
				const retained = this.demand.resultCallsForTerm(this.summaries.terms.base(current));
				const frame = this.summaries.terms.operand(current);
				for (let callIndex = 0; callIndex < retained.length; callIndex += 1) {
					this.worklist.enqueue(retained[callIndex], frame);
				}
			} else {
				const retained = this.demand.resultCallsForTerm(current);
				for (let callIndex = 0; callIndex < retained.length; callIndex += 1) {
					this.instantiation.compose(retained[callIndex].owner);
					this.worklist.enqueue(retained[callIndex], -retained[callIndex].owner);
				}
			}
			const related = this.demand.relatedTerms(current);
			for (let relatedIndex = 0; relatedIndex < related.length; relatedIndex += 1) {
				this.valueProducerTerms.push(related[relatedIndex]);
			}
			for (
				let link = this.instantiation.values.first(current);
				link !== 0;
				link = this.instantiation.values.next(link)
			) {
				this.valueProducerTerms.push(this.instantiation.values.target(link));
			}
		}
		this.valueProducerTerms.length = 0;
	}

	private queueReverseProducerTerms(
		relation: TermRelation,
		term: TermID,
	): void {
		for (
			let link = relation.firstReverse(term);
			link !== 0;
			link = relation.nextReverse(link)
		) {
			this.queueProducerTerm(relation.owner(link));
		}
	}

	private queueForwardProducerTerms(
		relation: TermRelation,
		term: TermID,
	): void {
		for (let link = relation.first(term); link !== 0; link = relation.next(link)) {
			this.queueProducerTerm(relation.target(link));
		}
	}

	private retainFact(site: CallValueEntry, calleeFn: SymbolID): void {
		const reference = this.demand.reference(site);
		if (!reference) {
			return;
		}
		let facts = this.factsByCall.get(site);
		if (!facts) {
			facts = [];
			this.factsByCall.set(site, facts);
		}
		for (let factIndex = 0; factIndex < facts.length; factIndex += 1) {
			if (facts[factIndex].calleeFn === calleeFn) {
				return;
			}
		}
		const fact = { site, reference, calleeFn };
		facts.push(fact);
		let incoming = this.incomingByFunction.get(calleeFn);
		if (!incoming) {
			incoming = [];
			this.incomingByFunction.set(calleeFn, incoming);
		}
		incoming.push(fact);
		if (reference.caller !== undefined) {
			let outgoing = this.outgoingByFunction.get(reference.caller);
			if (!outgoing) {
				outgoing = [];
				this.outgoingByFunction.set(reference.caller, outgoing);
			}
			outgoing.push(fact);
		}
	}

	private retainDirectFacts(call: SummaryCall): void {
		const targets = this.demand.directTargets(call.site);
		for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
			const target = targets[targetIndex];
			if (this.summaries.summaryIdsForDeclaration(target).length > 0) {
				this.retainFact(call.site, target);
			}
		}
	}
}
