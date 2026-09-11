import type { CallApplication, SemanticCallContext } from './call_context';
import type { SemanticCallGraph } from './call_graph';
import type { FunctionSummaryID, FunctionSummaryStore } from './function_summary';
import type { SemanticInstantiationQuery } from './instantiate';
import { SemanticQueryEvaluation } from './query_dependencies';
import type { CallValueEntry, FunctionValueFlowEntry } from './value_graph';

/** Analysis/source contexts, not runtime activations or serialized frame identifiers. */
export type LuaSourceActivation =
	| { readonly kind: 'module' }
	| {
		readonly kind: 'projection' | 'invocation';
		readonly body: FunctionValueFlowEntry;
		readonly lexicalOwner: LuaSourceActivation;
	};

/** The entire ordered source tuple stays attached to one caller context. */
export type LuaSourceCall = {
	readonly site: CallValueEntry;
	readonly caller: LuaSourceActivation;
};

export type LuaSourceCallApplication = {
	readonly call: LuaSourceCall;
	readonly target: LuaSourceActivation;
};

/** A finite ancestry graph. Known applications are not an exhaustive callee proof. */
export type LuaSourceCallGraph = {
	readonly heads: readonly LuaSourceCall[];
	readonly calls: readonly LuaSourceCall[];
	readonly applications: readonly LuaSourceCallApplication[];
};

/** Source ancestry consumes the existing solver's applications; it never selects callees. */
export class LuaSourceCallQuery {
	private readonly activations = new Map<number, LuaSourceActivation>([[0, { kind: 'module' }]]);
	private readonly sourceCalls = new Map<SemanticCallContext, LuaSourceCall>();
	private readonly sourceApplications = new Map<CallApplication, LuaSourceCallApplication>();
	private readonly queries = new Map<CallValueEntry, number>();
	private readonly graphs: LuaSourceCallGraph[] = [];
	private readonly evaluation: SemanticQueryEvaluation;
	private readonly activationFrames: number[] = [];

	public constructor(
		private readonly summaries: FunctionSummaryStore,
		private readonly instantiation: SemanticInstantiationQuery,
		private readonly calls: SemanticCallGraph,
	) {
		this.evaluation = new SemanticQueryEvaluation(summaries.terms.dependencies);
	}

	public ancestry(site: CallValueEntry): LuaSourceCallGraph {
		let query = this.queries.get(site);
		if (query === undefined) {
			query = this.queries.size;
			this.queries.set(site, query);
		}
		if (this.evaluation.isCurrent(query)) return this.graphs[query];
		for (;;) {
			this.evaluation.begin(query);
			this.graphs[query] = this.collect(site);
			this.evaluation.end(query, true);
			if (this.evaluation.isCurrent(query)) return this.graphs[query];
		}
	}

	private collect(site: CallValueEntry): LuaSourceCallGraph {
		const contexts = this.calls.callContexts(site);
		const heads: LuaSourceCall[] = [];
		const calls: LuaSourceCall[] = [];
		const applications: LuaSourceCallApplication[] = [];
		const seenCalls = new Set<SemanticCallContext>();
		const requestedSites = new Set<CallValueEntry>([site]);
		const seenApplications = new Set<CallApplication>();
		const seenFrames = new Set<number>();
		const frames: number[] = [];

		const addFrame = (frame: number): void => {
			if (frame > 0 && !seenFrames.has(frame)) {
				seenFrames.add(frame);
				frames.push(frame);
			}
		};
		const addCall = (context: SemanticCallContext): LuaSourceCall => {
			if (!requestedSites.has(context.call.site)) {
				requestedSites.add(context.call.site);
				this.calls.callContexts(context.call.site);
			}
			const call = this.sourceCall(context);
			if (!seenCalls.has(context)) {
				seenCalls.add(context);
				calls.push(call);
				addFrame(context.ownerFrame);
			}
			return call;
		};
		const addApplication = (context: SemanticCallContext, application: CallApplication): void => {
			if (seenApplications.has(application)) return;
			seenApplications.add(application);
			const call = addCall(context);
			let edge = this.sourceApplications.get(application);
			if (edge === undefined) {
				edge = { call, target: this.activation(application.targetFrame) };
				this.sourceApplications.set(application, edge);
			}
			applications.push(edge);
			addFrame(this.instantiation.frames.closure(application.targetFrame));
		};

		for (const context of contexts) {
			heads.push(addCall(context));
			for (const application of context.applications) addApplication(context, application);
		}
		for (let index = 0; index < frames.length; index += 1) {
			const frame = frames[index];
			for (const edge of this.calls.incomingApplications(frame)) addApplication(edge.context, edge.application);
			addFrame(this.instantiation.frames.closure(frame));
		}
		return { heads, calls, applications };
	}

	private sourceCall(context: SemanticCallContext): LuaSourceCall {
		let call = this.sourceCalls.get(context);
		if (call === undefined) {
			call = { site: context.call.site, caller: this.activation(context.ownerFrame) };
			this.sourceCalls.set(context, call);
		}
		return call;
	}

	/** Closure ancestry is lexical, independent of the incoming caller edges. */
	private activation(frame: number): LuaSourceActivation {
		let activation = this.activations.get(frame);
		if (activation !== undefined) return activation;
		const frames = this.activationFrames;
		frames.length = 0;
		let current = frame;
		while (activation === undefined) {
			frames.push(current);
			if (current > 0) current = this.instantiation.frames.closure(current);
			else {
				const owner = this.summaries.get(-current as FunctionSummaryID).lexicalOwner;
				current = owner === undefined ? 0 : -owner;
			}
			activation = this.activations.get(current);
		}
		for (let index = frames.length - 1; index >= 0; index -= 1) {
			current = frames[index];
			const summary = current > 0 ? this.instantiation.frames.summary(current) : -current as FunctionSummaryID;
			activation = { kind: current > 0 ? 'invocation' : 'projection', body: this.summaries.get(summary).source,
				lexicalOwner: activation };
			this.activations.set(current, activation);
		}
		return activation;
	}
}
