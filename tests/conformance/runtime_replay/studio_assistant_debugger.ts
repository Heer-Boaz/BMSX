import { AssistantHttpConnection } from '../../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../../ide/browser/http_session';
import { resolveRuntimeLuaSource } from '../../../ide/runtime/sources';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { check, createStudioFixture } from './studio_fixture';
import { reachNemesisTitle } from './studio_nemesis_navigation';
import { createStudioRenderer, type StudioRendererKind } from './studio_renderer';
import { submitAssistantText } from './studio_assistant_navigation';

/** Every breakpoint and source step below is issued by Codex's real tool transport. */
export async function runAssistantDebugger(kind: StudioRendererKind, canvas: HTMLCanvasElement, capture: (name: string) => Promise<void>) {
	const renderer = await createStudioRenderer(kind, canvas, capture), http = new StudioHttpSession();
	const test = await createStudioFixture(canvas, renderer.backend, renderer.capture, (signal, emit) => AssistantHttpConnection.open(http, signal, emit));
	const { ide, runtime, frame, until, cycles, harness } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'debugger tools: boot actual cart');
	await reachNemesisTitle(test);
	const resource = { domain: 0 as const, path: 'cartlib/world/world.lua' };
	const installed = resolveRuntimeLuaSource(ide.sources, resource)!.record.src;
	harness.openLuaSource(resource.path); await frame();
	const model = harness.getActiveEditorDocument().model;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty editor is NOT the source being debugged\n' }]);
	const version = model.version, media = ide.sources.currentBlua32Media;
	await test.runPaletteCommand('View: Codex Assistant'); await test.runMenuCommand('pause');
	await submitAssistantText(test, 'Use installed source to set a real cart breakpoint, call active_definition_view, inspect and source-step into/over/out, then complete the call and clear the breakpoint. Keep my dirty source uninstalled.');
	await until(() => ide.debugger.source.stop !== undefined && ide.terminal.active !== undefined, 'debugger tools: model-set breakpoint hits actual cart method');
	const evaluation = ide.terminal.active!, stoppedAt = cycles();
	check(ide.debugger.breakpoints.get(resource).size === 2, 'tools and gutter share the actual breakpoint owner');
	await renderer.capture!('model-breakpoint');
	await until(() => ide.editor.assistant.state === 'ready', 'debugger tools: model source stepping and return finish');
	check(ide.terminal.lastResult === evaluation && evaluation.result?.status === 'completed', 'debugger source controls complete the SAME Terminal call');
	check(ide.debugger.breakpoints.get(resource).size === 0, 'model clears only the requested source breakpoints');
	check(model.version === version && model.dirty && media === ide.sources.currentBlua32Media && test.execution.userPaused,
		'source debugging preserves dirty source, installed code and independent pause');
	const completedAt = cycles(); for (let i = 0; i < 6; i++) await frame();
	check(cycles() === completedAt, 'control boundary does not run the suspended game');
	await test.runPaletteCommand('View: Codex Assistant'); await frame(); await renderer.capture!('conversation-stops');
	await submitAssistantText(test, 'Continue until I press Stop.');
	await until(() => ide.debuggerExecution.active !== undefined, 'debugger tools: conversation owns ongoing Continue');
	const operation = ide.debuggerExecution.active!;
	await until(() => cycles() > completedAt + runtime.timing.cpuHz / 60, 'debugger tools: Continue actually runs game behind chat');
	const view = getActiveTab(); if (view.kind !== 'assistant') throw new Error('Assistant pane required');
	await test.click(view.turnActions.items.find(item => item.command === 'assistant.stop')!.bounds);
	await renderer.capture!('stop-dispatched');
	check(operation.outcome?.reason === 'cancelled' || operation.result?.reason === 'cancelled',
		`visible Stop dispatches before waiting for provider completion: assistant=${ide.editor.assistant.state}, active=${ide.debuggerExecution.active === operation}, outcome=${operation.outcome?.reason}, result=${operation.result?.reason}`);
	await until(() => ide.editor.assistant.state === 'ready' && ide.debuggerExecution.active === undefined, 'debugger tools: visible Stop settles owned continuation');
	check(operation.result?.status === 'interrupted' && operation.result.reason === 'cancelled', 'conversation Stop pauses only its own run');
	const cancelledAt = cycles(); for (let i = 0; i < 6; i++) await frame();
	check(cycles() === cancelledAt && test.execution.userPaused, 'cancelled source run cannot keep the scheduler alive');
	await renderer.capture!('cancelled-continue');
	await renderer.finish(); await ide.editor.shutdown();
	return { debugger: 'pass', target: ide.inspection.target, stoppedAt, completedAt, cancelledAt, installed };
}
