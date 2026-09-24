import { AssistantHttpConnection } from '../../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../../ide/browser/http_session';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { createStudioFixture, check } from './studio_fixture';
import { reachNemesisTitle } from './studio_nemesis_navigation';
import { createStudioRenderer, type StudioRendererKind } from './studio_renderer';
import { submitAssistantText } from './studio_assistant_navigation';

/** Actual review/Save owners and HTTP IO, including an accepted write which outlives its prompt. */
export async function runAssistantSourceSave(kind: StudioRendererKind, canvas: HTMLCanvasElement, capture: (name: string) => Promise<void>,
	waitForHeldSave: () => Promise<void>, releaseHeldSave: () => Promise<void>) {
	const renderer = await createStudioRenderer(kind, canvas, capture), http = new StudioHttpSession();
	const test = await createStudioFixture(canvas, renderer.backend, renderer.capture, (signal, emit) => AssistantHttpConnection.open(http, signal, emit));
	const { ide, runtime, until, cycles, frame, press, harness, runPaletteCommand } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'source Save: boot authoring target');
	await reachNemesisTitle(test); harness.openLuaSource('cart.lua'); await frame();
	const mainTab = getActiveTab(), main = harness.getActiveEditorDocument().model;
	const original = main.buffer.getText(), media = ide.sources.currentBlua32Media, stoppedAt = cycles();
	await runPaletteCommand('View: Codex Assistant');
	const view = getActiveTab(); if (view.kind !== 'assistant') throw new Error('Assistant required');
	const conversation = ide.editor.assistant;
	await submitAssistantText(test, 'Read Lua and canonical YAML. Propose comments for review, without saving or installing.');
	await until(() => conversation.state === 'ready' && conversation.entries.some(entry => entry.proposal !== undefined), 'source Save: model proposes exact source edits');
	const proposal = conversation.entries.find(entry => entry.proposal !== undefined)!.proposal!;
	const yaml = proposal.files.find(file => file.model.mode === 'yaml')!.model;
	const originalYaml = yaml.buffer.getText();
	check(main.buffer.getText() === original && !main.dirty && !yaml.dirty && ide.textFileSaves.latestOperation(main) === undefined,
		'a proposal is neither Apply nor Save');
	await test.click(view.turnActions.items.find(item => item.command === 'assistant.review')!.bounds);
	const review = getActiveTab(); if (review.kind !== 'workspace_edit_review') throw new Error('Shared review required');
	await frame(); await renderer.capture!('review');
	await test.click(review.actionBar.items.find(item => item.command === 'workspaceEditReview.apply')!.bounds);
	check(proposal.state === 'applied' && main.dirty && yaml.dirty && main.lastSavedSource === original
		&& yaml.lastSavedSource === originalYaml && ide.sources.currentBlua32Media === media, 'visible review Apply changes only working copies');
	await test.clickTab(view.id);
	await submitAssistantText(test, 'Read fresh receipts and status. Save the reviewed YAML, then Save the reviewed Lua. Do not install code.');
	await until(() => ide.textFileSaves.latestOperation(main) !== undefined, 'source Save: conversation admits the actual Lua write');
	await waitForHeldSave();
	const operation = ide.textFileSaves.latestOperation(main)!;
	check(operation.result === undefined && !yaml.dirty && main.dirty, 'Save is pending until its project acknowledgement arrives');
	await test.clickTab(mainTab.id); await press('ControlLeft', 'Home');
	test.clipboard.text = '-- later typing\n'; await press('ControlLeft', 'KeyV');
	await test.clickTab(view.id);
	await test.click(view.turnActions.items.find(item => item.command === 'assistant.stop')!.bounds);
	await until(() => conversation.state === 'ready', 'source Save: visible Stop retires the pending tool reply');
	check(operation.result === undefined, 'Stop does not fabricate Save success or undo the accepted write');
	await releaseHeldSave();
	await until(() => operation.result !== undefined, 'source Save: accepted write finishes after its prompt');
	check(operation.result!.status === 'saved' && main.dirty && main.lastSavedSource === operation.snapshot.source,
		'acknowledgement belongs to the captured source, not later typing');
	await submitAssistantText(test, 'Inspect fresh source and the historical Save result. Do not save the newer typing yet.');
	await until(() => conversation.state === 'ready', 'source Save: later prompt sees the ordinary owner acknowledgement');
	await frame(); await renderer.capture!('retired-save');
	await test.clickTab(mainTab.id); await press('ControlLeft', 'KeyS');
	await until(() => ide.textFileSaves.latestOperation(main) !== operation && !main.dirty, 'source Save: ordinary Ctrl+S saves the newer revision');
	await test.clickTab(view.id);
	await submitAssistantText(test, 'Read fresh status after my ordinary Ctrl+S. Distinguish persistence from runtime installation.');
	await until(() => conversation.state === 'ready', 'source Save: conversation observes the manual Save');
	check(cycles() === stoppedAt && ide.sources.currentBlua32Media === media && !test.execution.userPaused,
		'review and Lua/YAML Save never execute or install the authoring target, nor change the user pause request');
	await frame(); await renderer.capture!('manual-save');
	await renderer.finish(); await ide.editor.shutdown();
	return { sourceSave: 'pass', main: main.buffer.getText(), yaml: yaml.buffer.getText() };
}
