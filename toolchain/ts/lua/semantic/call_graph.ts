import { SemanticDemandIndex } from './demand_index';
import { SemanticCallableUseQuery } from './callable_use_query';
import { SemanticCallContext, type CallApplication, type CallApplicationEdge } from './call_context';
import {
	type FunctionSummaryID,
	FunctionSummaryStore,
	type SemanticNameID,
	type SummaryCall,
	type TermID,
	TermKind,
} from './function_summary';
import { SemanticInstantiationQuery } from './instantiate';
import { SemanticMemberQuery } from './member_query';
import type { Ref, SymbolID } from './model';
import { SemanticDependencyIndex, SemanticQueryEvaluation, SemanticQueryResults } from './query_dependencies';
import { SemanticQueryWorklist } from './query_worklist';
import type { BidirectionalTermRelation, TermRelation } from './term_relation';
import { declarationValueSource, type CallValueEntry } from './value_graph';

export type CallFact = {
	readonly site: CallValueEntry;
	readonly reference: Ref;
	readonly calleeFn: SymbolID;
};

const EMPTY_CALL_FACTS: readonly CallFact[] = [];
const EMPTY_CALL_ITEMS: ReadonlyMap<number, number> = new Map();
const EMPTY_APPLICATION_EDGES: readonly CallApplicationEdge[] = [];

export class SemanticCallWorklist extends SemanticQueryWorklist {
	private readonly calls: SummaryCall[] = [];
	private readonly ownerFrames: number[] = [];
	private readonly itemsBySite = new Map<CallValueEntry, Map<number, number>>();

	public enqueue(call: SummaryCall, ownerFrame: number): void {
		let items = this.itemsBySite.get(call.site);
		if (!items) {
			items = new Map();
			this.itemsBySite.set(call.site, items);
		}
		if (items.has(ownerFrame)) return;
		const item = this.calls.length;
		this.calls.push(call);
		this.ownerFrames.push(ownerFrame);
		items.set(ownerFrame, item);
		this.add(item);
	}

	public call(item: number): SummaryCall {
		return this.calls[item];
	}

	public ownerFrame(item: number): number {
		return this.ownerFrames[item];
	}

	public callItems(site: CallValueEntry): ReadonlyMap<number, number> {
		return this.itemsBySite.get(site) || EMPTY_CALL_ITEMS;
	}

}

export class SemanticCallGraph {
	private readonly contexts: SemanticCallContext[] = [];
	private incomingApplicationIndex: {
		readonly byFrame: Map<number, CallApplicationEdge[]>;
		readonly dependencies: SemanticDependencyIndex;
	} | undefined;
	private readonly contextQueries = new Map<CallValueEntry, number>();
	private readonly contextResults: SemanticQueryResults<SemanticCallContext>;
	private readonly callerContextQueries: SemanticQueryEvaluation;
	private readonly callableUses: SemanticCallableUseQuery;
	private readonly incomingFactDependencies: SemanticDependencyIndex;
	private readonly factsByCall: Map<CallValueEntry, CallFact[]> = new Map();
	private readonly incomingByFunction: Map<SymbolID, CallFact[]> = new Map();
	private readonly outgoingByFunction: Map<SymbolID, CallFact[]> = new Map();
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
	private readonly queriedSummaryCallers: boolean[] = [];
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
		this.contextResults = new SemanticQueryResults(summaries.terms.dependencies);
		this.callerContextQueries = new SemanticQueryEvaluation(summaries.terms.dependencies);
		this.callableUses = new SemanticCallableUseQuery(summaries, demand, instantiation);
		this.incomingFactDependencies = new SemanticDependencyIndex(summaries.terms.dependencies);
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
		while (this.worklist.pendingCount > 0) {
			let processed = false;
			const count = this.worklist.pendingCount;
			for (let index = 0; index < count; index += 1) {
				const item = this.worklist.take();
				if (this.worklist.evaluation.isCurrent(item)) continue;
				this.worklist.evaluation.begin(item);
				const context = this.context(item);
				const targetsBefore = context.applications.length;
				this.processCall(context);
				this.worklist.evaluation.end(item, context.applications.length !== targetsBefore);
				processed = true;
			}
			if (processed) this.solvePasses += 1;
		}
	}

	public getSolvePasses(): number {
		return this.solvePasses;
	}

	public getCallerContextEvaluations(): number {
		return this.callerContextQueries.count;
	}

	public getCallableUseEvaluations(): number { return this.callableUses.evaluations; }

	/** Retained site/owner inputs; these are may-analysis applications, not execution evidence. */
	public callContexts(call: CallValueEntry): readonly SemanticCallContext[] {
		let query = this.contextQueries.get(call);
		if (query === undefined) {
			query = this.contextQueries.size;
			this.contextQueries.set(call, query);
		}
		if (this.contextResults.isCurrent(query)) return this.contextResults.values(query);
		for (;;) {
			this.contextResults.begin(query);
			const owner = this.demand.call(call).owner;
			if (owner !== undefined) this.queryCallerContexts(owner);
			this.callee(call);
			const contexts = this.contextResults.buffer(0);
			for (const item of this.worklist.callItems(call).values()) {
				// Read solved work even if this invocation did not have to evaluate it.
				this.worklist.evaluation.isCurrent(item);
				contexts.push(this.contexts[item]);
			}
			const result = this.contextResults.publish(query, contexts);
			this.solve();
			if (this.contextResults.isCurrent(query)) return result;
		}
	}

	/** Exact context selection uses the work item's existing site/frame index. */
	public callContext(call: CallValueEntry, ownerFrame: number): SemanticCallContext {
		this.callContexts(call);
		return this.contexts[this.worklist.callItems(call).get(ownerFrame)!];
	}

	private queryCallerContexts(summary: FunctionSummaryID): void {
		const queries = this.callerContextQueries;
		if (queries.isCurrent(summary) || queries.isComputing(summary)) return;
		queries.begin(summary);
		this.compose(summary);
		const retained = this.summaries.get(summary);
		if (retained.lexicalOwner !== undefined) this.queryCallerContexts(retained.lexicalOwner);
		const declaration = this.summaries.declarationForSummary(summary);
		if (declaration !== undefined) {
			this.incomingFactDependencies.read(summary);
			const incoming = this.incomingByFunction.get(declaration);
			if (incoming !== undefined) {
				for (const fact of incoming) {
					const call = this.demand.call(fact.site);
					if (call.owner !== undefined) this.queryCallerContexts(call.owner);
					this.queryCall(call);
				}
			}
		}
		for (const call of this.callableUses.calls(summary)) {
			if (call.owner !== undefined) this.queryCallerContexts(call.owner);
			this.queryCall(call);
		}
		queries.end(summary);
	}

	private context(item: number): SemanticCallContext {
		let context = this.contexts[item];
		if (context === undefined) {
			const call = this.worklist.call(item);
			const ownerFrame = this.worklist.ownerFrame(item);
			context = new SemanticCallContext(call, this.instantiation.bindCall(call, ownerFrame), ownerFrame);
			this.contexts[item] = context;
		}
		return context;
	}

	/** Incoming source edges, not the first caller recorded when a frame was interned. */
	public incomingApplications(frame: number): readonly CallApplicationEdge[] {
		if (this.incomingApplicationIndex === undefined) {
			this.incomingApplicationIndex = {
				byFrame: new Map(), dependencies: new SemanticDependencyIndex(this.summaries.terms.dependencies),
			};
			for (const context of this.contexts) {
				for (const application of context.applications) this.indexIncoming(context, application);
			}
		}
		const { byFrame, dependencies } = this.incomingApplicationIndex;
		dependencies.read(frame);
		const edges = byFrame.get(frame);
		return edges === undefined ? EMPTY_APPLICATION_EDGES : edges;
	}

	private indexIncoming(context: SemanticCallContext, application: CallApplication): void {
		const { byFrame, dependencies } = this.incomingApplicationIndex!;
		const frame = application.targetFrame;
		let edges = byFrame.get(frame);
		if (edges === undefined) {
			edges = [];
			byFrame.set(frame, edges);
		}
		edges.push({ context, application });
		dependencies.changed(frame);
	}

	public compose(summary: FunctionSummaryID): void {
		if (this.queriedSummaryCallers[summary]) return;
		this.queriedSummaryCallers[summary] = true;
		this.instantiation.compose(summary);
		const retained = this.summaries.get(summary);
		// Projecting captured bindings does not query the creator's callers.
		// A nested body also needs its lexical owner's incoming contexts.
		if (retained.lexicalOwner !== undefined) this.compose(retained.lexicalOwner);
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
		this.queryCall(this.demand.call(call));
		this.solve();
		return this.factsByCall.get(call) || EMPTY_CALL_FACTS;
	}

	/** Register a site's demand in existing and subsequently discovered caller frames. */
	private queryCall(indexed: SummaryCall): void {
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

	private processCall(context: SemanticCallContext): void {
		const { call, inputs, ownerFrame } = context;
		const callerFrame = ownerFrame > 0 ? ownerFrame : 0;
		const compositionOwner = callerFrame === 0
			? undefined
			: this.instantiation.frames.summary(callerFrame);
		const compositionCall = compositionOwner !== undefined
			&& this.demand.compositionCalls(compositionOwner).includes(call);
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
					context,
					callerFrame,
					compositionCall ? compositionOwner : undefined,
					ownerFrame === 0,
				);
			}
			return;
		}
		const callee = inputs.callee;
		this.activateValueProducers(callee);
		this.processCallable(
			callee,
			context,
			callerFrame,
			compositionCall ? compositionOwner : undefined,
			ownerFrame === 0,
		);
	}

	private processCallable(
		callee: TermID,
		context: SemanticCallContext,
		callerFrame: number,
		compositionOwner: FunctionSummaryID | undefined,
		propagateResult: boolean,
	): void {
		const { call, inputs } = context;
		const { result } = inputs;
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
				inputs.arguments,
				result,
			);
			const application = context.addApplication(summary, this.callableTerms[callableIndex], frame);
			if (application !== undefined && this.incomingApplicationIndex !== undefined) this.indexIncoming(context, application);
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
			// Projection demand follows externally selectable or direct local callees;
			// source-context enumeration consumes the complete exact-use index instead.
			if (this.summaries.terms.isIndexableAnchor(anchor)
				&& (this.summaries.terms.kind(anchor) === TermKind.Root || this.summaries.terms.kind(current) === TermKind.Local)) {
				for (const call of this.demand.calleeCallsForTerm(current)) {
					if (call.owner === undefined) continue;
					this.instantiation.compose(call.owner);
					this.worklist.enqueue(call, -call.owner);
					for (const argument of call.arguments) {
						this.queueProducerTerm(this.summaries.projectExternalTerm(argument));
					}
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
			this.instantiation.demandValue(current);
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
		relation: BidirectionalTermRelation,
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
		for (const summary of this.summaries.summaryIdsForDeclaration(calleeFn)) {
			this.incomingFactDependencies.changed(summary);
		}
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
