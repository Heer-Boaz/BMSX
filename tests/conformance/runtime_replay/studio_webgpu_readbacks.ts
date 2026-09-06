import type { WebGPUBackend } from '../../../machine/ts/render/backend/webgpu/backend';
import { check, type StudioFixture } from './studio_fixture';

/** Additional WebGPU-only callback lifetime test, not a requirement of the developer loop. */
export async function testStudioWebGpuReadbacks(test: StudioFixture, backend: WebGPUBackend) {
	const { runtime, ide, execution, rewind, tasks, history, harness, frame, until, press, runMenuCommand, cycles } = test;
	const source = harness.getActiveEditorDocument().model.buffer.getText();
	check(source.includes("pattern = 'up[jp]'"), 'readback test starts from the repaired FSM revision');
	await runMenuCommand('pause');
	// Hold the actual WebGPU snapshot mapping, not a fake readback or a GP0
	// packet spliced into the real cart's in-progress DMA command stream.
	const readbackBuffer = backend.gxGpuState.vramReadbackBuffer;
	const mapAsync = readbackBuffer.mapAsync.bind(readbackBuffer);
	let releaseReadback!: () => void;
	const readbackGate = new Promise<void>(resolve => { releaseReadback = resolve; });
	let mapping = false;
	readbackBuffer.mapAsync = async (mode: GPUMapModeFlags, offset?: GPUSize64, size?: GPUSize64): Promise<undefined> => {
		await mapAsync(mode, offset, size);
		mapping = true;
		await readbackGate;
		return undefined;
	};
	await until(() => mapping, 'next continuous checkpoint maps actual VRAM');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	await press('ControlRight', 'ShiftRight');
	await press('ControlRight', 'AltRight');
	for (let index = 0; index < 3; index += 1) await press('ArrowUp');
	await press('KeyX');
	const mappingAt = cycles();
	rewind.seekTo(history.earliestCycles);
	rewind.seekTo(history.latestCycles);
	await frame();
	await press('ControlRight', 'ShiftRight');
	check(ide.editor.isActive && execution.userPaused && cycles() === mappingAt, 'IDE stays reachable during GPU fence');
	harness.openLuaSource('title_screen.lua');
	harness.replaceActiveCodeSource(source.replace("pattern = 'up[jp]'", "pattern = 'right[jp]'"));
	const mappingMedia = ide.sources.currentBlua32Media;
	const pendingApply = harness.performHotResume();
	for (let index = 0; index < 4; index += 1) await frame();
	check(ide.sources.currentBlua32Media === mappingMedia && cycles() === mappingAt,
		'apply waits for old callbacks; no replay or code mutation while mapping is held');
	releaseReadback();
	await pendingApply;
	readbackBuffer.mapAsync = mapAsync;
	await until(() => tasks.ready && !ide.debugger.plans.mutationActive && !runtime.completionCallPending()
		&& history.checkpointCount !== 0, 'pending apply completes at retained position');
	check(history.earliestCycles >= mappingAt, 'superseded seeks cannot win after code apply');

	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	check(execution.userPaused && ide.editor.isActive, 'readback completion leaves pause and IDE commands usable');
	return { mappingAt };
}
