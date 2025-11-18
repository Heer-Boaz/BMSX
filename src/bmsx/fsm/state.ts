import { Registry } from '../core/registry';
import { $ } from '../core/game';
import { Input } from '../input/input';
import { Identifiable, Identifier } from '../rompack/rompack';
import { insavegame, onload, type RevivableObjectArgs } from '../serializer/serializationhooks';
import { BST_MAX_HISTORY, DEFAULT_BST_ID } from './fsmcontroller';
import { StateDefinitions } from './fsmlibrary';
import { type id2sstate, type Stateful, type StateEventDefinition, type TickCheckDefinition, type transition_target, type StateTimelineConfig } from './fsmtypes';
import { StateDefinition } from './statedefinition';
import { EventPayload, GameEvent } from '../core/game_event';
import type { Timeline, TimelineDefinition } from '../timeline/timeline';
import type { TimelinePlayOptions } from '../component/timeline_component';

type TransitionExecutionMode = 'immediate' | 'queued' | 'deferred';

type TransitionTrigger = 'manual' | 'event' | 'input' | 'run-check' | 'process-input' | 'tick' | 'enter' | 'queue-drain';

interface TransitionOutcomeSnapshot {
	from?: Identifier;
	to: Identifier;
	execution: TransitionExecutionMode;
	status: 'success' | 'queued' | 'blocked' | 'noop';
	guardSummary?: string;
	reason?: string;
}

interface TransitionDiagSnapshot {
	trigger: TransitionTrigger;
	description?: string;
	eventName?: string;
	emitter?: Identifier;
	handlerName?: string;
	payloadSummary?: string;
	timestamp: number;
	bubbled?: boolean;
	actionEvaluations?: readonly string[];
	guardEvaluations?: readonly GuardEvaluation[];
	lastTransition?: TransitionOutcomeSnapshot;
}

interface TransitionDiagContext extends TransitionDiagSnapshot {
	actionEvaluations?: string[];
	guardEvaluations?: GuardEvaluation[];
	transitions?: TransitionOutcomeSnapshot[];
}

type TransitionQueueItem = { path: Identifier; diag?: TransitionDiagSnapshot };

interface TransitionTraceEntry {
	outcome: 'success' | 'queued' | 'blocked' | 'noop';
	execution: TransitionExecutionMode;
	from?: Identifier;
	to: Identifier;
	context?: TransitionDiagSnapshot;
	guard?: TransitionGuardDiagnostics;
	queueSize?: number;
	reason?: string;
}

interface EventDispatchResult {
	handled: boolean;
	context?: TransitionDiagSnapshot;
}

type TimelineHost = Stateful & {
	define_timeline(definition: Timeline | TimelineDefinition): void;
	play_timeline(id: string, opts?: TimelinePlayOptions): void;
	stop_timeline(id: string): void;
	get_timeline<T = Timeline>(id: string): Timeline<T> | undefined;
};

type StateTimelineBinding = {
	id: Identifier;
	create: () => Timeline;
	autoplay: boolean;
	stopOnExit: boolean;
	playOptions?: TimelinePlayOptions;
	defined: boolean;
};

interface GuardEvaluation {
	side: 'exit' | 'enter';
	descriptor: string;
	passed: boolean;
	defined: boolean;
	type: 'function' | 'string' | 'missing' | 'other';
	reason?: string;
}

interface TransitionGuardDiagnostics {
	allowed: boolean;
	evaluations: GuardEvaluation[];
}

const EMPTY_GAME_EVENT: GameEvent = Object.freeze({
	type: '__fsm.synthetic__',
	emitter: null,
	timestamp: 0,
});

function resolveEmitterId(event: GameEvent | undefined, fallback: Identifier): Identifier {
	if (!event || !event.emitter) return fallback;
	return (event.emitter as Identifiable).id ?? fallback;
}

function resolveEventPayload(event: GameEvent | undefined): EventPayload | undefined {
	if (!event) return undefined;
	const { type, timeStamp, emitter, target, ...rest } = event as Record<string, unknown>;
	if (Object.keys(rest).length === 0) return undefined;
	return rest as EventPayload;
}

@insavegame
/**
 * Represents a state in a state machine.
 * @template T - The type of the world object or model associated with the state.
 */
export class State<T extends Stateful = Stateful> implements Identifiable {
	public static TraceMap = new Map<Identifier, string[]>();

	/** Path parsing and diagnostics configuration. */
	public static pathConfig = {
		cacheSize: 256,
	};

	public static diagnostics = {
		/**
		 * If true, trace state transitions to the TraceMap for later inspection.
		 * The TraceMap maps state machine ids to arrays of transition descriptions.
		 * E.g. "StateMachine1: idle -> running (event: start)".
		 * It includes:
		 * - Whether guards passed or failed. These include guard functions and action definition evaluations.
		 * - Transition type (immediate, queued, deferred).
		 * - Transition trigger (e.g. event, input, direct (transition)).
		 */
		traceTransitions: true,
		/** Maximum number of entries kept per machine. Older entries are trimmed. */
		maxEntriesPerMachine: 512,
		/**
		 * If true, trace event dispatches to the TraceMap for later inspection.
		 * The TraceMap maps state machine ids to arrays of event dispatch descriptions.
		 * E.g. "StateMachine1: dispatch event 'jump' to state 'running'".
		 * It includes:
		 * - Whether the event was handled or not (i.e. if there was a handler for it).
		 * - The target state of the event, if any.
		 * - The source of the event (e.g. input, run check, etc.).
		 * - The event parameters.
		 * - The event timestamp.
		 * - The event handler function name, if any.
		 * - The transition type (immediate, queued, deferred).
		 * - Whether the event bubbled up.
		 */
		traceDispatch: true,
		/** When true, also mirror diagnostics to the console for live debugging. */
		mirrorToConsole: false,
	};

	/** Simple path parse cache. */
	private static _pathCache = new Map<string, { abs: boolean, up: number, segs: readonly string[] }>();
	private static _dumpHookRegistered = false;

	private static shouldTraceTransitions(): boolean {
		const diag = State.diagnostics;
		return !!diag && diag.traceTransitions === true;
	}

	private static shouldTraceDispatch(): boolean {
		const diag = State.diagnostics;
		return !!diag && diag.traceDispatch === true;
	}

	private static appendTraceEntry(id: Identifier, message: string): void {
		State.ensureTraceDumpHook();
		const diag = State.diagnostics;
		if (!diag) return;
		let list = State.TraceMap.get(id);
		if (!list) {
			list = [];
			State.TraceMap.set(id, list);
		}
		list.push(message);
		const limit = Math.max(0, diag.maxEntriesPerMachine ?? 0);
		if (limit > 0 && list.length > limit) {
			list.splice(0, list.length - limit);
		}
		if (diag.mirrorToConsole) {
			// eslint-disable-next-line no-console
			console.debug(`[FSM:${id}] ${message}`);
		}
	}

	private static ensureTraceDumpHook(): void {
		if (State._dumpHookRegistered) return;
		State._dumpHookRegistered = true;
		if (typeof process === 'undefined' || typeof process.on !== 'function') return;
		process.once('exit', () => {
			if (!State.diagnostics) return;
			if (State.TraceMap.size === 0) return;
			try {
				const payload = JSON.stringify(Array.from(State.TraceMap.entries()), null, 2);
				// eslint-disable-next-line no-console
				console.log('[StateTraceDump]', payload);
			} catch (error) {
				// eslint-disable-next-line no-console
				console.log('[StateTraceDump]', '<<unserializable>>');
			}
		});
	}

	private static describePayload(payload?: EventPayload): string {
		if (payload === undefined) return 'undefined';
		if (payload === null) return 'null';
		if (typeof payload === 'string') return payload;
		if (typeof payload === 'number' || typeof payload === 'boolean') return String(payload);
		try {
			const json = JSON.stringify(payload);
			if (!json) return 'undefined';
			return json.length > 160 ? `${json.slice(0, 157)}…` : json;
		} catch (err) {
			return `[unserializable:${(err as Error).message}]`;
		}
	}

	private static cloneSnapshot(ctx?: TransitionDiagContext): TransitionDiagSnapshot | undefined {
		if (!ctx) return undefined;
		return {
			trigger: ctx.trigger,
			description: ctx.description,
			eventName: ctx.eventName,
			emitter: ctx.emitter,
			handlerName: ctx.handlerName,
			payloadSummary: ctx.payloadSummary,
			timestamp: ctx.timestamp,
			bubbled: ctx.bubbled,
			actionEvaluations: ctx.actionEvaluations ? [...ctx.actionEvaluations] : undefined,
			guardEvaluations: ctx.guardEvaluations ? ctx.guardEvaluations.map(g => ({ ...g })) : undefined,
			lastTransition: ctx.lastTransition ? { ...ctx.lastTransition } : undefined,
		};
	}

	/** Parse filesystem-like path: '/', './', '../', quoting via ["..."] with escapes. */
	public static parseFsPath(input: string): { abs: boolean, up: number, segs: readonly string[] } {
		const hit = State._pathCache.get(input);
		if (hit) {
			State._pathCache.set(input, hit);
			return hit;
		}

		const len = input.length;
		let i = 0;
		let abs = false;
		let up = 0;
		const segs: string[] = [];

		if (len === 0) return { abs: false, up: 0, segs: [] };

		if (input[i] === '/') { abs = true; i++; }

		if (!abs) {
			if (input.startsWith('./', i)) {
				i += 2;
			} else {
				while (input.startsWith('../', i)) { up++; i += 3; }
			}
		}

		const pushSeg = (s: string) => {
			if (s.length === 0 || s === '.') return;
			if (s === '..') {
				if (segs.length > 0) segs.pop();
				else up++;
				return;
			}
			segs.push(s);
		};

		while (i < len) {
			const c = input[i];
			if (c === '/') { i++; continue; }
			if (c === '[' && i + 1 < len && input[i + 1] === '"') {
				i += 2; // skip ["
				let seg = '';
				let closed = false;
				while (i < len) {
					const ch = input[i++];
					if (ch === '\\') {
						if (i < len) {
							const esc = input[i++];
							if (esc === '"') seg += '"';
							else if (esc === '/') seg += '/';
							else seg += esc;
						}
						continue;
					}
					if (ch === '"') { if (i < len && input[i] === ']') { i++; closed = true; break; } else { throw new Error(`Unterminated quoted segment in path '${input}'.`); } }
					seg += ch;
				}
				if (!closed) throw new Error(`Unterminated quoted segment in path '${input}'.`);
				pushSeg(seg);
				continue;
			}

			let start = i;
			while (i < len && input[i] !== '/') i++;
			pushSeg(input.slice(start, i));
		}

		if (State._pathCache.size >= State.pathConfig.cacheSize) {
			const firstKey = State._pathCache.keys().next().value as string | undefined;
			if (firstKey) State._pathCache.delete(firstKey);
		}
		const rec = { abs, up, segs: segs as readonly string[] };
		State._pathCache.set(input, rec);
		return rec;
	}

	private runWithTransitionContext<T>(factory: () => TransitionDiagContext, fn: (ctx?: TransitionDiagContext) => T): T {
		if (!State.shouldTraceTransitions()) return fn(undefined);
		const ctx = factory();
		if (!this.transitionContextStack) this.transitionContextStack = [];
		this.transitionContextStack.push(ctx);
		try {
			return fn(ctx);
		} finally {
			const stack = this.transitionContextStack;
			if (stack) {
				stack.pop();
				if (stack.length === 0) this.transitionContextStack = undefined;
			}
		}
	}

	private peekTransitionContext(): TransitionDiagContext | undefined {
		const stack = this.transitionContextStack;
		if (!stack || stack.length === 0) return undefined;
		return stack[stack.length - 1];
	}

	private appendActionEvaluation(detail: string): void {
		if (!State.shouldTraceTransitions()) return;
		const ctx = this.peekTransitionContext();
		if (!ctx) return;
		if (!ctx.actionEvaluations) ctx.actionEvaluations = [];
		ctx.actionEvaluations.push(detail);
	}

	private appendGuardEvaluation(detail: GuardEvaluation): void {
		if (!State.shouldTraceTransitions()) return;
		const ctx = this.peekTransitionContext();
		if (!ctx) return;
		if (!ctx.guardEvaluations) ctx.guardEvaluations = [];
		ctx.guardEvaluations.push(detail);
	}

	private recordTransitionOutcomeOnContext(outcome: TransitionOutcomeSnapshot): void {
		if (!State.shouldTraceTransitions()) return;
		const ctx = this.peekTransitionContext();
		if (!ctx) return;
		ctx.lastTransition = outcome;
		if (!ctx.transitions) ctx.transitions = [];
		ctx.transitions.push(outcome);
	}

	private resolveContextSnapshot(provided?: TransitionDiagSnapshot): TransitionDiagSnapshot | undefined {
		if (provided) return provided;
		return State.cloneSnapshot(this.peekTransitionContext());
	}

	private formatGuardDiagnostics(guard: TransitionGuardDiagnostics | undefined): string | undefined {
		if (!guard) return undefined;
		if (!guard.evaluations || guard.evaluations.length === 0) return undefined;
		return guard.evaluations.map(ev => {
			const status = ev.passed ? 'pass' : 'fail';
			const descriptor = ev.descriptor && ev.descriptor !== '<none>' ? `(${ev.descriptor})` : '';
			const note = ev.reason && !ev.passed ? `!${ev.reason}` : undefined;
			return `${ev.side}:${status}${descriptor}${note ? `[${note}]` : ''}`;
		}).join(',');
	}

	private formatActionEvaluations(context?: TransitionDiagSnapshot): string | undefined {
		if (!context || !context.actionEvaluations || context.actionEvaluations.length === 0) return undefined;
		return context.actionEvaluations.join(';');
	}

	private emitTransitionTrace(entry: TransitionTraceEntry): void {
		if (!State.shouldTraceTransitions()) return;
		const context = this.resolveContextSnapshot(entry.context);
		const message = this.composeTransitionTraceMessage({ ...entry, context });
		State.appendTraceEntry(this.id, message);
	}

	private composeTransitionTraceMessage(entry: TransitionTraceEntry & { context?: TransitionDiagSnapshot }): string {
		const parts: string[] = ['[transition]'];
		parts.push(`outcome=${entry.outcome}`);
		parts.push(`exec=${entry.execution}`);
		parts.push(`to='${entry.to}'`);
		if (entry.from !== undefined) parts.push(`from='${entry.from}'`);
		if (entry.context?.trigger) {
			const triggerDetail = entry.context.eventName ? `${entry.context.trigger}(${entry.context.eventName})` : entry.context.trigger;
			parts.push(`trigger=${triggerDetail}`);
		}
		if (entry.context?.description) parts.push(`desc=${entry.context.description}`);
		if (entry.context?.handlerName) parts.push(`handler=${entry.context.handlerName}`);
		if (entry.context?.emitter) parts.push(`emitter=${entry.context.emitter}`);
		if (entry.context?.bubbled) parts.push('bubbled=true');
		if (entry.reason) parts.push(`reason=${entry.reason}`);
		const guardSummary = this.formatGuardDiagnostics(entry.guard);
		if (guardSummary) parts.push(`guards=${guardSummary}`);
		const actionSummary = this.formatActionEvaluations(entry.context);
		if (actionSummary) parts.push(`actions=${actionSummary}`);
		if (entry.context?.payloadSummary) parts.push(`payload=${entry.context.payloadSummary}`);
		if (entry.queueSize !== undefined) parts.push(`queue=${entry.queueSize}`);
		if (entry.context?.timestamp) parts.push(`ts=${entry.context.timestamp}`);
		return parts.join(' ');
	}

	private createFallbackSnapshot(trigger: TransitionTrigger, description: string, payload?: EventPayload): TransitionDiagSnapshot {
		return {
			trigger,
			description,
			timestamp: $.platform.clock.now(),
			payloadSummary: payload !== undefined ? State.describePayload(payload) : undefined,
		};
	}

	private hydrateContext(snapshot: TransitionDiagSnapshot | undefined, trigger: TransitionTrigger, description: string): TransitionDiagContext {
		if (snapshot) {
			return {
				trigger: snapshot.trigger,
				description: snapshot.description ?? description,
				eventName: snapshot.eventName,
				emitter: snapshot.emitter,
				handlerName: snapshot.handlerName,
				payloadSummary: snapshot.payloadSummary,
				timestamp: snapshot.timestamp,
				bubbled: snapshot.bubbled,
				actionEvaluations: snapshot.actionEvaluations ? [...snapshot.actionEvaluations] : undefined,
				guardEvaluations: snapshot.guardEvaluations ? snapshot.guardEvaluations.map(g => ({ ...g })) : undefined,
				lastTransition: snapshot.lastTransition ? { ...snapshot.lastTransition } : undefined,
			};
		}
		return {
			trigger,
			description,
			timestamp: $.platform.clock.now(),
		};
	}

	private createEventContext(eventName: string, emitter: Identifier, payload?: EventPayload): TransitionDiagContext {
		return {
			trigger: 'event',
			description: `event:${eventName}`,
			eventName,
			emitter,
			timestamp: $.platform.clock.now(),
			payloadSummary: payload !== undefined ? State.describePayload(payload) : undefined,
		};
	}

	private createInputContext(pattern: string, playerIndex: number): TransitionDiagContext {
		return {
			trigger: 'input',
			description: `input:${pattern}`,
			timestamp: $.platform.clock.now(),
			payloadSummary: `player=${playerIndex}`,
		};
	}

	private createProcessInputContext(): TransitionDiagContext {
		return {
			trigger: 'process-input',
			description: 'process_input',
			timestamp: $.platform.clock.now(),
		};
	}

	private createTickContext(handlerName: string): TransitionDiagContext {
		return {
			trigger: 'tick',
			description: `tick:${handlerName}`,
			timestamp: $.platform.clock.now(),
		};
	}

	private createRunCheckContext(index: number): TransitionDiagContext {
		return {
			trigger: 'run-check',
			description: `run_check#${index}`,
			timestamp: $.platform.clock.now(),
		};
	}

	private createEnterContext(stateId: Identifier): TransitionDiagContext {
		return {
			trigger: 'enter',
			description: `enter:${stateId}`,
			timestamp: $.platform.clock.now(),
		};
	}

	private describeStringHandler(targetState: string): string {
		return `transition:${targetState}`;
	}

	private describeActionHandler(spec: StateEventDefinition | TickCheckDefinition): string {
		if (typeof spec.do === 'function') return spec.do.name || '<anonymous>';
		if (typeof spec.do === 'string') return `do:${spec.do}`;
		return 'handler';
	}

	private emitEventDispatchTrace(eventName: string, emitter: Identifier, detail: EventPayload | undefined, handled: boolean, bubbled: boolean, depth: number, context?: TransitionDiagSnapshot): void {
		if (!State.shouldTraceDispatch()) return;
		const ctx = context ?? this.createFallbackSnapshot('event', `event:${eventName}`, detail);
		const transition = ctx.lastTransition;
		const parts: string[] = ['[dispatch]'];
		parts.push(`event=${eventName}`);
		parts.push(`handled=${handled}`);
		parts.push(`bubbled=${bubbled}`);
		if (depth > 0) parts.push(`depth=${depth}`);
		parts.push(`emitter=${emitter}`);
		if (ctx.handlerName) parts.push(`handler=${ctx.handlerName}`);
		parts.push(`state=${this.currentid}`);
		if (transition) {
			parts.push(`target=${transition.to}`);
			parts.push(`transition=${transition.execution}`);
			if (transition.guardSummary) parts.push(`guards=${transition.guardSummary}`);
		}
		else {
			parts.push(`target=${this.currentid}`);
			parts.push('transition=none');
		}
		if (ctx.payloadSummary) parts.push(`payload=${ctx.payloadSummary}`);
		else if (detail !== undefined) parts.push(`payload=${State.describePayload(detail)}`);
		if (ctx.timestamp) parts.push(`ts=${ctx.timestamp}`);
		State.appendTraceEntry(this.id, parts.join(' '));
	}

	/**
	 * The unique identifier of this specific instance of the state machine.
	* @see {@link make_id}
	 */
	id: Identifier;

	/**
	 * Direct reference to parent state
	 */
	private parent_ref?: State;

	/**
	 * Direct reference to root state
	 */
	private root_ref?: State;

	/** Parent state of this state (machine). */
	public get parent(): State | undefined { return this.parent_ref; }
	/** Root state of this state (machine). */
	public get root(): State { return this.root_ref ?? this; }
	public get is_root(): boolean { return this.root === this; }

	/**
	 * id of the state machine definition, which is the id of the state machine as defined in the StateDefinitions for root machines, or the id of the state for substate machines
	 * Note that the localdef_id is not necessarily unique, as multiple state machines can have substates with the same id.
	 * Also note that the localdef_id is not necessarily unique, as multiple instances of the same state machine definition can exist in the world.
	 * For the unique instance id, use the `id` property.
	 * For the unique definition id, used the `definition.def_id` property.
	 * @see {@link StateDefinitions}
	 */
	localdef_id!: Identifier;

	def_id!: Identifier; // The unique definition id of this state in the StateDefinitions-library

	/**
	 * Represents the substates of the FSM.
	 */
	states: id2sstate;

	/**
	 * Indicates whether the state machine is running in parallel with the 'current' state machine as defined in {@link StateMachineController.current_machine}.
	 */
	get is_concurrent(): boolean { return !!this.definition.is_concurrent; }

	/**
	 * Identifier of the active child state.
	 *
	 * The first child registered via {@link populateStates} becomes current when a
	 * definition does not specify `initial`, mirroring how the controller keeps the
	 * first machine focused. When a state transitions into a non-concurrent child,
	 * the child in turn drives its own subtree; concurrent children are ticked in
	 * addition to this `currentid` and therefore do not steal focus.
	 */
	currentid!: Identifier; // Identifier of current state

	/** Ring buffer for previous states (history). */
	private _hist!: Identifier[];
	private _histHead!: number;
	private _histSize!: number;

	/**
	 * Indicates whether the execution is paused.
	 */
	paused: boolean; // Iff paused, skip 'onrun'

	/**
	 * This state machine reflects the (partial) state of the world object with the given id
	 * @see {@link World.getWorldObject}
	 */
	target_id: Identifier;

	/**
	 * Represents the state data for the state machine that is shared across its states.
	 */
	public data: { [key: string]: any; } = {};

	private timelineBindings?: StateTimelineBinding[];

	/**
	 * Returns the world object or model that this state machine is associated with.
	 */
	public get target(): T { return $.registry.get<T>(this.target_id); }

	/**
	 * Returns the current state of the FSM
	 */
	public get current(): State | undefined {
		if (!this.states) return undefined;
		return this.states[this.currentid];
	}

	/**
	 * Gets the definition of the current state machine.
	 * @returns The definition of the current state machine.
	 */
	public get definition(): StateDefinition { return this.definitionOrThrow(); }

	private timelineHost(): TimelineHost {
		return this.target as unknown as TimelineHost;
	}

	public timeline<T = unknown>(id: Identifier): Timeline<T> {
		const host = this.timelineHost();
		const instance = host.get_timeline<T>(id);
		if (!instance) {
			throw new Error(`[State] Timeline '${id}' not found for target '${host.id}'.`);
		}
		return instance;
	}

	private ensureTimelineDefinitions(): StateTimelineBinding[] {
		if (!this.timelineBindings) {
			const defs: Array<[string, StateTimelineConfig]> = this.definition.timelines
				? Object.entries(this.definition.timelines)
				: [];
			if (defs.length === 0) {
				this.timelineBindings = [];
			} else {
				const bindings: StateTimelineBinding[] = [];
				for (const [key, config] of defs) {
					bindings.push(this.createTimelineBinding(key, config as StateTimelineConfig));
				}
				this.timelineBindings = bindings;
			}
		}
		if (!this.timelineBindings || this.timelineBindings.length === 0) return this.timelineBindings ?? [];
		const host = this.timelineHost();
		for (const binding of this.timelineBindings) {
			if (binding.defined) continue;
			const timeline = binding.create();
			if (!timeline) {
				throw new Error(`[State] Timeline factory for '${binding.id}' returned no timeline.`);
			}
			if (timeline.id !== binding.id) {
				throw new Error(`[State] Timeline factory for '${binding.id}' returned timeline '${timeline.id}'.`);
			}
			host.define_timeline(timeline);
			binding.defined = true;
		}
		return this.timelineBindings;
	}

	private createTimelineBinding(key: string, config: StateTimelineConfig): StateTimelineBinding {
		const { autoplay = true, stop_on_exit = true, play_options, id } = config;
		if (typeof config.create !== 'function') {
			throw new Error(`[State] Timeline '${key}' is missing a create() factory.`);
		}
		return {
			id: (id ?? key) as Identifier,
			create: config.create,
			autoplay,
			stopOnExit: stop_on_exit,
			playOptions: play_options,
			defined: false,
		};
	}

	private activateStateTimelines(): void {
		const bindings = this.ensureTimelineDefinitions();
		if (bindings.length === 0) return;
		const host = this.timelineHost();
		for (const binding of bindings) {
			if (!binding.autoplay) continue;
			host.play_timeline(binding.id, binding.playOptions);
		}
	}

	private deactivateStateTimelines(): void {
		if (!this.timelineBindings || this.timelineBindings.length === 0) return;
		const host = this.timelineHost();
		for (const binding of this.timelineBindings) {
			if (!binding.stopOnExit) continue;
			host.stop_timeline(binding.id);
		}
	}

	/**
	 * Gets the id of the start state of the FSM.
	 * @returns The id of the start state of the FSM.
	 */
	public get start_state_id(): Identifier { return this.definition.initial; }

	/**
	 * Represents the counter for the critical section.
	 */
	private critical_section_counter: number;

	/**
	 * Indicates whether we are currently draining the transition queue.
	 */
	private is_processing_queue: boolean;

	/**
	 * Represents the transition queue of the state machine.
	 * @property {Array<{ state_id: Identifier, args: any[] }>} transition_queue - The array of transition objects.
	 */
	private transition_queue: TransitionQueueItem[];


	private transitionContextStack?: TransitionDiagContext[];

	private definitionOrThrow(): StateDefinition {
		if (!this.def_id) {
			throw new Error(`[State] Definition id not resolved for state '${this.localdef_id}' (target '${this.target_id}').`);
		}
		const def = StateDefinitions[this.def_id];
		if (!def) {
			throw new Error(`[State] Definition '${this.def_id}' is not registered for state '${this.id}'.`);
		}
		return def;
	}

	private childDefinitionOrThrow(childId: Identifier): StateDefinition {
		const def = this.definitionOrThrow();
		if (!def.states) {
			throw new Error(`[State] Definition '${def.def_id}' has no substates while resolving '${childId}'.`);
		}
		const child = this.resolveDefinitionChild(def, childId);
		if (!child) {
			throw new Error(`[State] Definition '${def.def_id}' is missing child '${childId}'.`);
		}
		return child;
	}

	private statesOrThrow(ctx: State = this): id2sstate {
		if (!ctx.states) {
			throw new Error(`[State] State '${ctx.id}' does not define substates.`);
		}
		return ctx.states;
	}

	private resolveDefinitionChild(def: StateDefinition, childId: Identifier): StateDefinition | undefined {
		const states = def.states;
		if (!states) return undefined;
		if (Object.prototype.hasOwnProperty.call(states, childId)) {
			return states[childId] as StateDefinition;
		}
		const aliasUnderscore = `_${childId}`;
		if (Object.prototype.hasOwnProperty.call(states, aliasUnderscore)) {
			return states[aliasUnderscore] as StateDefinition;
		}
		const aliasHash = `#${childId}`;
		if (Object.prototype.hasOwnProperty.call(states, aliasHash)) {
			return states[aliasHash] as StateDefinition;
		}
		return undefined;
	}

	private findChild(ctx: State, seg: string): { child: State | undefined, key: string | undefined } {
		const states = ctx.states;
		if (!states) return { child: undefined, key: undefined };
		if (Object.prototype.hasOwnProperty.call(states, seg)) {
			return { child: states[seg], key: seg };
		}
		const aliasUnderscore = `_${seg}`;
		if (Object.prototype.hasOwnProperty.call(states, aliasUnderscore)) {
			return { child: states[aliasUnderscore], key: aliasUnderscore };
		}
		const aliasHash = `#${seg}`;
		if (Object.prototype.hasOwnProperty.call(states, aliasHash)) {
			return { child: states[aliasHash], key: aliasHash };
		}
		return { child: undefined, key: undefined };
	}

	private ensureChild(ctx: State, seg: string): { child: State, key: string } {
		const resolved = this.findChild(ctx, seg);
		if (!resolved.child || !resolved.key) {
			if (!ctx.states) {
				throw new Error(`[State] State '${ctx.id}' does not define substates.`);
			}
			const children = Object.keys(ctx.states).join(', ');
			throw new Error(`No state '${seg}' under '${ctx.id}'. Children: ${children}`);
		}
		return { child: resolved.child, key: resolved.key };
	}

	/**
	 * Enters the critical section.
	 * Increments the critical section counter.
	 */
	private enterCriticalSection(): void {
		++this.critical_section_counter;
	}

	/**
	 * Decreases the critical section counter by 1 and processes the transition queue if the counter reaches 0.
	 * Throws an error if the counter becomes negative.
	 */
	private leaveCriticalSection(): void {
		--this.critical_section_counter;
		if (this.critical_section_counter === 0) {
			if (!this.is_processing_queue) this.process_transition_queue();
		}
		else if (this.critical_section_counter < 0) {
			throw new Error(`Critical section counter was lower than 0, which is obviously a bug. State: "${this.id}, StateDefId: "${this.localdef_id}.`);
		}
	}

	/**
	 * Executes a function within a critical section and ensures the section is exited.
	 */
	private withCriticalSection<T>(fn: () => T): T {
		this.enterCriticalSection();
		try { return fn(); }
		finally { this.leaveCriticalSection(); }
	}

	/**
	 * Processes the transition queue by transitioning to the next state in the queue.
	 * This method dequeues each state transition from the transition queue and transitions to the corresponding state.
	 */
	private process_transition_queue(): void {
		if (this.is_processing_queue) return;
		this.is_processing_queue = true;
		try {
			for (let i = 0; i < this.transition_queue.length; i++) {
				const t = this.transition_queue[i];
				if (State.shouldTraceTransitions()) {
					this.runWithTransitionContext(
						() => this.hydrateContext(t.diag, 'queue-drain', 'queued-execution'),
						() => {
							this.transitionToState(t.path, 'deferred');
						},
					);
				} else {
					this.transitionToState(t.path, 'deferred');
				}
			}
			this.transition_queue.length = 0;
		} finally {
			this.is_processing_queue = false;
		}
	}



	/**
	 * Gets the definition of the current state of the FSM.
	 * Note that the definition can be empty, as not all objects have a defined machine.
	 */
	public get current_state_definition(): StateDefinition {
		const currentState = this.current;
		if (!currentState) {
			throw new Error(`[State] Current state '${this.currentid}' is not active for '${this.id}'.`);
		}
		return currentState.definition;
	}

	/**
	 * Factory for creating new FSMs.
	 * @param localdef_id - id of the FSM definition to use for this machine.
	 * @param target_id - id of the object that is stated by this FSM. @see {@link World.getWorldObject}.
	 */
	public static create(localdef_id: Identifier, target_id: Identifier, parent?: State, root?: State): State {
		let result = new State({ localdef_id, target_id, parent, root });
		result.populateStates(); // Populate the states of the state machine with the states from the state machine definition (if any) and their states
		result.reset(true); // Reset the state machine to the start state to initialize the state machine and its substate machines

		return result;
	}

	/**
	 * Represents the context of a state in a finite state machine.
	 * Contains information about the current state, the state machine it belongs to, and any substate machines.
	 * @param def_id - id of the state machine definition to use for this machine.
	 * @param target_id - id of the object that is stated by this FSM. @see {@link World.getWorldObject}.
	 */
	constructor(opts: RevivableObjectArgs & { localdef_id: Identifier, target_id: Identifier, parent?: State, root?: State }) {
		if (opts.constructReason === 'revive') {
			// Only bind and populate states when not reviving, as reviving will call onLoadSetup which will do this.
			// And we need to ensure that the state's parents are already bound when reviving, because reviving may access parent state information.
			return;
		}

		this.localdef_id = opts.localdef_id ?? DEFAULT_BST_ID;
		this.target_id = opts.target_id;
		this.parent_ref = opts.parent;
		if (opts.root) {
			this.root_ref = opts.root;
		} else if (opts.parent) {
			this.root_ref = opts.parent.root;
		} else {
			this.root_ref = this;
		}

		if (!opts.target_id) {
			throw new Error(`[State] Missing target id while constructing state '${this.localdef_id}'.`);
		}

		if (opts.parent) {
			const childDef = opts.parent.childDefinitionOrThrow(this.localdef_id);
			this.def_id = childDef.def_id;
		} else {
			const rootDef = StateDefinitions[this.localdef_id];
			if (!rootDef) {
				throw new Error(`[State] Definition '${this.localdef_id}' not found while constructing root state for '${opts.target_id}'.`);
			}
			this.def_id = rootDef.def_id;
		}


		this.paused = false;
		this.id = this.make_id();
		State.appendTraceEntry(this.id, `[create] machine='${this.localdef_id}' target='${this.target_id}'`);
		this.transition_queue = [];
		this.critical_section_counter = 0;
		this.is_processing_queue = false;
		this._hist = new Array(BST_MAX_HISTORY);
		this._histHead = 0;
		this._histSize = 0;
		this.bind();
	}

	@onload
	/**
	 * Performs the setup logic when the component is loaded.
	 */
	public onLoadSetup(): void {
		this.bind();
		this.reapplyMarkersForCurrentFrame(true);
	}

	/**
	 * Starts the state machine by transitioning to the start state and triggering the enter event for that state.
	 * If there are no states defined, the state machine will not start and the method will return early.
	 * If there are states defined but no start state, an error will be thrown as the state machine cannot start without a start state.
	 */
	public start(): void {
		this.activateStateTimelines();
		const startStateId = this.start_state_id;
		if (!startStateId) {
			if (!this.states) return; // If there are no states defined, there is no start state to start the state machine with and we can return early
			throw new Error(`No start state defined for state machine '${this.id}', while the state machine has states defined.'`); // If there are states defined, but no start state, throw an error as we can't start the state machine
		}

		const states = this.states;
		if (!states) {
			throw new Error(`[State] start(): State '${this.id}' has no instantiated substates.`);
		}
		const startInstance = states[startStateId];
		if (!startInstance) throw new Error(`[State] start(): Start state '${startStateId}' not found in state machine '${this.id}'.`);
		const startStateDef = startInstance.definition;

		// Trigger the enter event for the start state. Note that there is no definition for the none-state, so we don't trigger the enter event for that state.
		this.withCriticalSection(() => {
			startInstance.activateStateTimelines();
			const enterStart = startStateDef.entering_state;
			let startNext: transition_target | void;
			if (typeof enterStart === 'function') {
				startNext = enterStart.call(this.target, startInstance);
			}
			startInstance.transitionToNextStateIfProvided(startNext);
		});

		// Start the state machine for the current active state recursively
		startInstance.start();
	}

	/**
	 * Runs the current state of the FSM.
	 * If the FSM is paused, this function does nothing.
	 * Calls the process_input function of the current state, if it exists, with the state_event_type.None event type.
	 * Calls the run function of the current state, if it exists, with the state_event_type.Run event type.
	 */
	tick(): void {
		if (!this.definition || this.paused) return;

		this._transitionsThisTick = 0;
		this.withCriticalSection(() => {
			this.in_tick = true;
			// Run states first
			this.runSubstateMachines();
			// Process input for the current state
			this.processInput();
			// Run the current state's logic
			this.runCurrentState();
			// Execute run checks
			this.doRunChecks();
			this.in_tick = false;
		});
	}

	/**
	 * Processes the input for the current state and transitions to the next state if provided.
	 */
	processInput(): void {
		if (this.paused) return;

		// Note that the input procesing is run first in the lowest substate, then in the parent state, and then in the parent of the parent state, and so on.
		// That is because the `runSubstateMachines` function is called before the `processInput` function, which means that the input processing is run in the states first.
		this.processInputForCurrentState();

		const processInput = this.definition.process_input;
		const next_state = typeof processInput === 'function'
			? this.runWithTransitionContext(
				() => {
					const ctx = this.createProcessInputContext();
					ctx.handlerName = processInput.name || '<anonymous>';
					return ctx;
				},
				() => processInput.call(this.target, this, EMPTY_GAME_EVENT),
			)
			: undefined;
		this.transitionToNextStateIfProvided(next_state);
	}

	/**
	 * Processes the player input 'events' for the current state.
	 * If the current state has an 'on_input' property, it checks if the input matches any of the input patterns and executes the corresponding handler.
	 * @returns {void}
	 */
	private processInputForCurrentState(): void {
		const inputHandlers = this.definition.input_event_handlers;
		if (!inputHandlers) return;

		const playerIndex = this.target.player_index ?? 1;
		const p = Input.instance.getPlayerInput(playerIndex);
		const evalMode = this.resolveInputEvaluationMode();

		for (const inputPattern in inputHandlers) {
			const handler = inputHandlers[inputPattern];
			if (!handler) continue;
			if (!p.checkActionTriggered(inputPattern)) continue;
			const handled = this.runWithTransitionContext(
				() => this.createInputContext(inputPattern, playerIndex),
				ctx => {
					if (ctx) ctx.handlerName = typeof handler === 'string' ? this.describeStringHandler(handler) : this.describeActionHandler(handler);
					return this.handleStateTransition(handler);
				},
			);
			if (handled && evalMode === 'first') break;
		}
	}

	private resolveInputEvaluationMode(): 'first' | 'all' {
		let node: State<any> | undefined = this;
		while (node) {
			const mode = node.definition.input_eval;
			if (mode === 'first' || mode === 'all') return mode;
			node = node.parent;
		}
		return 'all';
	}

	/**
	 * Runs the current state of the state machine.
	 * If the state has a `run` function defined in its definition, it calls that function.
	 * If the `run` function returns a next state, it transitions to that state.
	 * If the `run` function does not return a next state and `auto_tick` is enabled in the state definition, it increments the `ticks` counter.
	 */
	private runCurrentState(): void {
		const tickHandler = this.definition.tick;
		const next_state = typeof tickHandler === 'function'
			? this.runWithTransitionContext(
				() => this.createTickContext(tickHandler.name || '<anonymous>'),
					() => tickHandler.call(this.target, this, EMPTY_GAME_EVENT),
			)
			: undefined;
		if (next_state) {
			this.transitionToNextStateIfProvided(next_state);
		}
	}

	/**
	 * Runs the substate machines.
	 */
	runSubstateMachines(): void {
		if (!this.states) return;

		const states = this.states;
		const cur = states[this.currentid];
		if (!cur) {
			throw new Error(`[State] Current state '${this.currentid}' not found in '${this.id}'.`);
		}
		cur.tick();
		// Parallel states run alongside the focused branch without stealing
		// `currentid`, providing the same behaviour as controller-level concurrent
		// machines.
		for (const [id, s] of Object.entries(states)) {
			if (id !== this.currentid && s.is_concurrent) s.tick();
		}
	}

	/**
	 * Perform the run checks for the current state.
	 * @returns {void}
	 */
	doRunChecks(): void {
		if (this.paused) return;

		// Run checks in the current state.
		// Note that the run checks are run first in the lowest substate, then in the parent state, and then in the parent of the parent state, and so on.
		// That is because the `runSubstateMachines` function is called before the `doRunChecks` function, which means that the run checks are run in the states first.
		this.runChecksForCurrentState();
	}

	/**
	 * Executes the run checks defined in the state machine definition.
	 * If a run check condition is met, it might transition to the next state based on the provided logic.
	 */
	runChecksForCurrentState(): void {
		const checks = this.definition.run_checks;
		if (!checks) return;

		let index = 0;
		for (const rc of checks) {
			const handled = this.runWithTransitionContext(
				() => this.createRunCheckContext(index),
				ctx => {
					if (ctx) ctx.handlerName = this.describeActionHandler(rc);
					return this.handleStateTransition(rc);
				},
			);
			if (handled) break; // First passing check wins
			index++;
		}
	}

	/**
	 * Transition to a new state identified by the given ID. If the ID contains multiple parts separated by '/', it traverses through the states accordingly and switches the state of each part.
	 * If no parts are provided, the ID will be split by '/' to determine the parts.
	 * @param path - The ID of the state to transition to.
	 * @throws Error if the state with the given ID does not exist.
	 */
	public transition_to_path(path: string | string[]): void {
		if (Array.isArray(path)) {
			if (path.length === 0) throw new Error(`Empty path is invalid.`);
			let ctx: State = this;
			for (const seg of path) {
				const { child, key } = this.ensureChild(ctx, seg);
				if (!child.is_concurrent && ctx.currentid !== key) ctx.transitionToState(key);
				ctx = child;
			}
			return;
		}

		const spec = State.parseFsPath(path);
		if (!spec.abs && spec.up === 0 && spec.segs.length === 0) {
			throw new Error(`Empty path is invalid.`);
		}
		let ctx: State = spec.abs ? this.root : this;
		for (let u = 0; u < spec.up; u++) {
			if (!ctx.parent) throw new Error(`Path '${path}' attempts to go above root.`);
			ctx = ctx.parent;
		}

		for (let i = 0; i < spec.segs.length; i++) {
			const seg = spec.segs[i];
			const { child, key } = this.ensureChild(ctx, seg);
			if (!child.is_concurrent && ctx.currentid !== key) ctx.transitionToState(key);
			ctx = child;
		}
	}

	public transition_to(state_id: Identifier): void {
		this.transition_to_path(state_id);
	}

	public get path(): string {
		if (this.is_root) return '/';
		const segments: string[] = [];
		let node: State | undefined = this;
		while (node && !node.is_root) {
			segments.push(node.currentid);
			node = node.parent;
		}
		return '/' + segments.reverse().join('/');
	}

	/**
	 * Checks if the current state matches the given path.
	 * Supports filesystem style (":/", "/", "./", "../") and array of segments.
	 */
	public matches_state_path(path: string | string[]): boolean {
		const matchSegments = (start: State, segments: readonly string[]): boolean => {
			if (segments.length === 0) return false;
			let ctx = start;
			for (let i = 0; i < segments.length; i++) {
				const seg = segments[i];
				const { child, key } = this.findChild(ctx, seg);
				if (!child || !key) return false;
				if (!child.is_concurrent && ctx.currentid !== key) return false;
				if (i === segments.length - 1) return true;
				ctx = child;
			}
			return false;
		};

		if (Array.isArray(path)) {
			return matchSegments(this, path);
		}

		const spec = State.parseFsPath(path);
		let ctx: State = spec.abs ? this.root : this;
		for (let u = 0; u < spec.up; u++) {
			if (!ctx.parent) return false;
			ctx = ctx.parent;
		}
		return matchSegments(ctx, spec.segs);
	}

	/**
	 * Checks the state guards of the current state and the target state.
	 * If the current state has a canExit guard and it returns false, the transition is prevented.
	 * If the target state has a canEnter guard and it returns false, the transition is prevented.
	 * If all guards pass, the transition is allowed.
	 * @param target_state_id - The identifier of the target state.
	 * @returns true if the transition is allowed, false otherwise.
	 */
	private checkStateGuardConditions(target_state_id: Identifier): TransitionGuardDiagnostics {
		let allowed = true;
		const evaluations: GuardEvaluation[] = [];

		const curDef = this.current_state_definition;
		const exitGuardDef = curDef.transition_guards;
		const exitGuard = exitGuardDef ? exitGuardDef.can_exit : undefined;
		if (typeof exitGuard === 'function') {
			const passed = exitGuard.call(this.target, this);
			const evaluation: GuardEvaluation = {
				side: 'exit',
				descriptor: exitGuard.name || '<anonymous>',
				passed,
				defined: true,
				type: 'function',
				reason: passed ? undefined : 'exit guard returned false',
			};
			this.appendGuardEvaluation({ ...evaluation });
			evaluations.push(evaluation);
			if (!passed) allowed = false;
		} else {
			const evaluation: GuardEvaluation = exitGuard === undefined
				? { side: 'exit', descriptor: '<none>', passed: true, defined: false, type: 'missing' }
				: {
					side: 'exit',
					descriptor: String(exitGuard),
					passed: true,
					defined: true,
					type: typeof exitGuard === 'string' ? 'string' : 'other',
					reason: 'non-callable guard ignored',
				};
			this.appendGuardEvaluation({ ...evaluation });
			evaluations.push(evaluation);
		}

		if (!allowed) {
			const evaluation: GuardEvaluation = {
				side: 'enter',
				descriptor: '<not-evaluated>',
				passed: false,
				defined: false,
				type: 'missing',
				reason: 'enter guard skipped due to exit guard failure',
			};
			this.appendGuardEvaluation({ ...evaluation });
			evaluations.push(evaluation);
			return { allowed, evaluations };
		}

		const states = this.statesOrThrow();
		const tgt = states[target_state_id];
		if (!tgt) {
			throw new Error(`[State] Target state '${target_state_id}' not found under '${this.id}'.`);
		}
		const enterGuardDef = this.childDefinitionOrThrow(target_state_id).transition_guards;
		const enterGuard = enterGuardDef ? enterGuardDef.can_enter : undefined;
		if (typeof enterGuard === 'function') {
			const passed = enterGuard.call(this.target, tgt);
			const evaluation: GuardEvaluation = {
				side: 'enter',
				descriptor: enterGuard.name || '<anonymous>',
				passed,
				defined: true,
				type: 'function',
				reason: passed ? undefined : 'enter guard returned false',
			};
			this.appendGuardEvaluation({ ...evaluation });
			evaluations.push(evaluation);
			if (!passed) allowed = false;
		} else {
			const evaluation: GuardEvaluation = enterGuard === undefined
				? { side: 'enter', descriptor: '<none>', passed: true, defined: false, type: 'missing' }
				: {
					side: 'enter',
					descriptor: String(enterGuard),
					passed: true,
					defined: true,
					type: typeof enterGuard === 'string' ? 'string' : 'other',
					reason: 'non-callable guard ignored',
				};
			this.appendGuardEvaluation({ ...evaluation });
			evaluations.push(evaluation);
		}

		return { allowed, evaluations };
	}

	/**
	 * Transition to the specified state.
	 * If the return value of the enter function is a string, it is assumed to be the ID of the next state to transition to.
	 *
	 * @param state_id - The identifier of the state to transition to.
	 * @param args - Optional arguments to pass to the state's enter and exit actions.
	 * @throws Error - If the state with the specified ID doesn't exist or if the target state is parallel.
	 */
	private _transitionsThisTick = 0;
	private in_tick = false;
	private static readonly MAX_TRANSITIONS_PER_TICK = 1000;

	private transitionToState(state_id: Identifier, execMode: TransitionExecutionMode = 'immediate'): void {
		if (this.in_tick) {
			if (++this._transitionsThisTick > State.MAX_TRANSITIONS_PER_TICK) {
				throw new Error(`Transition limit exceeded in one tick for '${this.id}'.`);
			}
		}

		const diagEnabled = State.shouldTraceTransitions();

		if (this.critical_section_counter > 0 && execMode === 'immediate') {
			if (diagEnabled) {
				const context = this.resolveContextSnapshot(undefined) ?? this.createFallbackSnapshot('manual', 'queued-transition');
				const outcome: TransitionOutcomeSnapshot = { from: this.currentid, to: state_id, execution: 'queued', status: 'queued', reason: 'critical-section' };
				this.recordTransitionOutcomeOnContext(outcome);
				this.emitTransitionTrace({ outcome: 'queued', execution: 'queued', from: this.currentid, to: state_id, context, queueSize: this.transition_queue.length + 1, reason: 'critical-section' });
				this.transition_queue.push({ path: state_id, diag: context });
			} else {
				this.transition_queue.push({ path: state_id });
			}
			return;
		}

		if (this.currentid === state_id) {
			if (diagEnabled) {
				const context = this.resolveContextSnapshot(undefined) ?? this.createFallbackSnapshot(execMode === 'deferred' ? 'queue-drain' : 'manual', 'noop-transition');
				this.recordTransitionOutcomeOnContext({ from: this.currentid, to: state_id, execution: execMode, status: 'noop', reason: 'already-current' });
				this.emitTransitionTrace({ outcome: 'noop', execution: execMode, from: this.currentid, to: state_id, context, reason: 'already-current' });
			}
			return;
		}

		const guardDiagnostics = this.checkStateGuardConditions(state_id);
		if (!guardDiagnostics.allowed) {
			if (diagEnabled) {
				const context = this.resolveContextSnapshot(undefined) ?? this.createFallbackSnapshot(execMode === 'deferred' ? 'queue-drain' : 'manual', 'guard-blocked');
				const outcome: TransitionOutcomeSnapshot = { from: this.currentid, to: state_id, execution: execMode, status: 'blocked', guardSummary: this.formatGuardDiagnostics(guardDiagnostics) };
				this.recordTransitionOutcomeOnContext(outcome);
				this.emitTransitionTrace({ outcome: 'blocked', execution: execMode, from: this.currentid, to: state_id, context, guard: guardDiagnostics, reason: 'guard' });
			}
			return;
		}

		this.withCriticalSection(() => {
			const prevId = this.currentid;
			const prevDef = this.current_state_definition;
			const prevStates = this.statesOrThrow();
			const prevInstance = prevStates[prevId];
			if (!prevInstance) {
				throw new Error(`[State] Previous state '${prevId}' not found in '${this.id}'.`);
			}

		const exitHandler = prevDef.exiting_state;
		if (typeof exitHandler === 'function') {
			exitHandler.call(this.target, prevInstance);
		}
		prevInstance.deactivateStateTimelines();
		this.pushHistory(prevId);

		this.currentid = state_id;
		const cur = this.current;
			if (!cur) {
				throw new Error(`[State] State '${this.id}' transitioned to '${state_id}' but the instance was not created.`);
			}
			const curDef = this.current_state_definition;
			if (curDef.is_concurrent) throw new Error(`Cannot transition to parallel state '${state_id}'!`);

		cur.activateStateTimelines();
		const enterHandler = curDef.entering_state;
			const next = typeof enterHandler === 'function'
				? this.runWithTransitionContext(
					() => {
						const ctx = this.createEnterContext(state_id);
						ctx.handlerName = enterHandler.name || '<anonymous>';
						return ctx;
					},
					() => enterHandler.call(this.target, cur),
				)
				: undefined;
			cur.transitionToNextStateIfProvided(next);

			if (diagEnabled) {
				const outcome: TransitionOutcomeSnapshot = { from: prevId, to: state_id, execution: execMode, status: 'success', guardSummary: this.formatGuardDiagnostics(guardDiagnostics) };
				this.recordTransitionOutcomeOnContext(outcome);
				this.emitTransitionTrace({ outcome: 'success', execution: execMode, from: prevId, to: state_id, guard: guardDiagnostics });
			}
		});
	}

	/**
	 * Dispatches an event to the state machine.
	 * If the state machine is paused, the event will not be processed.
	 * If the current state has child states, the event will be dispatched to the child states.
	 * If the current state does not have child states, the event will be dispatched to the parent states.
	 * @param eventName - The name of the event to dispatch.
	 * @param emitter_id - The identifier of the event emitter.
	 * @param args - Additional arguments to pass to the event handlers.
	 */
	public dispatch_event(event: GameEvent): boolean {
		if (this.paused) return false;

		const eventName = event.type;
		const emitterId = resolveEmitterId(event, this.target_id);
		const detail = resolveEventPayload(event);

		const hasChildren = !!this.states && Object.keys(this.states).length > 0;
		if (hasChildren) {
			const states = this.statesOrThrow();
			const cur = states[this.currentid];
			if (!cur) {
				throw new Error(`[State] Current child '${this.currentid}' not found in '${this.id}' while dispatching '${eventName}'.`);
			}
			const parallels = Object.values(states).filter(s => s.is_concurrent);
			let handled = cur.dispatch_event(event);
			for (const s of parallels) handled = s.dispatch_event(event) || handled;
			if (handled) return true;
		}

		let current: State | undefined = this;
		let depth = 0;
		while (current) {
			const result = current.handleEvent(eventName, emitterId, detail, event);
			const bubbled = depth > 0 || (!result.handled && !!current.parent);
			current.emitEventDispatchTrace(eventName, emitterId, detail, result.handled, bubbled, depth, result.context);
			if (result.handled) return true;
			current = current.parent;
			depth++;
		}
		return false;
	}

	/**
	 * Transitions to the next state if provided.
	 *
	 * @param next_state - The identifier of the next state to transition to.
	 */
	private transitionToNextStateIfProvided(next_state: transition_target | void): void {
		if (!next_state) return;
		if (isNoOpString(next_state)) return;
		this.transition_to(next_state);
	}

	/**
	 * Handles an event in the state.
	 * @param eventName - The name of the event.
	 * @param emitter_id - The identifier of the event emitter.
	 * @param args - Additional arguments for the event.
	 * @returns A boolean indicating whether the event was handled.
	 */
	private handleEvent(eventName: string, emitter_id: Identifier, detail: EventPayload | undefined, event?: GameEvent): EventDispatchResult {
		if (this.paused) return { handled: false };
		let capturedContext: TransitionDiagContext | undefined;
		const handled = this.withCriticalSection(() => this.runWithTransitionContext(
			() => this.createEventContext(eventName, emitter_id, detail),
			ctx => {
				capturedContext = ctx;
				const handlers = this.definition.on;
				if (!handlers) return false;
				const spec = handlers[eventName];
				if (!spec) return false;
				if (typeof spec === 'string') ctx.handlerName = this.describeStringHandler(spec);
				else {
					ctx.handlerName = this.describeActionHandler(spec);
				}
				return this.handleStateTransition(spec, event);
			},
		));
		if (!State.shouldTraceDispatch() && !State.shouldTraceTransitions()) return { handled };
		return { handled, context: State.cloneSnapshot(capturedContext) };
	}

	private handleStateTransition(action: Identifier | StateEventDefinition | TickCheckDefinition | undefined, event?: GameEvent): boolean {
		if (!action) return false;

		if (typeof action === 'string') {
			if (isNoOpString(action)) return true;
			this.transition_to(action);
			return true;
		}

		const doHandler = action.do;
		if (!doHandler) return false;

		switch (typeof doHandler) {
			case 'string':
				if (isNoOpString(doHandler)) return true;
				this.appendActionEvaluation(`do:string=${doHandler}`);
				this.transition_to(doHandler);
				return true;
			case 'function':
				const handlerEvent = (event ?? EMPTY_GAME_EVENT) as GameEvent;
				const next = doHandler.call(this.target, this as State<T>, handlerEvent) as transition_target | void;
				this.appendActionEvaluation(`do:${doHandler.name || '<anonymous>'}${next ? `->${next}` : ''}`);
				if (!next) return true;
				if (isNoOpString(next)) return true;
				this.transition_to(next);
				return true;
			default:
				return false;
		}
	}

	/**
	 * Adds the given state ID to the history stack, which tracks the previous states of the state machine.
	 * If the history stack exceeds the maximum length, the oldest state is removed from the stack.
	 * @param toPush - the state ID to add to the history stack
	 */
	protected pushHistory(toPush: Identifier): void {
		const cap = BST_MAX_HISTORY;
		const tailIndex = (this._histHead + this._histSize) % cap;
		this._hist[tailIndex] = toPush;
		if (this._histSize < cap) {
			this._histSize++;
		} else {
			// Buffer full: advance head to overwrite oldest
			this._histHead = (this._histHead + 1) % cap;
		}
	}

	/**
	 * Goes back to the previous state in the history stack.
	 * If there is no previous state, nothing happens.
	 */
	public pop_and_transition(): void {
		if (this._histSize <= 0) return;
		const cap = BST_MAX_HISTORY;
		const tailIndex = (this._histHead + this._histSize - 1 + cap) % cap;
		const poppedStateId = this._hist[tailIndex];
		this._histSize--;
		if (poppedStateId) this.transition_to(poppedStateId);
	}

	/** Returns a snapshot of the history ring buffer from oldest to newest. */
	public getHistorySnapshot(): Identifier[] {
		const out: Identifier[] = [];
		for (let i = 0; i < this._histSize; i++) {
			out.push(this._hist[(this._histHead + i) % BST_MAX_HISTORY]);
		}
		return out;
	}

	/**
	 * Populates the state machine with states defined in the state machine definition.
	 * If no state machine definition is defined, a default machine with a generated 'none'-state is created.
	 * If no current state is set, the state is set to the first state found in the set of states.
	 */
	public populateStates(): void {
		const sdef = this.definition;
		if (!sdef || !sdef.states) { // If no state machine definition is defined, don't populate the states
			this.states = undefined; // Set the states to undefined to denote that there are no states defined (as opposed to an empty object). Note that states should already be undefined, but just to be sure, set it to undefined here as well
			return; // Don't populate the states
		}
		const state_ids = Object.keys(sdef.states);
		if (state_ids.length === 0) { // If there are no states defined in the state machine definition, don't populate the states
			this.states = undefined;
			return;
		}

		this.states = {}; // Initialize the states object to an empty object
		for (let sdef_id in sdef.states) {
			let state = new State({ localdef_id: sdef_id, target_id: this.target_id, parent: this, root: this.root });
			this.add(state);
			state.populateStates(); // Populate the states of the state
		}
		// If no current state is set, set the state to the first state that it finds in the set of states
		if (!this.currentid) this.currentid = this.states ? Object.keys(this.states)[0] : undefined;
	}

	/**
	 * Adds the given states to the state machine.
	 * If a state with the same ID already exists in the state machine, an error is thrown.
	 * @param states - the states to add to the state machine
	 * @throws Error if a state with the same ID already exists in the state machine
	 */
	private add(...states: State[]): void {
		for (let state of states) {
			if (!state.localdef_id) throw new Error(`State is missing an id, while attempting to add it to this sstate '${this.localdef_id}'!`);
			if (this.states[state.localdef_id]) throw new Error(`State ${state.localdef_id} already exists for sstate '${this.localdef_id}'!`);
			this.states[state.localdef_id] = state;
		}
	}

	/**
	 * Generates a unique identifier for the current instance.
	 * The identifier is created by concatenating the parent machine's id (or the `target_id` for root machines) and the `def_id`.
	 * @returns The generated identifier.
	 */
	private make_id(): Identifier {
		let parentPart: Identifier;
		let thisPart: Identifier;
		if (this.is_root) {
			parentPart = this.target_id + '.';
			thisPart = this.localdef_id;
		}
		else {
			if (this.parent_ref.is_root) parentPart = this.parent_ref.id + ':/';
			else parentPart = this.parent_ref.id + '/';
			thisPart = this.localdef_id;
		}
		const id = parentPart + thisPart;
		return id;
	}

	/**
	 * Disposes the current state machine and deregisters it from the registry.
	 * Also deregisters all states.
	 */
	public dispose(): void {
		this.deactivateStateTimelines();
		// Also deregister all states
		if (!this.states) return;
		for (let state in this.states) {
			this.states[state].dispose();
		}
	}
	public bind(): void {
		Registry.instance.register(this);
	}

	public unbind(): void {
		Registry.instance.deregister(this);
	}
protected _ticks: number = 0;

public get ticks(): number {
	return this._ticks;
}

	public set ticks(v: number) {
		this._ticks = v;
	}

	public reapplyMarkersForCurrentFrame(recursive: boolean = false): void {
		if (!recursive || !this.states) return;
		for (const child of Object.values(this.states)) {
			child?.reapplyMarkersForCurrentFrame(true);
		}
	}

	/** Resets this state machine's local data and propagates reset to child machines when requested. */
	public reset(reset_tree: boolean = true): void {
		const def = this.definition;
		this.data = def.data ? { ...def.data } : {};
		if (reset_tree) this.resetSubmachine(); // Reset the substate machine if it exists
	}

	// Resets the state machine to its initial state.
	// If a start state is defined in the state machine definition, the current state is set to that state.
	// Otherwise, the current state is set to the 'none' state.
	// The history of previous states is cleared and the state machine is unpaused.
	public resetSubmachine(reset_tree: boolean = true): void {
		// N.B. doesn't trigger the onenter-event!
		const def = this.definition;
		const start = def.initial;
		this.currentid = start;
		// Reset history ring buffer
		this._histHead = 0;
		this._histSize = 0;
		this.paused = false;
		this.data = def.data ? { ...def.data } : {};
		if (reset_tree && this.states) {
			for (let state of Object.values(this.states)) {
				state.reset(reset_tree);
			}
		}
	}
}
function isNoOpString(value: string): boolean {
	if (!value) return false;
	const lower = value.trim().toLowerCase();
	return lower === 'no-op' || lower === 'noop' || lower === 'no_op';
}
