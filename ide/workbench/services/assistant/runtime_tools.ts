import type { ActorExecutionService } from '../../contrib/actor_lab/execution';
import type { RuntimeDebuggerExecution } from '../../../runtime/debugger_execution';
import { DebuggerSourceContext } from './debugger_sources';
import { clearExecutionStopHighlights } from '../../../runtime_error/navigation';
import type { RuntimeInspection, RuntimeInspectionService } from '../../../runtime/inspection';
import type { GameImageCapture } from '../../../../hosts/common/image';
import type { RuntimeFrameNavigation } from '../../../runtime/frame_navigation';
import type { LuaTerminalSession } from '../terminal/session';
import { decodeRuntimeToolRequest, encodeBootOperation } from './runtime_tool_protocol';
import type { BootService } from '../execution/boot';
import { StudioToolInputError } from './tool_input';
import { ActorRuntimeInspection } from '../../contrib/actor_lab/runtime_inspection';

/** Prompt lifetime owns its borrows and finite operations, never the physical target. */
export class WorkspaceRuntimeTools {
	private readonly debugSources: DebuggerSourceContext;
	private inspection: RuntimeInspection | undefined;
	private actors: ActorRuntimeInspection | undefined;
	private disposed = false;
	private readonly lifetime = new AbortController();
	private readonly onDisconnect = () => this.dispose();
	public constructor(private readonly owner: RuntimeInspectionService, private readonly navigation: RuntimeFrameNavigation,
		private readonly gameCapture: GameImageCapture, private readonly terminal: LuaTerminalSession, private readonly debuggerExecution: RuntimeDebuggerExecution, private readonly actorExecution: ActorExecutionService, private readonly boots: BootService, private readonly connection: AbortSignal) {
		connection.throwIfAborted();
		this.debugSources = new DebuggerSourceContext(debuggerExecution.state);
		connection.addEventListener('abort', this.onDisconnect, { once: true });
	}
	public execute(name: string, input: unknown, requestSignal?: AbortSignal) {
		if (this.disposed) throw new StudioToolInputError('Runtime tool context is disposed');
		const request = decodeRuntimeToolRequest(name, input);
		switch (request.name) {
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
					target: this.owner.target, canEvaluate: this.terminal.canEvaluate, canControl: this.terminal.canToggleExecution,
					active: this.terminal.active === undefined ? undefined : this.terminal.observe(this.terminal.active),
					lastResult: this.terminal.lastResult === undefined ? undefined : this.terminal.observe(this.terminal.lastResult),
				} };
				const signal = requestSignal === undefined ? this.lifetime.signal : AbortSignal.any([this.lifetime.signal, requestSignal]);
				signal.throwIfAborted();
				let operation;
				if (request.name === 'studio_evaluate_lua') operation = this.terminal.evaluate(request.source, request.context);
				else if (request.name === 'studio_evaluate_frame') {
					if (this.inspection === undefined) throw new StudioToolInputError('Open a suspended inspection before evaluating a frame');
					const frame = this.inspection.stackFrame(request.frame);
					operation = this.terminal.evaluate(request.source, this.terminal.frameContext(frame));
				} else {
					operation = this.terminal.active;
					if (operation === undefined || operation.id !== request.evaluation) throw new StudioToolInputError('Lua evaluation is no longer active');
					this.terminal.setPaused(operation, request.action === 'pause');
				}
				return this.terminal.waitForStop(operation, signal).then(result => ({ kind: 'runtime' as const,
					data: { target: this.owner.target, ...result } }));
			}
			case 'studio_runtime_status': return { kind: 'runtime' as const, data: { ...this.owner.status(),
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
		this.connection.removeEventListener('abort', this.onDisconnect);
		this.inspection?.dispose(); this.inspection = undefined;
		this.actors = undefined;
	}
}
