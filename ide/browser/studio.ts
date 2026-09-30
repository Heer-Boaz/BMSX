import { HttpWorkspaceBuilds } from './builds';
import { HttpWorkspaceProjects } from './projects';
import { loadPublishedMedia, openPublishedBuild } from './published_media';
import { showEditorMessage } from '../common/feedback_state';
import { COLOR_STATUS_SUCCESS, COLOR_STATUS_ERROR } from '../common/constants';
import { HttpConversationObserver } from './conversation_observer';
import { decodeImage, encodePngImage } from '../../hosts/browser/image';
import { AssistantHttpConnection } from './assistant_connection';
import { StudioServerConnection } from './server_connection';
import { WorkspaceEditReviewInput } from '../workbench/contrib/edit_review/editor_input';
import { openEditorTab } from '../workbench/ui/tabs';
import { StudioHttpSession } from './http_session';
import { BrowserGraphLayoutEngine } from './graph_layout';
import { HostExecutionControl } from '../../hosts/common/execution_control';
import { HostRewind } from '../../hosts/common/rewind';
import { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import {
	completeBrowserBoot,
	prepareBrowserStartup,
	loadBrowserMedia,
	showBrowserBootError,
} from '../../hosts/browser/boot';
import { BrowserClipboard } from '../../hosts/browser/clipboard';
import { reportClipboardFailure } from '../input/clipboard';
import { HttpWorkspaceRecordProvider } from './workspace_records';
import { IndexedDbWorkspaceRecordProvider } from './indexeddb_workspace_records';
import { ScopedKeyValueStorage } from '../workspace/key_value_storage';
import type { StudioConfiguration } from '../common/studio_configuration';
import { IdeMicrotaskQueue } from '../common/microtask_queue';
import { prepareWorkbenchRuntime } from '../workbench/machine_runtime';
import { bindBrowserFullscreenShortcut } from '../../hosts/browser/fullscreen';
import { defaultResourcePanelRatio } from '../workbench/contrib/resources/panel/layout';
import { persistWorkspaceSessionLocally } from '../workbench/workspace/storage';
import {
	initializeMachineRuntime,
	initializeMachineVideoPresenter,
} from '../../hosts/common/machine_runtime';
import { HostAudioOutput } from '../../hosts/common/audio_output';
import {
	HostFrameRunResult,
	HostFrameSession,
} from '../../hosts/common/host_frame';
import { HostOverlayMenu } from '../../hosts/common/host_overlay_menu';
import { RenderPresentationState } from '../../hosts/common/presentation_state';
import { SystemOutputLog } from '../../hosts/common/system_output_log';
import { runWorkbenchHostFrame } from '../workbench/host_frame';

declare const BMSX_BROWSER_DEBUG: boolean;

async function startBrowserStudio(): Promise<void> {
	let browserFiles: IndexedDbWorkspaceRecordProvider | undefined;
	try {
		const configuration: StudioConfiguration = JSON.parse(document.getElementById('bmsx-studio-configuration')!.dataset.settings!);
		// Independent protocols on the same server share admission, not availability or lifetime.
		const sessions = new Map<string, StudioHttpSession>();
		const httpSession = (baseUrl: string): StudioHttpSession => {
			let session = sessions.get(baseUrl);
			if (session === undefined) { session = new StudioHttpSession(baseUrl); sessions.set(baseUrl, session); }
			return session;
		};
		const artifact = new URL(location.href).searchParams.get('artifact');
		if (artifact !== null && !configuration.server?.builds) throw new Error('Opening a published build requires the workspace build service.');
		const media = artifact === null
			? await loadBrowserMedia(document.body.dataset.systemRom, document.body.dataset.defaultRom)
			: await loadPublishedMedia(httpSession(configuration.server!.baseUrl), artifact);
		const options = await prepareBrowserStartup(BMSX_BROWSER_DEBUG, media);
		const runtime = initializeMachineRuntime(
			options.systemRom,
			options.cartridgeSlots,
			options.machineModel,
			options.input,
		);
		const presenter = initializeMachineVideoPresenter(
			runtime,
			options.videoOutput,
			options.videoBackend,
		);
		const audioOutput = new HostAudioOutput(
			options.audio,
			runtime.machine.audioController,
			runtime.machine.audioOutput.outputRing,
			runtime.timing.ufpsScaled,
		);
		const systemOutput = new SystemOutputLog();
		const runtimeTasks = new RuntimeTaskQueue(audioOutput, presenter);
		const presentation = new RenderPresentationState();
		const execution = new HostExecutionControl(audioOutput);
		const rewind = new HostRewind(runtime, presenter, presentation, runtimeTasks, audioOutput, options.logOutput);
		const session = new HostFrameSession(
			runtime.timing.ufpsScaled,
			options.clock.now(),
			rewind,
			execution,
		);
		const hostOverlayMenu = new HostOverlayMenu(
			presenter,
			runtime,
			options.input,
			rewind,
			execution,
		);
		const workspace = configuration.workspace;
		if (workspace.kind === 'browser') browserFiles = await IndexedDbWorkspaceRecordProvider.open();
		const workspaceFiles = workspace.kind === 'browser' ? browserFiles! : new HttpWorkspaceRecordProvider(httpSession(workspace.baseUrl));
		const storage = workspace.kind === 'browser'
			? new ScopedKeyValueStorage(window.localStorage, 'bmsx.standalone:') : window.localStorage;
		const clipboard = new BrowserClipboard();
		const ide = await prepareWorkbenchRuntime(
			options.systemRom,
			options.cartridgeSlots,
			runtime,
			presenter,
			presentation,
			encodePngImage,
			decodeImage,
			options.videoOutput,
			options.input,
			audioOutput,
			runtimeTasks,
			execution,
			rewind,
			hostOverlayMenu,
			storage,
			workspaceFiles,
			options.clock,
			clipboard,
			new IdeMicrotaskQueue(),
			options.logOutput,
			defaultResourcePanelRatio(window.innerWidth / window.screen.width),
			() => new BrowserGraphLayoutEngine(new Worker(new URL('./graph-layout.worker.js', document.baseURI))),
			configuration.assistant === undefined ? undefined : (signal, onEvent) => AssistantHttpConnection.open(httpSession(configuration.assistant), signal, onEvent),
			configuration.conversations === undefined ? undefined : (signal, onEvent) => HttpConversationObserver.open(httpSession(configuration.conversations), signal, onEvent),
			artifact === null ? 'workspace' : 'installed',
		);
		clipboard.bindInput(options.browserInput, () => ide.editor.clipboardTarget, reportClipboardFailure);
		systemOutput.flush(runtime, options.logOutput);
		audioOutput.bootstrap();
		bindBrowserFullscreenShortcut(
			options.input,
			execution,
			options.logOutput,
		);
		window.addEventListener('beforeunload', (event) => {
			if (!BMSX_BROWSER_DEBUG) {
				event.preventDefault();
				event.returnValue = 'Are you sure you want to exit this awesome game?';
			}
		});
		window.addEventListener('pagehide', (event) => {
			ide.editor.assistant.disconnect();
			ide.editor.observedConversation.disconnect();
			persistWorkspaceSessionLocally();
			if (!event.persisted) browserFiles?.close();
		});
		runtime.frameScheduler.clearQueuedTime();
		const frameLoop = options.frames.start((currentTime) => {
			options.browserInput.poll(currentTime);
			const result = runWorkbenchHostFrame(
				session,
				runtime,
				presenter,
				options.input,
				audioOutput,
				systemOutput,
				options.logOutput,
				ide,
				presentation,
				hostOverlayMenu,
				currentTime,
			);
			if (result === HostFrameRunResult.ExitRequested) {
				window.close();
				if (window.closed) {
					frameLoop.stop();
				}
			}
		});
		const server = configuration.server;
		if (server !== undefined) {
			if (server.projects) ide.editor.projects = new HttpWorkspaceProjects(httpSession(server.baseUrl));
			const builds = server.builds ? new HttpWorkspaceBuilds(httpSession(server.baseUrl), job => {
				showEditorMessage(`${job.request.target}: ${job.phase}. Studio: Build Jobs`, job.state === 'completed' ? COLOR_STATUS_SUCCESS : COLOR_STATUS_ERROR, 6);
			}) : undefined;
			ide.editor.builds = builds;
			if (builds !== undefined) ide.editor.openPublishedBuild = openPublishedBuild;
			const connection = new StudioServerConnection(httpSession(server.baseUrl),
				{ title: document.title, url: location.href, tools: server.tools, builds: server.builds }, ide.editor.tools, proposal => {
					ide.editor.activate();
					openEditorTab(ide.editor.editorPanes, new WorkspaceEditReviewInput(proposal));
				}, (state, detail) => {
					ide.editor.serverConnectionState = state;
					ide.editor.serverConnectionDetail = detail;
				}, builds);
			ide.editor.retryServerConnection = () => connection.retry();
			window.addEventListener('pagehide', event => {
				if (event.persisted) connection.suspend();
				else { connection.dispose(); builds?.dispose(); }
			});
			window.addEventListener('pageshow', event => { if (event.persisted) connection.resume(); });
			document.addEventListener('freeze', () => connection.suspend());
			document.addEventListener('resume', () => connection.resume());
			document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') connection.wake(); });
			window.addEventListener('online', () => connection.wake());
			connection.resume();
		}
		completeBrowserBoot();
	} catch (error) {
		browserFiles?.close();
		showBrowserBootError(error);
	}
}

window.addEventListener('load', () => {
	void startBrowserStudio();
}, { once: true });
