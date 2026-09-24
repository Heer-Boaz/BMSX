import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import type { HostAudioOutput } from '../../../../hosts/common/audio_output';
import { HostPauseReason, type HostExecutionControl } from '../../../../hosts/common/execution_control';
import type { RuntimeTaskQueue } from '../../../../hosts/common/runtime_task_queue';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import type { RuntimeFaultState } from '../../../runtime/fault_state';
import { enterSystemSources, type RuntimeSourceState } from '../../../runtime/sources';
import { blua32MediaRequiresRebuild, bootInstalledBlua32Media, installBlua32Media,
	prepareBlua32MediaBoot, type Blua32CartridgeEntry, type PreparedBlua32Boot } from '../../../runtime/lua_pipeline';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { WorkspaceRecord } from '../../../workspace/records';
import { applyAllWorkspaceSourceOverrides, applyLuaTextModelSources } from '../../../workspace/workspace';
import { captureLuaTextModelSources, type LuaTextModelSourceSnapshot } from '../working_copy/lua_sources';

type BootPhase = 'queued' | 'reading-sources' | 'building' | 'installing' | 'resetting';
type BootCancellation = 'interrupted' | 'superseded' | 'machine-reset' | 'shutdown';
type BootEffects = { readonly installed: boolean; readonly reset: boolean };

/** Reset acknowledges physical reset registers, never completion of arbitrary guest initialization. */
export type BootResult = BootEffects & (
	| { readonly status: 'reset' }
	| { readonly status: 'rejected'; readonly error: unknown }
	| { readonly status: 'failed'; readonly phase: BootPhase; readonly error: unknown }
	| { readonly status: 'cancelled'; readonly reason: BootCancellation }
);

export interface BootOperation {
	readonly id: number;
	readonly kind: 'startup' | 'reboot';
	readonly sourceSnapshots: readonly LuaTextModelSourceSnapshot[];
	readonly entry: Blua32CartridgeEntry | undefined;
	readonly status: BootPhase | BootResult['status'];
	readonly result: BootResult | null;
	readonly completion: Promise<BootResult>;
}

class PendingBoot implements BootOperation {
	public phase: BootPhase = 'queued';
	public installed = false;
	public reset = false;
	public result: BootResult | null = null;
	private resolveCompletion!: (result: BootResult) => void;
	public readonly completion = new Promise<BootResult>(resolve => { this.resolveCompletion = resolve; });
	private readonly onAbort = () => this.finish({ status: 'cancelled', reason: 'interrupted', installed: this.installed, reset: this.reset });

	public constructor(
		public readonly id: number,
		public readonly kind: 'startup' | 'reboot',
		public readonly sourceSnapshots: readonly LuaTextModelSourceSnapshot[],
		public readonly entry: Blua32CartridgeEntry | undefined,
		private readonly signal?: AbortSignal,
	) { signal?.addEventListener('abort', this.onAbort, { once: true }); }

	public get status(): BootOperation['status'] { return this.result === null ? this.phase : this.result.status; }

	public finish(result: BootResult): void {
		if (this.result !== null) return;
		this.signal?.removeEventListener('abort', this.onAbort);
		this.result = result;
		this.resolveCompletion(result);
	}

	public readonly fail = (error: unknown): void => {
		this.finish({ status: 'failed', phase: this.phase, installed: this.installed, reset: this.reset, error });
	};
}

/** Owns accepted boot inputs, physical reset and lifetime, not editor views or guest readiness. */
export class BootService {
	private latest: PendingBoot | null = null;
	private serial = 0;
	private closing = false;

	public constructor(
		private readonly models: EditorTextModelService,
		private readonly sources: RuntimeSourceState,
		private readonly tooling: RuntimeLuaTooling,
		private readonly fault: RuntimeFaultState,
		private readonly runtime: Runtime,
		private readonly tasks: RuntimeTaskQueue,
		private readonly execution: HostExecutionControl,
		private readonly audioOutput: HostAudioOutput,
		private readonly storage: KeyValueStorage,
		private readonly dirtyRecords: ReadonlyMap<string, WorkspaceRecord>,
	) {}

	public get acceptingRequests(): boolean { return !this.closing; }
	public get latestOperation(): BootOperation | null { return this.latest; }

	/** Composition calls this before the first host frame, after workspace recovery. */
	public start(): BootOperation {
		const operation = this.accept('startup');
		this.execution.setPauseReason(HostPauseReason.AwaitingLaunch, true);
		try {
			let prepared: PreparedBlua32Boot;
			try {
				prepared = this.prepare(operation);
			} catch (error) {
				// Initialize packed hardware for inspection only. The launch hold stays
				// set: rejected authored source must not silently run the packed program.
				this.reset(operation, this.tooling.luaInterpreter);
				operation.finish({ status: 'rejected', installed: false, reset: true, error });
				return operation;
			}
			this.installAndReset(operation, prepared);
		} catch (error) {
			operation.fail(error);
		}
		return operation;
	}

	public reboot(entry?: Blua32CartridgeEntry, signal?: AbortSignal): BootOperation {
		signal?.throwIfAborted();
		const operation = this.accept('reboot', entry, signal);
		void this.tasks.schedule(async () => {
			if (operation.result !== null) return;
			operation.phase = 'reading-sources';
			await applyAllWorkspaceSourceOverrides(this.storage, this.sources, this.dirtyRecords);
			if (operation.result !== null) return;
			let prepared: PreparedBlua32Boot;
			try {
				prepared = this.prepare(operation);
			} catch (error) {
				operation.finish({ status: 'rejected', installed: false, reset: false, error });
				return;
			}
			this.installAndReset(operation, prepared);
		}, operation.fail);
		return operation;
	}

	private accept(kind: BootOperation['kind'], entry?: Blua32CartridgeEntry, signal?: AbortSignal): PendingBoot {
		if (this.closing) throw new Error('Cannot boot after workbench shutdown has started.');
		this.cancelPending('superseded');
		const operation = new PendingBoot(++this.serial, kind, captureLuaTextModelSources(this.models, this.sources),
			entry === undefined ? undefined : { ...entry }, signal);
		this.latest = operation;
		return operation;
	}

	private prepare(operation: PendingBoot): PreparedBlua32Boot {
		operation.phase = 'building';
		if (operation.entry?.domain === 1) {
			const first = this.sources.cartridgeSlots[0];
			if (first !== null && first.rom.header.blua32ImageOffset !== 0
				&& first.rom.header.blua32StartupFunctionAddress !== 0) {
				throw new Error('CART 1 cannot launch: BIOS boots CART 0 first.');
			}
		}
		applyLuaTextModelSources(this.sources, operation.sourceSnapshots);
		return prepareBlua32MediaBoot(this.sources, this.tooling, this.runtime,
			blua32MediaRequiresRebuild(this.sources), operation.entry);
	}

	private installAndReset(operation: PendingBoot, prepared: PreparedBlua32Boot): void {
		operation.phase = 'installing';
		this.execution.setPauseReason(HostPauseReason.AwaitingLaunch, true);
		if (prepared.installation !== null) {
			installBlua32Media(this.sources, this.runtime, prepared.installation);
			operation.installed = true;
		}
		this.reset(operation, prepared.interpreter);
		if (operation.kind === 'reboot') {
			this.audioOutput.muteSystem(false);
			this.audioOutput.restart(this.runtime.timing.ufpsScaled);
		}
		this.execution.setPauseReason(HostPauseReason.AwaitingLaunch, false);
		operation.finish({ status: 'reset', installed: operation.installed, reset: true });
	}

	private reset(operation: PendingBoot, interpreter: PreparedBlua32Boot['interpreter']): void {
		operation.phase = 'resetting';
		enterSystemSources(this.sources);
		bootInstalledBlua32Media(this.fault, this.tooling, this.runtime, interpreter);
		operation.reset = true;
	}

	public didReplaceMachine(): void {
		// boot() notifies synchronously. Only that operation owns this reset;
		// external reset/restore retires queued work and its command feedback.
		if (this.latest?.status === 'resetting') return;
		this.cancelPending('machine-reset');
		this.execution.setPauseReason(HostPauseReason.AwaitingLaunch, false);
	}

	private cancelPending(reason: BootCancellation): void {
		const operation = this.latest;
		this.latest = null;
		operation?.finish({ status: 'cancelled', installed: operation.installed, reset: operation.reset, reason });
	}

	public failPending(error: unknown): void { this.latest?.fail(error); }

	public shutdown(): Promise<void> {
		this.closing = true;
		this.cancelPending('shutdown');
		return this.tasks.join();
	}
}
