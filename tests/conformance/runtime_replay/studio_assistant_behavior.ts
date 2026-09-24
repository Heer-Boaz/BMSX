import { AssistantHttpConnection } from '../../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../../ide/browser/http_session';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { BEHAVIOR_TOOLS_SOURCE } from '../../helpers/behavior_tools_fixture';
import { check, createStudioFixture } from './studio_fixture';
import { createStudioRenderer, type StudioRendererKind } from './studio_renderer';
import { submitAssistantText } from './studio_assistant_navigation';
import { chooseBehavior } from './studio_behavior_picker';

/** Fixture setup writes the model; chat, review, builder navigation and Undo are visible UI actions. */
export async function runAssistantBehavior(kind: StudioRendererKind, canvas: HTMLCanvasElement, capture: (name: string) => Promise<void>) {
	const renderer = await createStudioRenderer(kind, canvas, capture), http = new StudioHttpSession();
	const test = await createStudioFixture(canvas, renderer.backend, renderer.capture, (signal, emit) => AssistantHttpConnection.open(http, signal, emit));
	const { ide, until, press, frame, harness, cycles, runPaletteCommand } = test;
	await until(() => cycles() > test.runtime.timing.cpuHz * 13, 'behavior tools: boot authoring');
	await press('ControlRight', 'ShiftRight');
	harness.openLuaSource('cart.lua');
	const document = harness.getActiveEditorDocument().model, saved = document.lastSavedSource;
	document.pushEditOperations([{ offset: 0, deleteLength: document.buffer.length, text: BEHAVIOR_TOOLS_SOURCE }]);
	const code = getActiveTab(), position = cycles(), media = ide.sources.currentBlua32Media;
	const conversation = ide.editor.assistant;
	await runPaletteCommand('Behavior Lens: Open State Machine (FSM)');
	await chooseBehavior(test, 'FSM fixture.tools.machine', 'STATE MACHINES');
	const machine = getActiveTab(); if (machine.kind !== 'behavior_lens') throw new Error('FSM Lens required');
	await machine.graphLayout.settled; await frame();
	const generation = machine.view.document;
	check(generation === ide.editor.behaviorLens.documents.get(document), 'visual and nonvisual queries share the workspace source generation');

	for (const [index, prompt] of [
		'Make active the initial state of fixture.tools.machine through the FSM source tool. Offer review only.',
		'Duplicate the first child of fixture.tools.tree through the BT source tool. Offer review only.',
		'Change fixture.tools.effect cooldown_ms to 25 through the ActionEffect source tool. Offer review only.',
	].entries()) {
		await runPaletteCommand('View: Codex Assistant');
		const chat = getActiveTab(); if (chat.kind !== 'assistant') throw new Error('Assistant required');
		const before = document.buffer.getText();
		await submitAssistantText(test, prompt);
		await until(() => conversation.state === 'ready' && conversation.entries.filter(entry => entry.kind === 'proposal').length === index + 1,
			'behavior tools: semantic edit returned through real model transport');
		const proposal = conversation.entries.filter(entry => entry.kind === 'proposal')[index].proposal!;
		check(proposal.state === 'pending' && proposal.files[0].model === document && document.buffer.getText() === before,
			'behavior tools: conversation planned a real source edit without applying it');
		if (index === 0) check(machine.view.document === generation, 'tool reads do not refresh or replace the ordinary Lens generation');
		await test.click(chat.turnActions.items.find(item => item.command === 'assistant.review')!.bounds);
		const review = getActiveTab(); if (review.kind !== 'workspace_edit_review') throw new Error('Source review required');
		await frame(); await renderer.capture!(`review-${index}`);
		await test.click(review.actionBar.items.find(item => item.command === 'workspaceEditReview.apply')!.bounds);
		check(proposal.state === 'applied', 'ordinary Apply owns the source/history mutation');
		if (index === 0) {
			await test.clickTab(machine.id); await machine.graphLayout.settled; await frame();
			const presentation = machine.view.presentation;
			check(presentation.kind === 'state-graph' && presentation.viewport.model.edges.some(edge =>
				edge.link.reference.kind === 'state-entry' && edge.link.target.source.label === 'active'), 'FSM graph reads the same changed initial edge');
		} else if (index === 1) {
			await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
			await chooseBehavior(test, 'BT fixture.tools.tree', 'BEHAVIOR TREES');
			const lens = getActiveTab(); if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'graph') throw new Error('BT graph required');
			await frame(); check(lens.view.presentation.viewport.model.nodes[0].children[0].children.length === 3, 'BT graph has the duplicated authored child');
		} else {
			await runPaletteCommand('Behavior Lens: Open ActionEffect');
			await chooseBehavior(test, 'EFFECT fixture.tools.effect', 'ACTIONEFFECTS');
			const lens = getActiveTab(); if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'properties') throw new Error('Effect properties required');
			await frame(); check(lens.view.presentation.tree.rows.some(row => row.element.kind === 'property' && row.element.value === '25'), 'ordinary effect property reads the proposed expression');
		}
		await frame(); await renderer.capture!(`builder-${index}`);
		const builder = getActiveTab(), changed = document.buffer.getText();
		await test.clickTab(code.id); await press('ControlLeft', 'KeyZ');
		check(document.buffer.getText() === before, 'one ordinary Undo restores the semantic edit exactly');
		await press('ControlLeft', 'KeyY'); check(document.buffer.getText() === changed, 'ordinary Redo reuses model history');
		await test.clickTab(builder.id); await frame();
		check(cycles() === position && ide.sources.currentBlua32Media === media && document.lastSavedSource === saved,
			'semantic source tools and review never execute, install or save the authoring game');
	}
	await runPaletteCommand('View: Codex Assistant'); await frame(); await renderer.capture!('conversation');
	const source = document.buffer.getText();
	await renderer.finish(); await ide.editor.shutdown();
	return { behavior: 'pass', source };
}
