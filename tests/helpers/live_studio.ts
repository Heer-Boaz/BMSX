import { MemoryStorage } from '../../ide/workspace/memory_storage';
import { WorkbenchPreferences } from '../../ide/workbench/services/preferences/preferences';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { TestContext } from 'node:test';
import { HostAudioDevice } from '../../hosts/common/audio_device';
import { HostAudioOutput } from '../../hosts/common/audio_output';
import { HostExecutionControl } from '../../hosts/common/execution_control';
import { HostFrameSession } from '../../hosts/common/frame_session';
import { Input } from '../../hosts/common/input/manager';
import { RemoteInput } from '../../hosts/common/input/remote';
import { initializeMachineRuntime, initializeMachineVideoPresenter } from '../../hosts/common/machine_runtime';
import { OffscreenVideoOutput } from '../../hosts/common/offscreen_video_output';
import { RenderPresentationState } from '../../hosts/common/presentation_state';
import { HostRewind } from '../../hosts/common/rewind';
import { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { SystemOutputLog } from '../../hosts/common/system_output_log';
import { DiscardingAudioSink } from '../../hosts/node/common/discarding_audio';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { clearBackgroundTasks } from '../../ide/common/background_tasks';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { runStudioHostFrame } from '../../ide/workbench/frame';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { HeadlessGPUBackend } from '../../machine/ts/render/headless/backend';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { createLoadedTestRuntimeSourceState } from './runtime_sources';
import { MemoryWorkspaceFiles } from './workspace_files';


/** Ordinary boot and the physical host phases of Studio, shared by live editor regressions. */
export async function createLiveStudioFixture(t: TestContext) {
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	const [system, cart] = await Promise.all([readFile('dist/system/bmsx-bios.debug.rom'), readFile('dist/studio_test.debug.rom')]);
	const media = await loadRomToolingMedia(system, [cart, null]);
	const sources = createLoadedTestRuntimeSourceState(media.system, media.cartridgeSlots);
	const clock = new VirtualHeadlessClock(), input = new Input(clock, new HeadlessInputHub(), -1);
	const runtime = initializeMachineRuntime(system, [cart, null], PSX_MACHINE_SPEC, input);
	const backend = new HeadlessGPUBackend(256, 212, runtime.model.gxGpuVramBytes);
	const display = new OffscreenVideoOutput(256, 212);
	const presenter = initializeMachineVideoPresenter(runtime, display, backend);
	presenter.crt_postprocessing_enabled = false;
	const audio = new HostAudioOutput(new HostAudioDevice(new DiscardingAudioSink()), runtime.machine.audioController, runtime.timing.ufpsScaled);
	const tasks = new RuntimeTaskQueue(audio, presenter), execution = new HostExecutionControl(audio);
	const screen = new RenderPresentationState(), log = { log() {} }, output = new SystemOutputLog();
	const rewind = new HostRewind(runtime, presenter, screen, tasks, audio, log);
	const session = new HostFrameSession(runtime.timing.ufpsScaled, 0, rewind, execution);
	const externalWork = (): never => { throw new Error('Live Studio does not build a fixture or another runtime.'); };
	const ide = new RuntimeIdeState(runtime, presenter, { capture: externalWork }, externalWork,
		display,
		new WorkbenchPreferences(new MemoryStorage()), input, audio, tasks, execution, rewind, clock, new HeadlessClipboard(), new IdeMicrotaskQueue(), log,
		0.3, { width: 800, height: 360 }, sources, new Map(), externalWork, externalWork, externalWork);
	const editor = ide.editor;
	t.after(async () => {
		inputFocus.setTarget(null); pointerCapture.interrupt(false); editor.editorParts.clear();
		await editor.shutdown(); clearBackgroundTasks(); editorTextModelService.clear(); sources.catalog.dispose();
		presenter.dispose(); audio.dispose(); input.dispose(); closeWorkspaceRecords();
	});
	const frame = async () => {
		clock.advance(1000 / 60);
		runStudioHostFrame(session, runtime, presenter, input, audio, output, ide, screen, clock.now());
		await tasks.join(); await Promise.resolve();
		assert.equal(ide.fault.hostFrameFailure, undefined);
		assert.equal(ide.fault.faultSnapshot, null);
		editor.update(0);
	};
	const until = async (condition: () => boolean) => {
		for (let i = 0; i < 500 && !condition(); i++) await frame();
		assert.ok(condition(), 'operation completes through normal Studio frame progress');
	};
	assert.equal(ide.boots.start('installed').result!.status, 'reset');
	await until(() => ide.guest.global('studio_test_ready') === true);
	ide.transport.pause();
	display.workspace.layout(2400, 1080);
	editor.activate();
	await frame();
	const native = new RemoteInput(input, clock, undefined, event => editor.dispatchPointer(event), event => editor.dispatchWheel(event));
	return { ide, editor, sources, runtime, execution, backend, display, presenter, tasks, native, frame, until };
}
