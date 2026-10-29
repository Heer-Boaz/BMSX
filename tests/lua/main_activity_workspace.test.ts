import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import type { EditorDiagnostic } from '../../ide/common/models';
import { editorFeedbackState } from '../../ide/common/feedback_state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { ActionPrompt } from '../../ide/workbench/contrib/modal/action_prompt';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import type { CommandQuickPickItem } from '../../ide/workbench/contrib/commands/quick_pick_provider';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';

const SCENE = `local scenes = require('cartlib/world/scene_library')
scenes.register('retained', { objects = {
 { member_id = 'selected', definition_id = 'example', options = { pos = { x = 1, y = 2, z = 3 } } },
} })
return {}
`;

function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['scene.lua', SCENE], ['cartlib/world/scene_library.lua', 'return {}'],
		['diagnostics.lua', 'return 1\n'.repeat(20)]]);
	f.editor.setFontVariant('tiny');
	const main = f.editor.mainWorkspace, panel = f.editor.problems;
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'diagnostics.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	f.editor.diagnostics.computePending();
	const diagnostics: EditorDiagnostic[] = Array.from({ length: 12 }, (_, row) => ({ model, version: model.version,
		row, startColumn: 2, endColumn: 3, severity: 'error', message: 'A retained source diagnostic with a distinct exact authored location.' }));
	panel.setDiagnostics(diagnostics, { ready: 1, pending: 0, unsupported: 0, failed: 0 });
	main.regionLayout.activityHeight = 70; main.setActivityVisible(true); f.update(); main.focusActivity();
	return { ...f, main, panel, model, diagnostics };
}

const pointer = (x: number, y: number, down: number, up = 0) => ({ x, y,
	buttons: down, pressedButtons: down, releasedButtons: up, cancelledButtons: 0,
	modifiers: KeyModifier.none, spaceDown: false, timestamp: 1 });

test('Main activity hide and reattach retain diagnostics and reading without borrowing document lifetime', t => {
	const f = fixture(t), selected = f.diagnostics[10];
	f.panel.setSelectionIndex(10); f.panel.revealSelection(f.panel.layoutState, f.panel.contentWidth);
	const scroll = f.panel.getScrollIndex(); assert.ok(scroll > 0);
	const documents = [...f.editor.editorParts.documents], generation = f.panel.scope.contextGeneration;
	assert.equal(f.editor.commands.isEnabled('problems', f.panel.focusTarget), true);
	f.editor.commands.execute('problems', f.panel.focusTarget); f.update();
	assert.equal(f.panel.attached, false); assert.equal(f.panel.focusTarget.focus(), false);
	assert.ok(f.panel.scope.contextGeneration > generation);
	assert.ok(f.panel.selectedDiagnostic === selected); assert.equal(f.panel.getScrollIndex(), scroll);
	assert.equal(f.main.primary, undefined);
	assert.equal(f.editor.editorParts.documents.length, documents.length);
	assert.ok(f.editor.editorParts.documents.every((part, index) => part === documents[index]));
	f.editor.commands.execute('problems', inputFocus.admittedTarget); f.update();
	assert.equal(f.panel.attached, true); assert.ok(inputFocus.admittedTarget === f.panel.focusTarget);
	assert.ok(f.panel.selectedDiagnostic === selected); assert.equal(f.panel.getScrollIndex(), scroll);
	assert.equal(f.model.dirty, false);
});

test('Main activity hide revokes the real header gesture and popup lease without reviving either on reattach', t => {
	const f = fixture(t), button = f.panel.header.actions.items[0].bounds;
	f.editor.dispatchPointer(pointer(button.left + 2, button.top + 2, PointerButton.Primary));
	assert.equal(pointerCapture.active, true);
	f.main.setActivityVisible(false); assert.equal(pointerCapture.active, false);
	f.main.focusActivity();
	f.editor.dispatchPointer(pointer(button.left + 2, button.top + 2, 0, PointerButton.Primary));
	assert.ok(inputFocus.admittedTarget === f.panel.focusTarget, 'a retired press cannot activate the new header attachment');
	const origin = f.panel.header.controls.focusTarget; origin.focus();
	f.editor.contextMenu.show(20, 20, [], f.editor.commands);
	assert.equal(f.editor.contextMenu.visible, true); assert.ok(f.editor.contextMenu.invocationOrigin === origin);
	f.main.setActivityVisible(false); assert.equal(f.editor.contextMenu.visible, false);
	f.main.focusActivity(); assert.equal(f.editor.contextMenu.visible, false);
});

test('Main activity native sash keeps its requested extent and cancels only its own hidden gesture', t => {
	const f = fixture(t), layout = f.main.regionLayout, sash = layout.activitySash;
	layout.activityHeight = 120; f.update();
	const x = (layout.activitySashBounds.left + layout.activitySashBounds.right) / 2, y = sash.position;
	f.editor.dispatchPointer(pointer(x, y, PointerButton.Primary)); assert.equal(pointerCapture.active, true);
	f.editor.dispatchPointer({ ...pointer(x, y + 12, PointerButton.Primary), pressedButtons: 0 });
	const requested = layout.activityHeight; assert.notEqual(requested, 120);
	f.main.setActivityVisible(false); assert.equal(pointerCapture.active, false);
	f.main.focusActivity(); f.update(); assert.equal(layout.activityHeight, requested);
	assert.equal(f.model.dirty, false);
});

test('a newer real focus during activity visibility publication wins over the original focus request', t => {
	const f = fixture(t); f.main.setActivityVisible(false); f.first.focus();
	let unbind: () => void;
	unbind = f.main.regionLayout.onDidChange(() => { if (!f.main.regionLayout.activityVisible) return; unbind(); f.second.focus(); });
	f.main.focusActivity();
	assert.ok(inputFocus.admittedTarget === f.second.code.focusTarget);
	assert.ok(f.editor.editorParts.activePart === f.secondPart);
	assert.equal(f.panel.attached, true, 'admitted visibility may survive without reclaiming the newer foreground');
});

for (const command of ['editor.source', 'editor.sourceToSide'] as const)
	test(`Problems ${command} addresses its selected canonical diagnostic, never the Scene document behind it`, async t => {
		const f = fixture(t), group = f.editor.editorParts.main.activeGroup;
		const sceneResource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
		f.editor.sceneEditor.openResource(group, sceneResource); f.update();
		const scene = group.model.activeTab; assert.ok(scene instanceof SceneEditorInput);
		const selection = scene.view.authoring.selection, cycles = f.host.runtime.machine.scheduler.nowCycles;
		f.panel.setDiagnostics(f.diagnostics, { ready: 1, pending: 0, unsupported: 0, failed: 0 });
		f.main.focusActivity(); f.panel.setSelectionIndex(7);
		assert.equal(f.editor.commands.isEnabled(command, f.panel.focusTarget), true);
		f.editor.commands.execute(command, f.panel.focusTarget);
		await Promise.resolve(); await Promise.resolve(); f.update();
		const input = f.editor.editorParts.activeGroup.model.activeTab;
		assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.model,
			'the selected activity diagnostic is the semantic Source subject, not the active document');
		assert.equal(input.context.view.cursorRow, 7); assert.equal(input.context.view.cursorColumn, 2);
		assert.ok(group.model.tabs.includes(scene)); assert.ok(scene.view.authoring.selection === selection);
		assert.equal(f.main.primary, undefined); assert.equal(f.model.dirty, false);
		assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
	});

test('the actual command palette retains the activity Source subject and loses its lease when that attachment hides', async t => {
	const f = fixture(t), group = f.editor.editorParts.main.activeGroup;
	const sceneResource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	f.editor.sceneEditor.openResource(group, sceneResource); f.update(); const scene = group.model.activeTab;
	f.panel.setDiagnostics(f.diagnostics, { ready: 1, pending: 0, unsupported: 0, failed: 0 });
	f.main.focusActivity(); f.panel.setSelectionIndex(8);
	f.editor.commands.execute('commandPalette', f.panel.focusTarget);
	const picker = f.editor.quickInput;
	const index = picker.model.list.rows.findIndex(row => (row.item as CommandQuickPickItem).command === 'editor.source');
	assert.ok(index >= 0, 'the selected diagnostic contributes Source to the actual application palette');
	picker.model.list.selectionIndex = index;
	f.key('Enter'); await Promise.resolve(); await Promise.resolve(); f.update();
	const input = f.editor.editorParts.activeGroup.model.activeTab;
	assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.model);
	f.main.focusActivity(); f.editor.commands.execute('commandPalette', f.panel.focusTarget);
	assert.equal(picker.visible, true); f.main.setActivityVisible(false); assert.equal(picker.visible, false);
	f.main.focusActivity(); f.key('Enter'); assert.ok(group.model.tabs.includes(scene!));
});

for (const retirement of ['hide', 'selection', 'source'] as const)
	test(`pending diagnostic Source cannot regain authority after ${retirement} changes its exact producing observation`, async t => {
		const f = fixture(t); f.panel.setSelectionIndex(6);
		const ready = Promise.withResolvers<void>(), capture = f.panel.captureSourceLocation.bind(f.panel);
		t.mock.method(f.panel, 'captureSourceLocation', () => {
			const request = capture()!;
			return { ...request, readLocation: async () => { await ready.promise; return request.readLocation(); } };
		});
		const opening = t.mock.method(f.editor.navigation, 'openSource'), admitted = t.mock.method(f.editor.navigation, 'openResource');
		f.editor.commands.execute('editor.source', f.panel.focusTarget);
		assert.equal(opening.mock.callCount(), 1); assert.equal(admitted.mock.callCount(), 0);
		if (retirement === 'hide') { f.main.setActivityVisible(false); f.main.focusActivity(); }
		else if (retirement === 'selection') { f.panel.setSelectionIndex(7); f.panel.setSelectionIndex(6); }
		else f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- newer source\n' }]);
		f.second.focus(); const foreground = inputFocus.admittedTarget;
		ready.resolve(); assert.equal(await opening.mock.calls[0].result, undefined);
		assert.equal(admitted.mock.callCount(), 0);
		assert.ok(inputFocus.admittedTarget === foreground && f.editor.editorParts.activePart === f.secondPart);
		assert.equal(f.editor.editorParts.main.activeGroup.model.tabs.length, 0);
	});

test('empty and retired activity origins cannot borrow the Scene document Source capability', t => {
	const f = fixture(t), group = f.editor.editorParts.main.activeGroup;
	const sceneResource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	f.editor.sceneEditor.openResource(group, sceneResource); f.update(); f.main.focusActivity();
	f.panel.setDiagnostics([], { ready: 1, pending: 0, unsupported: 0, failed: 0 });
	const producer = t.mock.method(f.panel, 'captureSourceLocation'), opening = t.mock.method(f.editor.navigation, 'openSource');
	for (const command of ['editor.source', 'editor.sourceToSide'] as const) {
		assert.equal(f.editor.commands.isEnabled(command, f.panel.focusTarget), false);
		f.editor.commands.execute(command, f.panel.focusTarget);
	}
	assert.equal(producer.mock.callCount(), 0); assert.equal(opening.mock.callCount(), 0);
	f.panel.setDiagnostics(f.diagnostics, { ready: 1, pending: 0, unsupported: 0, failed: 0 }); f.panel.setSelectionIndex(3);
	assert.equal(f.editor.commands.isEnabled('editor.source', f.panel.focusTarget), true);
	assert.equal(producer.mock.callCount(), 0, 'availability does not resolve source or capture a semantic operation');
	f.main.setActivityVisible(false);
	assert.equal(f.editor.commands.isEnabled('editor.source', f.panel.focusTarget), false);
	f.editor.commands.execute('editor.source', f.panel.focusTarget);
	assert.equal(opening.mock.callCount(), 0);
	f.main.focusActivity(); assert.ok(group.model.activeTab instanceof SceneEditorInput);
});

test('newer activity placement and foreground survive coherent initial workspace restoration publication', async t => {
	const f = fixture(t), snapshot = f.main.serialize();
	f.main.regionLayout.activityHeight = 95;
	const release = f.main.regionLayout.onDidChange(() => {
		release(); f.main.regionLayout.activityHeight = 160; f.main.setActivityVisible(false); f.second.focus();
	});
	const restore = f.main.beginRestore();
	try {
		assert.equal(await restore.restore(snapshot, () => { throw new Error('An unbound primary has no source factory work.'); }), true);
		restore.focusClient(); f.update();
		assert.equal(f.main.regionLayout.activityHeight, 160); assert.equal(f.main.regionLayout.activityVisible, false);
		assert.equal(f.panel.attached, false);
		assert.ok(inputFocus.admittedTarget === f.second.code.focusTarget && f.editor.editorParts.activePart === f.secondPart);
	} finally { restore.dispose(); }
});

test('Main owns both overflowing scroll routes while real documents, authoring regions and activity remain independently reachable', async t => {
	const f = fixture(t), group = f.editor.editorParts.main.activeGroup;
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(model, { document, sourceVersion: model.version, scene: document.scenes[0] }, inputFocus.target!), true);
	group.openEditor(new CodeEditorInput(f.model));
	f.editor.updateViewport({ width: 280, height: 100 }); f.editor.setFontVariant('msx'); f.update();
	const primary = f.main.primary!, layout = f.main.regionLayout;
	f.main.focusActivity(); f.update();
	const track = layout.verticalScrollTrack;
	const hit = f.editor.surfaces.hitTest((track.left + track.right) / 2, (track.top + track.bottom) / 2)!;
	assert.ok(hit !== null && f.editor.surfaces.isInContext(hit.captureScope, f.main.surface.captureScope));
	assert.equal(f.editor.surfaces.isInContext(hit.captureScope, f.editor.editorParts.main.surface.captureScope), false,
		'the translated logical document must not occlude Main vertical scrolling');
	assert.ok(inputFocus.admittedTarget === f.panel.focusTarget);
	f.main.focusPrimary('hierarchy'); f.update();
	assert.ok(inputFocus.admittedTarget !== null && primary.hierarchy.scope.contains(inputFocus.admittedTarget.scope));
	const horizontal = layout.scrollTrack;
	const horizontalHit = f.editor.surfaces.hitTest((horizontal.left + horizontal.right) / 2, (horizontal.top + horizontal.bottom) / 2)!;
	assert.ok(horizontalHit !== null && f.editor.surfaces.isInContext(horizontalHit.captureScope, f.main.surface.captureScope));
	assert.equal(f.editor.surfaces.isInContext(horizontalHit.captureScope, f.editor.editorParts.main.surface.captureScope), false,
		'the document client clips above the outer arrangement horizontal scrollbar');
	group.panes.activePane!.focus(); f.update();
	assert.ok(inputFocus.admittedTarget !== null && group.focusScope.contains(inputFocus.admittedTarget.scope));
	assert.ok(f.main.primary === primary && group.model.activeTab instanceof CodeEditorInput && f.panel.attached);
	assert.equal(f.model.dirty, false); assert.equal(model.dirty, false);
});

test('attached scrolled-out hierarchy focus admits native Problems commands while blocking popups and hidden clients remain denied', async t => {
	const f = fixture(t), part = f.editor.editorParts.main, group = part.activeGroup;
	f.editor.editorParts.minimize(f.firstPart); f.editor.editorParts.minimize(f.secondPart);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(model, { document, sourceVersion: model.version, scene: document.scenes[0] }, inputFocus.target!), true);
	const primary = f.main.primary;
	group.openEditor(new CodeEditorInput(f.model));
	f.main.regionLayout.activityHeight = 50;
	f.editor.updateViewport({ width: 180, height: 240 }); f.update(); f.main.focusPrimary('hierarchy');
	const layout = f.main.regionLayout, horizontal = layout.scrollTrack;
	f.editor.dispatchPointer(pointer(horizontal.right - 1, horizontal.top + 1, PointerButton.Primary));
	f.editor.dispatchPointer(pointer(horizontal.right - 1, horizontal.top + 1, 0, PointerButton.Primary)); f.update();
	f.editor.updateViewport({ width: 180, height: 96 }); f.update();
	const vertical = layout.verticalScrollTrack;
	f.editor.dispatchPointer(pointer(vertical.left + 1, vertical.bottom - 1, PointerButton.Primary));
	f.editor.dispatchPointer(pointer(vertical.left + 1, vertical.bottom - 1, 0, PointerButton.Primary)); f.update();
	const selected = f.panel.selectedDiagnostic;
	const retained = inputFocus.target;
	assert.ok(retained !== null && primary !== undefined && primary.hierarchy.scope.contains(retained.scope));
	assert.ok(primary.hierarchy.attached);
	const observations: object[] = [];
	const observe = inputFocus.onDidChangeTarget(() => observations.push({ revision: inputFocus.revision,
		interaction: inputFocus.interactionRevision, target: inputFocus.target === null ? 'none'
			: f.panel.scope.contains(inputFocus.target.scope) ? 'activity' : 'outgoing', admitted: inputFocus.admittedTarget !== null }));
	try {
		assert.equal(inputFocus.admittedTarget === retained, true, 'scroll clipping does not retire an attached keyboard owner');
		f.key('KeyM', KeyModifier.ctrl | KeyModifier.shift);
		assert.equal(f.panel.attached, false);
		f.key('KeyM', KeyModifier.ctrl | KeyModifier.shift);
		assert.equal(f.panel.attached, true);
		assert.equal(inputFocus.admittedTarget === f.panel.focusTarget, true, JSON.stringify(observations));
		assert.ok(f.main.primary === primary && f.panel.selectedDiagnostic === selected);
		f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
		assert.equal(f.editor.quickInput.visible, true);
		assert.equal(f.panel.focusTarget.focus(), false, 'an actual palette still blocks underlying activity input');
		f.key('Escape');
		f.main.setActivityVisible(false); f.update();
		assert.equal(f.panel.focusTarget.focus(), false, 'a genuinely detached activity cannot regain keyboard admission');
		assert.ok(inputFocus.admittedTarget !== f.panel.focusTarget);
		assert.equal(f.model.dirty, false); assert.equal(model.dirty, false);
	} finally { observe(); }
});

test('an activity body press retains its hit diagnostic when focus reveals and moves the native list', async t => {
	const f = fixture(t), group = f.editor.editorParts.main.activeGroup, model = f.firstInput.workingCopy;
	f.editor.editorParts.minimize(f.firstPart); f.editor.editorParts.minimize(f.secondPart);
	const behind = new CodeEditorInput(f.secondInput.workingCopy); group.openEditor(behind);
	f.main.regionLayout.activityHeight = 70;
	f.editor.updateViewport({ width: 300, height: 80 }); f.update(); f.editor.editorParts.main.focus();
	const diagnostics: EditorDiagnostic[] = [0, 1, 2].map(row => ({ model, version: model.version,
		row, startColumn: 0, endColumn: 1, severity: 'error', message: 'probe' }));
	f.panel.setDiagnostics(diagnostics, { ready: 1, pending: 0, unsupported: 0, failed: 0 });
	const restore = f.main.beginRestore();
	try {
		assert.equal(await restore.restore({ ...f.main.serialize(), scrollY: 5 }, () => { throw new Error('Unbound Main has no primary source to restore.'); }), true);
	} finally { restore.dispose(); }
	f.update();
	const x = f.panel.bounds.left + 10, y = f.panel.layoutState.contentTop + f.panel.getItemLayout(0).height - 1;
	assert.ok(f.editor.surfaces.hitTest(x, y) === f.main.activitySurface, 'the original occurrence is admitted by the actual activity body');
	f.editor.dispatchPointer(pointer(x, y, PointerButton.Primary));
	f.editor.dispatchPointer(pointer(x, y, 0, PointerButton.Primary)); f.update();
	const input = f.editor.editorParts.activeGroup.model.activeTab;
	assert.ok(input instanceof CodeEditorInput && input.workingCopy === model);
	assert.ok(f.panel.selectedDiagnostic === diagnostics[0], 'focus-driven reflow cannot retarget the already admitted press');
	assert.equal(input.context.view.cursorRow, diagnostics[0].row);
	assert.equal(input.context.view.cursorColumn, diagnostics[0].startColumn);
	assert.ok(group.model.tabs.includes(behind)); assert.equal(model.dirty, false);
});

for (const publication of ['model activation', 'attachment'] as const)
	test(`diagnostic activation preserves a newer real foreground chosen during ${publication}`, t => {
		const f = fixture(t), group = f.editor.editorParts.main.activeGroup;
		f.panel.setSelectionIndex(5);
		const invoke = () => { release(); f.second.focus(); };
		const release = publication === 'model activation' ? group.model.onDidChange(change => { if (change === 'active') invoke(); })
			: group.panes.onWillShowEditor(invoke);
		t.after(release);
		f.key('Enter');
		assert.ok(inputFocus.admittedTarget === f.second.code.focusTarget && f.editor.editorParts.activePart === f.secondPart);
		assert.ok(f.main.primary === undefined && f.panel.selectedDiagnostic === f.diagnostics[5]);
		assert.equal(f.model.dirty, false);
	});

for (const font of ['tiny', 'msx'] as const)
	test(`a dirty final Main consumer presents a reachable ${font} release decision from the scrolled activity`, async t => {
		const f = fixture(t), resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
		const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
		assert.equal(await f.editor.openSceneInMain(model, { document, sourceVersion: model.version, scene: document.scenes[0] }, inputFocus.target!), true);
		const primary = f.main.primary; assert.ok(primary instanceof ScenePrimaryClient);
		assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true); f.main.focusPrimary('details'); f.update();
		const field = primary.details.control.controls[0]; assert.equal(field.field.focusTarget.focus(), true);
		setFieldText(field.field, '31', true); f.key('Enter');
		assert.equal(field.pending, false); assert.equal(model.dirty, true);
		const edited = model.buffer.getText();
		const consumers = [...f.main.workingCopyConsumers()];
		assert.equal(consumers.length, 1); assert.ok(consumers[0] === primary.consumer);
		assert.ok(f.editor.editorParts.groups.every(group => group.model.tabs.every(input => input.resource !== model.resource)),
			'no document presentation consumes the dirty Main working copy');
		f.editor.updateViewport({ width: 300, height: 100 }); f.editor.setFontVariant(font); f.update(); f.main.focusActivity(); f.update();
		const shown: ActionPrompt[] = [], show = ActionPrompt.prototype.show;
		t.mock.method(ActionPrompt.prototype, 'show', function (this: ActionPrompt, ...args: Parameters<typeof show>) {
			shown.push(this); return show.apply(this, args);
		});
		const pending = f.main.clearPrimary(f.editor.editorParts.closeController, f.panel.focusTarget);
		assert.equal(shown.length, 1); const prompt = shown[0]; f.update();
		try {
			assert.equal(prompt.visible, true);
			for (const button of prompt.view.buttons) {
				const bounds = button.bounds;
				assert.equal(f.editor.surfaces.hitTest((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2)?.captureScope,
					prompt.pointerScope, 'every actual dirty-source decision must be reachable through its owning Main modal surface');
			}
			const cancel = prompt.view.buttons.find(button => button.choice === 'cancel')!.bounds;
			const x = (cancel.left + cancel.right) / 2, y = (cancel.top + cancel.bottom) / 2;
			f.editor.dispatchPointer(pointer(x, y, PointerButton.Primary));
			f.editor.dispatchPointer(pointer(x, y, 0, PointerButton.Primary));
			assert.equal(await pending, false); assert.equal(prompt.visible, false);
			assert.ok(f.main.primary === primary); assert.equal(model.buffer.getText(), edited); assert.equal(model.dirty, true);
		} finally { prompt.close('cancel', false); await pending; }
	});

for (const font of ['tiny', 'msx'] as const)
	test(`dirty Main document close from activity keeps its ${font} native decision reachable without stealing origin focus`, async t => {
		const f = createActualSourcePanes(t, false, [['only.lua', 'return 3\n']]);
		f.editor.editorParts.minimize(f.firstPart); f.editor.editorParts.minimize(f.secondPart);
		const main = f.editor.mainWorkspace, part = f.editor.editorParts.main, group = part.activeGroup;
		const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'only.lua' })!;
		const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), input = new CodeEditorInput(model);
		group.openEditor(input); model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained pending edit\n' }]);
		const edited = model.buffer.getText(), cycles = f.host.runtime.machine.scheduler.nowCycles;
		f.editor.setFontVariant(font); main.regionLayout.activityHeight = 70;
		f.editor.updateViewport({ width: 300, height: 80 }); f.update(); main.focusActivity(); f.update();
		assert.equal(main.primary, undefined);
		const origin = f.editor.problems.focusTarget;
		assert.ok(inputFocus.admittedTarget === origin);
		const pending = f.editor.editorParts.closeGroup(group, origin), prompt = part.actionPrompt;
		f.update();
		try {
			assert.equal(prompt.visible, true);
			assert.ok(inputFocus.admittedTarget === origin, 'a sibling-origin decision does not claim keyboard focus before native interaction');
			for (const button of prompt.view.buttons) {
				const bounds = button.bounds;
				assert.equal(f.editor.surfaces.hitTest((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2)?.captureScope,
					prompt.pointerScope, 'each actual document-close decision routes to the prompt, not the activity underneath');
			}
			const cancel = prompt.view.buttons.find(button => button.choice === 'cancel')!.bounds;
			const x = (cancel.left + cancel.right) / 2, y = (cancel.top + cancel.bottom) / 2;
			f.editor.dispatchPointer(pointer(x, y, PointerButton.Primary));
			f.editor.dispatchPointer(pointer(x, y, 0, PointerButton.Primary));
			assert.equal(await pending, false); assert.equal(prompt.visible, false);
			assert.ok(group.model.tabs.includes(input) && group.model.activeTab === input && group.panes.activePane?.input === input);
			assert.equal(group.openingAdmitted, true); assert.equal(model.buffer.getText(), edited); assert.equal(model.dirty, true);
			assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
		} finally { prompt.close('cancel', false); await pending; }
	});

for (const font of ['tiny', 'msx'] as const)
	test(`native paste feedback preserves reachable ${font} dirty-document decisions for a long canonical source identity`, async t => {
		const path = 'authoring/scenes/review/independent_activity_diagnostics.lua', original = 'return 3\n';
		const f = createActualSourcePanes(t, false, [[path, original]]);
		f.editor.editorParts.minimize(f.firstPart); f.editor.editorParts.minimize(f.secondPart);
		const main = f.editor.mainWorkspace, part = f.editor.editorParts.main, group = part.activeGroup;
		const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!;
		const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), input = new CodeEditorInput(model);
		group.openEditor(input); f.editor.setFontVariant(font); f.update();
		f.key('End', KeyModifier.ctrl);
		const append = '-- pending native document close\n';
		await f.editor.clipboard.writeText(append); f.key('KeyV', KeyModifier.ctrl); await Promise.resolve(); f.update();
		assert.equal(model.buffer.getText(), original + append); assert.equal(model.dirty, true);
		assert.equal(editorFeedbackState.message.visible, true, 'the actual Source paste producer retains its ordinary feedback');
		main.regionLayout.activityHeight = 70;
		f.editor.updateViewport({ width: 300, height: 80 }); f.update(); main.focusActivity(); f.update();
		const origin = f.editor.problems.focusTarget;
		assert.ok(inputFocus.admittedTarget === origin);
		const pending = f.editor.editorParts.closeGroup(group, origin), prompt = part.actionPrompt;
		f.update();
		try {
			assert.equal(prompt.visible, true); assert.equal(editorFeedbackState.message.visible, true);
			assert.ok(inputFocus.admittedTarget === origin);
			for (const button of prompt.view.buttons) {
				const bounds = button.bounds;
				assert.equal(f.editor.surfaces.hitTest((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2)?.captureScope,
					prompt.pointerScope, 'feedback and a long canonical label cannot displace native decision buttons beyond their presentation');
			}
			const cancel = prompt.view.buttons.find(button => button.choice === 'cancel')!.bounds;
			const x = (cancel.left + cancel.right) / 2, y = (cancel.top + cancel.bottom) / 2;
			f.editor.dispatchPointer(pointer(x, y, PointerButton.Primary));
			f.editor.dispatchPointer(pointer(x, y, 0, PointerButton.Primary));
			assert.equal(await pending, false); assert.equal(prompt.visible, false);
			assert.ok(group.model.activeTab === input && group.panes.activePane?.input === input);
			assert.equal(group.openingAdmitted, true); assert.equal(model.buffer.getText(), original + append); assert.equal(model.dirty, true);
		} finally { prompt.close('cancel', false); await pending; }
	});
