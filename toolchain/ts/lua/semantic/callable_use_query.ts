import type { SemanticDemandIndex } from './demand_index';
import type { FunctionSummaryID, FunctionSummaryStore, SummaryCall, TermID } from './function_summary';
import type { SemanticInstantiationQuery } from './instantiate';
import { SemanticQueryResults } from './query_dependencies';

/** Exact callee uses reachable through retained assignments, not inferred read answers. */
export class SemanticCallableUseQuery {
	private readonly results: SemanticQueryResults<SummaryCall>;
	private readonly pending: TermID[] = [];
	private readonly seen: number[] = [];
	private readonly selected = new Set<SummaryCall>();
	private generation = 0;

	public constructor(
		private readonly summaries: FunctionSummaryStore,
		private readonly demand: SemanticDemandIndex,
		private readonly instantiation: SemanticInstantiationQuery,
	) {
		this.results = new SemanticQueryResults(summaries.terms.dependencies);
	}

	public get evaluations(): number { return this.results.count; }

	public calls(summaryId: FunctionSummaryID): readonly SummaryCall[] {
		if (this.results.isCurrent(summaryId)) return this.results.values(summaryId);
		this.results.begin(summaryId);
		const summary = this.summaries.get(summaryId);
		const pending = this.pending;
		pending.length = 0;
		pending.push(summary.functionValue);
		if (summary.lexicalOwner !== undefined) {
			for (let frame = this.instantiation.frames.first(summary.lexicalOwner); frame !== 0; frame = this.instantiation.frames.next(frame)) {
				pending.push(this.instantiation.contextualize(summary.functionValue, frame));
			}
		}
		const generation = ++this.generation;
		const calls = this.results.buffer(0);
		this.selected.clear();
		const values = this.instantiation.values;
		for (let index = 0; index < pending.length; index += 1) {
			const term = pending[index];
			if (this.seen[term] === generation) continue;
			this.seen[term] = generation;
			const template = this.summaries.terms.retainedTemplate(term);
			if (template !== undefined) {
				for (const call of this.demand.calleeCallsForTerm(template)) {
					if (this.selected.has(call)) continue;
					this.selected.add(call);
					calls.push(call);
				}
			}
			for (let link = values.firstReverse(term); link !== 0; link = values.nextReverse(link)) {
				pending.push(values.owner(link));
			}
		}
		return this.results.publish(summaryId, calls);
	}
}
