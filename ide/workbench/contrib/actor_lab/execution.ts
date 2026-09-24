import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { Closure } from '../../../../machine/ts/machine/cpu/closure';
import type { Table } from '../../../../machine/ts/machine/cpu/table';
import { valueString, valueTag, ValueTag, type Value } from '../../../../machine/ts/machine/cpu/value';
import { IO_SYS_STATUS, SYS_STATUS_SUPERVISOR_ACTIVE } from '../../../../machine/ts/spec/bmsx/io';
import type { HostExecutionControl } from '../../../../hosts/common/execution_control';
import type { HostRewind } from '../../../../hosts/common/rewind';
import type { RuntimeTaskQueue } from '../../../../hosts/common/runtime_task_queue';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession, SuspendedValueIdentity } from '../../../runtime/suspended_guest';
import type { RuntimeFaultState } from '../../../runtime/fault_state';
import { resumeRuntimeDebugger, RuntimeDebuggerResumeMode, type RuntimeDebuggerState } from '../../../runtime/debugger_state';
import { scheduleRuntimeGuestCall, type RuntimeGuestCall } from '../../../runtime/guest_call';
import type { PreparedLuaLiteral } from '../../../runtime/lua_literal';
import { readRuntimeLuaModuleCapture, readRuntimeLuaModuleExport } from '../../../runtime/lua_inspection';
import { clearExecutionStopHighlights } from '../../../runtime_error/navigation';
import type { ResourceDomain } from '../../../common/resource';
import { ActorRuntimeTree, findRuntimeActor, runtimeWorld } from './runtime';
import { resolveActorTarget, type ActorTarget } from './target';
import { actorActions } from './operations';

export type ActorInvocation =
	| { readonly kind: 'action'; readonly target: ActorTarget; readonly method: string; readonly args: readonly PreparedLuaLiteral[] }
	| { readonly kind: 'method'; readonly target: ActorTarget; readonly method: string; readonly identity: SuspendedValueIdentity; readonly args: readonly PreparedLuaLiteral[] }
	| { readonly kind: 'event'; readonly target: ActorTarget; readonly name: string; readonly payload: PreparedLuaLiteral }
	| { readonly kind: 'scrub'; readonly target: ActorTarget; readonly programHashId: number; readonly time: number }
	| { readonly kind: 'spawn'; readonly domain: ResourceDomain; readonly worldHashId: number; readonly definitionId: SuspendedValueIdentity;
		readonly definition: SuspendedValueIdentity; readonly options: PreparedLuaLiteral };
export type ActorExecutionResult = { readonly status: 'completed' | 'interrupted' | 'rejected' | 'host-error'; readonly values: readonly string[];
	readonly tags: readonly ValueTag[]; readonly reason?: string; readonly spawnedActorHashId?: number };
export type ActorExecutionLifetime = { readonly isCurrent?: () => boolean; readonly signal?: AbortSignal };

export class ActorExecutionOperation {
	private readonly settled = Promise.withResolvers<ActorExecutionResult>();
	public readonly completion = this.settled.promise;
	public readonly listeners = new Set<() => void>();
	public result: ActorExecutionResult | undefined;
	public status: 'queued' | 'running' | 'paused' = 'queued';
	public invoked = false;
	public revoked = false;
	public controlVersion = 0;
	public constructor(public readonly id: number, public executionRevision: number) {}
	public finish(result: ActorExecutionResult): void { this.result = result; this.settled.resolve(result); }
}

/** World-admitted calls shared by Actor Lab and tools. No view or borrowed node is retained. */
export class ActorExecutionService {
	public active: ActorExecutionOperation | undefined;
	public lastResult: ActorExecutionOperation | undefined;
	private serial = 0;
	private generation = 0;
	private closing = false;
	private readonly values: Value[] = [];
	private readonly tree = new ActorRuntimeTree();
	public constructor(private readonly runtime: Runtime, private readonly sources: RuntimeSourceState,
		private readonly guest: SuspendedGuestSession, private readonly debuggerState: RuntimeDebuggerState,
		private readonly fault: RuntimeFaultState, private readonly tasks: RuntimeTaskQueue,
		private readonly execution: HostExecutionControl, private readonly rewind: HostRewind) {}

	public get canExecute(): boolean {
		return !this.closing && this.active === undefined && this.tasks.mutationReady && !this.execution.launchPending
			&& this.debuggerState.executionContext === undefined && !this.debuggerState.plans.mutationActive
			&& !this.rewind.active && !this.execution.frameStepPending && !this.fault.hostFrameFailed && this.fault.faultSnapshot === null
			&& this.runtime.machine.cpu.activeCartridgeSlot() !== -1
			&& (this.runtime.machine.memory.readIoU32(IO_SYS_STATUS) & SYS_STATUS_SUPERVISOR_ACTIVE) === 0;
	}
	public get canControl(): boolean {
		return this.active !== undefined && this.tasks.ready && this.debuggerState.plans.workbenchControlActive && this.fault.faultSnapshot === null;
	}
	public get paused(): boolean { return this.debuggerState.plans.controlSuspended || this.debuggerState.source.stop !== undefined; }
	public observe(operation: ActorExecutionOperation) {
		return { id: operation.id, invoked: operation.invoked, revoked: operation.revoked,
			status: operation.result?.status ?? operation.status, values: operation.result?.values ?? [], tags: operation.result?.tags ?? [],
			reason: operation.result?.reason, spawnedActorHashId: operation.result?.spawnedActorHashId };
	}
	public start(request: ActorInvocation, lifetime?: ActorExecutionLifetime): ActorExecutionOperation {
		lifetime?.signal?.throwIfAborted();
		if (!this.canExecute) throw new Error('Actor execution is unavailable during another machine operation, history review or recovery.');
		const domain = request.kind === 'spawn' ? request.domain : request.target.domain;
		const worldHashId = request.kind === 'spawn' ? request.worldHashId : request.target.worldHashId;
		if (domain !== this.runtime.machine.cpu.activeCartridgeSlot()) throw new Error('Actor operation does not belong to the active cartridge.');
		const operation = new ActorExecutionOperation(++this.serial, this.execution.revision), generation = this.generation;
		this.active = operation;
		// A pause may settle the tool waiter before admission. Its original prompt
		// still owns the uninvoked request, unless a newer controller took over.
		if (lifetime?.signal !== undefined) {
			const signal = lifetime.signal, version = operation.controlVersion;
			const abort = () => { if (!operation.invoked) this.cancel(operation, version); };
			signal.addEventListener('abort', abort, { once: true });
			void operation.completion.then(() => signal.removeEventListener('abort', abort));
		}
		void scheduleRuntimeGuestCall(this.runtime, this.guest, this.debuggerState, this.tasks, {
			admission: 'quiescent', honorUserStops: true,
			isCurrent: () => generation === this.generation && operation.result === undefined && !operation.revoked && (lifetime?.isCurrent?.() ?? true),
			boundary: () => {
				const world = this.world(domain, worldHashId);
				if (world === undefined) {
					this.finish(operation, { status: 'rejected', values: [], tags: [], reason: 'World changed before actor invocation.' }); return;
				}
				return { request: { domain, closure: this.guest.readStringMember(world, 'request_mutation_boundary') as Closure, args: () => [world] },
					condition: values => {
						const receipt = values[0] as Table, key = this.runtime.machine.cpu.stringPool.find('reached')!;
						return () => receipt.getStringKey(key) === true;
					} };
			},
			prepare: () => {
				if (operation.result !== undefined) return;
				const world = this.world(domain, worldHashId);
				let call: RuntimeGuestCall | undefined;
				try { if (world !== undefined) call = this.prepare(request, world); }
				finally { this.tree.release(); }
				if (call === undefined) { this.finish(operation, { status: 'rejected', values: [], tags: [], reason: 'Actor target or operation changed before invocation.' }); return; }
				return call;
			},
			didEnter: () => { operation.invoked = true; },
		}, () => {
			clearExecutionStopHighlights(); this.execution.requestExecution(false);
			operation.executionRevision = this.execution.revision; operation.status = 'running';
		}, completed => {
			if (operation.result !== undefined) return;
			if (!completed) { this.finish(operation, { status: 'interrupted', values: [], tags: [], reason: operation.invoked
				? 'Lua call interrupted; performed mutations are retained.' : 'Actor invocation cancelled before entry.' }); return; }
			this.runtime.machine.cpu.readCompletionValues(this.values);
			const result: ActorExecutionResult = { status: 'completed', values: this.values.map(value => this.guest.previewValue(value, 1, 8)),
				tags: this.values.map(valueTag), spawnedActorHashId: request.kind === 'spawn' ? (this.values[0] as Table).hashId : undefined };
			this.values.length = 0; this.finish(operation, result);
		}, error => { if (operation.result === undefined) this.finish(operation, { status: 'host-error', values: [], tags: [], reason: String(error) }); });
		return operation;
	}
	private world(domain: ResourceDomain, hashId: number): Table | undefined {
		const world = runtimeWorld(this.sources, this.guest, domain);
		return world?.hashId === hashId ? world : undefined;
	}
	private prepare(request: ActorInvocation, world: Table): RuntimeGuestCall | undefined {
		const cpu = this.runtime.machine.cpu, guest = this.guest;
		if (request.kind === 'spawn') {
			const module = readRuntimeLuaModuleExport(this.sources, guest, request.domain, 'cartlib/world/prefab');
			if (module.kind !== 'value' || module.value === null) return;
			const definitions = readRuntimeLuaModuleCapture(this.sources, guest, request.domain, 'cartlib/world/prefab', guest.readStringMember(module.value, 'define'), 'definitions');
			if (definitions.kind !== 'value') return;
			let id: Value = null;
			guest.visitTableEntries(definitions.value, (key, definition) => {
				if (guest.matchesIdentity(key, request.definitionId) && guest.matchesIdentity(definition, request.definition)) id = key;
			});
			if (id === null) return;
			return { domain: request.domain, closure: guest.readStringMember(world, 'spawn') as Closure, args: () => [world, id, request.options(cpu)] };
		}
		const { target } = request, tree = this.tree;
		tree.update(this.sources, guest, target.domain, findRuntimeActor(this.sources, guest, target.domain, target.actorHashId));
		const node = resolveActorTarget(tree.roots, target, guest);
		if (node === undefined) return;
		let receiver = request.kind === 'method' ? node.value! : node.receiver!;
		let method: string;
		const leading: Value[] = [];
		if (request.kind === 'action') {
			const action = actorActions(node).find(action => action.method === request.method);
			if (action === undefined) return;
			method = action.method;
			if (node.kind === 'state') leading.push(valueString(cpu.stringPool.intern(node.path!)));
			else if (action.keyed) leading.push(node.key);
		} else if (request.kind === 'scrub') {
			if (node.kind !== 'timeline' || (guest.readStringMember(node.value, 'program') as Table).hashId !== request.programHashId) return;
			method = 'scrub_time'; leading.push(node.key, request.time);
		} else if (request.kind === 'event') {
			receiver = guest.readStringMember(tree.roots[0].value, 'events') as Table;
			method = 'emit'; leading.push(valueString(cpu.stringPool.intern(request.name)));
		} else method = request.method;
		const closure = guest.readStringMember(receiver, method);
		if (valueTag(closure) !== ValueTag.Closure || request.kind === 'method' && !guest.matchesIdentity(closure, request.identity)) return;
		return { domain: target.domain, closure: closure as Closure, args: () => {
			const args: Value[] = [receiver, ...leading];
			if (request.kind === 'action' || request.kind === 'method') for (const literal of request.args) args.push(literal(cpu));
			else if (request.kind === 'event') args.push(request.payload(cpu));
			return args;
		} };
	}
	public setPaused(operation: ActorExecutionOperation, paused: boolean): void {
		if (this.active !== operation) throw new Error('Actor operation is no longer active.');
		if (!this.debuggerState.plans.workbenchControlActive) {
			if (!paused) throw new Error('Actor operation has not entered the CPU.');
			operation.revoked = true;
			this.finish(operation, { status: 'interrupted', values: [], tags: [], reason: 'Actor invocation cancelled before entry.' }); return;
		}
		if (!paused && !this.canControl) throw new Error('Actor control is unavailable during recovery.');
		operation.controlVersion++;
		if (!paused && this.debuggerState.source.stop !== undefined) {
			resumeRuntimeDebugger(this.debuggerState, RuntimeDebuggerResumeMode.Continue); clearExecutionStopHighlights();
		} else this.debuggerState.plans.setControlSuspended(paused);
		if (!paused) this.execution.requestExecution(false);
		operation.executionRevision = this.execution.revision;
		this.afterHostFrame();
	}
	public afterHostFrame(): void {
		const operation = this.active;
		if (operation === undefined || operation.status === 'queued') return;
		if (this.fault.hostFrameFailed) { this.finish(operation, { status: 'host-error', values: [], tags: [], reason: 'Host execution failed.' }); return; }
		const status = this.paused ? 'paused' : 'running';
		if (operation.status === status) return;
		operation.status = status; for (const listener of operation.listeners) listener();
	}
	public waitForStop(operation: ActorExecutionOperation, signal: AbortSignal): Promise<ReturnType<ActorExecutionService['observe']>> {
		const version = operation.controlVersion;
		return new Promise((resolve, reject) => {
			const dispose = () => { operation.listeners.delete(changed); signal.removeEventListener('abort', abort); };
			const changed = () => {
				// Admission lifetime cancellation can retire the call before this
				// waiter's abort listener runs. It is still cancellation, not a reply.
				if (signal.aborted) { abort(); return; }
				if (operation.result === undefined && operation.status !== 'paused') return;
				operation.listeners.delete(changed);
				if (operation.invoked || operation.result !== undefined) signal.removeEventListener('abort', abort);
				else {
					// A control request can acquire a still-uninvoked admission from
					// an earlier controller. Paused observation does not abandon it.
					void operation.completion.then(() => signal.removeEventListener('abort', abort));
				}
				resolve(this.observe(operation));
			};
			const abort = () => {
				dispose();
				this.cancel(operation, version);
				reject(signal.reason);
			};
			operation.listeners.add(changed); signal.addEventListener('abort', abort, { once: true });
			if (signal.aborted) abort(); else changed();
		});
	}
	private cancel(operation: ActorExecutionOperation, version: number): void {
		if (this.active !== operation || operation.controlVersion !== version || operation.executionRevision !== this.execution.revision) return;
		if (!operation.invoked) operation.revoked = true;
		this.setPaused(operation, true);
	}
	private finish(operation: ActorExecutionOperation, result: ActorExecutionResult): void {
		operation.finish(result); this.lastResult = operation; this.active = undefined;
		for (const listener of operation.listeners) listener();
	}
	public didReplaceMachine(): void {
		this.generation++;
		this.tree.dispose();
		if (this.active !== undefined) this.finish(this.active, { status: 'interrupted', values: [], tags: [], reason: 'Machine state replaced.' });
	}
	public shutdown(): Promise<void> { this.closing = true; this.didReplaceMachine(); return this.tasks.join(); }
}
