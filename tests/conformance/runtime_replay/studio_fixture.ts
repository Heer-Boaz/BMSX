import { getCodeAreaBounds, resolveTextPositionBounds } from '../../../ide/editor/ui/view/view';
import { BrowserGraphLayoutEngine } from '../../../ide/browser/graph_layout';
import type { RectBounds } from '../../../machine/ts/common/rect';
import { HostExecutionControl } from '../../../hosts/common/execution_control';
import { BrowserVideoOutput } from '../../../hosts/browser/video_output';
import { HostAudioOutput, type AudioOutputPuller } from '../../../hosts/common/audio_output';
import { HostFrameSession } from '../../../hosts/common/host_frame';
import { HostOverlayMenu } from '../../../hosts/common/host_overlay_menu';
import { Input } from '../../../hosts/common/input/manager';
import { initializeMachineRuntime, initializeMachineVideoPresenter } from '../../../hosts/common/machine_runtime';
import { RenderPresentationState } from '../../../hosts/common/presentation_state';
import { HostRewind } from '../../../hosts/common/rewind';
import { RuntimeTaskQueue } from '../../../hosts/common/runtime_task_queue';
import { SystemOutputLog } from '../../../hosts/common/system_output_log';
import { VirtualHeadlessClock } from '../../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../../hosts/node/headless/input';
import { prepareWorkbenchRuntime } from '../../../ide/workbench/machine_runtime';
import { runWorkbenchHostFrame } from '../../../ide/workbench/host_frame';
import { IdeMicrotaskQueue } from '../../../ide/common/microtask_queue';
import { BrowserClipboard } from '../../../ide/browser/clipboard';
import { createHeadlessIdeHarness } from '../../../ide/testing/headless_harness';
import { RecordingLogOutput } from '../../../ide/testing/recording_log_output';
import type { Table } from '../../../machine/ts/machine/cpu/table';
import { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../../machine/ts/spec/bmsx/io';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { buildModuleExportSlotName } from '../../../toolchain/ts/lua/module_path';
import type { GPUBackend } from '../../../machine/ts/render/backend/backend';
import type { EditorCommandId } from '../../../ide/common/commands';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import type { EditorTabId } from '../../../ide/workbench/ui/tab/id';
import { WHEEL_SCROLL_STEP } from '../../../ide/common/constants';
import { TOP_BAR_MENUS, type TopBarMenuItem } from '../../../ide/workbench/ui/top_bar/menu';
import { createResourceState } from '../../../ide/workbench/contrib/resources/widget_state';

export function check(condition: boolean, message: string): void {
	if (!condition) throw new Error(message);
}

/** Pointer actionability consumes production text geometry rather than duplicating its projection. */
export function codePositionBounds(row: number, column: number) {
	const target = { left: 0, top: 0, right: 0, bottom: 0 };
	resolveTextPositionBounds(row, column, target);
	target.top = (target.top + target.bottom) / 2;
	target.right = target.left + 1;
	target.bottom = target.top + 1;
	const bounds = getCodeAreaBounds();
	check(target.left >= bounds.textLeft && target.right < bounds.codeRight
		&& target.top >= bounds.codeTop && target.bottom < bounds.codeBottom, 'navigation pointer target must be visible');
	return target;
}

/** Actual Studio composition; backend selection belongs to the test project. */
export async function createStudioFixture(canvas: HTMLCanvasElement, backend: GPUBackend, capture?: (name: string) => Promise<void>) {
	const bios = new Uint8Array(await (await fetch('/bios.rom')).arrayBuffer());
	const cart = new Uint8Array(await (await fetch('/cart.rom')).arrayBuffer());
	const clock = new VirtualHeadlessClock();
	const input = new Input(clock, new HeadlessInputHub(), -1);
	const runtime = initializeMachineRuntime(bios, [cart, null], PSX_MACHINE_SPEC, input);
	const display = new BrowserVideoOutput(canvas, null);
	const presenter = initializeMachineVideoPresenter(runtime, display, backend);
	presenter.crt_postprocessing_enabled = false;
	let puller: AudioOutputPuller | null = null;
	const observations = { hostFrames: 0, audioFrames: 0, suspended: false, expectedFaultSequence: 0 };
	const samples = new Int16Array(2048);
	const audio = new HostAudioOutput({
		setRuntimeAudioPuller(value) { puller = value; },
		pumpRuntimeAudio() { if (puller) observations.audioFrames += puller(samples, 960, 48000); },
		resume() { observations.suspended = false; }, suspend() { observations.suspended = true; }, setEmulationFrameTimeSec() {},
	}, runtime.machine.audioController, runtime.machine.audioOutput.outputRing, runtime.timing.ufpsScaled);
	const log = new RecordingLogOutput({ log(level, message) { if (level === 3) console.error(message); } });
	const tasks = new RuntimeTaskQueue(audio, presenter);
	const screen = new RenderPresentationState();
	const execution = new HostExecutionControl(audio);
	const rewind = new HostRewind(runtime, presenter, screen, tasks, audio, log);
	const session = new HostFrameSession(runtime.timing.ufpsScaled, clock.now(), rewind, execution);
	const menu = new HostOverlayMenu(presenter, runtime, input, rewind, execution);
	const clipboard = new BrowserClipboard();
	const ide = await prepareWorkbenchRuntime(bios, [cart, null], runtime, presenter, display, input,
		audio, tasks, execution, rewind, menu, localStorage, new HttpWorkspaceRecordProvider(), clock, clipboard, new IdeMicrotaskQueue(), log, 0.3, () => new BrowserGraphLayoutEngine(new Worker('/graph-layout.worker.js')));
	const output = new SystemOutputLog();
	const harness = createHeadlessIdeHarness(ide, runtime, input, audio, localStorage, log);
	const history = runtime.history;
	const cycles = () => runtime.machine.scheduler.currentNowCycles();
	const frame = async () => {
		clock.advance(runtime.timing.frameDurationMs);
		runWorkbenchHostFrame(session, runtime, presenter, input, audio, output, log, ide, screen, menu, clock.now());
		if (ide.editor.isActive) {
			const viewport = ide.overlayRenderer.viewportSize;
			check(presenter.viewportSize.x === viewport.width && presenter.viewportSize.y === viewport.height,
				'Studio layout and presentation target must agree, including frames that restore machine state');
		}
		observations.hostFrames += 1;
		await new Promise<void>(resolve => setTimeout(resolve, 0));
		check(!ide.fault.hostFrameFailed, 'workbench host frame failed');
		check(runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE) <= observations.expectedFaultSequence, 'unexpected guest fault');
	};
	const until = async (predicate: () => boolean, message: string) => {
		console.info(`STUDIO: ${message}`);
		for (let index = 0; index < 8000 && !predicate(); index += 1) await frame();
		check(predicate(), `${message}: cycles=${cycles()} ready=${tasks.ready} pause=${execution.userPaused} editor=${ide.editor.isActive} control=${ide.debugger.plans.controlActive} mutation=${ide.debugger.plans.mutationActive} history=${history.mode}`);
	};
	let pressId = 0;
	const setKey = (key: string, down: boolean) => {
		input.inputButton('keyboard:0', key, down, down ? 1 : 0, clock.now(), ++pressId);
	};
	const setPointerButton = (button: 'pointer_primary' | 'pointer_secondary' | 'pointer_aux', down: boolean) => {
		input.inputButton('pointer:0', button, down, down ? 1 : 0, clock.now(), ++pressId);
	};
	const press = async (...keys: string[]) => {
		for (const key of keys) setKey(key, true);
		await frame();
		for (const key of keys) setKey(key, false);
		await frame();
	};
	const movePointer = (bounds: RectBounds) => {
		const displayRect = display.measureDisplay();
		const viewport = ide.overlayRenderer.viewportSize;
		input.inputAxis2('pointer:0', 'pointer_position',
			displayRect.left + (bounds.left + bounds.right) * displayRect.width / (viewport.width * 2),
			displayRect.top + (bounds.top + bounds.bottom) * displayRect.height / (viewport.height * 2), clock.now());
	};
	const click = async (bounds: RectBounds, heldFrames = 1, button: 'pointer_primary' | 'pointer_secondary' | 'pointer_aux' = 'pointer_primary') => {
		// Like Playwright's stable-position actionability check, resolve pointer
		// coordinates after browser layout, not just our accelerated machine tick.
		// BrowserVideoOutput can still have a canvas resize queued on rAF.
		let previous = display.measureDisplay();
		for (;;) {
			await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
			const current = display.measureDisplay();
			if (current.x === previous.x && current.y === previous.y && current.width === previous.width && current.height === previous.height) break;
			console.info(`STUDIO: pointer waits for canvas layout ${previous.x},${previous.y} ${previous.width}x${previous.height} -> ${current.x},${current.y} ${current.width}x${current.height}`);
			previous = current;
		}
		movePointer(bounds);
		await frame();
		setPointerButton(button, true);
		for (let index = 0; index < heldFrames; index += 1) await frame();
		setPointerButton(button, false);
		await frame();
	};
	/** Reach an offscreen tab through the real wheel route, then click its visible label. */
	const clickTab = async (id: EditorTabId, heldFrames = 1) => {
		await frame();
		const bounds = editorChromeState.tabButtonBounds.get(id)!;
		const width = editorChromeState.tabBarBounds.right;
		const delta = bounds.left < 0 ? bounds.left : bounds.right > width ? bounds.right - width : 0;
		if (delta !== 0) {
			movePointer(editorChromeState.tabBarBounds); await frame();
			const steps = Math.sign(delta) * Math.ceil(Math.abs(delta) / (editorViewState.charAdvance * 4));
			input.inputAxis1('pointer:0', 'pointer_wheel', steps * WHEEL_SCROLL_STEP, clock.now());
			await frame();
		}
		const left = Math.max(0, bounds.left), right = Math.min(width, bounds.right);
		check(right > left, `tab ${id} is reachable through horizontal scrolling`);
		await click({ left, right, top: bounds.top, bottom: bounds.bottom }, heldFrames);
	};
	const runMenuCommand = async (command: EditorCommandId) => {
		check(ide.editor.isActive, 'Run-menu commands require editor focus');
		if (editorChromeState.openMenuId !== 'run') await click(editorChromeState.menuEntryBounds.run);
		check(editorChromeState.openMenuId === 'run', 'Run menu opens through its visible pointer target');
		const item = TOP_BAR_MENUS.run.items.find((item): item is TopBarMenuItem => item.type === 'command' && item.command === command);
		check(!item.disabled, `Run-menu command must be enabled: ${command}`);
		await click(item.bounds);
	};
	const runPaletteCommand = async (label: string): Promise<void> => {
		await press('ControlLeft', 'ShiftLeft', 'KeyP');
		const picker = ide.editor.quickInput;
		check(picker.visible && picker.title === 'COMMAND PALETTE', 'palette: the IDE shortcut opens the shared picker');
		clipboard.text = label;
		await press('ControlLeft', 'KeyV');
		const commandIndex = picker.model.list.rows.findIndex(row => row.item.label === label);
		check(commandIndex >= 0, `palette: ${label} is an enabled registered command`);
		for (let index = 0; index < commandIndex; index += 1) await press('ArrowDown');
		check(picker.model.list.selectionIndex === commandIndex, `palette: keyboard selects ${label}`);
		await press('Enter');
	};
	const settle = () => until(() => tasks.ready && !rewind.seeking, 'seek/queue must settle');
	const guest = ide.luaTooling.suspendedGuest;
	// Diagnostic reads use the same raw guest representation as the inspector.
	// No cart probe, Lua call, alternate world or replacement ROM is installed.
	const world = () => guest.global(buildModuleExportSlotName('cartlib/world/world', []));
	const title = () => {
		const objects = guest.readStringMember(world(), '_objects') as Table;
		for (let index = 1; index <= objects.arrayLength; index += 1) {
			const object = objects.get(index);
			if (guest.formatValue(guest.readStringMember(object, 'id')) === 'nemesis_s.title_screen') return object;
		}
		throw new Error('real title actor missing');
	};
	audio.bootstrap();
	return { runtime, ide, execution, rewind, tasks, history, harness, guest, clock, input, clipboard, observations,
		frame, until, setKey, setPointerButton, press, movePointer, click, clickTab, runMenuCommand, runPaletteCommand, settle, cycles, title, capture };
}

export type StudioFixture = Awaited<ReturnType<typeof createStudioFixture>>;

/** Shared product file-creation flow; callers author bytes and choose Save/Reboot themselves. */
export async function createStudioLuaSource(test: StudioFixture, path: string, source: string) {
	await test.press('ControlLeft', 'KeyN');
	await test.press('ControlLeft', 'KeyA');
	test.clipboard.text = path;
	await test.press('ControlLeft', 'KeyV');
	await test.press('Enter');
	await test.until(() => !createResourceState.visible, `New File creates ${path}`);
	const model = test.harness.getActiveEditorDocument().model;
	check(model.resource.path === path, 'New File opens its actual working copy');
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: source }]);
	return model;
}
import { HttpWorkspaceRecordProvider } from '../../../ide/browser/workspace_records';
