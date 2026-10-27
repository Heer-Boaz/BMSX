import { HttpWorkspaceBuilds } from './builds';
import { HttpWorkspaceProjects } from './projects';
import { resolveBrowserSourceContext } from './source_contexts';
import { openBrowserWorkspaceSession } from './workspace_session';
import { importWorkspaceFiles } from './file_import';
import { loadPublishedBuild, openPublishedBuild } from './published_media';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import type { StudioSourceContext } from '../../hosts/common/studio_projects';
import { createLoadedProjectSourceCatalog } from '../runtime/sources';
import { showEditorMessage } from '../common/feedback_state';
import { HttpConversationObserver } from './conversation_observer';
import { decodeImage, encodePngImage } from '../../hosts/browser/image';
import { AssistantHttpConnection } from './assistant_connection';
import { StudioServerConnection } from './server_connection';
import { WorkspaceEditReviewInput } from '../workbench/contrib/edit_review/editor_input';
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
import { BrowserTextInput } from '../../hosts/browser/text_input';
import { reportClipboardFailure } from '../input/clipboard';
import { HttpWorkspaceRecordProvider } from './workspace_records';
import { IndexedDbWorkspaceRecordProvider } from './indexeddb_workspace_records';
import { ScopedKeyValueStorage } from '../workspace/key_value_storage';
import type { StudioConfiguration } from '../common/studio_configuration';
import { IdeMicrotaskQueue } from '../common/microtask_queue';
import { prepareWorkbenchRuntime } from '../workbench/machine_runtime';
import { bindBrowserFullscreenShortcut } from '../../hosts/browser/fullscreen';
import { BrowserOnscreenKeyboard } from '../../hosts/browser/onscreen_keyboard';
import { BrowserHostControls } from '../../hosts/browser/host_controls';
import { BROWSER_KEYBOARD_PAGES } from '../../hosts/browser/onscreen_keyboard_layout';
import { OnScreenKeyboard } from '../../hosts/common/input/on_screen_keyboard';
import { HostKeyboardInteraction } from '../../hosts/common/input/host_keyboard_interaction';
import { defaultResourcePanelRatio } from '../workbench/contrib/resources/panel/layout';
import { persistWorkspaceSessionLocally } from '../workbench/workspace/storage';
import {
	initializeMachineRuntime,
	initializeMachineVideoPresenter,
} from '../../hosts/common/machine_runtime';
import { HostAudioOutput } from '../../hosts/common/audio_output';
import { HostAudioDevice } from '../../hosts/common/audio_device';
import { HostFrameRunResult } from '../../hosts/common/host_frame';
import { HostFrameSession } from '../../hosts/common/frame_session';
import { HostOverlayMenu, HostOverlayOutcome } from '../../hosts/common/host_overlay_menu';
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
		const parameters = new URL(location.href).searchParams;
		if (parameters.has('artifact')) throw new Error('An artifact does not identify a source project. Open the completed request from Studio Build Jobs.');
		const buildRequest = parameters.get('build');
		if (buildRequest !== null && !configuration.server?.builds) throw new Error('Opening a published build requires the workspace build service.');
		const published = buildRequest === null ? undefined : await loadPublishedBuild(httpSession(configuration.server!.baseUrl), buildRequest);
		const media = buildRequest === null
			? await loadBrowserMedia(document.body.dataset.systemRom, document.body.dataset.defaultRom)
			: published!.media;
		const options = await prepareBrowserStartup(BMSX_BROWSER_DEBUG, media, 'fit');
		const sourceMedia = await loadRomToolingMedia(options.systemRom, options.cartridgeSlots);
		const workspace = configuration.workspace;
		// A raw-media open admits its selected source folder. Only a build receipt
		// can supply the named project's identity; matching filesystem roots cannot.
		const workspaceCartridge = sourceMedia.cartridgeSlots[0] ?? sourceMedia.cartridgeSlots[1];
		const sourceRoot = (workspaceCartridge ?? sourceMedia.system).index.projectRootPath;
		const workspaceContext = buildRequest !== null ? published!.project.cartridge
			: workspace.kind === 'browser' ? await resolveBrowserSourceContext(sourceRoot)
				: await new HttpWorkspaceProjects(httpSession(workspace.baseUrl)).resolveSource(sourceRoot);
		const resolveSource = (root: string) => workspace.kind === 'browser' ? resolveBrowserSourceContext(root)
			: new HttpWorkspaceProjects(httpSession(workspace.baseUrl)).resolveSource(root);
		const systemContext = published === undefined ? await resolveSource(sourceMedia.system.index.projectRootPath) : published.project.system;
		const cartridgeContexts: [StudioSourceContext | null, StudioSourceContext | null] = [null, null];
		const sourceSeeds = workspaceCartridge === null ? [] : [{ admission: workspaceContext, layer: workspaceCartridge }];
		for (const slot of [0, 1] as const) {
			const layer = sourceMedia.cartridgeSlots[slot];
			if (layer === null) continue;
			const admission = published !== undefined ? published.project.cartridge : layer.index.projectRootPath === workspaceContext.projectRoot
				? workspaceContext : await resolveSource(layer.index.projectRootPath);
			cartridgeContexts[slot] = admission;
			// The opened workspace owns its authoring seed; another installation
			// of that context contributes no second mutable source namespace.
			if (!sourceSeeds.some(seed => seed.admission.id === admission.id)) sourceSeeds.push({ admission, layer });
		}
		const catalog = createLoadedProjectSourceCatalog({ admission: systemContext, layer: sourceMedia.system }, sourceSeeds);
		const sourceBindings = { catalog, systemContextId: systemContext.id,
			cartridgeContextIds: [cartridgeContexts[0] === null ? null : cartridgeContexts[0].id,
				cartridgeContexts[1] === null ? null : cartridgeContexts[1].id] as const };
		const browserSession = await openBrowserWorkspaceSession();
		if (workspace.kind === 'browser') browserFiles = await IndexedDbWorkspaceRecordProvider.open();
		const workspaceFiles = workspace.kind === 'browser' ? browserFiles! : new HttpWorkspaceRecordProvider(httpSession(workspace.baseUrl));
		const storage = workspace.kind === 'browser'
			? new ScopedKeyValueStorage(window.localStorage, 'bmsx.standalone:') : window.localStorage;
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
			new HostAudioDevice(options.audio),
			runtime.machine.audioController,
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
		const keyboardModel = new OnScreenKeyboard(options.input, BROWSER_KEYBOARD_PAGES);
		const keyboardInteraction = new HostKeyboardInteraction(options.input, keyboardModel, presenter, undefined);
		const hostOverlayMenu = new HostOverlayMenu(
			presenter,
			runtime,
			options.input,
			rewind,
			execution,
			keyboardInteraction,
			options.menuOptions,
		);
		options.browserInput.setOnscreenKeyboard(new BrowserOnscreenKeyboard(
			document, keyboardModel, () => hostOverlayMenu.dismiss(HostOverlayOutcome.Cancel),
		));
		options.browserInput.setForegroundPointerCapture(keyboardInteraction.capturesPointer);
		options.browserInput.setHostControls(new BrowserHostControls(
			document, hostOverlayMenu.requestToggleKeyboard, hostOverlayMenu.requestToggleMenu,
		));
		const clipboard = new BrowserClipboard();
		const ide = await prepareWorkbenchRuntime(
			sourceMedia,
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
			workspaceContext,
			sourceBindings,
			browserSession.identity,
			workspaceFiles,
			options.clock,
			clipboard,
			new IdeMicrotaskQueue(),
			options.logOutput,
			defaultResourcePanelRatio(window.innerWidth / window.screen.width),
			() => new BrowserGraphLayoutEngine(new Worker(new URL('./graph-layout.worker.js', document.baseURI))),
			configuration.assistant === undefined ? undefined : (signal, onEvent) => AssistantHttpConnection.open(httpSession(configuration.assistant), signal, onEvent),
			configuration.conversations === undefined ? undefined : (signal, onEvent) => HttpConversationObserver.open(httpSession(configuration.conversations), signal, onEvent),
			buildRequest === null ? 'workspace' : 'installed',
		);
		clipboard.bindInput(options.browserInput, () => ide.editor.clipboardTarget, reportClipboardFailure);
		const textInput = new BrowserTextInput(document.getElementById('gamescreen') as HTMLCanvasElement, ide.editor);
		options.browserInput.setNativeKeyHandler(textInput.handleKey);
		options.browserInput.setNativePointerHandler(event => ide.editor.dispatchPointer(event));
		options.browserInput.setNativeWheelHandler(event => ide.editor.dispatchWheel(event));
		if (workspace.kind === 'http') ide.editor.importFiles = (directory, signal) => importWorkspaceFiles(httpSession(workspace.baseUrl), directory, signal);
		systemOutput.flush(runtime, options.logOutput);
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
			if (!event.persisted) {
				options.browserInput.setNativeKeyHandler(undefined);
				options.browserInput.setNativePointerHandler(undefined);
				options.browserInput.setNativeWheelHandler(undefined);
				textInput.dispose();
				browserFiles?.close();
			}
		});
		// Keep the lease for this document's lifetime, including a cached page.
		// The browser releases it when the document dies, not merely on pagehide.
		window.addEventListener('pageshow', event => { if (event.persisted) browserSession.activate(); });
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
			textInput.refresh();
			if (result === HostFrameRunResult.ExitRequested) {
				window.close();
				if (window.closed) {
					frameLoop.stop();
				}
			}
		});
		document.title = `${workspaceContext.projectRoot}${buildRequest === null ? '' : ` [opened ${buildRequest.slice(0, 12)}]`} - BMSX Studio`;
		const server = configuration.server;
		if (server !== undefined) {
			if (server.projects) ide.editor.projects = new HttpWorkspaceProjects(httpSession(server.baseUrl));
			const builds = server.builds ? new HttpWorkspaceBuilds(httpSession(server.baseUrl), job => {
				showEditorMessage(`${job.request.target}: ${job.phase}. Studio: Build Jobs`, job.state === 'completed' ? 'success' : 'error', 6);
			}) : undefined;
			ide.editor.builds = builds;
			if (builds !== undefined) {
				ide.editor.openPublishedBuild = openPublishedBuild;
				ide.editor.tools.openBuild = async (requestId, signal) => {
					const job = await builds.get(requestId);
					signal?.throwIfAborted();
					if (job === undefined || job.state !== 'completed') throw new Error('Only a completed workspace build can be opened.');
					if (job.project === undefined) throw new Error('This build has no source project admission. Rebuild the project before opening Studio.');
					return openPublishedBuild(job.request.requestId);
				};
			}
			const connection = new StudioServerConnection(httpSession(server.baseUrl),
				{ title: document.title, url: location.href, tools: server.tools, builds: server.builds }, ide.editor.tools, proposal => {
					ide.editor.activate();
					ide.editor.editorParts.editorDestination(ide.editor.editorParts.activeGroup).openEditor(new WorkspaceEditReviewInput(proposal));
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
