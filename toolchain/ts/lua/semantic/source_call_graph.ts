import type { CallApplication, SemanticCallContext } from './call_context';
import type { SemanticCallGraph } from './call_graph';
import type { FunctionSummaryID, FunctionSummaryStore } from './function_summary';
import type { SemanticInstantiationQuery } from './instantiate';
import { SemanticQueryEvaluation } from './query_dependencies';
import type { CallValueEntry, FunctionValueFlowEntry } from './value_graph';

/** Analysis/source contexts, not runtime activations or serialized frame identifiers. */
export type LuaSourceActivation =
	| { readonly kind: 'module' }
	| LuaFunctionSourceActivation;

type LuaFunctionSourceActivation = {
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
	readonly target: LuaFunctionSourceActivation;
};

/** A finite ancestry graph. Known applications are not an exhaustive callee proof. */
export type LuaSourceCallGraph = {
	readonly heads: readonly LuaSourceCall[];
	readonly calls: readonly LuaSourceCall[];
	readonly applications: readonly LuaSourceCallApplication[];
};

/** Source ancestry consumes the existing solver's applications; it never selects callees. */
export class LuaSourceCallQuery {
	public readonly module = { kind: 'module' } as const;
	private readonly activations = new Map<number, LuaFunctionSourceActivation>();
	private readonly framesByActivation = new Map<LuaSourceActivation, number>([[this.module, 0]]);
	private readonly sourceCalls = new Map<SemanticCallContext, LuaSourceCall>();
	private readonly sourceApplications = new Map<CallApplication, LuaSourceCallApplication>();
	private readonly applicationsByCall = new Map<LuaSourceCall, readonly LuaSourceCallApplication[]>();
	private readonly incomingByActivation = new Map<LuaSourceActivation, readonly LuaSourceCallApplication[]>();
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

	/** The caller context is chosen before following any one of its argument lanes. */
	public inActivation(site: CallValueEntry, activation: LuaSourceActivation): LuaSourceCall {
		const frame = this.framesByActivation.get(activation)!;
		return this.sourceCall(this.calls.callContext(site, frame));
	}

	public applications(call: LuaSourceCall): readonly LuaSourceCallApplication[] {
		const context = this.calls.callContext(call.site, this.framesByActivation.get(call.caller)!);
		const retained = this.applicationsByCall.get(call);
		if (retained !== undefined && retained.length === context.applications.length) return retained;
		const applications = retained === undefined ? [] : retained.slice();
		for (let index = applications.length; index < context.applications.length; index += 1) {
			applications.push(this.sourceApplication(context, context.applications[index]));
		}
		this.applicationsByCall.set(call, applications);
		return applications;
	}

	/** Retained predecessor rows include later incoming edges to a shared activation. */
	public incoming(activation: LuaFunctionSourceActivation): readonly LuaSourceCallApplication[] {
		const edges = this.calls.incomingApplications(this.framesByActivation.get(activation)!);
		const retained = this.incomingByActivation.get(activation);
		if (retained !== undefined && retained.length === edges.length) return retained;
		const applications = retained === undefined ? [] : retained.slice();
		for (let index = applications.length; index < edges.length; index += 1) {
			const edge = edges[index];
			applications.push(this.sourceApplication(edge.context, edge.application));
		}
		this.incomingByActivation.set(activation, applications);
		return applications;
	}

	/** A captured binding follows its lexical creator, never an arbitrary incoming caller. */
	public scope(body: FunctionValueFlowEntry, from: LuaSourceActivation): LuaFunctionSourceActivation;
	public scope(body: FunctionValueFlowEntry | undefined, from: LuaSourceActivation): LuaSourceActivation;
	public scope(body: FunctionValueFlowEntry | undefined, from: LuaSourceActivation): LuaSourceActivation {
		if (body === undefined) return this.module;
		for (let current = from; current.kind !== 'module'; current = current.lexicalOwner) {
			if (current.body === body) return current;
		}
		// A write from another body is a projected contribution, not proof that it ran here.
		return this.functionActivation(-this.summaries.idForFlow(body));
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
			addCall(context);
			applications.push(this.sourceApplication(context, application));
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

	private sourceApplication(context: SemanticCallContext, application: CallApplication): LuaSourceCallApplication {
		let edge = this.sourceApplications.get(application);
		if (edge === undefined) {
			edge = { call: this.sourceCall(context), target: this.functionActivation(application.targetFrame) };
			this.sourceApplications.set(application, edge);
		}
		return edge;
	}

	/** Closure ancestry is lexical, independent of the incoming caller edges. */
	private activation(frame: number): LuaSourceActivation {
		return frame === 0 ? this.module : this.functionActivation(frame);
	}

	private functionActivation(frame: number): LuaFunctionSourceActivation {
		let activation: LuaSourceActivation | undefined = this.activations.get(frame);
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
			activation = current === 0 ? this.module : this.activations.get(current);
		}
		for (let index = frames.length - 1; index >= 0; index -= 1) {
			current = frames[index];
			const summary = current > 0 ? this.instantiation.frames.summary(current) : -current as FunctionSummaryID;
			const next: LuaFunctionSourceActivation = { kind: current > 0 ? 'invocation' : 'projection', body: this.summaries.get(summary).source,
				lexicalOwner: activation };
			this.activations.set(current, next);
			this.framesByActivation.set(next, current);
			activation = next;
		}
		return this.activations.get(frame)!;
	}
}
