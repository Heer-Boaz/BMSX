import { AssistantHttpConnection } from '../../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../../ide/browser/http_session';
import { resolveRuntimeLuaSource } from '../../../ide/runtime/sources';
import { check, createStudioFixture } from './studio_fixture';
import { reachNemesisTitle } from './studio_nemesis_navigation';
import { createStudioRenderer, type StudioRendererKind } from './studio_renderer';
import { submitAssistantText } from './studio_assistant_navigation';

/** Actual cart source stop -> conversation stack/scopes/values -> shared Terminal continuation. */
export async function runAssistantStack(kind: StudioRendererKind, canvas: HTMLCanvasElement, capture: (name: string) => Promise<void>) {
	const renderer = await createStudioRenderer(kind, canvas, capture), http = new StudioHttpSession();
	const test = await createStudioFixture(canvas, renderer.backend, renderer.capture, (signal, emit) => AssistantHttpConnection.open(http, signal, emit));
	const { ide, runtime, frame, until, cycles, harness } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'stack tools: boot actual cart');
	await reachNemesisTitle(test);
	const resource = { domain: 0 as const, path: 'cartlib/world/world.lua' };
	const lines = resolveRuntimeLuaSource(ide.sources, resource)!.record.src.split('\n');
	const declaration = lines.findIndex(line => line.includes('function world_class:active_definition_view('));
	const line = lines.findIndex((text, index) => index > declaration && text.includes('views[definition_id] = created')) + 1;
	harness.openLuaSource(resource.path); await frame();
	const model = harness.getActiveEditorDocument().model;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- stack locations must still name installed code\n' }]);
	const version = model.version, media = ide.sources.currentBlua32Media;
	await test.runPaletteCommand('View: Codex Assistant');
	await test.runMenuCommand('pause');
	ide.debugger.breakpoints.toggle(resource, line);
	check(ide.debugger.breakpoints.bindings.pcs[1].size !== 0, 'stack tools: breakpoint bound to installed code');
	await submitAssistantText(test, 'Call active_definition_view in the real Lua Terminal, inspect its stopped stack, locals, upvalues and self, then continue. Keep my source uninstalled.');
	await until(() => ide.debugger.stopped && ide.terminal.active !== undefined, 'stack tools: actual cart method breakpoint');
	const stoppedAt = cycles(), heap = runtime.machine.cpu.luaHeap.usedBytes();
	const inspection = ide.inspection.open();
	const stopped = inspection.readStack(0, 100);
	const method = stopped.frames[0];
	check(method.kind === 'source' && method.resource.path === resource.path && method.line === line, 'installed source owns stop location');
	const scopes = inspection.frameScopes(method.reference).scopes;
	const locals = inspection.read(scopes[0].reference!, 0, scopes[0].count!);
	check(locals.entries.some(entry => entry.key.display === 'self' && entry.value.kind === 'table'), 'actual method receiver is inspectable');
	check(locals.entries.some(entry => entry.key.display === 'created' && entry.value.kind === 'table'), 'actual method local table is inspectable');
	check(cycles() === stoppedAt && runtime.machine.cpu.luaHeap.usedBytes() === heap, 'stack/scopes reads neither execute nor allocate guest state');
	await until(() => harness.getActiveCodeContext()?.executionStopRow === line - 1, 'stack tools: ordinary debugger source navigation');
	await renderer.capture!('paused-call');
	ide.debugger.breakpoints.toggle(resource, line);
	await until(() => ide.editor.assistant.state === 'ready', 'stack tools: real model reads scopes and continues');
	let expired = false;
	try { inspection.frameScopes(method.reference); } catch (error) { expired = String(error).includes('expired'); }
	check(expired, 'continued execution expires the same stop-scoped handles used by ordinary Studio');
	check(model.version === version && model.dirty && ide.sources.currentBlua32Media === media && test.execution.userPaused,
		'inspection and continuation preserve unsaved source, installed code and independent pause');
	const completedAt = cycles();
	for (let index = 0; index < 6; index++) await frame();
	check(cycles() === completedAt, 'Terminal continuation does not resume gameplay');
	await test.runPaletteCommand('View: Codex Assistant'); await frame();
	await renderer.capture!('conversation-inspection');
	await renderer.finish(); await ide.editor.shutdown();
	return { stack: 'pass', target: ide.inspection.target, stoppedAt, completedAt, line };
}
