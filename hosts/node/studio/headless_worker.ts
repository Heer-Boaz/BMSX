import { readFile } from 'node:fs/promises';
import { parentPort, workerData, Worker } from 'node:worker_threads';
import { HostAudioDevice } from '../../common/audio_device';
import { HostAudioOutput } from '../../common/audio_output';
import { HostExecutionControl } from '../../common/execution_control';
import { HostFrameSession } from '../../common/frame_session';
import { HostFrameRunResult } from '../../common/host_frame';
import { HostOverlayMenu } from '../../common/host_overlay_menu';
import { HostOnScreenKeyboard } from '../../common/host_on_screen_keyboard';
import { HostKeyboardInteraction } from '../../common/input/host_keyboard_interaction';
import { OnScreenKeyboard } from '../../common/input/on_screen_keyboard';
import { NATIVE_KEYBOARD_PAGES } from '../../common/input/on_screen_keyboard_keys';
import { RemoteInput } from '../../common/input/remote';
import { Input } from '../../common/input/manager';
import { ConsoleLogOutput } from '../../common/log';
import { initializeMachineRuntime, initializeMachineVideoPresenter } from '../../common/machine_runtime';
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
import { capturePresentedImage, decodeImage, encodePngImage } from '../headless/screenshot';
import { HeadlessClipboard } from '../headless/clipboard';
import { HeadlessGPUBackend } from '../../../machine/ts/render/headless/backend';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { loadRomToolingMedia } from '../../../toolchain/ts/rompack/media';
import { IdeMicrotaskQueue } from '../../../ide/common/microtask_queue';
import { editorTextModelService } from '../../../ide/editor/model/model_service';
import { createLoadedProjectSourceCatalog } from '../../../ide/runtime/sources';
import type { WorkspaceSourceCatalog } from '../../../ide/workspace/source_catalog';
import { MemoryStorage } from '../../../ide/workspace/memory_storage';
import { prepareWorkbenchRuntime } from '../../../ide/workbench/machine_runtime';
import { disposeShortcutHandlers } from '../../../ide/workbench/mode';
import type { RuntimeIdeState } from '../../../ide/workbench/state';
import { shutdownWorkspaceStorage } from '../../../ide/workbench/workspace/storage';
import { runWorkbenchHostFrame } from '../../../ide/workbench/host_frame';
import { NodeGraphLayoutEngine } from '../../../ide/node/graph_layout';
import { RESOURCE_PANEL_DEFAULT_RATIO } from '../../../ide/common/constants';
import { StudioUiService } from '../../../ide/workbench/services/assistant/ui_tools';
import { StudioToolRequests } from '../../../ide/workbench/services/assistant/tool_requests';
import type { HeadlessStudioOptions, HeadlessStudioReply, HeadlessStudioRequest } from './headless_protocol';
import { WorkerWorkspaceRecordProvider } from './workspace';

/** The ordinary workbench and compositor, hosted without a browser or desktop input. */
class HeadlessStudioRuntime {
	private readonly clock = new RealtimeHeadlessClock();
	private readonly input = new Input(this.clock, new HeadlessInputHub(), -1);
	private readonly runtime;
	private readonly presenter;
	private readonly videoOutput = new OffscreenVideoOutput(256, 212);
	private readonly backend;
	private readonly hostMenu;
	private readonly audioOutput;
	private readonly tasks;
	private readonly execution;
	private readonly rewind;
	private readonly session;
	private readonly presentation = new RenderPresentationState();
	private readonly log = new ConsoleLogOutput();
	private readonly systemOutput = new SystemOutputLog();
	private workbench: RuntimeIdeState | undefined;
	private catalog: WorkspaceSourceCatalog | undefined;
	private ui: StudioUiService | undefined;
	private requests: StudioToolRequests | undefined;
	private frameLoop: { stop(): void } | undefined;
	private closing = false;
	private disposal: Promise<void> | undefined;

	public constructor(systemRom: Uint8Array, cartridgeSlots: readonly [Uint8Array | null, Uint8Array | null]) {
		this.runtime = initializeMachineRuntime(systemRom, cartridgeSlots, PSX_MACHINE_SPEC, this.input);
		this.backend = new HeadlessGPUBackend(256, 212, this.runtime.model.gxGpuVramBytes);
		this.presenter = initializeMachineVideoPresenter(this.runtime, this.videoOutput, this.backend);
		this.presenter.crt_postprocessing_enabled = false;
		this.audioOutput = new HostAudioOutput(new HostAudioDevice(new DiscardingAudioSink()),
			this.runtime.machine.audioController, this.runtime.timing.ufpsScaled);
		this.tasks = new RuntimeTaskQueue(this.audioOutput, this.presenter);
		this.execution = new HostExecutionControl(this.audioOutput);
		this.rewind = new HostRewind(this.runtime, this.presenter, this.presentation, this.tasks, this.audioOutput, this.log);
		this.session = new HostFrameSession(this.runtime.timing.ufpsScaled, this.clock.now(), this.rewind, this.execution);
		const keyboard = new OnScreenKeyboard(this.input, NATIVE_KEYBOARD_PAGES);
		const keyboardView = new HostOnScreenKeyboard(this.presenter, keyboard);
		this.hostMenu = new HostOverlayMenu(this.presenter, this.runtime, this.input, this.rewind, this.execution,
			new HostKeyboardInteraction(this.input, keyboard, this.presenter, keyboardView));
	}

	public async initialize(options: HeadlessStudioOptions, systemRom: Uint8Array,
		cartridgeSlots: readonly [Uint8Array | null, Uint8Array | null]): Promise<void> {
		const media = await loadRomToolingMedia(systemRom, cartridgeSlots);
		const catalog = createLoadedProjectSourceCatalog({ admission: options.project.system, layer: media.system },
			[{ admission: options.project.cartridge, layer: media.cartridgeSlots[0]! }]);
		this.catalog = catalog;
		this.workbench = await prepareWorkbenchRuntime(media, this.runtime, this.presenter, this.presentation,
			encodePngImage, decodeImage, this.videoOutput, this.input, this.audioOutput, this.tasks, this.execution,
			this.rewind, this.hostMenu, new MemoryStorage(), options.project.cartridge, { catalog,
				systemContextId: options.project.system.id, cartridgeContextIds: [options.project.cartridge.id, null] },
			options.recoveryIdentity, new WorkerWorkspaceRecordProvider(parentPort!), this.clock, new HeadlessClipboard(),
			new IdeMicrotaskQueue(), this.log, RESOURCE_PANEL_DEFAULT_RATIO,
			() => new NodeGraphLayoutEngine(new Worker(new URL('../../../ide/node/graph_layout_worker.cjs', import.meta.url))),
			undefined, undefined, 'installed');
		const editor = this.workbench.editor;
		this.ui = new StudioUiService(() => capturePresentedImage(this.backend), this.presenter.canvasSize, this.videoOutput,
			editorTextModelService, new RemoteInput(this.input, this.clock, this.input.dispatchEditingKey.bind(this.input),
				event => editor.dispatchPointer(event), event => editor.dispatchWheel(event)));
		this.systemOutput.flush(this.runtime, this.log);
		this.requests = new StudioToolRequests(this.workbench.tools,
			{ sourceAccess: options.sourceAccess, reviewApproval: 'agent' }, this.ui);
		this.runtime.frameScheduler.clearQueuedTime();
		this.session.currentTimeMs = this.clock.now();
		this.frameLoop = new RealtimeHeadlessFrameLoop(this.clock, HEADLESS_DEFAULT_FRAME_INTERVAL_MS).start(currentTime => {
			this.ui!.beforeFrame();
			const result = runWorkbenchHostFrame(this.session, this.runtime, this.presenter, this.input, this.audioOutput,
				this.systemOutput, this.log, this.workbench!, this.presentation, this.hostMenu, currentTime);
			this.ui!.afterFrame(this.presenter.presentationSequence);
			if (result === HostFrameRunResult.ExitRequested) void this.dispose(false).then(() => parentPort!.close());
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
				const dirty: { contextId: string; path: string }[] = [];
				for (const model of editorTextModelService.models) {
					if (model.dirty) dirty.push({ contextId: model.identity.contextId, path: model.identity.path });
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
		this.ui?.dispose();
		if (this.workbench !== undefined) disposeShortcutHandlers(this.workbench);
		this.disposal = (async () => {
			try { await this.workbench?.shutdown(); }
			finally {
				try {
					await this.tasks.join();
					if (discardUnsaved) for (const model of editorTextModelService.models) if (model.dirty) model.revert();
				} finally {
					try {
						if (this.workbench !== undefined) await this.workbench.editor.shutdown();
						else await shutdownWorkspaceStorage();
					}
					finally {
						if (this.workbench === undefined) {
							editorTextModelService.clear();
							this.catalog?.dispose();
						}
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
