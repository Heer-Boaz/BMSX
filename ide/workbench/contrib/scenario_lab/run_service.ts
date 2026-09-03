import type { HostAudioOutput } from '../../../../hosts/common/audio_output';
import type { Input } from '../../../../hosts/common/input/manager';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import { LuaError } from '../../../../toolchain/ts/lua/errors';
import { buildScenarioCartridge } from '../../../../toolchain/ts/rompack/scenario_cartridge';
import type { LuaInterpreter } from '../../../language/lua/interpreter/interpreter';
import {
	blua32MediaRequiresRebuild,
	bootInstalledBlua32Media,
	prepareBlua32MediaBoot,
} from '../../../runtime/lua_pipeline';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import {
	createBlua32SourceImage,
	resolveRuntimeLuaSourceForContext,
	type Blua32SourceMedia,
	type RuntimeSourceState,
} from '../../../runtime/sources';
import type { RuntimeTaskQueue } from '../../../runtime/task_queue';
import {
	clearFaultSnapshot,
	type RuntimeFaultState,
} from '../../../runtime/fault_state';
import {
	discardRuntimeDebuggerPlans,
	resetRuntimeDebuggerExecution,
	type RuntimeDebuggerState,
} from '../../../runtime/debugger_state';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import {
	applyAllWorkspaceSourceOverrides,
	applyLuaCodeTabSources,
} from '../../../workspace/workspace';
import {
	markLuaTextModelsAppliedToRuntime,
	type CurrentLuaSourceSnapshot,
	type LuaTextModelSourceSnapshot,
} from '../../ui/code_tab/activation';
import { workspaceDirtyRecords } from '../../workspace/state';
import { ScenarioExecutionService } from '../../../testing/scenario/execution_service';
import type {
	ScenarioRunFailure,
	ScenarioRunResult,
} from '../../../testing/scenario/result_service';
import { ScenarioResultService } from '../../../testing/scenario/result_service';
import type { ScenarioTestItem } from '../../../testing/scenario/test_collection';

type PendingScenarioRun = {
	readonly test: ScenarioTestItem;
	readonly testSource: CurrentLuaSourceSnapshot;
	readonly pendingProgramSources: ReadonlyArray<LuaTextModelSourceSnapshot>;
	result: ScenarioRunResult | null;
	cancelled: boolean;
};

export type ScenarioMediaSessionEvent =
	| { readonly type: 'complete' }
	| { readonly type: 'error'; readonly error: unknown };

type ScenarioMediaSessionListener = (event: ScenarioMediaSessionEvent) => void;

type ScenarioMediaSession = {
	readonly request: PendingScenarioRun;
	readonly slot: 0 | 1;
	readonly canonicalRom: Uint8Array;
	readonly canonicalSourceMedia: Blua32SourceMedia;
	readonly canonicalBootRequired: boolean;
	phase: 'building' | 'installed' | 'running' | 'restore_queued';
};

function failureFromError(
	sources: RuntimeSourceState,
	test: ScenarioTestItem,
	error: unknown,
): ScenarioRunFailure {
	const message = error instanceof Error ? error.message : String(error);
	if (error instanceof LuaError) {
		const path = error.path.startsWith('@') ? error.path.slice(1) : error.path;
		const source = resolveRuntimeLuaSourceForContext(
			sources,
			test.resource.domain,
			path,
		)!;
		return {
			message,
			location: {
				resource: {
					domain: source.domain,
					path: source.record.source_path,
				},
				line: error.line,
				column: error.column,
			},
		};
	}
	return {
		message,
		location: {
			resource: test.resource,
			line: 1,
			column: 1,
		},
	};
}

/**
 * Owns the browser workbench's one derived-cartridge media session.
 * Collection, guest protocol execution, and retained results remain separate.
 */
export class ScenarioRunService {
	public readonly results = new ScenarioResultService();
	public readonly execution: ScenarioExecutionService;
	private pendingRun: PendingScenarioRun | null = null;
	private mediaSession: ScenarioMediaSession | null = null;
	private readonly mediaSessionListeners = new Set<ScenarioMediaSessionListener>();

	public constructor(
		private readonly runtime: Runtime,
		private readonly sources: RuntimeSourceState,
		input: Input,
		private readonly audioOutput: HostAudioOutput,
		private readonly storage: KeyValueStorage,
		private readonly fault: RuntimeFaultState,
		private readonly luaTooling: RuntimeLuaTooling,
		private readonly debuggerState: RuntimeDebuggerState,
		private readonly runtimeTasks: RuntimeTaskQueue,
	) {
		this.execution = new ScenarioExecutionService(
			runtime,
			sources,
			input,
			fault,
			this.results,
			null,
		);
	}

	public get active(): boolean {
		return this.pendingRun !== null || this.mediaSession !== null;
	}

	public start(
		test: ScenarioTestItem,
		testSource: CurrentLuaSourceSnapshot,
		pendingProgramSources: ReadonlyArray<LuaTextModelSourceSnapshot>,
	): Promise<void> {
		if (this.active) {
			throw new Error('A Scenario Lab media session is already active.');
		}
		const request: PendingScenarioRun = {
			test,
			testSource,
			pendingProgramSources,
			result: null,
			cancelled: false,
		};
		this.pendingRun = request;
		return this.runtimeTasks.schedule(
			() => this.prepareRun(request),
			error => this.endMediaSessionWithError(error),
		);
	}

	public onDidEndMediaSession(listener: ScenarioMediaSessionListener): () => void {
		this.mediaSessionListeners.add(listener);
		return () => this.mediaSessionListeners.delete(listener);
	}

	public cancel(): void {
		const pending = this.pendingRun;
		if (pending !== null) {
			pending.cancelled = true;
			return;
		}
		const session = this.mediaSession!;
		if (session.phase !== 'running') {
			session.request.cancelled = true;
			return;
		}
		this.execution.cancel();
		this.queueCanonicalRestore(session);
	}

	/** Called after the workbench host has offered the completed guest tick for presentation. */
	public finishHostFrame(presentationSequence: number, presented: boolean): void {
		if (presented) {
			this.execution.didPresent(presentationSequence);
		}
		const session = this.mediaSession;
		if (session !== null
			&& session.phase === 'running'
			&& !this.execution.active) {
			this.queueCanonicalRestore(session);
		}
	}

	private async prepareRun(request: PendingScenarioRun): Promise<void> {
		try {
			await applyAllWorkspaceSourceOverrides(
				this.storage,
				this.sources,
				workspaceDirtyRecords,
			);
			applyLuaCodeTabSources(this.sources, request.pendingProgramSources);
			const result = this.results.begin(
				request.test,
				request.testSource.revision,
				0,
			);
			request.result = result;
			if (request.cancelled) {
				this.results.cancel(result, 0);
				this.pendingRun = null;
				this.emitMediaSessionEvent({ type: 'complete' });
				return;
			}

			const canonicalBootRequired = blua32MediaRequiresRebuild(this.sources);
			const interpreter = prepareBlua32MediaBoot(
				this.sources,
				this.luaTooling,
				this.runtime,
				canonicalBootRequired,
			);
			markLuaTextModelsAppliedToRuntime(request.pendingProgramSources);
			const slot = request.test.resource.domain;
			const cartridge = this.sources.cartridgeSlots[slot]!;
			const session: ScenarioMediaSession = {
				request,
				slot,
				canonicalRom: cartridge.rom.bytes,
				canonicalSourceMedia: this.sources.currentBlua32Media,
				canonicalBootRequired,
				phase: 'building',
			};
			this.mediaSession = session;
			const scenario = await buildScenarioCartridge({
				systemRom: this.sources.systemRom.bytes,
				cartridge: session.canonicalRom,
				test: {
					sourcePath: request.test.resource.path,
					source: request.testSource.source,
				},
				ramByteCount: this.runtime.machine.memory.ramByteCount(),
				optLevel: this.sources.realtimeCompileOptLevel,
			});
			if (request.cancelled) {
				this.results.cancel(result, 0);
				if (session.canonicalBootRequired) {
					this.bootCanonicalMedia(session, interpreter);
				}
				this.pendingRun = null;
				this.mediaSession = null;
				this.emitMediaSessionEvent({ type: 'complete' });
				return;
			}

			const canonicalImages = session.canonicalSourceMedia.cartridgeSlots;
			const scenarioImages = [
				canonicalImages[0],
				canonicalImages[1],
			] as [typeof canonicalImages[0], typeof canonicalImages[1]];
			scenarioImages[slot] = createBlua32SourceImage(
				scenario.linked.layout,
				scenario.linked.symbols,
			);
			this.runtime.machine.cartridgeController.installRom(slot, scenario.layer.bytes);
			this.sources.currentBlua32Media = {
				system: session.canonicalSourceMedia.system,
				cartridgeSlots: scenarioImages,
			};
			session.phase = 'installed';
			this.bootMedia(interpreter);
			this.pendingRun = null;
			session.phase = 'running';
			this.execution.start(result);
		} catch (error) {
			this.failPreparation(request, error);
		}
	}

	private failPreparation(request: PendingScenarioRun, error: unknown): void {
		const result = request.result;
		if (result !== null && result.state === 'preparing') {
			this.results.fail(
				result,
				0,
				failureFromError(this.sources, request.test, error),
				null,
			);
		}
		const session = this.mediaSession;
		if (session !== null
			&& (session.canonicalBootRequired || session.phase !== 'building')) {
			this.bootCanonicalMedia(
				session,
				prepareBlua32MediaBoot(
					this.sources,
					this.luaTooling,
					this.runtime,
					false,
				),
			);
		}
		this.mediaSession = null;
		this.pendingRun = null;
		this.emitMediaSessionEvent({ type: 'error', error });
	}

	private queueCanonicalRestore(session: ScenarioMediaSession): void {
		session.phase = 'restore_queued';
		this.runtimeTasks.schedule(() => {
			this.bootCanonicalMedia(
				session,
				prepareBlua32MediaBoot(
					this.sources,
					this.luaTooling,
					this.runtime,
					false,
				),
			);
			this.mediaSession = null;
			this.emitMediaSessionEvent({ type: 'complete' });
		}, error => this.endMediaSessionWithError(error));
	}

	private endMediaSessionWithError(error: unknown): void {
		this.pendingRun = null;
		this.mediaSession = null;
		this.emitMediaSessionEvent({ type: 'error', error });
	}

	private emitMediaSessionEvent(event: ScenarioMediaSessionEvent): void {
		for (const listener of this.mediaSessionListeners) {
			listener(event);
		}
	}

	private bootCanonicalMedia(
		session: ScenarioMediaSession,
		interpreter: LuaInterpreter,
	): void {
		this.runtime.machine.cartridgeController.installRom(
			session.slot,
			session.canonicalRom,
		);
		this.sources.currentBlua32Media = session.canonicalSourceMedia;
		this.bootMedia(interpreter);
	}

	private bootMedia(interpreter: LuaInterpreter): void {
		clearFaultSnapshot(this.fault);
		discardRuntimeDebuggerPlans(this.debuggerState);
		bootInstalledBlua32Media(
			this.fault,
			this.luaTooling,
			this.runtime,
			interpreter,
		);
		this.audioOutput.muteSystem(false);
		resetRuntimeDebuggerExecution(this.debuggerState);
		this.audioOutput.restart(this.runtime.timing.ufpsScaled);
	}
}
