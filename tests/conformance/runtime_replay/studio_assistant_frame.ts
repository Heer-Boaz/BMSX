import { AssistantHttpConnection } from '../../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../../ide/browser/http_session';
import { resolveRuntimeLuaSource } from '../../../ide/runtime/sources';
import { check, createStudioFixture } from './studio_fixture';
import { reachNemesisTitle } from './studio_nemesis_navigation';
import { createStudioRenderer, type StudioRendererKind } from './studio_renderer';
import { submitAssistantText } from './studio_assistant_navigation';

/** Native app-server tools enter the same Terminal above a stopped cartridge IRQ. */
export async function runAssistantFrame(kind: StudioRendererKind, canvas: HTMLCanvasElement, capture: (name: string) => Promise<void>) {
	const renderer = await createStudioRenderer(kind, canvas, capture), http = new StudioHttpSession();
	const test = await createStudioFixture(canvas, renderer.backend, renderer.capture, (signal, emit) => AssistantHttpConnection.open(http, signal, emit));
	const { ide, runtime, frame, until, cycles } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'frame tools: boot actual cart');
	await reachNemesisTitle(test);
	test.harness.openLuaSource('cart.lua'); await frame();
	await test.runPaletteCommand('View: Codex Assistant'); await test.runMenuCommand('pause');
	const resource = { domain: 0 as const, path: 'cartlib/irq.lua' };
	const line = resolveRuntimeLuaSource(ide.sources, resource)!.record.src.split('\n').findIndex(text => text.includes('local pending = flags')) + 1;
	ide.debugger.breakpoints.toggle(resource, line);
	const continued = ide.debuggerExecution.resume('continue', 'workbench');
	await until(() => continued.result !== undefined, 'frame tools: source IRQ stop');
	const stop = ide.debugger.source.stop!, cpu = runtime.machine.cpu;
	const exceptionDepth = cpu.readExceptionReturnFrameDepth(), pcs = cpu.activeThread.frames.map(frame => frame.pc);
	check(exceptionDepth >= 0, 'frame tools: active IRQ is retained');
	await test.runPaletteCommand('View: Codex Assistant');
	await submitAssistantText(test, 'Inspect the current IRQ frame. Evaluate its flags in the Lua Terminal, change them, test a Lua error, and check that stale frame handles expire. Do not continue the game.');
	await until(() => ide.editor.assistant.state === 'ready', 'frame tools: conversation finishes real Terminal evaluations');
	check(ide.debugger.source.stop === stop && cpu.readExceptionReturnFrameDepth() === exceptionDepth
		&& cpu.activeThread.frames.length === pcs.length && cpu.activeThread.frames.every((frame, index) => frame.pc === pcs[index]),
		'frame tools: no ancestor or IRQ has executed while evaluating the selected frame');
	const held = cycles(); await frame(); await frame();
	check(cycles() === held && ide.terminal.active === undefined, 'frame tools: the conversation leaves the game stopped');
	await test.runPaletteCommand('View: Lua Terminal'); await frame(); await renderer.capture!('frame-terminal');
	await renderer.finish(); await ide.editor.shutdown();
	return { frame: 'pass', held };
}
