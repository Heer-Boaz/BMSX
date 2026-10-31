import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createSceneSourceFixture } from '../helpers/scene_sources';
import { SCENE_AUTHORING_SOURCE } from '../fixtures/studio/scene_authoring';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneEditorControl } from '../../ide/workbench/contrib/scene_editor/control';
import { SceneEditorViewState } from '../../ide/workbench/contrib/scene_editor/view_state';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import type { EditorCommandRunner } from '../../ide/common/commands';

/** Actual Scene controls attached to frontend surfaces, without an editor input or group. */
function fixture(t: TestContext) {
	configureFontVariant('tiny');
	const source = createSceneSourceFixture(t, SCENE_AUTHORING_SOURCE);
	const document = source.documents.get(source.model);
	const context = new SceneAuthoringContext(source.model, source.documents,
		{ document, sourceVersion: source.model.version, scene: document.scenes[0] });
	const view = new SceneEditorViewState(context), surfaces = new WorkbenchSurfaceService();
	const scope = new InputFocusScope(Symbol('standalone Scene control'), inputFocus.workbenchScope);
	const bounds = { left: 0, top: 0, right: 384, bottom: 288 };
	const owner = surfaces.attach({ role: 'content', captureScope: scope.surfaceScope, isVisible: () => true,
		getBounds: () => bounds, getClip: () => bounds, draw() {} });
	const menu = new ContextMenuController(inputFocus, pointerCapture, bounds);
	const commands: EditorCommandRunner = {
		isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target),
	};
	const picker = new QuickInputController(menu, undefined, undefined, { scope: inputFocus.workbenchScope, bounds, kind: 'workspace' });
	const control = new SceneEditorControl(commands, source.sources, menu, surfaces, owner, bounds, scope, picker);
	control.setView(view, bounds); control.update();
	t.after(() => {
		picker.dispose(); control.dispose(); view.dispose(); context.dispose(); menu.dispose(); surfaces.dispose();
		inputFocus.setTarget(null); pointerCapture.cancel();
	});
	return { ...source, context, view, control, bounds };
}

test('a second Scene presentation projects an existing context selection instead of choosing its own first root', t => {
	const f = fixture(t);
	assert.equal(selectSceneOutlineRow(f.view.hierarchy, 2), true); f.control.update();
	const selected = f.context.selection, next = new SceneEditorViewState(f.context);
	t.after(() => next.dispose());
	f.control.setView(next, f.bounds); f.control.update();
	assert.equal(f.context.selection, selected);
	assert.equal(next.hierarchy.outline.rows[next.hierarchy.outline.selectionIndex].element.kind, 'member');
	assert.equal(f.control.details.controls[0].field.text, '4', 'the newly attached field binds the selected canonical numeric value');
	assert.equal(f.model.buffer.getText(), SCENE_AUTHORING_SOURCE);
});

test('independent Scene contexts share source but not semantic selection or control drafts', t => {
	const f = fixture(t), other = new SceneAuthoringContext(f.model, f.documents), otherView = new SceneEditorViewState(other);
	t.after(() => { otherView.dispose(); other.dispose(); });
	otherView.refresh(); selectSceneOutlineRow(otherView.hierarchy, 3);
	selectSceneOutlineRow(f.view.hierarchy, 1); f.control.update();
	const field = f.control.details.controls[0]; field.field.focusTarget.focus(); setFieldText(field.field, '31', true);
	assert.equal(field.commit(), true);
	f.context.refresh(); other.refresh();
	assert.ok(f.context.document === other.document, 'contexts share the newly admitted projection');
	assert.equal(other.selection?.kind, 'member');
	assert.equal(other.selection?.kind === 'member' ? other.selection.entry : undefined, other.document!.scenes[0].objects[2]);
	assert.equal(other.selection?.kind === 'member' ? other.selection.index : -1, 2);
	assert.equal(f.model.buffer.getText(), SCENE_AUTHORING_SOURCE.replace('0, 0, 1, 1,', '0, 0, 1, 31,'));
});

test('a missing primary declaration revokes pending field edits and cannot retarget the control after Undo', t => {
	const f = fixture(t);
	selectSceneOutlineRow(f.view.hierarchy, 1); f.control.update();
	const field = f.control.details.controls[0]; field.field.focusTarget.focus(); setFieldText(field.field, '77', true);
	const source = f.model.buffer.getText();
	f.model.pushEditOperations([{ offset: 0, deleteLength: source.length, text: source }]);
	assert.equal(field.commit(), true, 'admission retires the old draft instead of applying it to a replacement');
	assert.equal(f.context.availability, 'unavailable');
	assert.equal(f.view.hierarchy.outline.rows.length, 0);
	assert.equal(field.field.readOnly, true);
	assert.equal(f.model.buffer.getText(), source);
	f.model.undo(); f.control.update();
	assert.equal(f.context.availability, 'unavailable');
	assert.equal(f.view.hierarchy.outline.rows.length, 0);
	assert.equal(f.model.buffer.getText(), source);
});


test('canonical model retirement detaches a standalone Scene widget and revokes its field and history targets', t => {
	const f = fixture(t);
	selectSceneOutlineRow(f.view.hierarchy, 1); f.control.update();
	const field = f.control.details.controls[0], origin = f.control.focusTarget;
	field.field.focusTarget.focus(); setFieldText(field.field, '88', true);
	f.models.clear();
	assert.equal(f.control.hasView, false);
	assert.equal(field.pending, false);
	assert.equal(field.field.focusTarget.hasFocus, false);
	assert.equal(origin.getCommand('undo')!.isEnabled(), false);
	assert.equal(origin.getCommand('sceneEditor.removeMember')!.isEnabled(), false);
	assert.equal(f.control.getSourceLocation(), undefined);
	f.control.update();
});
