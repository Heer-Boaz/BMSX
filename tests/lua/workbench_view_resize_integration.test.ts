import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyModifier } from '../../hosts/common/input/text';
import type { EditorCommandId } from '../../ide/common/commands';
import { editorFeedbackState, updateEditorMessage } from '../../ide/common/feedback_state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { measureText, measureTextRange } from '../../ide/editor/common/text/layout';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import type { CommandQuickPickItem } from '../../ide/workbench/contrib/commands/quick_pick_provider';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import type { ActionPromptRequest } from '../../ide/workbench/contrib/modal/action_prompt_view';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createWorkbenchActionBar } from '../../ide/workbench/ui/action_bar';
import { WorkbenchFloatingWindow } from '../../ide/workbench/ui/window/control';
import { WorkbenchWindowModel } from '../../ide/workbench/ui/window/model';
import { createActualSourcePanes } from '../helpers/source_panes';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';

const RESIZE_COMMANDS = ['workspace.increaseViewWidth', 'workspace.decreaseViewWidth',
	'workspace.increaseViewHeight', 'workspace.decreaseViewHeight'] as const satisfies readonly EditorCommandId[];
const DECISION: ActionPromptRequest = { title: 'Pending source action', message: 'Continue with the captured source?',
	primary: 'Save and continue', secondary: 'Continue without saving', primaryEnabled: true, defaultChoice: 'primary' };

async function fixture(t: TestContext, font: 'tiny' | 'msx' = 'tiny') {
	const f = createActualSourcePanes(t, false, [['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	const editor = f.editor, parts = editor.editorParts, main = editor.mainWorkspace;
	t.after(() => updateEditorMessage(editorFeedbackState.message.timer));
	editor.updateViewport({ width: 1600, height: 800 }); editor.setFontVariant(font);
	parts.minimize(f.firstPart); parts.minimize(f.secondPart);
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!);
	const document = f.ide.sceneSources.get(model);
	assert.equal(await editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target!), true);
	const primary = main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true);
	const group = parts.main.activeGroup, input = new CodeEditorInput(model);
	group.openEditor(input); main.openActivity('problems'); editor.resourcePanel.show(); f.update();
	return { ...f, parts, main, primary, model, group, input };
}

for (const font of ['tiny', 'msx'] as const)
	test(`${font} focused view sizing changes native intent without publishing a field draft or replacing any subject`, async t => {
		const f = await fixture(t, font), { editor, main, primary, group, model } = f;
		main.focusPrimary('details');
		const field = primary.details.control.controls[0]; assert.equal(field.field.focusTarget.focus(), true);
		setFieldText(field.field, '-', true);
		const source = model.buffer.getText(), version = model.version, selected = primary.consumer.selection;
		const generation = primary.scope.contextGeneration, detailsGeneration = primary.details.scope.contextGeneration;
		const tabs = [...group.model.tabs], hierarchyWidth = main.regionLayout.hierarchyWidth;
		const activityHeight = main.regionLayout.activityHeight, filesRatio = editor.resourcePanel.split.ratio;
		const cycles = f.host.runtime.machine.scheduler.nowCycles;
		assert.equal(editor.commands.isEnabled('workspace.increaseViewWidth', field.field.focusTarget), true);
		editor.commands.execute('workspace.increaseViewWidth', field.field.focusTarget); f.update();
		const wider = main.regionLayout.detailsWidth; assert.notEqual(wider, undefined);
		assert.equal(editor.commands.isEnabled('workspace.decreaseViewWidth', field.field.focusTarget), true);
		editor.commands.execute('workspace.decreaseViewWidth', field.field.focusTarget); f.update();
		// Requested size is the persisted user intent changed by this command, not incidental rendered geometry.
		assert.ok(main.regionLayout.detailsWidth! < wider!);
		assert.equal(main.regionLayout.hierarchyWidth, hierarchyWidth); assert.equal(main.regionLayout.activityHeight, activityHeight);
		assert.equal(editor.resourcePanel.split.ratio, filesRatio);
		assert.equal(editor.commands.isEnabled('workspace.increaseViewHeight', field.field.focusTarget), false);
		editor.commands.execute('workspace.increaseViewHeight', field.field.focusTarget); f.update();
		assert.equal(field.pending, true); assert.equal(field.field.text, '-');
		assert.ok(inputFocus.admittedTarget === field.field.focusTarget && main.primary === primary && primary.consumer.selection === selected);
		assert.equal(primary.scope.contextGeneration, generation); assert.equal(primary.details.scope.contextGeneration, detailsGeneration);
		assert.deepEqual(group.model.tabs, tabs); assert.equal(model.buffer.getText(), source); assert.equal(model.version, version);
		assert.equal(model.dirty, false); assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
	});

test('Files and docked Activity expose only their real resizable axis while retaining native selection and focus', async t => {
	const f = await fixture(t), { editor, main } = f, files = editor.resourcePanel;
	files.focusTarget.focus();
	const selected = files.files.selectedNode, ratio = files.split.ratio, filesScope = files.focusTarget.scope.contextGeneration;
	assert.equal(editor.commands.isEnabled('workspace.increaseViewWidth', files.focusTarget), true);
	editor.commands.execute('workspace.increaseViewWidth', files.focusTarget); f.update();
	assert.ok(files.split.ratio > ratio);
	assert.ok(inputFocus.admittedTarget === files.focusTarget && files.files.selectedNode === selected);
	assert.equal(files.focusTarget.scope.contextGeneration, filesScope);
	for (const command of ['workspace.increaseViewHeight', 'workspace.decreaseViewHeight'] as const) {
		assert.equal(editor.commands.isEnabled(command, files.focusTarget), false);
		editor.commands.execute(command, files.focusTarget);
	}
	main.focusActivity(); f.update();
	const activity = main.activity!, target = activity.commandTarget, scope = activity.scope.contextGeneration;
	const before = main.regionLayout.activityHeight;
	assert.equal(editor.commands.isEnabled('workspace.increaseViewHeight', target), true);
	editor.commands.execute('workspace.increaseViewHeight', target); f.update();
	assert.notEqual(main.regionLayout.activityHeight, before);
	assert.ok(inputFocus.admittedTarget === target && main.activity === activity); assert.equal(activity.scope.contextGeneration, scope);
	const size = main.regionLayout.activityHeight;
	for (const command of ['workspace.increaseViewWidth', 'workspace.decreaseViewWidth'] as const) {
		assert.equal(editor.commands.isEnabled(command, target), false);
		editor.commands.execute(command, target); f.update();
		assert.equal(main.regionLayout.activityHeight, size);
	}
	main.setActivityPlacement('floatingWindow'); f.update();
	for (const command of RESIZE_COMMANDS) assert.equal(editor.commands.isEnabled(command, target), false);
	assert.equal(main.activityPlacement, 'floatingWindow'); assert.ok(main.activity === activity);
});

test('a retained hierarchy origin resizes that region rather than the later active document window', async t => {
	const f = await fixture(t), { editor, primary, main } = f;
	main.focusPrimary('hierarchy'); const origin = inputFocus.admittedTarget!;
	f.secondPart.focus(); f.update();
	const focused = inputFocus.admittedTarget, active = f.parts.activePart, window = f.secondPart.window!.model;
	const bounds = { ...window.requestedBounds }, placement = window.placement;
	const before = main.regionLayout.hierarchyWidth;
	assert.equal(editor.commands.isEnabled('workspace.increaseViewWidth', origin), true);
	editor.commands.execute('workspace.increaseViewWidth', origin); f.update();
	assert.notEqual(main.regionLayout.hierarchyWidth, before);
	assert.ok(inputFocus.admittedTarget === focused && f.parts.activePart === active && main.primary === primary);
	assert.deepEqual(window.requestedBounds, bounds); assert.equal(window.placement, placement);
});

test('resize command availability follows the native directional limit instead of accepting an inert action', async t => {
	const f = await fixture(t), { editor, main, primary } = f;
	main.focusPrimary('details'); const origin = inputFocus.admittedTarget!, sash = main.regionLayout.detailsSash;
	// Arrange an actual native limit; the assertion concerns command availability, not a UI coordinate.
	sash.moveTo(sash.start + sash.minimumFirstSize); f.update();
	const width = main.regionLayout.detailsWidth;
	assert.equal(editor.commands.isEnabled('workspace.increaseViewWidth', origin), false);
	editor.commands.execute('workspace.increaseViewWidth', origin); f.update();
	assert.equal(main.regionLayout.detailsWidth, width);
	assert.equal(editor.commands.isEnabled('workspace.decreaseViewWidth', origin), true);
	editor.commands.execute('workspace.decreaseViewWidth', origin); f.update();
	assert.ok(main.regionLayout.detailsWidth! < width! && inputFocus.admittedTarget === origin && main.primary === primary);
	const files = editor.resourcePanel; files.focusTarget.focus();
	files.split.moveTo(files.split.start + files.split.minimumFirstSize); f.update();
	const ratio = files.split.ratio;
	assert.equal(editor.commands.isEnabled('workspace.decreaseViewWidth', files.focusTarget), false);
	editor.commands.execute('workspace.decreaseViewWidth', files.focusTarget); f.update();
	assert.equal(files.split.ratio, ratio);
	assert.equal(editor.commands.isEnabled('workspace.increaseViewWidth', files.focusTarget), true);
});

test('group resize addresses the invoking retained group and preserves topology, inputs, source reading and active focus', async t => {
	const f = await fixture(t), { editor, group, input } = f, part = f.parts.main;
	f.main.setRegionVisible('hierarchy', false); f.main.setRegionVisible('details', false); f.main.setActivityVisible(false);
	editor.resourcePanel.hide(); f.update();
	const right = part.splitGroup(group, 'right'), below = part.splitGroup(group, 'down');
	right.openEditor(new CodeEditorInput(f.firstInput.workingCopy)); below.openEditor(new CodeEditorInput(f.secondInput.workingCopy));
	f.update(); group.panes.activePane!.focus();
	const origin = group.panes.activePane!.commandTarget, topology = part.arrangement.topologyRevision;
	const groups = [...part.groups], tabs = groups.map(candidate => [...candidate.model.tabs]);
	input.context.view.cursorRow = 2; input.context.view.cursorColumn = 7;
	const row = input.context.view.cursorRow, column = input.context.view.cursorColumn, source = f.model.buffer.getText();
	const splits = [...part.arrangement.splits], ratios = splits.map(split => split.split.ratio);
	right.panes.activePane!.focus(); const focused = inputFocus.admittedTarget;
	assert.equal(editor.commands.isEnabled('workspace.increaseViewWidth', origin), true);
	editor.commands.execute('workspace.increaseViewWidth', origin); f.update();
	assert.ok(splits.some((split, index) => split.split.ratio !== ratios[index]));
	const widths = splits.map(split => split.split.ratio);
	assert.equal(editor.commands.isEnabled('workspace.increaseViewHeight', origin), true);
	editor.commands.execute('workspace.increaseViewHeight', origin); f.update();
	assert.ok(splits.some((split, index) => split.split.ratio !== widths[index]));
	assert.equal(part.arrangement.topologyRevision, topology); assert.deepEqual(part.groups, groups);
	groups.forEach((candidate, index) => assert.deepEqual(candidate.model.tabs, tabs[index]));
	assert.ok(inputFocus.admittedTarget === focused && part.activeGroup === right && group.model.activeTab === input);
	assert.equal(input.context.view.cursorRow, row); assert.equal(input.context.view.cursorColumn, column);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.dirty, false);
});

test('a sole or maximized document group has no resize boundary and never borrows Main side-region sizes', async t => {
	const f = await fixture(t), { editor, main, group } = f, part = f.parts.main;
	group.panes.activePane!.focus(); const origin = group.panes.activePane!.commandTarget;
	const hierarchy = main.regionLayout.hierarchyWidth, details = main.regionLayout.detailsWidth, activity = main.regionLayout.activityHeight;
	for (const command of RESIZE_COMMANDS) {
		assert.equal(editor.commands.isEnabled(command, origin), false);
		editor.commands.execute(command, origin); f.update();
	}
	const added = part.splitGroup(group, 'right'); added.openEditor(new CodeEditorInput(f.firstInput.workingCopy)); f.update();
	part.arrangement.toggleMaximize(group); f.update(); group.panes.activePane!.focus();
	const ratio = part.arrangement.splits[0].split.ratio;
	for (const command of RESIZE_COMMANDS) {
		assert.equal(editor.commands.isEnabled(command, origin), false);
		editor.commands.execute(command, origin); f.update();
	}
	assert.equal(part.arrangement.splits[0].split.ratio, ratio); assert.ok(part.arrangement.maximized === group);
	assert.equal(main.regionLayout.hierarchyWidth, hierarchy); assert.equal(main.regionLayout.detailsWidth, details);
	assert.equal(main.regionLayout.activityHeight, activity); assert.ok(inputFocus.admittedTarget === origin);
});

test('hidden primary and Activity origins cannot resize another live client or revive their attachments', async t => {
	const f = await fixture(t), { editor, main, primary } = f;
	main.focusPrimary('details'); const details = inputFocus.admittedTarget!;
	main.focusActivity(); const activity = inputFocus.admittedTarget!;
	main.setRegionVisible('details', false); main.setActivityVisible(false); f.secondPart.focus(); f.update();
	const focused = inputFocus.admittedTarget, hierarchy = main.regionLayout.hierarchyWidth;
	const width = main.regionLayout.detailsWidth, height = main.regionLayout.activityHeight;
	for (const origin of [details, activity]) for (const command of RESIZE_COMMANDS) {
		assert.equal(editor.commands.isEnabled(command, origin), false);
		editor.commands.execute(command, origin); f.update();
	}
	assert.equal(primary.details.attached, false); assert.equal(main.activityDisplayed, false);
	assert.equal(main.regionLayout.hierarchyWidth, hierarchy); assert.equal(main.regionLayout.detailsWidth, width);
	assert.equal(main.regionLayout.activityHeight, height); assert.ok(inputFocus.admittedTarget === focused && main.primary === primary);
});

test('root and local modal admission prevents resize commands from escaping into blocked document or Main regions', async t => {
	const f = await fixture(t), { editor, main, group, primary } = f;
	main.focusPrimary('hierarchy'); const hierarchy = inputFocus.admittedTarget!;
	const width = main.regionLayout.hierarchyWidth;
	const rootDecision = editor.actionPrompt.show(DECISION); f.update();
	for (const origin of [hierarchy, editor.actionPrompt.focusTarget]) for (const command of RESIZE_COMMANDS) {
		assert.equal(editor.commands.isEnabled(command, origin), false);
		editor.commands.execute(command, origin); f.update();
	}
	assert.equal(main.regionLayout.hierarchyWidth, width); assert.ok(inputFocus.admittedTarget === editor.actionPrompt.focusTarget);
	f.key('Escape'); assert.equal(await rootDecision, 'cancel');
	const right = f.parts.main.splitGroup(group, 'right'); right.openEditor(new CodeEditorInput(f.firstInput.workingCopy)); f.update();
	group.panes.activePane!.focus(); const document = group.panes.activePane!.commandTarget;
	const prompt = f.parts.main.actionPrompt, localDecision = prompt.show(DECISION); f.update();
	t.after(() => prompt.close('cancel', false));
	const ratio = f.parts.main.arrangement.splits[0].split.ratio;
	for (const origin of [document, prompt.focusTarget]) for (const command of RESIZE_COMMANDS) {
		assert.equal(editor.commands.isEnabled(command, origin), false);
		editor.commands.execute(command, origin); f.update();
	}
	assert.equal(f.parts.main.arrangement.splits[0].split.ratio, ratio);
	assert.equal(editor.commands.isEnabled('workspace.increaseViewWidth', hierarchy), true);
	editor.commands.execute('workspace.increaseViewWidth', hierarchy); f.update();
	assert.notEqual(main.regionLayout.hierarchyWidth, width); assert.equal(prompt.visible, true);
	assert.ok(main.primary === primary && inputFocus.admittedTarget === prompt.focusTarget);
	prompt.close('cancel'); assert.equal(await localDecision, 'cancel');
});

test('a modeless window owned by a modal cannot resize through its borrowed document ancestry', async t => {
	const f = await fixture(t), surfaces = f.editor.surfaces, bounds = f.main.bounds;
	const right = f.parts.main.splitGroup(f.group, 'right'); right.openEditor(new CodeEditorInput(f.firstInput.workingCopy)); f.update();
	const modal = surfaces.attach({ role: 'modal', blockedScope: f.parts.main.surface,
		presentationParent: f.main.surface, lifetimeOwner: f.main.surface, captureScope: Symbol('resize-local-sheet'),
		isVisible: () => true, getBounds: () => bounds, getClip: () => bounds, draw() {} });
	const scope = new InputFocusScope(Symbol('resize-sheet-owned-window'), f.group.focusScope);
	const window = surfaces.attach({ role: 'window', presentationParent: modal, lifetimeOwner: modal, captureScope: scope.surfaceScope,
		isVisible: () => true, getBounds: () => bounds, getClip: () => bounds, draw() {} });
	t.after(() => modal.dispose());
	const target = inputFocus.createTarget(null, scope); target.canFocus = () => window.visible;
	t.after(target.bindKeyboard(() => {})); assert.equal(target.focus(), true);
	const ratios = f.parts.main.arrangement.splits.map(split => split.split.ratio);
	for (const command of RESIZE_COMMANDS) {
		assert.equal(f.editor.commands.isEnabled(command, target), false);
		f.editor.commands.execute(command, target); f.update();
	}
	assert.deepEqual(f.parts.main.arrangement.splits.map(split => split.split.ratio), ratios);
	assert.ok(inputFocus.admittedTarget === target);
});

test('an owned floating inspector retains semantic document ancestry without borrowing the document resize boundary', async t => {
	const f = await fixture(t), { editor, group } = f, part = f.parts.main;
	const right = part.splitGroup(group, 'right'); right.openEditor(new CodeEditorInput(f.firstInput.workingCopy)); f.update();
	const window = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, editor.surfaces, editor.commands, editor.contextMenu, {
		model: new WorkbenchWindowModel({ left: 40, top: 50, right: 320, bottom: 250 }, 80, 40),
		actionBar: createWorkbenchActionBar('window.title'), lifetimeOwner: group.paneSurface, presentationParent: null,
		focusScope: group.focusScope, focusReturn: group.focusTarget, workArea: f.main.bounds,
		content: { draw() {} }, layoutContent() {}, retireContentInput() {}, restoreContentInput() {}, focusContent() {},
	});
	t.after(() => window.dispose()); window.attach(); window.show(false);
	window.layout(editorViewState.font.renderFont(), measureTextRange, measureText); window.clientFocusTarget.focus();
	const origin = inputFocus.admittedTarget!, ratios = part.arrangement.splits.map(split => split.split.ratio);
	const bounds = { ...window.model.requestedBounds }, generation = origin.scope.contextGeneration;
	assert.ok(group.focusScope.contains(origin.scope));
	for (const command of RESIZE_COMMANDS) {
		assert.equal(editor.commands.isEnabled(command, origin), false);
		editor.commands.execute(command, origin); f.update();
	}
	assert.deepEqual(part.arrangement.splits.map(split => split.split.ratio), ratios);
	assert.deepEqual(window.model.requestedBounds, bounds); assert.equal(origin.scope.contextGeneration, generation);
	assert.ok(inputFocus.admittedTarget === origin && window.visible && group.model.activeTab === f.input);
});

test('a guest viewport cannot use focused-view resize authority or change the physical machine through these UI commands', async t => {
	const f = await fixture(t), { editor, group } = f;
	const right = f.parts.main.splitGroup(group, 'right'); right.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	group.openEditor(new GameViewInput()); f.update(); group.panes.activePane!.focus(); f.key('Tab');
	const guest = inputFocus.admittedTarget!; assert.ok(guest.guestInput !== undefined);
	const binding = guest.guestInput, ratios = f.parts.main.arrangement.splits.map(split => split.split.ratio);
	const cycles = f.host.runtime.machine.scheduler.nowCycles;
	for (const command of RESIZE_COMMANDS) {
		assert.equal(editor.commands.isEnabled(command, guest), false);
		editor.commands.execute(command, guest); f.update();
	}
	assert.deepEqual(f.parts.main.arrangement.splits.map(split => split.split.ratio), ratios);
	assert.ok(inputFocus.admittedTarget === guest && guest.guestInput === binding);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('the real command palette resizes its captured native origin and returns to the same authored presentation', async t => {
	const f = await fixture(t), { editor, main, primary } = f;
	main.focusPrimary('hierarchy'); const origin = inputFocus.admittedTarget!, selected = primary.consumer.selection;
	const width = main.regionLayout.hierarchyWidth, source = f.model.buffer.getText();
	f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
	const picker = editor.quickInput; assert.equal(picker.visible, true);
	const index = picker.model.list.rows.findIndex(row => (row.item as CommandQuickPickItem).command === 'workspace.increaseViewWidth');
	assert.ok(index >= 0);
	for (let row = 0; row < index; row++) f.key('ArrowDown');
	f.key('Enter'); assert.equal(picker.visible, false);
	assert.notEqual(main.regionLayout.hierarchyWidth, width);
	assert.ok(inputFocus.admittedTarget === origin && main.primary === primary && primary.consumer.selection === selected);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.dirty, false);
});
