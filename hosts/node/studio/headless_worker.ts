import { readFile } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import { HostAudioDevice } from '../../common/audio_device';
import { HostAudioOutput } from '../../common/audio_output';
import { HostExecutionControl } from '../../common/execution_control';
import { HostFrameSession } from '../../common/frame_session';
import { GameCaptureService } from '../../common/game_capture';
import { Input } from '../../common/input/manager';
import { ConsoleLogOutput } from '../../common/log';
import { initializeMachineRuntime, initializeMachineVideoPresenter } from '../../common/machine_runtime';
import { OffscreenMachine } from '../../common/offscreen_machine';
import { OffscreenVideoOutput } from '../../common/offscreen_video_output';
import { RenderPresentationState } from '../../common/presentation_state';
import { HostRewind } from '../../common/rewind';
import { RuntimeTaskQueue } from '../../common/runtime_task_queue';
import { SystemOutputLog } from '../../common/system_output_log';
import type { StudioHeadlessCloseResult } from '../../common/studio_tools';
import { DiscardingAudioSink } from '../common/discarding_audio';
import { RealtimeHeadlessClock } from '../headless/clock';
import { HEADLESS_DEFAULT_FRAME_INTERVAL_MS, RealtimeHeadlessFrameLoop } from '../headless/frame_loop';
import { HeadlessInputHub } from '../headless/input';
import { encodePngImage } from '../headless/screenshot';
import { HeadlessGPUBackend } from '../../../machine/ts/render/headless/backend';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { loadRomToolingMedia } from '../../../toolchain/ts/rompack/media';
import { IdeMicrotaskQueue } from '../../../ide/common/microtask_queue';
import { editorTextModelService } from '../../../ide/editor/model/model_service';
import { createRuntimeSourceState, developmentCartridgeSource } from '../../../ide/runtime/sources';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../../ide/workspace/records';
import { WorkspaceSourceRecovery } from '../../../ide/workbench/services/working_copy/source_recovery';
import { applyAllWorkspaceSourceOverrides, discoverWorkspaceLuaSources } from '../../../ide/workspace/workspace';
import { PlayRuntimeSession } from '../../../ide/workbench/play_runtime';
import { StudioWorkbench } from '../../../ide/workbench/workbench';
import { runStudioHostFrame } from '../../../ide/workbench/frame';
import { StudioToolRequests } from '../../../ide/workbench/services/assistant/tool_requests';
import type { HeadlessStudioOptions, HeadlessStudioReply, HeadlessStudioRequest } from './headless_protocol';
import { WorkerWorkspaceRecordProvider } from './workspace';

/** Production Node composition: no browser, frontend input, editor view or substitute machine. */
class HeadlessStudioRuntime {
	private readonly clock = new RealtimeHeadlessClock();
	private readonly input = new Input(this.clock, new HeadlessInputHub(), -1);
	private readonly runtime;
	private readonly presenter;
	private readonly audioOutput;
	private readonly tasks;
	private readonly execution;
	private readonly rewind;
	private readonly session;
	private readonly presentation = new RenderPresentationState();
	private readonly log = new ConsoleLogOutput();
	private readonly systemOutput = new SystemOutputLog();
	private workbench: StudioWorkbench | undefined;
	private recovery: WorkspaceSourceRecovery | undefined;
	private requests: StudioToolRequests | undefined;
	private frameLoop: { stop(): void } | undefined;
	private closing = false;
	private disposal: Promise<void> | undefined;

	public constructor(systemRom: Uint8Array, cartridgeSlots: readonly [Uint8Array | null, Uint8Array | null]) {
		this.runtime = initializeMachineRuntime(systemRom, cartridgeSlots, PSX_MACHINE_SPEC, this.input);
		this.presenter = initializeMachineVideoPresenter(this.runtime, new OffscreenVideoOutput(256, 212),
			new HeadlessGPUBackend(256, 212, this.runtime.model.gxGpuVramBytes));
		this.presenter.crt_postprocessing_enabled = false;
		this.audioOutput = new HostAudioOutput(new HostAudioDevice(new DiscardingAudioSink()),
			this.runtime.machine.audioController, this.runtime.timing.ufpsScaled);
		this.tasks = new RuntimeTaskQueue(this.audioOutput, this.presenter);
		this.execution = new HostExecutionControl(this.audioOutput);
		this.rewind = new HostRewind(this.runtime, this.presenter, this.presentation, this.tasks, this.audioOutput, this.log);
		this.session = new HostFrameSession(this.runtime.timing.ufpsScaled, this.clock.now(), this.rewind, this.execution);
	}

	public async initialize(options: HeadlessStudioOptions, systemRom: Uint8Array,
		cartridgeSlots: readonly [Uint8Array | null, Uint8Array | null]): Promise<void> {
		const media = await loadRomToolingMedia(systemRom, cartridgeSlots);
		const sources = createRuntimeSourceState(media.system, media.cartridgeSlots);
		await openWorkspaceRecords(new WorkerWorkspaceRecordProvider(parentPort!));
		this.recovery = new WorkspaceSourceRecovery({ identity: options.recoveryIdentity,
			projectRootPath: developmentCartridgeSource(sources)?.projectRootPath ?? sources.systemProjectRootPath,
			models: editorTextModelService, sources, clock: this.clock, logOutput: this.log });
		const workspaceDirtyRecords = await this.recovery.initialize();
		const observed = await discoverWorkspaceLuaSources(sources);
		await applyAllWorkspaceSourceOverrides(sources, workspaceDirtyRecords, observed);
		await this.recovery.restoreModels();
		this.workbench = new StudioWorkbench({ runtime: this.runtime, input: this.input, audioOutput: this.audioOutput,
			runtimeTasks: this.tasks, execution: this.execution, rewind: this.rewind, clock: this.clock,
			microtasks: new IdeMicrotaskQueue(), logOutput: this.log, sources, models: editorTextModelService,
			workspaceDirtyRecords,
			gameCapture: new GameCaptureService(this.presenter, this.presentation, this.tasks, encodePngImage),
			createTestTarget: (system, slots, model, input) => new OffscreenMachine(system, slots, model, input),
			createPlaySession: (system, slots, model, input, program, domain) => new PlayRuntimeSession(
				new OffscreenMachine(system, slots, model, input), program, domain, this.audioOutput.device, this.log) });
		const boot = this.workbench.boots.start('installed').result!;
		if (boot.status === 'failed' || boot.status === 'rejected') throw boot.error;
		this.systemOutput.flush(this.runtime, this.log);
		this.audioOutput.device.select(this.audioOutput);
		this.requests = new StudioToolRequests(this.workbench.tools, { sourceAccess: options.sourceAccess, reviewApproval: 'agent' });
		this.recovery.start();
		this.runtime.frameScheduler.clearQueuedTime();
		this.session.currentTimeMs = this.clock.now();
		this.frameLoop = new RealtimeHeadlessFrameLoop(this.clock, HEADLESS_DEFAULT_FRAME_INTERVAL_MS).start(currentTime => {
			runStudioHostFrame(this.session, this.runtime, this.presenter, this.input, this.audioOutput,
				this.systemOutput, this.workbench!, this.presentation, currentTime);
		});
	}

	public async handle(message: HeadlessStudioRequest): Promise<void> {
		switch (message.type) {
			case 'execute': {
				if (this.closing) return;
				const result = await this.requests!.execute(message.request, message.operation);
				if (result !== undefined) this.reply({ type: 'result', request: message.request, result });
				break;
			}
			case 'cancel': this.requests!.cancel(message.request); break;
			case 'release': this.requests!.release(message.context); break;
			case 'close': {
				const dirty: { domain: -1 | 0 | 1; path: string }[] = [];
				for (const model of editorTextModelService.models) {
					if (model.dirty) dirty.push({ domain: model.identity.domain, path: model.identity.path });
				}
				if (dirty.length !== 0 && !message.discardUnsaved) {
					this.reply({ type: 'closed', request: message.request, result: { status: 'dirty', resources: dirty } });
					return;
				}
				await this.dispose(message.discardUnsaved);
				this.closed(message.request);
				break;
			}
			case 'shutdown':
				await this.dispose(false);
				this.closed(message.request);
		}
	}

	private closed(request: string): void {
		const result: StudioHeadlessCloseResult = { status: 'closed' };
		this.reply({ type: 'closed', request, result });
		parentPort!.close();
	}
	private reply(reply: HeadlessStudioReply): void { parentPort!.postMessage(reply); }

	public dispose(discardUnsaved: boolean): Promise<void> {
		if (this.disposal !== undefined) return this.disposal;
		this.closing = true;
		this.frameLoop?.stop();
		this.requests?.close(new Error('Headless Studio closed'));
		this.disposal = (async () => {
			try { await this.workbench?.shutdown(); }
			finally {
				try {
					await this.tasks.join();
					if (discardUnsaved) await this.recovery?.discard();
					else await this.recovery?.shutdown();
				} finally {
					try { await closeWorkspaceRecords(); }
					finally {
						editorTextModelService.clear();
						this.input.dispose();
						this.audioOutput.dispose();
						this.presenter.dispose();
					}
				}
			}
		})();
		return this.disposal;
	}
}


async function main(): Promise<void> {
	const options: HeadlessStudioOptions = workerData;
	let studio: HeadlessStudioRuntime | undefined;
	try {
		const [systemRom, slot0, slot1] = await Promise.all([readFile(options.systemRomPath),
			options.cartridgeSlots[0] === null ? null : readFile(options.cartridgeSlots[0]),
			options.cartridgeSlots[1] === null ? null : readFile(options.cartridgeSlots[1])]);
		const cartridgeSlots = [slot0, slot1] as const;
		studio = new HeadlessStudioRuntime(systemRom, cartridgeSlots);
		await studio.initialize(options, systemRom, cartridgeSlots);
		parentPort!.on('message', (message: HeadlessStudioRequest) => {
			void studio!.handle(message).catch(async error => {
				parentPort!.postMessage({ type: 'failed', error });
				try { await studio!.dispose(false); } finally { parentPort!.close(); }
			});
		});
		parentPort!.postMessage({ type: 'ready' });
	} catch (error) {
		parentPort!.postMessage({ type: 'failed', error });
		try { await studio?.dispose(false); } finally { parentPort!.close(); }
	}
}

void main();
