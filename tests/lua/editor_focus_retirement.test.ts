import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { InputFocusScope, InputFocusService, inputFocus } from '../../ide/input/focus';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { createActualSourcePanes } from '../helpers/source_panes';

test('retiring a control follows its declared return chain past unavailable controls and denied surfaces', () => {
	const focus = new InputFocusService();
	const container = focus.createTarget();
	const blocked = focus.createTarget(container, new InputFocusScope());
	const unavailable = focus.createTarget(blocked, new InputFocusScope());
	const field = focus.createTarget(unavailable, new InputFocusScope());
	let eligible = true, blurs = 0;
	field.canFocus = () => eligible;
	unavailable.canFocus = () => false;
	field.onDidBlur(next => { blurs++; assert.ok(next === container); });
	assert.equal(field.focus(), true);
	focus.bindScopeAdmission(scope => scope !== blocked.scope);
	eligible = false;
	field.release();
	assert.ok(focus.admittedTarget === container);
	assert.equal(blurs, 1);
});

test('retiring an ineligible control clears focus when every declared return surface is denied', () => {
	const focus = new InputFocusService();
	const container = focus.createTarget();
	const parent = focus.createTarget(container, new InputFocusScope());
	const field = focus.createTarget(parent, new InputFocusScope());
	let eligible = true, blurs = 0;
	field.canFocus = () => eligible;
	field.onDidBlur(next => { blurs++; assert.ok(next === null); });
	assert.equal(field.focus(), true);
	focus.bindScopeAdmission(() => false);
	eligible = false;
	field.release();
	assert.ok(focus.target === null);
	assert.equal(blurs, 1);
});

test('retirement preserves a newer foreign focus selected by the departing control', () => {
	const focus = new InputFocusService();
	const container = focus.createTarget(), field = focus.createTarget(container), foreign = focus.createTarget();
	let containerFocuses = 0;
	container.onDidFocus(() => { containerFocuses++; });
	field.onDidBlur(() => { foreign.focus(); });
	assert.equal(field.focus(), true);
	field.release();
	assert.ok(focus.admittedTarget === foreign);
	assert.equal(containerFocuses, 0);
	const revision = focus.revision;
	field.release();
	assert.ok(focus.admittedTarget === foreign);
	assert.equal(focus.revision, revision, 'a retired control cannot release a newer focus owner');
});

for (const invocation of ['command', 'toolbar pointer', 'compact command'] as const) test(`Scene ${invocation} removal returns a retired numeric field to Outline for canonical keyboard Undo`, t => {
	const f = createActualSourcePanes(t, false, [['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	f.editor.setFontVariant('tiny');
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	f.editor.sceneEditor.openResource(f.firstGroup, resource);
	const input = f.firstGroup.model.activeTab;
	assert.ok(input instanceof SceneEditorInput);
	f.update();
	const pane = f.firstGroup.panes.activePane!;
	assert.ok(pane instanceof SceneEditorPane);
	if (invocation === 'compact command') { f.firstBounds.right = 160; f.update(); }
	selectSceneOutlineRow(input, 1);
	pane.update();
	f.editor.commands.execute('sceneEditor.details', pane.commandTarget);
	const commandTarget = pane.commandTarget;
	const field = pane.controls[0].field, model = input.workingCopy, original = model.buffer.getText();
	assert.equal(field.focusTarget.focus(), true);
	assert.equal(field.replaceText(0, field.readText().text.length, '789'), true);
	assert.equal(field.focusTarget.edit!.pending, true);
	const accepted = original.replace('x = 11', 'x = 789');

	if (invocation !== 'toolbar pointer') f.editor.commands.execute('sceneEditor.removeMember', field.focusTarget.commandContext);
	else {
		const action = input.actionBar.items.find(item => item.command === 'sceneEditor.removeMember')!;
		assert.ok(action.visible && !action.overflowed && action.enabled);
		const { left, right, top, bottom } = action.bounds;
		// Geometry locates the actual retained action; the assertions concern focus and source history.
		for (const down of [true, false]) {
			f.host.clock.advance(10);
			f.editor.dispatchPointer({ x: (left + right) / 2, y: (top + bottom) / 2,
				buttons: down ? PointerButton.Primary : 0, pressedButtons: down ? PointerButton.Primary : 0,
				releasedButtons: down ? 0 : PointerButton.Primary, cancelledButtons: 0,
				modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
		}
	}
	assert.equal(field.focusTarget.edit!.pending, false);
	assert.equal(input.outline.selectionIndex, -1);
	assert.ok(model.buffer.getText() !== original && model.buffer.getText() !== accepted);
	f.update();
	assert.equal(input.section, 'outline');
	assert.ok(inputFocus.admittedTarget === pane.commandTarget);
	assert.ok(inputFocus.admittedTarget !== commandTarget, 'the retired Details subject cannot remain the keyboard owner');
	f.key('KeyZ', KeyModifier.ctrl);
	assert.equal(model.buffer.getText(), accepted, 'first Undo reverses removal, not the separately accepted numeric draft');
	assert.equal(input.outline.selectionIndex, -1);
	f.key('KeyZ', KeyModifier.ctrl);
	assert.equal(model.buffer.getText(), original);
	assert.equal(model.canUndo, false);
	assert.equal(model.canRedo, true);
	assert.equal(input.section, 'outline');
});
