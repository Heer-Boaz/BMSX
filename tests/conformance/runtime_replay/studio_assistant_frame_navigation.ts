import { AssistantHttpConnection } from '../../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../../ide/browser/http_session';
import { check, createStudioFixture } from './studio_fixture';
import { reachNemesisTitle } from './studio_nemesis_navigation';
import { createStudioRenderer, type StudioRendererKind } from './studio_renderer';
import { submitAssistantText } from './studio_assistant_navigation';

/** Real conversation tool execution; no synthetic tool dispatch or second execution loop. */
export async function runAssistantNavigation(kind: StudioRendererKind, canvas: HTMLCanvasElement, capture: (name: string) => Promise<void>) {
	const renderer = await createStudioRenderer(kind, canvas, capture), http = new StudioHttpSession();
	const test = await createStudioFixture(canvas, renderer.backend, renderer.capture, (signal, emit) => AssistantHttpConnection.open(http, signal, emit));
	const { ide, runtime, frame, until, cycles } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'navigation tools: boot actual cart');
	await reachNemesisTitle(test);
	test.harness.openLuaSource('cart.lua'); await frame();
	const source = test.harness.getActiveEditorDocument().model;
	source.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- navigation must not install this source\n' }]);
	await test.runPaletteCommand('View: Codex Assistant');
	const view = ide.editor.editorGroup.model.activeTab; if (view.kind !== 'assistant') throw new Error('Assistant pane required');
	const before = { cycles: cycles(), videoTick: runtime.frameScheduler.lastTickSequence };
	const version = source.version, media = ide.sources.currentBlua32Media, conversation = ide.editor.assistant;
	await submitAssistantText(test, 'Inspect, advance four video frames, rewind two, capture the image, seek the original recording position and replay four. Leave me paused.');
	await until(() => conversation.state === 'ready' && conversation.entries.some(entry => entry.kind === 'assistant'), 'navigation tools: first model workflow completes');
	const after = { cycles: cycles(), videoTick: runtime.frameScheduler.lastTickSequence };
	check(after.videoTick === before.videoTick + 4 && test.execution.userPaused && ide.frameNavigation.active === undefined,
		'model completes four actual video boundaries and leaves explicit pause');
	check(ide.editor.editorGroup.model.activeTab === view && ide.editor.isActive && source.version === version && ide.sources.currentBlua32Media === media,
		'navigation needs no view switch, UI click, save or install');
	check(ide.inspection.canInspect && test.rewind.active, 'model can inspect the stopped historical target');
	await renderer.capture!('completed');
	for (let i = 0; i < 8; i++) await frame();
	check(cycles() === after.cycles, 'completion does not silently resume gameplay');

	await submitAssistantText(test, 'Advance a long batch until I press Stop.');
	await until(() => ide.frameNavigation.active !== undefined && cycles() > after.cycles, 'navigation tools: second turn has actual in-flight execution');
	const operation = ide.frameNavigation.active!;
	await test.click(view.turnActions.items.find(item => item.command === 'assistant.stop')!.bounds);
	await until(() => conversation.state === 'ready' && ide.frameNavigation.active === undefined, 'navigation tools: visible Stop retires the owned batch');
	const stopped = await operation.completion;
	check(stopped.status === 'interrupted' && stopped.reason === 'cancelled' && stopped.completedFrames > 0 && stopped.completedFrames < 100000,
		'Stop cancels a real partially executed batch, not just its provider request');
	const stoppedAt = cycles();
	for (let i = 0; i < 8; i++) await frame();
	check(cycles() === stoppedAt && test.execution.userPaused && ide.inspection.canInspect, 'cancelled navigation remains paused and inspectable');
	await renderer.capture!('stopped');

	// Ordinary controls use the same owner; no Codex-specific button was added.
	const uiBefore = runtime.frameScheduler.lastTickSequence;
	await test.runPaletteCommand('Run: Next Frame');
	await until(() => ide.frameNavigation.active === undefined, 'navigation tools: ordinary Next Frame completes');
	check(runtime.frameScheduler.lastTickSequence === uiBefore + 1 && ide.editor.editorGroup.model.activeTab.kind === 'game_view', 'ordinary command steps and opens Game View');
	const uiPresent = { cycles: cycles(), videoTick: runtime.frameScheduler.lastTickSequence };
	const retainedLatest = runtime.history.latestCycles;
	await test.runPaletteCommand('Run: Previous Frame');
	await until(() => ide.frameNavigation.active === undefined, 'navigation tools: ordinary Previous Frame completes');
	check(runtime.frameScheduler.lastTickSequence === uiBefore && test.execution.userPaused, 'ordinary previous frame reviews the preceding boundary');
	check(!ide.debuggerExecution.canResume('continue'), 'Continue is unavailable during ordinary history review');
	ide.editor.commands.execute('runtime.present');
	const presentOperation = ide.frameNavigation.active!;
	await until(() => ide.frameNavigation.active === undefined, 'navigation tools: ordinary Return to Present completes');
	const present = await presentOperation.completion;
	check(present.status === 'completed' && present.completedFrames === 0 && present.request.kind === 'finish-review'
		&& present.request.destination === 'present' && present.after.cycles === uiPresent.cycles && present.after.videoTick === uiPresent.videoTick,
		'ordinary Return to Present restores the recording end without an extra live frame');
	check(!test.rewind.active && runtime.history.latestCycles === retainedLatest && test.execution.userPaused && ide.debuggerExecution.canResume('continue'),
		'ordinary Return to Present preserves future, stays paused and enables Continue');
	await test.runPaletteCommand('Run: Previous Frame');
	await until(() => ide.frameNavigation.active === undefined, 'navigation tools: ordinary review reopens');
	const acceptedAt = { cycles: cycles(), videoTick: runtime.frameScheduler.lastTickSequence };
	await test.runPaletteCommand('Run: Use This Point');
	await until(() => ide.frameNavigation.active === undefined, 'navigation tools: ordinary Use This Point completes');
	check(cycles() === acceptedAt.cycles && runtime.frameScheduler.lastTickSequence === acceptedAt.videoTick,
		'ordinary Use This Point does not execute an extra live frame');
	check(!test.rewind.active && runtime.history.latestCycles === acceptedAt.cycles && runtime.history.latestCycles < retainedLatest
		&& test.execution.userPaused && ide.debuggerExecution.canResume('continue'),
		'ordinary Use This Point truncates future, stays paused and enables Continue');
	await frame();
	await renderer.capture!('ordinary-frame-controls');
	await renderer.finish(); await ide.editor.shutdown();
	return { navigation: 'pass', before, after, stopped, ordinaryReview: { present, acceptedAt }, target: ide.inspection.target };
}
