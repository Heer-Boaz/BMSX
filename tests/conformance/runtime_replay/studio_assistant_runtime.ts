import { AssistantHttpConnection } from '../../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../../ide/browser/http_session';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { check, createStudioFixture } from './studio_fixture';
import { reachNemesisTitle } from './studio_nemesis_navigation';
import { createStudioRenderer, type StudioRendererKind } from './studio_renderer';

/** Actual browser machine -> HTTP bridge -> Codex app-server -> deterministic model fixture. */
export async function runAssistantRuntime(kind: StudioRendererKind, canvas: HTMLCanvasElement, capture: (name: string) => Promise<void>) {
	const renderer = await createStudioRenderer(kind, canvas, capture), http = new StudioHttpSession();
	const test = await createStudioFixture(canvas, renderer.backend, renderer.capture, (signal, emit) => AssistantHttpConnection.open(http, signal, emit));
	const { ide, runtime, frame, until, press, cycles } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'runtime tools: boot actual cart');
	await reachNemesisTitle(test);
	test.harness.openLuaSource('cart.lua'); await frame();
	const model = test.harness.getActiveEditorDocument().model;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- uninstalled source, not runtime state\n' }]);
	await test.runPaletteCommand('View: Codex Assistant');
	const view = getActiveTab(); if (view.kind !== 'assistant') throw new Error('Assistant pane required');
	const position = cycles(), videoTick = runtime.frameScheduler.lastTickSequence, heap = runtime.machine.cpu.luaHeap.usedBytes(), version = model.version;
	const media = ide.sources.currentBlua32Media, conversation = ide.editor.assistant;
	await test.click(view.composerBounds);
	test.clipboard.text = 'Pause and inspect the real world and one object. Do not execute Lua or modify source.';
	await press('ControlLeft', 'KeyV'); await press('ControlLeft', 'Enter');
	await until(() => conversation.state === 'ready' && conversation.entries.some(entry => entry.kind === 'assistant'), 'runtime tools: real model tool round trip');
	check(cycles() === position && runtime.frameScheduler.lastTickSequence === videoTick && runtime.machine.cpu.luaHeap.usedBytes() === heap,
		'runtime tool reads do not execute the guest or allocate guest values');
	check(test.execution.userPaused && model.version === version && ide.sources.currentBlua32Media === media,
		'runtime tools retain user pause and leave unsaved source/installed media alone');
	await frame(); await renderer.capture!('runtime-inspection-response');

	// With no editor attached, actual execution (not pane detachment) must revoke borrows.
	await press('ControlRight', 'ShiftRight'); await frame();
	check(!ide.editor.isActive && test.execution.userPaused, 'closing Studio keeps the explicit tool pause');
	await until(() => test.tasks.ready, 'runtime tools: drain background history work');
	const inspection = ide.inspection.open(), reference = inspection.scopes.find(scope => scope.domain === 0)!.reference!;
	inspection.read(reference, 0, 1);
	test.execution.requestExecution(true);
	await until(() => cycles() > position, 'runtime tools: execute with the editor closed');
	let expired = false;
	try { inspection.read(reference, 0, 1); } catch (error) { expired = String(error).includes('expired'); }
	check(expired, 'actual execution retires borrows without a visible IDE pane');
	for (let index = 0; index < 4; index++) await frame();
	await until(() => test.tasks.ready, 'runtime tools: record frames for rewind');
	ide.inspection.pause();
	const beforeRewind = ide.inspection.open(), oldReference = beforeRewind.scopes[0].reference!;
	test.rewind.stepFrame(-1);
	await until(() => !test.rewind.seeking && test.tasks.ready, 'runtime tools: rewind reaches a stopped target');
	expired = false;
	try { beforeRewind.read(oldReference, 0, 1); } catch (error) { expired = String(error).includes('expired'); }
	check(expired && test.rewind.active && ide.inspection.canInspect, 'restore retires borrows and the paused historical target is inspectable');
	const historical = ide.inspection.open(), historicalReference = historical.scopes[0].reference!;
	historical.read(historicalReference, 0, 1);
	test.rewind.stepFrame(1);
	await until(() => !test.rewind.seeking && test.tasks.ready, 'runtime tools: recorded forward frame completes');
	expired = false;
	try { historical.read(historicalReference, 0, 1); } catch (error) { expired = String(error).includes('expired'); }
	check(expired && ide.fault.faultSnapshot === null, 'recorded forward execution also retires historical borrows');
	await renderer.finish(); await ide.editor.shutdown();
	return { inspection: 'pass', position, videoTick, target: ide.inspection.target };
}
