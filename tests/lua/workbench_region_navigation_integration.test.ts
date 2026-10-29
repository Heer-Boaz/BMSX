import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { editorFeedbackState, updateEditorMessage } from '../../ide/common/feedback_state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import type { ActionPromptRequest } from '../../ide/workbench/contrib/modal/action_prompt_view';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';

const DECISION: ActionPromptRequest = { title: 'Pending source action', message: 'Continue with the captured source?',
	primary: 'Save and continue', secondary: 'Continue without saving', primaryEnabled: true, defaultChoice: 'primary' };

test('a modeless window inside a local modal cannot use outer-region traversal to escape that modal', async t => {
	const f = await fixture(t), surfaces = f.editor.surfaces, bounds = f.main.bounds;
	const modal = surfaces.attach({ role: 'modal', blockedScope: f.parts.main.surface,
		presentationParent: f.main.surface, lifetimeOwner: f.main.surface, captureScope: Symbol('local sheet'),
		isVisible: () => true, getBounds: () => bounds, getClip: () => bounds, draw() {} });
	const scope = new InputFocusScope(Symbol('sheet-owned window'), f.group.focusScope);
	const window = surfaces.attach({ role: 'window', presentationParent: modal, lifetimeOwner: modal, captureScope: scope.surfaceScope,
		isVisible: () => true, getBounds: () => bounds, getClip: () => bounds, draw() {} });
	t.after(() => modal.dispose());
	const target = inputFocus.createTarget(null, scope); target.canFocus = () => window.visible;
	t.after(target.bindKeyboard(() => {}));
	assert.equal(target.focus(), true);
	for (const command of ['workspace.focusNextRegion', 'workspace.focusPreviousRegion'] as const)
		assert.equal(f.editor.commands.isEnabled(command, target), false);
	f.key('F6'); assert.ok(inputFocus.admittedTarget === target);
	f.key('F6', KeyModifier.shift); assert.ok(inputFocus.admittedTarget === target);
});

async function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	const editor = f.editor, parts = editor.editorParts, main = editor.mainWorkspace;
	// Invalid-field warnings belong to this test's Workbench presentation, not its successor.
	t.after(() => updateEditorMessage(editorFeedbackState.message.timer));
	editor.setFontVariant('tiny');
	parts.minimize(f.firstPart); parts.minimize(f.secondPart);
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!);
	const document = f.ide.sceneSources.get(model);
	assert.equal(await editor.openSceneInMain(model, { document, sourceVersion: model.version, scene: document.scenes[0] }, inputFocus.target!), true);
	const primary = main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true);
	const group = parts.main.activeGroup, input = new CodeEditorInput(model);
	group.openEditor(input);
	editor.diagnostics.computePending();
	editor.problems.setDiagnostics([{ model, version: model.version, row: 0, startColumn: 0, endColumn: 1,
		severity: 'error', message: 'Independent fixture diagnostic' }], { ready: 1, pending: 0, unsupported: 0, failed: 0 });
	main.openActivity('problems'); editor.resourcePanel.show(); f.update();
	return { ...f, parts, main, primary, model, group, input };
}

test('actual F6 and Shift+F6 traverse fixed outer regions without changing retained authoring or local Tab order', async t => {
	const f = await fixture(t), { editor, primary, group, model } = f;
	const source = model.buffer.getText(), version = model.version, selection = primary.consumer.selection;
	const filesSelection = editor.resourcePanel.files.selectedNode, diagnostic = editor.problems.selectedDiagnostic;
	const tabs = [...group.model.tabs], cycles = f.host.runtime.machine.scheduler.nowCycles;
	const regions = [primary.hierarchy.scope, group.focusScope, primary.details.scope, editor.problems.scope,
		editor.statusBar.focusTarget.scope, editor.resourcePanel.focusTarget.scope];
	for (const scope of regions) {
		f.key('F6');
		assert.ok(inputFocus.admittedTarget !== null && scope.contains(inputFocus.admittedTarget.scope));
	}
	for (const scope of [...regions].reverse().slice(1).concat(editor.resourcePanel.focusTarget.scope)) {
		f.key('F6', KeyModifier.shift);
		assert.ok(inputFocus.admittedTarget !== null && scope.contains(inputFocus.admittedTarget.scope));
	}
	f.main.focusPrimary('details');
	assert.ok(inputFocus.admittedTarget === primary.details.control.focusTarget);
	f.key('Tab'); assert.ok(inputFocus.admittedTarget === primary.details.control.controls[0].field.focusTarget);
	f.key('Tab'); assert.ok(inputFocus.admittedTarget === primary.details.control.controls[1].field.focusTarget);
	f.key('Tab', KeyModifier.shift); assert.ok(inputFocus.admittedTarget === primary.details.control.controls[0].field.focusTarget);
	f.key('F6'); assert.ok(inputFocus.admittedTarget === editor.problems.focusTarget);
	assert.ok(primary.consumer.selection === selection && editor.resourcePanel.files.selectedNode === filesSelection
		&& editor.problems.selectedDiagnostic === diagnostic && group.model.tabs.every((input, index) => input === tabs[index]));
	assert.equal(model.buffer.getText(), source); assert.equal(model.version, version); assert.equal(model.dirty, false);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('outer navigation skips hidden clients and floating or minimized activity without revealing or replacing them', async t => {
	const f = await fixture(t), { editor, main, primary, group } = f;
	main.setRegionVisible('hierarchy', false); main.setRegionVisible('details', false);
	main.setActivityVisible(false); editor.resourcePanel.hide(); f.update(); group.panes.activePane!.focus();
	const hierarchyGeneration = primary.hierarchy.scope.contextGeneration, detailsGeneration = primary.details.scope.contextGeneration;
	const activityGeneration = editor.problems.scope.contextGeneration;
	f.key('F6'); assert.ok(inputFocus.admittedTarget === editor.statusBar.focusTarget);
	f.key('F6'); assert.ok(inputFocus.admittedTarget === group.panes.activePane!.commandTarget);
	assert.equal(primary.hierarchy.attached, false); assert.equal(primary.details.attached, false);
	assert.equal(editor.problems.attached, false); assert.equal(editor.resourcePanel.isVisible(), false);
	assert.equal(primary.hierarchy.scope.contextGeneration, hierarchyGeneration);
	assert.equal(primary.details.scope.contextGeneration, detailsGeneration);
	assert.equal(editor.problems.scope.contextGeneration, activityGeneration);
	main.openActivity('problems'); main.setActivityPlacement('floatingWindow'); f.update();
	for (const minimized of [false, true]) {
		if (minimized) main.minimizeActivity();
		group.panes.activePane!.focus(); f.key('F6');
		assert.ok(inputFocus.admittedTarget === editor.statusBar.focusTarget);
		f.key('F6', KeyModifier.shift); assert.ok(inputFocus.admittedTarget === group.panes.activePane!.commandTarget);
		assert.equal(main.activityPlacement, 'floatingWindow'); assert.equal(main.activityWindow.model.minimized, minimized);
		assert.ok(main.activity === editor.problems && editor.problems.attached);
	}
});

test('a floating document or activity is outside the ring and cannot replace the Main document destination', async t => {
	const f = await fixture(t), { editor, parts, main, primary, group } = f;
	f.firstPart.focus(); f.update(); assert.ok(parts.activePart === f.firstPart);
	f.key('F6'); assert.ok(inputFocus.admittedTarget === editor.resourcePanel.focusTarget);
	f.key('F6'); assert.ok(primary.hierarchy.scope.contains(inputFocus.admittedTarget!.scope));
	f.key('F6'); assert.ok(inputFocus.admittedTarget === group.panes.activePane!.commandTarget);
	assert.ok(parts.activePart === parts.main && group.model.activeTab === f.input);
	f.firstPart.focus(); f.key('F6', KeyModifier.shift);
	assert.ok(inputFocus.admittedTarget === editor.statusBar.focusTarget);
	main.setActivityPlacement('floatingWindow'); main.focusActivity(); f.update();
	f.key('F6'); assert.ok(inputFocus.admittedTarget === editor.resourcePanel.focusTarget);
	main.focusActivity(); f.key('F6', KeyModifier.shift);
	assert.ok(inputFocus.admittedTarget === editor.statusBar.focusTarget);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondPart.window!.model.minimized);
});

test('scroll-clipped but attached Main regions stay eligible and their concrete owner reveals keyboard focus', async t => {
	const f = await fixture(t), { editor, main, primary, group } = f;
	editor.updateViewport({ width: 180, height: 96 }); editor.setFontVariant('msx');
	main.regionLayout.activityHeight = 70; f.update(); main.focusActivity(); f.update();
	const scrollY = main.regionLayout.scrollY;
	assert.ok(scrollY > 0 && primary.hierarchy.attached && primary.details.attached);
	editor.resourcePanel.focusTarget.focus();
	f.key('F6'); assert.ok(primary.hierarchy.scope.contains(inputFocus.admittedTarget!.scope));
	assert.ok(main.regionLayout.scrollY < scrollY, 'the owning Main arrangement reveals its retained hierarchy');
	f.key('F6'); assert.ok(inputFocus.admittedTarget === group.panes.activePane!.commandTarget);
	f.key('F6'); assert.ok(primary.details.scope.contains(inputFocus.admittedTarget!.scope));
	f.key('F6'); assert.ok(inputFocus.admittedTarget === editor.problems.focusTarget);
	assert.ok(main.regionLayout.scrollY > 0 && main.primary === primary);
});

for (const draft of ['123', '-'] as const) test(`ordinary region blur ${draft === '123' ? 'publishes a valid field once' : 'cancels an invalid field without a source edit'}`, async t => {
	const f = await fixture(t), field = f.primary.details.control.controls[0];
	f.main.focusPrimary('details'); assert.equal(field.field.focusTarget.focus(), true);
	const source = f.model.buffer.getText(), version = f.model.version;
	let changes = 0; const release = f.model.onDidChangeContent(() => changes++); t.after(release);
	setFieldText(field.field, draft, true); f.key('F6');
	assert.ok(inputFocus.admittedTarget === f.editor.problems.focusTarget);
	assert.equal(field.pending, false);
	assert.equal(changes, draft === '123' ? 1 : 0);
	assert.equal(f.model.version, version + changes);
	assert.equal(f.model.buffer.getText(), draft === '123' ? source.replace('x = 11,', 'x = 123,') : source);
});

test('direct sibling-primary focus applies the actual invalid-field blur policy instead of a universal commit veto', async t => {
	const f = await fixture(t), field = f.primary.details.control.controls[0];
	f.main.focusPrimary('details'); field.field.focusTarget.focus(); setFieldText(field.field, '-', true);
	const version = f.model.version;
	f.main.focusPrimary('hierarchy'); f.update();
	assert.ok(f.primary.hierarchy.scope.contains(inputFocus.admittedTarget!.scope));
	assert.equal(field.pending, false); assert.equal(f.model.version, version);
	assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE);
});

for (const command of ['workspace.hierarchy.focus', 'sceneEditor.outline'] as const)
	for (const draft of ['123', '-']) test(`${command} delegates ${draft === '123' ? 'valid' : 'invalid'} draft departure to native focus`, async t => {
		const f = await fixture(t), field = f.primary.details.control.controls[0];
		f.main.focusPrimary('details'); field.field.focusTarget.focus(); setFieldText(field.field, draft, true);
		const source = f.model.buffer.getText(), version = f.model.version;
		f.editor.commands.execute(command, field.field.focusTarget); f.update();
		assert.ok(f.primary.hierarchy.scope.contains(inputFocus.admittedTarget!.scope));
		assert.equal(field.pending, false);
		assert.equal(f.model.version, version + (draft === '123' ? 1 : 0));
		assert.equal(f.model.buffer.getText(), draft === '123' ? source.replace('x = 11,', 'x = 123,') : source);
	});

test('actual empty Problems makes status ineligible while Files restores its own native status destination', async t => {
	const f = await fixture(t), { editor } = f;
	editor.problems.setDiagnostics([], { ready: 1, pending: 0, unsupported: 0, failed: 0 });
	f.main.focusActivity(); f.update();
	assert.equal(editor.statusBar.canFocus, false);
	f.key('F6'); assert.ok(inputFocus.admittedTarget === editor.resourcePanel.focusTarget);
	assert.equal(editor.statusBar.canFocus, true);
	f.key('F6', KeyModifier.shift); assert.ok(inputFocus.admittedTarget === editor.statusBar.focusTarget);
	f.key('F6', KeyModifier.shift); assert.ok(inputFocus.admittedTarget === editor.problems.focusTarget);
	assert.equal(editor.statusBar.canFocus, false);
});

test('a newer real focus selected during departing draft publication wins without a second region attempt', async t => {
	const f = await fixture(t), field = f.primary.details.control.controls[0];
	f.main.focusPrimary('details'); field.field.focusTarget.focus(); setFieldText(field.field, '123', true);
	const release = f.model.onDidChangeContent(() => { release(); f.secondPart.focus(); }); t.after(release);
	f.key('F6');
	assert.ok(inputFocus.admittedTarget === f.second.code.focusTarget && f.parts.activePart === f.secondPart);
	assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE.replace('x = 11,', 'x = 123,'));
	assert.equal(field.pending, false);
});

test('replacing the selected activity during blur revokes the captured destination without focusing a replacement or ring fallback', async t => {
	const f = await fixture(t), field = f.primary.details.control.controls[0];
	f.main.focusPrimary('details'); field.field.focusTarget.focus(); setFieldText(field.field, '123', true);
	const release = f.model.onDidChangeContent(() => { release(); f.main.openActivity('builds.output', { focus: false }); }); t.after(release);
	f.key('F6');
	assert.notEqual(f.main.activity, f.editor.problems);
	assert.notEqual(inputFocus.admittedTarget, f.main.activity!.commandTarget);
	assert.notEqual(inputFocus.admittedTarget, f.editor.statusBar.focusTarget);
	assert.notEqual(inputFocus.admittedTarget, f.editor.resourcePanel.focusTarget);
	assert.equal(f.editor.problems.attached, false);
	assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE.replace('x = 11,', 'x = 123,'));
});

test('root and part-local modal origins cannot escape with either region key while sibling regions honor local admission', async t => {
	const f = await fixture(t), rootDecision = f.editor.actionPrompt.show(DECISION); f.update();
	for (const modifiers of [KeyModifier.none, KeyModifier.shift]) {
		f.key('F6', modifiers); assert.ok(inputFocus.admittedTarget === f.editor.actionPrompt.focusTarget);
		assert.equal(f.editor.commands.isEnabled('workspace.focusNextRegion', inputFocus.admittedTarget), false);
	}
	f.key('Escape'); assert.equal(await rootDecision, 'cancel');
	f.group.panes.activePane!.focus();
	const prompt = f.parts.main.actionPrompt, localDecision = prompt.show(DECISION); f.update();
	t.after(() => prompt.close('cancel', false));
	assert.equal(prompt.visible, true);
	for (const modifiers of [KeyModifier.none, KeyModifier.shift]) {
		f.key('F6', modifiers); assert.ok(inputFocus.admittedTarget === prompt.focusTarget);
	}
	assert.equal(f.editor.resourcePanel.focusTarget.focus(), true);
	f.key('F6'); assert.ok(f.primary.hierarchy.scope.contains(inputFocus.admittedTarget!.scope));
	f.key('F6'); assert.ok(f.primary.details.scope.contains(inputFocus.admittedTarget!.scope), 'only the modal document family is skipped');
	assert.equal(prompt.visible, true); assert.ok(f.group.model.contains(f.input));
	prompt.close('cancel'); assert.equal(await localDecision, 'cancel');
});

test('guest viewport input keeps F6 and Shift+F6 while Shift+F1 alone returns to host region navigation', async t => {
	const f = await fixture(t), game = new GameViewInput();
	f.group.openEditor(game); f.update();
	const pane = f.group.panes.activePane!; pane.focus(); f.key('Tab');
	const guest = inputFocus.admittedTarget!; assert.ok(guest.guestInput !== undefined);
	const binding = guest.guestInput, cycles = f.host.runtime.machine.scheduler.nowCycles;
	for (const modifiers of [KeyModifier.none, KeyModifier.shift]) {
		const down = new KeyInputEvent('F6', modifiers), up = new KeyInputEvent('F6', modifiers, false, false);
		f.editor.dispatchKey(down); f.editor.dispatchKey(up); f.update();
		assert.equal(down.consumed, false); assert.equal(up.consumed, false);
		assert.ok(inputFocus.admittedTarget === guest && guest.guestInput === binding);
	}
	f.key('F1', KeyModifier.shift); assert.ok(inputFocus.admittedTarget === pane.commandTarget);
	f.key('F6'); assert.ok(f.primary.details.scope.contains(inputFocus.admittedTarget!.scope));
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});
