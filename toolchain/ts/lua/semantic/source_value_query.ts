import type { FunctionSummaryStore } from './function_summary';
import { SemanticQueryEvaluation } from './query_dependencies';
import type { LuaSourceActivation, LuaSourceCall, LuaSourceCallApplication, LuaSourceCallQuery } from './source_call_graph';
import type { LuaSourceBoundary, LuaWrittenSource, LuaWrittenSourceQuery } from './written_sources';

/** A written occurrence in one analysis context, never a runtime value or instance. */
export type LuaContextualSource = {
	readonly source: LuaWrittenSource;
	readonly activation: LuaSourceActivation;
};

export type LuaSourceValueEdge = {
	readonly from: LuaContextualSource;
	readonly to: LuaContextualSource;
} & (
	| { readonly kind: 'written' }
	| { readonly kind: 'argument'; readonly application: LuaSourceCallApplication }
	| { readonly kind: 'return'; readonly application: LuaSourceCallApplication }
);

/** Known return contributions do not close the callee set of a dynamic call. */
export type LuaSourceCallResult = {
	readonly source: LuaContextualSource;
	readonly call: LuaSourceCall;
	readonly callee: LuaContextualSource;
	readonly applications: readonly LuaSourceCallApplication[];
};

export type LuaSourceValueTrace = {
	readonly root: LuaContextualSource;
	readonly sources: readonly LuaContextualSource[];
	readonly edges: readonly LuaSourceValueEdge[];
	readonly terminals: readonly LuaContextualSource[];
	readonly boundaries: readonly { readonly source: LuaContextualSource; readonly reason: LuaSourceBoundary }[];
	/** Retained even with no known application. Not a singleton/exhaustiveness certificate. */
	readonly callResults: readonly LuaSourceCallResult[];
};

/**
 * Written dependencies cross calls only through the existing application edges.
 * Argument/return edges keep their application label: consumers must not form a
 * Cartesian product of separately flattened argument terminals at shared frames.
 */
export class LuaSourceValueQuery {
	private readonly sourcesByActivation = new Map<LuaSourceActivation, Map<LuaWrittenSource, LuaContextualSource>>();
	private readonly queries = new Map<LuaContextualSource, number>();
	private readonly traces: LuaSourceValueTrace[] = [];
	private readonly evaluation: SemanticQueryEvaluation;

	public constructor(private readonly written: LuaWrittenSourceQuery, private readonly calls: LuaSourceCallQuery,
		private readonly summaries: FunctionSummaryStore) {
		this.evaluation = new SemanticQueryEvaluation(summaries.terms.dependencies);
	}

	public get evaluations(): number { return this.evaluation.count; }

	public source(source: LuaWrittenSource, activation: LuaSourceActivation): LuaContextualSource {
		let sources = this.sourcesByActivation.get(activation);
		if (sources === undefined) { sources = new Map(); this.sourcesByActivation.set(activation, sources); }
		let contextual = sources.get(source);
		if (contextual === undefined) { contextual = { source, activation }; sources.set(source, contextual); }
		return contextual;
	}

	/** Select the call context first; the ordinal is a semantic lane including self. */
	public argument(call: LuaSourceCall, index: number): LuaContextualSource {
		return this.source(this.written.argument(call.site, index), call.caller);
	}

	public trace(root: LuaContextualSource): LuaSourceValueTrace {
		let query = this.queries.get(root);
		if (query === undefined) { query = this.queries.size; this.queries.set(root, query); }
		if (this.evaluation.isCurrent(query)) return this.traces[query];
		for (;;) {
			this.evaluation.begin(query);
			this.traces[query] = this.collect(root);
			this.evaluation.end(query, true);
			if (this.evaluation.isCurrent(query)) return this.traces[query];
		}
	}

	private collect(root: LuaContextualSource): LuaSourceValueTrace {
		const sources: LuaContextualSource[] = [root];
		const edges: LuaSourceValueEdge[] = [];
		const terminals: LuaContextualSource[] = [];
		const boundaries: { source: LuaContextualSource; reason: LuaSourceBoundary }[] = [];
		const callResults: LuaSourceCallResult[] = [];
		const seen = new Set<LuaContextualSource>(sources);
		const add = (edge: LuaSourceValueEdge): void => {
			edges.push(edge);
			if (!seen.has(edge.to)) { seen.add(edge.to); sources.push(edge.to); }
		};
		for (let cursor = 0; cursor < sources.length; cursor += 1) {
			const current = sources[cursor];
			const inputs = this.written.inputs(current.source);
			if (inputs.kind === 'terminal') terminals.push(current);
			else if (inputs.kind === 'contributions') {
				for (const source of inputs.sources) {
					add({ kind: 'written', from: current, to: this.source(source, this.writeScope(source, current.activation)) });
				}
			} else if (inputs.reason === 'parameter-input' || inputs.reason === 'receiver') {
				const parameter = this.summaries.terms.parameterOwner(current.source.value.root)!;
				const summary = this.summaries.get(parameter.summary);
				const activation = this.calls.scope(summary.source, current.activation);
				if (activation.kind === 'projection') {
					boundaries.push({ source: current, reason: inputs.reason });
					continue;
				}
				for (const application of this.calls.incoming(activation)) {
					add({ kind: 'argument', from: current, to: this.argument(application.call, parameter.index), application });
				}
			} else if (inputs.reason === 'call-result') {
				const call = this.calls.inActivation(inputs.call, current.activation);
				const applications = this.calls.applications(call);
				callResults.push({ source: current, call, applications,
					callee: this.source(this.written.callee(inputs.call), call.caller) });
				for (const application of applications) {
					for (const returned of this.written.returns(application.target.body)) {
						add({ kind: 'return', from: current, to: this.source(returned, application.target), application });
					}
				}
			} else boundaries.push({ source: current, reason: inputs.reason });
		}
		return { root, sources, edges, terminals, boundaries, callResults };
	}

	private writeScope(source: LuaWrittenSource, activation: LuaSourceActivation): LuaSourceActivation {
		switch (source.kind) {
			case 'module-export': case 'module-bypass': return this.calls.module;
			case 'declaration-write': return this.calls.scope(source.write.flow, activation);
			case 'value-transfer': return this.calls.scope(source.flow, activation);
			default: return activation;
		}
	}
}
