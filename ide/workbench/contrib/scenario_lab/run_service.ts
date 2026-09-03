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
	type LuaTextModelSourceSnapshot,
} from '../../ui/code_tab/activation';
import { workspaceDirtyRecords } from '../../workspace/state';
import { ScenarioExecutionService } from '../../../testing/scenario/execution_service';
import type {
	ScenarioRun,
	ScenarioRunItemSource,
	ScenarioRunFailure,
} from '../../../testing/scenario/result_service';
import { ScenarioResultService } from '../../../testing/scenario/result_service';
import type {
	ScenarioTestItem,
	ScenarioTestNodeId,
} from '../../../testing/scenario/test_collection';

const SCENARIO_INTERACTIVE_MAX_LOGICAL_TICKS = 3000;

export type ScenarioRunTestSource = ScenarioRunItemSource & {
	readonly source: string;
};

type ScenarioRunRequest = {
	readonly testSources: readonly ScenarioRunTestSource[];
	readonly pendingProgramSources: ReadonlyArray<LuaTextModelSourceSnapshot>;
	readonly run: ScenarioRun;
	cancelled: boolean;
};

export type ScenarioMediaSessionEvent =
	| { readonly type: 'complete' }
	| { readonly type: 'error'; readonly error: unknown };

type ScenarioMediaSessionListener = (event: ScenarioMediaSessionEvent) => void;

type ScenarioMediaSession = {
	readonly request: ScenarioRunRequest;
	readonly slot: 0 | 1;
	readonly canonicalRom: Uint8Array;
	readonly canonicalSourceMedia: Blua32SourceMedia;
	itemIndex: number;
	phase: 'building' | 'running' | 'restore_queued';
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
 * Owns one browser Scenario run and its serial derived-cartridge media session.
 * The workbench submits one resolved scope; it never schedules individual items.
 */
export class ScenarioRunService {
	public readonly results = new ScenarioResultService();
	public readonly execution: ScenarioExecutionService;
	private request: ScenarioRunRequest | null = null;
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
			SCENARIO_INTERACTIVE_MAX_LOGICAL_TICKS,
		);
	}

	public get active(): boolean {
		return this.request !== null;
	}

	public start(
		scopeId: ScenarioTestNodeId,
		testSources: readonly ScenarioRunTestSource[],
		pendingProgramSources: ReadonlyArray<LuaTextModelSourceSnapshot>,
	): Promise<void> {
		if (this.request !== null) {
			throw new Error('A Scenario Lab media session is already active.');
		}
		const run = this.results.beginRun(
			scopeId,
			testSources,
		);
		this.results.startItem(run, 0, 0);
		const request: ScenarioRunRequest = {
			testSources,
			pendingProgramSources,
			run,
			cancelled: false,
		};
		this.request = request;
		return this.runtimeTasks.schedule(
			() => this.prepareMediaSession(request),
			error => this.endMediaSessionWithError(error),
		);
	}

	public onDidEndMediaSession(listener: ScenarioMediaSessionListener): () => void {
		this.mediaSessionListeners.add(listener);
		return () => this.mediaSessionListeners.delete(listener);
	}

	public cancel(): void {
		const request = this.request!;
		request.cancelled = true;
		const session = this.mediaSession;
		if (session === null || session.phase !== 'running') {
			return;
		}
		this.execution.cancel();
		this.results.cancelRun(request.run);
		this.queueCanonicalRestore(session, { type: 'complete' });
	}

	/** Called after the host has offered the completed guest tick for presentation. */
	public finishHostFrame(presentationSequence: number, presented: boolean): void {
		if (presented) {
			this.execution.didPresent(presentationSequence);
		}
		const session = this.mediaSession;
		if (session === null
			|| session.phase !== 'running'
			|| this.execution.active) {
			return;
		}
		const request = session.request;
		if (request.cancelled) {
			this.results.cancelRun(request.run);
			this.queueCanonicalRestore(session, { type: 'complete' });
			return;
		}
		const nextItemIndex = session.itemIndex + 1;
		if (nextItemIndex === request.testSources.length) {
			this.results.completeRun(request.run);
			this.queueCanonicalRestore(session, { type: 'complete' });
			return;
		}
		session.itemIndex = nextItemIndex;
		session.phase = 'building';
		this.results.startItem(request.run, nextItemIndex, 0);
		this.runtimeTasks.schedule(
			async () => {
				try {
					await this.prepareItem(session);
				} catch (error) {
					this.failPreparation(request, error);
				}
			},
			error => this.endMediaSessionWithError(error),
		);
	}

	private async prepareMediaSession(request: ScenarioRunRequest): Promise<void> {
		try {
			if (request.cancelled) {
				this.cancelBeforeMediaSession(request);
				return;
			}
			await applyAllWorkspaceSourceOverrides(
				this.storage,
				this.sources,
				workspaceDirtyRecords,
			);
			applyLuaCodeTabSources(this.sources, request.pendingProgramSources);
			if (blua32MediaRequiresRebuild(this.sources)) {
				prepareBlua32MediaBoot(
					this.sources,
					this.luaTooling,
					this.runtime,
					true,
				);
			}
			markLuaTextModelsAppliedToRuntime(request.pendingProgramSources);
			const slot = request.testSources[0].test.resource.domain;
			const cartridge = this.sources.cartridgeSlots[slot]!;
			const session: ScenarioMediaSession = {
				request,
				slot,
				canonicalRom: cartridge.rom.bytes,
				canonicalSourceMedia: this.sources.currentBlua32Media,
				itemIndex: 0,
				phase: 'building',
			};
			this.mediaSession = session;
			if (request.cancelled) {
				this.cancelDuringBuild(session);
				return;
			}
			await this.prepareItem(session);
		} catch (error) {
			this.failPreparation(request, error);
		}
	}

	private async prepareItem(session: ScenarioMediaSession): Promise<void> {
		const request = session.request;
		const testSource = request.testSources[session.itemIndex];
		const scenario = await buildScenarioCartridge({
				systemRom: this.sources.systemRom.bytes,
				cartridge: session.canonicalRom,
				test: {
					sourcePath: testSource.test.resource.path,
					source: testSource.source,
				},
				ramByteCount: this.runtime.machine.memory.ramByteCount(),
				optLevel: this.sources.realtimeCompileOptLevel,
		});
		if (request.cancelled) {
			this.cancelDuringBuild(session);
			return;
		}
		const canonicalImages = session.canonicalSourceMedia.cartridgeSlots;
		const scenarioImages = [
			canonicalImages[0],
			canonicalImages[1],
		] as [typeof canonicalImages[0], typeof canonicalImages[1]];
		scenarioImages[session.slot] = createBlua32SourceImage(
			scenario.linked.layout,
			scenario.linked.symbols,
		);
		this.runtime.machine.cartridgeController.installRom(
			session.slot,
			scenario.layer.bytes,
		);
		this.sources.currentBlua32Media = {
			system: session.canonicalSourceMedia.system,
			cartridgeSlots: scenarioImages,
		};
		this.bootMedia(prepareBlua32MediaBoot(
			this.sources,
			this.luaTooling,
			this.runtime,
			false,
		));
		session.phase = 'running';
		this.execution.start(request.run.items[session.itemIndex]);
	}

	private cancelBeforeMediaSession(request: ScenarioRunRequest): void {
		this.results.cancel(request.run.items[0], 0);
		this.results.cancelRun(request.run);
		this.request = null;
		this.emitMediaSessionEvent({ type: 'complete' });
	}

	private cancelDuringBuild(session: ScenarioMediaSession): void {
		const run = session.request.run;
		this.results.cancel(run.items[session.itemIndex], 0);
		this.results.cancelRun(run);
		this.queueCanonicalRestore(session, { type: 'complete' });
	}

	private failPreparation(request: ScenarioRunRequest, error: unknown): void {
		const result = this.results.activeResult!;
		this.results.fail(
			result,
			0,
			failureFromError(this.sources, result.test, error),
			null,
		);
		this.results.failRun(request.run);
		const session = this.mediaSession;
		if (session !== null) {
			this.queueCanonicalRestore(session, { type: 'error', error });
			return;
		}
		this.request = null;
		this.emitMediaSessionEvent({ type: 'error', error });
	}

	private queueCanonicalRestore(
		session: ScenarioMediaSession,
		event: ScenarioMediaSessionEvent,
	): void {
		session.phase = 'restore_queued';
		this.runtimeTasks.schedule(() => {
			this.restoreCanonicalMedia(session);
			this.mediaSession = null;
			this.request = null;
			this.emitMediaSessionEvent(event);
		}, error => this.endMediaSessionWithError(error));
	}

	private endMediaSessionWithError(error: unknown): void {
		this.mediaSession = null;
		this.request = null;
		this.emitMediaSessionEvent({ type: 'error', error });
	}

	private emitMediaSessionEvent(event: ScenarioMediaSessionEvent): void {
		for (const listener of this.mediaSessionListeners) {
			listener(event);
		}
	}

	private restoreCanonicalMedia(session: ScenarioMediaSession): void {
		this.runtime.machine.cartridgeController.installRom(
			session.slot,
			session.canonicalRom,
		);
		this.sources.currentBlua32Media = session.canonicalSourceMedia;
		this.bootMedia(prepareBlua32MediaBoot(
			this.sources,
			this.luaTooling,
			this.runtime,
			false,
		));
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
