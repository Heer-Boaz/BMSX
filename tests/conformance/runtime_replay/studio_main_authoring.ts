import { ScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/primary_client';
import { UnavailableScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/unavailable_primary';
import { openSceneFixture } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';

/** Standalone renderer workflow over a dedicated test cartridge and independent source fixtures. */
export async function runStudioMainAuthoring(test: StudioFixture) {
	await test.until(() => test.ide.sources.activeCartridgeSlot === 0, 'main: dedicated test cartridge starts');
	await test.press('ControlRight', 'ShiftRight');
	await test.runMenuCommand('pause');
	await testMainSceneAuthoring(test);
	return { hostFrames: test.observations.hostFrames, cycles: test.cycles(), mainAuthoring: 'pass' };
}

/** Explicit source fixture setup, then ordinary Files/menu/keyboard/pointer authoring in the real Workbench. */
export async function testMainSceneAuthoring(test: StudioFixture): Promise<void> {
	const { ide, frame, press, click, cycles } = test, editor = ide.editor;
	const panelWasVisible = editor.resourcePanel.isVisible();
	const { model, resource, close } = await openSceneFixture(test, 'main');
	const original = model.buffer.getText(), before = cycles(), media = ide.sources.currentBlua32Media;
	await close();
	check(editor.editorParts.groups.every(group => group.model.tabs.every(input => input.resource?.contextId !== resource.contextId)),
		'main: fixture document attachments are closed before primary authoring');

	// Arrangement only reveals the test-owned source. Actual disclosure, declaration selection and opening use UI input.
	const panel = editor.resourcePanel;
	panel.show(); panel.queuePendingSelection(resource); panel.applyPendingSelection(); await frame();
	check(panel.files.selectedNode?.element.kind === 'file', 'main: Files selects the exact fixture resource');
	await press('ArrowRight'); await press('ArrowDown');
	const occurrence = panel.files.selectedNode?.element;
	check(occurrence?.kind === 'definition' && occurrence.content.kind === 'scene' && occurrence.content.ownerResource === resource,
		'main: ordinary tree navigation selects the authored Scene occurrence');
	await press('ContextMenu');
	await test.clickContextCommand('resources.editInMain');
	const client = editor.mainWorkspace.primary;
	check(client instanceof ScenePrimaryClient, 'main: Files admits the real authored Scene client');
	if (!(client instanceof ScenePrimaryClient)) throw new Error('main: Scene client required');
	check(occurrence?.kind === 'definition' && occurrence.content.kind === 'scene' && client.consumer.subject === occurrence.content.definition,
		'main: primary authoring keeps the exact declaration supplied by Files');
	check(editor.editorParts.groups.every(group => group.model.tabs.every(input => input.resource?.contextId !== resource.contextId)),
		'main: primary authoring creates no hidden document input');
	await press('ControlLeft', 'KeyB');
	check(!panel.isVisible(), 'main: the browser can hide without retiring its admitted primary subject');
	await press('ArrowDown'); await press('Enter'); await press('Home');
	check(client.consumer.selection?.kind === 'member' && client.consumer.selection.index === 0,
		'main: hierarchy navigation selects an actual authored member');
	const field = client.control.controls[0];
	await click(client.view.properties[0].bounds); await press('Digit1'); await press('Digit2');
	check(field.pending && field.field.text === '12' && model.buffer.getText() === original,
		'main: the actual field owns its draft before source publication');
	await press('ControlLeft', 'KeyZ');
	check(field.field.text === '1' && model.buffer.getText() === original, 'main: field Undo cannot undo canonical source');
	await press('ControlLeft', 'KeyY');
	check(field.pending && field.field.text === '12', 'main: field Redo restores the unsubmitted numeric value');

	// Font and theme changes exercise the real retained control, not regenerated test geometry.
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			await test.capture?.(`main-${editor.fontVariant}-theme-${theme}-draft`);
			await press('ControlLeft', 'AltLeft', 'KeyT');
			check(editor.mainWorkspace.primary === client && field.pending && model.buffer.getText() === original,
				'main: theme changes retain the exact draft and context');
		}
		await press('ControlLeft', 'ShiftLeft', 'KeyT');
		check(editor.mainWorkspace.primary === client && field.pending && model.buffer.getText() === original,
			'main: font reflow retains the exact draft and context');
	}
	await press('Enter');
	const accepted = original.replace('x = 1,', 'x = 12,');
	check(model.buffer.getText() === accepted && !field.pending && model.dirty,
		'main: acceptance publishes one canonical coordinate edit');
	const selected = { ...client.consumer.selectionRange };
	await press('ContextMenu'); await test.clickContextCommand('editor.source');
	const input = editor.editorParts.main.activeGroup.model.activeTab;
	check(input?.kind === 'code_editor' && input.workingCopy === model,
		'main: Source opens the canonical working copy in the ordinary document arrangement');
	await press('ControlLeft', 'End');
	check(editor.mainWorkspace.primary === client && client.consumer.selectionRange.start === selected.start
		&& client.consumer.selectionRange.end === selected.end,
		'main: independent document caret navigation cannot replace primary selection');
	await test.runPaletteCommand('Go: Back');
	const restored = editor.mainWorkspace.primary;
	check(restored instanceof ScenePrimaryClient && restored !== client && restored.consumer.workingCopy === model
		&& restored.consumer.selectionRange.start === selected.start && restored.consumer.selectionRange.end === selected.end,
		'main: Back restores the exact authored location through a fresh primary attachment');
	await test.runPaletteCommand('Go: Forward');
	check(editor.editorParts.main.activeGroup.model.activeTab === input,
		'main: Forward returns to the independent retained Source view');
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			await test.capture?.(`main-${editor.fontVariant}-theme-${theme}-source`);
			await press('ControlLeft', 'AltLeft', 'KeyT');
		}
		await press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	await press('ControlLeft', 'KeyW');
	check(editor.mainWorkspace.primary === restored && model.buffer.getText() === accepted && model.dirty && !editor.actionPrompt.visible,
		'main: closing Source neither prompts for nor discards the working copy retained by Main');
	if (!(restored instanceof ScenePrimaryClient)) throw new Error('main: restored Scene client required');
	await click(restored.view.layout.sourceBounds); await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && !model.dirty,
		'main: the retained authoring control consumes the same canonical source history after document close');
	await press('ContextMenu'); await test.clickContextCommand('editor.source');
	await press('ControlLeft', 'KeyA'); await press('Backspace');
	check(model.buffer.getText() === '' && restored.consumer.availability === 'unavailable',
		'main: deleting the exact authored declaration leaves its retained reference unavailable');

	// Exercise initial-recovery attachment explicitly; UI input above produced the missing subject.
	const recovery = editor.mainWorkspace.beginRestore();
	try {
		check(await recovery.restore(editor.mainWorkspace.serialize(), (record, surface, scope, isCurrent) =>
			editor.restorePrimaryClient(record, surface, scope, isCurrent)), 'main: unavailable reference admits its own recovery presentation');
	} finally { recovery.dispose(); }
	const unavailable = editor.mainWorkspace.primary;
	check(unavailable instanceof UnavailableScenePrimaryClient && unavailable.getWorkingCopies()[0] === model,
		'main: recovery retains the real source model without fabricating a Scene context');
	await test.runPaletteCommand('Workspace: Focus Primary Authoring');
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			await test.capture?.(`main-${editor.fontVariant}-theme-${theme}-unavailable`);
			await press('ControlLeft', 'AltLeft', 'KeyT');
		}
		await press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	await press('Tab'); await press('Enter');
	check(editor.editorParts.main.activeGroup.model.activeTab?.kind === 'code_editor',
		'main: unavailable presentation exposes Source through its actual keyboard action control');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && !model.dirty && editor.mainWorkspace.primary === unavailable,
		'main: Source Undo cannot silently rebind the unavailable persisted subject');
	await test.runPaletteCommand('Workspace: Clear Primary Authoring');
	check(editor.mainWorkspace.primary === undefined && !restored.control.hasView && !restored.consumer.isCurrent,
		'main: explicit clear releases its actual controls and domain context');
	await close();
	if (panelWasVisible !== panel.isVisible()) await press('ControlLeft', 'KeyB');
	check(cycles() === before && ide.sources.currentBlua32Media === media,
		'main: source-only authoring never executes or installs a cartridge');
}
