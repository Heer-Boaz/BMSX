import { AssistantHttpConnection } from '../../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../../ide/browser/http_session';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { check, createStudioFixture } from './studio_fixture';
import { reachNemesisTitle } from './studio_nemesis_navigation';
import { createStudioRenderer, type StudioRendererKind } from './studio_renderer';
import { submitAssistantText } from './studio_assistant_navigation';

/** Real source review, persistence, Reboot, debugger, Terminal and isolated test target. */
export async function runAssistantProgram(kind: StudioRendererKind, canvas: HTMLCanvasElement, capture: (name: string) => Promise<void>,
	armProgramRead: () => Promise<void>, waitForProgramRead: () => Promise<void>, releaseProgramRead: () => Promise<void>) {
	const renderer = await createStudioRenderer(kind, canvas, capture), http = new StudioHttpSession();
	const test = await createStudioFixture(canvas, renderer.backend, renderer.capture, (signal, emit) => AssistantHttpConnection.open(http, signal, emit));
	const { ide, runtime, until, cycles, harness, frame, press } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'program: boot actual authored fixture');
	await reachNemesisTitle(test); harness.openLuaSource('cart.lua'); await frame();
	const mainTab = getActiveTab(), main = harness.getActiveEditorDocument().model;
	const original = main.buffer.getText(), oldMedia = ide.sources.currentBlua32Media, before = cycles();
	await test.runPaletteCommand('View: Codex Assistant');
	const view = getActiveTab(); if (view.kind !== 'assistant') throw new Error('Assistant pane required');
	const conversation = ide.editor.assistant;
	await submitAssistantText(test, 'Run installed_probe and inspect its failure. Read cart.lua and propose the source fix for review. Do not save or install yet.');
	await until(() => conversation.state === 'ready' && conversation.entries.some(entry => entry.proposal !== undefined), 'program: reproduce failure and offer canonical-source repair');
	const proposal = conversation.entries.find(entry => entry.proposal !== undefined)!.proposal!;
	check(main.buffer.getText() === original && !main.dirty && cycles() === before && ide.sources.currentBlua32Media === oldMedia,
		'failure reproduction and proposal do not change the authoring machine');
	await test.click(view.turnActions.items.find(item => item.command === 'assistant.review')!.bounds);
	const review = getActiveTab(); if (review.kind !== 'workspace_edit_review') throw new Error('Shared review required');
	await frame(); await renderer.capture!('review');
	await test.click(review.actionBar.items.find(item => item.command === 'workspaceEditReview.apply')!.bounds);
	check(proposal.state === 'applied' && main.dirty && main.lastSavedSource === original, 'visible Apply does not Save or install');
	await test.clickTab(view.id);
	await submitAssistantText(test, 'Save the reviewed fix. Compare installed source, Reboot with current Lua sources, then verify the installed code using a breakpoint and the Lua Terminal. Capture the current frame, clear the breakpoint, advance 120 video frames and capture the visible intro. Rerun the unchanged test. Report reset separately from execution and test results.');
	await until(() => conversation.state === 'ready', 'program: Save, actual install/reset, execution, image and independent rerun finish');
	check(!main.dirty && ide.sources.currentBlua32Media !== oldMedia && ide.editor.isActive,
		'Reboot installs without closing the conversation');
	check(ide.terminal.lastResult?.result?.status === 'completed' && ide.scenarioRuns.results.runs[0].state === 'passed',
		'actual Terminal completion and scenario result belong to their separate owners');
	await test.clickTab(view.id); await frame(); await renderer.capture!('installed-and-retested');
	const media = ide.sources.currentBlua32Media, position = cycles(), latest = ide.boots.latestOperation;
	await armProgramRead();
	await submitAssistantText(test, 'Reboot again; I will stop it during source preparation.');
	await until(() => ide.boots.latestOperation !== latest && ide.boots.latestOperation?.status === 'reading-sources', 'program: real Reboot source IO is pending');
	await waitForProgramRead();
	const pending = ide.boots.latestOperation!;
	await test.clickTab(mainTab.id); await press('ControlLeft', 'Home');
	test.clipboard.text = '-- typed during cancelled preparation\n'; await press('ControlLeft', 'KeyV');
	await test.clickTab(view.id);
	await test.click(view.turnActions.items.find(item => item.command === 'assistant.stop')!.bounds);
	await until(() => conversation.state === 'ready', 'program: visible Stop retires the accepted Reboot before installation');
	check(pending.result?.status === 'cancelled' && !pending.result.installed && !pending.result.reset, 'Stop is an actual cancelled operation, not hidden feedback');
	await releaseProgramRead(); await ide.runtimeTasks.join();
	await submitAssistantText(test, 'Read the last Reboot outcome without starting another operation.');
	await until(() => conversation.state === 'ready', 'program: next prompt observes cancellation through the shared Boot owner');
	check(cycles() === position && ide.sources.currentBlua32Media === media && main.dirty, 'late IO cannot reset the target, install or erase newer edits');
	await frame(); await renderer.capture!('cancelled-before-install');
	await renderer.finish(); await ide.editor.shutdown();
	return { program: 'pass' };
}
