import type { HotResumeService } from '../execution/hot_resume';
import type { RuntimeGpuHistory } from '../../../runtime/gpu_history';
import { encodeGpuOperation } from './gpu_tool_protocol';
import type { RuntimeEventHistory } from '../../../runtime/event_history';
import { GteCommandSnapshot, type RuntimeGteHistory } from '../../../runtime/gte_history';
import type { IDisposable } from '../../../common/lifecycle';
import { encodeGteCommand } from './gte_tool_protocol';
import type { ActorExecutionService } from '../../contrib/actor_lab/execution';
import type { RuntimeDebuggerExecution } from '../../../runtime/debugger_execution';
import { DebuggerSourceContext } from './debugger_sources';
import { clearExecutionStopHighlights } from '../../../runtime_error/navigation';
import type { RuntimeInspection, RuntimeInspectionService } from '../../../runtime/inspection';
import type { GameImageCapture } from '../../../../hosts/common/image';
import type { RuntimeFrameNavigation } from '../../../runtime/frame_navigation';
import type { RuntimeLuaEvaluation } from '../../../runtime/lua_evaluation';
import { decodeRuntimeToolRequest, encodeHotResumeOperation, encodeBootOperation } from './runtime_tool_protocol';
import type { BootService } from '../execution/boot';
import { StudioToolInputError } from './tool_input';
import { ActorRuntimeInspection } from '../../contrib/actor_lab/runtime_inspection';

/** Prompt lifetime owns its borrows and finite operations, never the physical target. */
export class WorkspaceRuntimeTools {
	private readonly debugSources: DebuggerSourceContext;
	private inspection: RuntimeInspection | undefined;
	private actors: ActorRuntimeInspection | undefined;
	private gteObservation: IDisposable | undefined;
	private gpuObservation: IDisposable | undefined;
	private disposed = false;
	private readonly lifetime = new AbortController();
	private readonly onDisconnect = () => this.dispose();
	public constructor(private readonly owner: RuntimeInspectionService, private readonly navigation: RuntimeFrameNavigation,
		private readonly gameCapture: GameImageCapture, private readonly luaEvaluation: RuntimeLuaEvaluation, private readonly debuggerExecution: RuntimeDebuggerExecution, private readonly actorExecution: ActorExecutionService, private readonly boots: BootService, private readonly hotResumes: HotResumeService, private readonly events: RuntimeEventHistory, private readonly gte: RuntimeGteHistory, private readonly gpu: RuntimeGpuHistory, private readonly connection: AbortSignal) {
		connection.throwIfAborted();
		this.debugSources = new DebuggerSourceContext(debuggerExecution.state);
		connection.addEventListener('abort', this.onDisconnect, { once: true });
	}
	public execute(name: string, input: unknown, requestSignal?: AbortSignal) {
		if (this.disposed) throw new StudioToolInputError('Runtime tool context is disposed');
		const request = decodeRuntimeToolRequest(name, input);
		switch (request.name) {
			case 'studio_gpu_history':
			case 'studio_read_gpu_operations':
			case 'studio_read_gpu_words':
			case 'studio_seek_gpu_operation': {
				if (request.target !== this.owner.target) throw new StudioToolInputError('GPU history requires this authoring target.');
				requestSignal?.throwIfAborted();
				const history = this.gpu;
				if (request.name === 'studio_gpu_history') {
					if (request.action === 'start' && this.gpuObservation === undefined) this.gpuObservation = history.observe();
					else if (request.action === 'stop') { this.gpuObservation?.dispose(); this.gpuObservation = undefined; }
					else if (request.action === 'clear') history.clear();
					return { kind: 'runtime' as const, data: { target: this.owner.target, observing: history.observing,
						observingInContext: this.gpuObservation !== undefined, generation: history.generation,
						firstSequence: history.firstSequence, endSequence: history.endSequence, total: history.count,
						capacity: history.capacity, wordCount: history.wordCount, wordCapacity: history.wordCapacity, expired: history.expired } };
				}
				if (request.generation !== history.generation) throw new StudioToolInputError('GPU history generation changed; read the current generation.');
				if (request.sequence < history.firstSequence) throw new StudioToolInputError('GPU operation sequence expired; read the retained sequence window.');
				if (request.sequence > history.endSequence || request.name !== 'studio_read_gpu_operations' && request.sequence === history.endSequence) throw new StudioToolInputError('GPU operation sequence is beyond the published history.');
				if (request.name === 'studio_read_gpu_operations') {
					const count = Math.min(request.count, history.endSequence - request.sequence), operations = [];
					for (let offset = 0; offset < count; offset++) {
						const record = history.at(request.sequence + offset); operations.push(encodeGpuOperation(record, history.canSeek(record)));
					}
					return { kind: 'runtime' as const, data: { target: this.owner.target, generation: history.generation, firstSequence: history.firstSequence, endSequence: history.endSequence, operations } };
				}
				const record = history.at(request.sequence);
				if (request.name === 'studio_read_gpu_words') {
					if (request.offset > record.wordCount) throw new StudioToolInputError('GPU word offset is beyond this operation.');
					const count = Math.min(request.count, record.wordCount - request.offset), words = new Array<number>(count);
					history.copyWords(request.sequence, request.offset, words);
					return { kind: 'runtime' as const, data: { target: this.owner.target, generation: history.generation,
						sequence: request.sequence, offset: request.offset, nextOffset: request.offset + count, wordCount: record.wordCount, words } };
				}
				if (!history.canSeek(record)) throw new StudioToolInputError('The GPU operation has no reachable frame in the retained physical recording.');
				const sequence = record.sequence, cycles = record.cycles;
				const signal = requestSignal === undefined ? this.lifetime.signal : AbortSignal.any([this.lifetime.signal, requestSignal]);
				return this.navigation.seek(cycles, signal).completion.then(result => ({ kind: 'runtime' as const,
					data: { target: this.owner.target, generation: request.generation, sequence, requestedObservationCycles: cycles, ...result } }));
			}
			case 'studio_gte_history':
			case 'studio_read_gte_commands':
			case 'studio_seek_gte_command': {
				if (request.target !== this.owner.target) throw new StudioToolInputError('GTE history requires this authoring target.');
				requestSignal?.throwIfAborted();
				const history = this.gte;
				if (request.name === 'studio_gte_history') {
					if (request.action === 'start' && this.gteObservation === undefined) this.gteObservation = history.observe();
					else if (request.action === 'stop') { this.gteObservation?.dispose(); this.gteObservation = undefined; }
					else if (request.action === 'clear') history.clear();
					return { kind: 'runtime' as const, data: { target: this.owner.target, observing: history.observing,
						observingInContext: this.gteObservation !== undefined, generation: history.generation,
						firstSequence: history.firstSequence, endSequence: history.endSequence,
						total: history.count, capacity: history.capacity, expired: history.expired } };
				}
				if (request.generation !== history.generation) throw new StudioToolInputError('GTE history generation changed; read the current generation.');
				if (request.sequence < history.firstSequence) throw new StudioToolInputError('GTE command sequence expired; read the retained sequence window.');
				if (request.sequence > history.endSequence || request.name === 'studio_seek_gte_command' && request.sequence === history.endSequence) {
					throw new StudioToolInputError('GTE command sequence is beyond the published history.');
				}
				if (request.name === 'studio_seek_gte_command') {
					const record = history.at(request.sequence), sequence = record.sequence, cycles = record.cycles;
					if (!history.canSeek(record)) throw new StudioToolInputError('The GTE command has no reachable frame in the retained physical recording.');
					const signal = requestSignal === undefined ? this.lifetime.signal : AbortSignal.any([this.lifetime.signal, requestSignal]);
					const operation = this.navigation.seek(cycles, signal);
					return operation.completion.then(result => ({ kind: 'runtime' as const, data: { target: this.owner.target,
						generation: request.generation, sequence, requestedCommandCycles: cycles, ...result } }));
				}
				const count = Math.min(request.count, history.endSequence - request.sequence), commands = [];
				if (count !== 0) {
					const snapshot = new GteCommandSnapshot();
					for (let offset = 0; offset < count; offset++) {
						history.copy(request.sequence + offset, snapshot);
						commands.push(encodeGteCommand(snapshot, history.canSeek(snapshot)));
					}
				}
				return { kind: 'runtime' as const, data: { target: this.owner.target, generation: history.generation,
					firstSequence: history.firstSequence, endSequence: history.endSequence, commands } };
			}
			case 'studio_event_history':
			case 'studio_read_events':
			case 'studio_seek_event': {
				if (request.target !== this.owner.target) throw new StudioToolInputError('Event history requires this authoring target.');
				requestSignal?.throwIfAborted();
				const history = this.events;
				if (request.name !== 'studio_event_history') {
					if (request.generation !== history.generation) throw new StudioToolInputError('Event history was cleared; read the current generation.');
					if (request.sequence < history.firstSequence) throw new StudioToolInputError('Event sequence expired; read the retained sequence window.');
					if (request.sequence > history.endSequence) throw new StudioToolInputError('Event sequence is beyond the published history.');
					if (request.name === 'studio_seek_event') {
						if (request.sequence === history.endSequence) throw new StudioToolInputError('Event sequence is beyond the published history.');
						const event = history.at(request.sequence);
						if (!history.canSeek(event)) throw new StudioToolInputError('The event has no reachable frame in the retained physical recording.');
						const signal = requestSignal === undefined ? this.lifetime.signal : AbortSignal.any([this.lifetime.signal, requestSignal]);
						const operation = this.navigation.seek(event.cycles, signal);
						return operation.completion.then(result => ({ kind: 'runtime' as const, data: { target: this.owner.target,
							generation: request.generation, sequence: event.sequence, ...result } }));
					}
					const end = Math.min(history.endSequence, request.sequence + request.count);
					const events = [];
					for (let sequence = request.sequence; sequence < end; sequence++) events.push(history.at(sequence));
					return { kind: 'runtime' as const, data: { target: this.owner.target, generation: history.generation,
						firstSequence: history.firstSequence, endSequence: history.endSequence, events } };
				}
				if (request.action === 'clear') history.clear();
				return { kind: 'runtime' as const, data: { target: this.owner.target, status: history.status,
					generation: history.generation, firstSequence: history.firstSequence, endSequence: history.endSequence,
					total: history.count, capacity: history.capacity, expired: history.expired } };
			}
			case 'studio_hot_resume': {
				if (request.target !== this.owner.target) throw new StudioToolInputError('Hot Resume requires this authoring target.');
				const signal = requestSignal === undefined ? this.lifetime.signal : AbortSignal.any([this.lifetime.signal, requestSignal]);
				const operation = this.hotResumes.resume('workbench', signal);
				return operation.admission.then(admission => ({ kind: 'runtime' as const, data: { target: this.owner.target,
					admission: admission.status, ...encodeHotResumeOperation(operation) } }));
			}
			case 'studio_reboot_runtime': {
				if (request.target !== this.owner.target) throw new StudioToolInputError('Reboot requires this authoring target.');
				const signal = requestSignal === undefined ? this.lifetime.signal : AbortSignal.any([this.lifetime.signal, requestSignal]);
				const operation = this.boots.reboot(undefined, signal);
				return operation.completion.then(() => ({ kind: 'runtime' as const, data: { target: this.owner.target, ...encodeBootOperation(operation) } }));
			}
			case 'studio_actor_execution_status': case 'studio_control_actor': {
				if (request.target !== this.owner.target) throw new StudioToolInputError('Actor execution requires this authoring target.');
				const service = this.actorExecution;
				if (request.name === 'studio_actor_execution_status') return { kind: 'runtime' as const, data: { target: this.owner.target,
					canExecute: service.canExecute, canControl: service.canControl, active: service.active === undefined ? undefined : service.observe(service.active),
					lastResult: service.lastResult === undefined ? undefined : service.observe(service.lastResult) } };
				const signal = requestSignal === undefined ? this.lifetime.signal : AbortSignal.any([this.lifetime.signal, requestSignal]);
				signal.throwIfAborted();
				const operation = service.active;
				if (operation === undefined || operation.id !== request.operation) throw new StudioToolInputError('Actor operation is no longer active.');
				service.setPaused(operation, request.action === 'pause');
				return service.waitForStop(operation, signal).then(data => ({ kind: 'runtime' as const, data: { target: this.owner.target, ...data } }));
			}
			case 'studio_list_actor_operations': case 'studio_actor_action': case 'studio_call_actor_method': {
				if (this.actors === undefined) throw new StudioToolInputError('Inspect the actual actor tree before requesting its operations.');
				if (request.name === 'studio_list_actor_operations') return { kind: 'runtime' as const,
					data: { ...this.actors.operations(request.node), canExecute: this.actorExecution.canExecute } };
				const signal = requestSignal === undefined ? this.lifetime.signal : AbortSignal.any([this.lifetime.signal, requestSignal]);
				signal.throwIfAborted();
				const invocation = this.actors.invocation(request.node, request.name === 'studio_actor_action' ? 'action' : 'method', request.method, request.arguments);
				const operation = this.actorExecution.start(invocation, { signal });
				return this.actorExecution.waitForStop(operation, signal).then(data => ({ kind: 'runtime' as const, data: { target: this.owner.target, ...data } }));
			}
			case 'studio_list_actors': case 'studio_read_actor_tree': case 'studio_read_actor_node': {
				const inspection = this.inspection;
				if (inspection === undefined || request.name === 'studio_list_actors' && inspection.id !== request.inspection) {
					throw new StudioToolInputError('Actor reads require the current suspended inspection');
				}
				if (this.actors === undefined) {
					inspection.requireSuspended();
					this.actors = inspection.lifetime.add(new ActorRuntimeInspection(inspection));
				}
				const data = request.name === 'studio_list_actors' ? this.actors.list(request.start, request.count)
					: request.name === 'studio_read_actor_tree' ? this.actors.tree(request.actor, request.start, request.count) : this.actors.read(request.node);
				return { kind: 'runtime' as const, data };
			}
			case 'studio_terminal_status':
			case 'studio_evaluate_lua':
			case 'studio_evaluate_frame':
			case 'studio_control_lua': {
				if (request.target !== this.owner.target) throw new StudioToolInputError('Target is not this Studio authoring runtime');
				if (request.name === 'studio_terminal_status') return { kind: 'runtime' as const, data: {
					target: this.owner.target, canEvaluate: this.luaEvaluation.canEvaluate, canControl: this.luaEvaluation.canToggleExecution,
					active: this.luaEvaluation.active === undefined ? undefined : this.luaEvaluation.observe(this.luaEvaluation.active),
					lastResult: this.luaEvaluation.lastResult === undefined ? undefined : this.luaEvaluation.observe(this.luaEvaluation.lastResult),
				} };
				const signal = requestSignal === undefined ? this.lifetime.signal : AbortSignal.any([this.lifetime.signal, requestSignal]);
				signal.throwIfAborted();
				let operation;
				if (request.name === 'studio_evaluate_lua') operation = this.luaEvaluation.evaluate(request.source, request.context);
				else if (request.name === 'studio_evaluate_frame') {
					if (this.inspection === undefined) throw new StudioToolInputError('Open a suspended inspection before evaluating a frame');
					const frame = this.inspection.stackFrame(request.frame);
					operation = this.luaEvaluation.evaluate(request.source, this.luaEvaluation.frameContext(frame));
				} else {
					operation = this.luaEvaluation.active;
					if (operation === undefined || operation.id !== request.evaluation) throw new StudioToolInputError('Lua evaluation is no longer active');
					this.luaEvaluation.setPaused(operation, request.action === 'pause');
				}
				return this.luaEvaluation.waitForStop(operation, signal).then(result => ({ kind: 'runtime' as const,
					data: { target: this.owner.target, ...result } }));
			}
			case 'studio_runtime_status': return { kind: 'runtime' as const, data: { ...this.owner.status(),
				hotResume: this.hotResumes.latestOperation === null ? undefined : encodeHotResumeOperation(this.hotResumes.latestOperation),
				boot: this.boots.latestOperation === null ? undefined : encodeBootOperation(this.boots.latestOperation),
				debugger: { active: this.debuggerExecution.active?.mode, canContinue: this.debuggerExecution.canResume('continue'),
					canStepInto: this.debuggerExecution.canResume('into'), canStepOver: this.debuggerExecution.canResume('over'), canStepOut: this.debuggerExecution.canResume('out') } } };
			case 'studio_list_debug_sources':
			case 'studio_resume_debugger': {
				if (request.target !== this.owner.target) throw new StudioToolInputError('Target is not this Studio authoring runtime');
				if (request.name === 'studio_list_debug_sources') return { kind: 'runtime' as const, data: this.debugSources.list() };
				const signal = requestSignal === undefined ? this.lifetime.signal : AbortSignal.any([this.lifetime.signal, requestSignal]);
				const operation = this.debuggerExecution.resume(request.mode, 'workbench', signal);
				clearExecutionStopHighlights();
				return operation.completion.then(result => ({ kind: 'runtime' as const, data: { target: this.owner.target, ...result } }));
			}
			case 'studio_read_debug_source': return { kind: 'runtime' as const, data: this.debugSources.read(request.source) };
			case 'studio_set_breakpoints': return { kind: 'runtime' as const, data: this.debugSources.setBreakpoints(request.source, request.lines) };
			case 'studio_step_frames':
			case 'studio_seek_history': {
				if (request.target !== this.owner.target) throw new StudioToolInputError('Target is not this Studio authoring runtime');
				const signal = requestSignal === undefined ? this.lifetime.signal : AbortSignal.any([this.lifetime.signal, requestSignal]);
				const operation = request.name === 'studio_step_frames'
					? this.navigation.step(request.direction, request.count, signal)
					: this.navigation.seek(request.cycles, signal);
				return operation.completion.then(result => ({ kind: 'runtime' as const, data: { target: this.owner.target, ...result } }));
			}
			case 'studio_pause_runtime':
			case 'studio_capture_game':
			case 'studio_inspect_runtime': {
				if (request.target !== this.owner.target) throw new StudioToolInputError('Target is not this Studio authoring runtime');
				if (request.name === 'studio_capture_game') {
					const signal = requestSignal === undefined ? this.lifetime.signal : AbortSignal.any([this.lifetime.signal, requestSignal]);
					return this.owner.capture(this.gameCapture, signal).then(image => ({ kind: 'image' as const, images: [image.imageUrl],
						data: { observation: image.observation, published: image.published, width: image.width, height: image.height,
							view: 'completed-game-before-crt-and-host-overlays' as const } }));
				}
				if (request.name === 'studio_pause_runtime') return { kind: 'runtime' as const, data: this.owner.pause() };
				const signal = requestSignal === undefined ? this.lifetime.signal : AbortSignal.any([this.lifetime.signal, requestSignal]);
				return this.owner.openAfterTasks(signal).then(inspection => {
					// Cancellation can race the acquisition promise before this owner publishes it.
					if (signal.aborted) { inspection.dispose(); signal.throwIfAborted(); }
					this.inspection?.dispose();
					this.actors = undefined;
					this.inspection = inspection;
					return { kind: 'runtime' as const, data: { ...inspection.state, inspection: inspection.id,
						coverage: { globals: 'installed-bindings' as const, stack: 'current-cpu' as const }, scopes: inspection.scopes } };
				});
			}
			case 'studio_read_runtime_values': {
				if (this.inspection === undefined) throw new StudioToolInputError('Open a suspended inspection before reading values');
				return { kind: 'runtime' as const, data: this.inspection.read(request.reference, request.start, request.count) };
			}
			case 'studio_read_runtime_stack': {
				if (this.inspection === undefined || this.inspection.id !== request.inspection) throw new StudioToolInputError('Stack reads require the current suspended inspection');
				return { kind: 'runtime' as const, data: this.inspection.readStack(request.start, request.count) };
			}
			case 'studio_read_frame_scopes': {
				if (this.inspection === undefined) throw new StudioToolInputError('Open a suspended inspection before reading frame scopes');
				return { kind: 'runtime' as const, data: this.inspection.frameScopes(request.frame) };
			}
		}
	}
	public dispose(): void {
		this.disposed = true;
		this.lifetime.abort();
		this.debugSources.dispose();
		this.gteObservation?.dispose(); this.gteObservation = undefined;
		this.gpuObservation?.dispose(); this.gpuObservation = undefined;
		this.connection.removeEventListener('abort', this.onDisconnect);
		this.inspection?.dispose(); this.inspection = undefined;
		this.actors = undefined;
	}
}
