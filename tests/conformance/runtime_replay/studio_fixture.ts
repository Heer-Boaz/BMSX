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
import { TOP_BAR_MENUS, type TopBarMenuItem } from '../../../ide/workbench/ui/top_bar/menu';

export function check(condition: boolean, message: string): void {
	if (!condition) throw new Error(message);
}

/** Actual Studio composition; backend selection belongs to the test project. */
export async function createStudioFixture(canvas: HTMLCanvasElement, backend: GPUBackend) {
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
	const ide = await prepareWorkbenchRuntime(bios, [cart, null], runtime, presenter, display, input,
		audio, tasks, execution, rewind, menu, localStorage, clock, new BrowserClipboard(), new IdeMicrotaskQueue(), log, 0.3);
	const output = new SystemOutputLog();
	const harness = createHeadlessIdeHarness(ide, runtime, input, audio, localStorage, log);
	const history = runtime.history;
	const cycles = () => runtime.machine.scheduler.currentNowCycles();
	const frame = async () => {
		clock.advance(runtime.timing.frameDurationMs);
		runWorkbenchHostFrame(session, runtime, presenter, input, audio, output, log, ide, screen, menu, clock.now());
		observations.hostFrames += 1;
		await new Promise<void>(resolve => setTimeout(resolve, 0));
		check(!ide.fault.hostFrameFailed, 'workbench host frame failed');
		check(runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE) <= observations.expectedFaultSequence, 'unexpected Nemesis fault');
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
	const press = async (...keys: string[]) => {
		for (const key of keys) setKey(key, true);
		await frame();
		for (const key of keys) setKey(key, false);
		await frame();
	};
	const click = async (bounds: RectBounds, heldFrames = 1) => {
		const displayRect = display.measureDisplay();
		const viewport = ide.overlayRenderer.viewportSize;
		input.inputAxis2('pointer:0', 'pointer_position',
			displayRect.left + (bounds.left + bounds.right) * displayRect.width / (viewport.width * 2),
			displayRect.top + (bounds.top + bounds.bottom) * displayRect.height / (viewport.height * 2), clock.now());
		await frame();
		input.inputButton('pointer:0', 'pointer_primary', true, 1, clock.now(), ++pressId);
		for (let index = 0; index < heldFrames; index += 1) await frame();
		input.inputButton('pointer:0', 'pointer_primary', false, 0, clock.now(), ++pressId);
		await frame();
	};
	const runMenuCommand = async (command: EditorCommandId) => {
		check(ide.editor.isActive, 'Run-menu commands require editor focus');
		if (editorChromeState.openMenuId !== 'run') await click(editorChromeState.menuEntryBounds.run);
		check(editorChromeState.openMenuId === 'run', 'Run menu opens through its visible pointer target');
		const item = TOP_BAR_MENUS.run.items.find((item): item is TopBarMenuItem => item.type === 'command' && item.command === command);
		check(!item.disabled, `Run-menu command must be enabled: ${command}`);
		await click(item.bounds);
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
	return { runtime, ide, execution, rewind, tasks, history, harness, guest, clock, input, observations,
		frame, until, setKey, press, click, runMenuCommand, settle, cycles, title };
}

export type StudioFixture = Awaited<ReturnType<typeof createStudioFixture>>;
