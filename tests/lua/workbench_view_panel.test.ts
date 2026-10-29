import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createSceneSourceFixture } from '../helpers/scene_sources';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneDetailsViewState } from '../../ide/workbench/contrib/scene_editor/details_view';
import { SceneDetailsControl } from '../../ide/workbench/contrib/scene_editor/details_control';
import { measureSceneDetails } from '../../ide/workbench/contrib/scene_editor/details_layout';
import { WorkbenchViewPanel } from '../../ide/workbench/ui/view_panel/control';
import { createWorkbenchActionBar } from '../../ide/workbench/ui/action_bar';
import { WorkbenchMenu } from '../../ide/workbench/ui/menu/model';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import type { EditorCommandRunner } from '../../ide/common/commands';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('room', { objects = {
 { member_id = 'first', definition_id = 'actor', options = { pos = { x = 1, y = 2, z = 3 }, strength = 5 } },
} })`;
function fixture(t: TestContext) {
	configureFontVariant('tiny');
	const f = createSceneSourceFixture(t, SOURCE), context = new SceneAuthoringContext(f.model, f.documents), view = new SceneDetailsViewState(context);
	const document = context.document!, scene = document.scenes[0];
	context.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 });
	const bounds = { left: 0, top: 0, right: 240, bottom: 240 }, surfaces = new WorkbenchSurfaceService();
	const scope = new InputFocusScope(Symbol('view panel client'), inputFocus.workbenchScope), focusReturn = inputFocus.createTarget();
	focusReturn.bindKeyboard(() => {});
	const semantic = inputFocus.createTarget(focusReturn, scope); semantic.canFocus = () => false;
	const saved: string[] = [];
	semantic.registerCommand('save', { contextual: true, isEnabled: () => true, run: () => { saved.push(f.model.buffer.getText()); } });
	const surface = surfaces.attach({ role: 'content', captureScope: Symbol('view panel region'), isVisible: () => true,
		getBounds: () => bounds, getClip: () => bounds, draw() {} });
	const menu = new ContextMenuController(inputFocus, pointerCapture);
	const commands: EditorCommandRunner = { isEnabled: (command, target) => target?.resolveCommand(command)?.isEnabled() === true,
		execute: (command, target) => { const action = target?.resolveCommand(command); if (action?.isEnabled()) action.run(); } };
	const actions = new WorkbenchMenu([{ type: 'command', command: 'save' }], undefined);
	const sections = { outline: { isEnabled: () => true, run: () => { focusReturn.focus(); } }, details: { isEnabled: () => true, run: () => {} } };
	const panel = new WorkbenchViewPanel({ title: 'Details', description: f.resource.path, view, actions: createWorkbenchActionBar(actions, true),
		contextActions: actions, commands, contextMenu: menu, surfaces, surface, workArea: bounds, scope, commandTarget: semantic, focusReturn,
		measureContent: measureSceneDetails, createControl: region => new SceneDetailsControl(commands, menu, region, semantic, sections) });
	panel.attach(bounds);
	t.after(() => { panel.dispose(); view.dispose(); context.dispose(); menu.dispose(); surfaces.dispose(); inputFocus.setTarget(null); pointerCapture.interrupt(false); });
	return { ...f, context, view, panel, bounds, focusReturn, menu, saved };
}

test('a real panel owns its header/body Tab boundary without making the logical semantic target focusable', t => {
	const f = fixture(t), actions = f.panel.actionBar.focusTarget;
	actions.focus();
	for (const target of [f.panel.control.focusTarget, ...f.panel.control.controls.map(control => control.field.focusTarget),
		...f.panel.control.options.controls.map(control => control.field.focusTarget), actions]) {
		assert.equal(inputFocus.moveFocus(false), true); assert.equal(inputFocus.target, target);
	}
	assert.equal(inputFocus.moveFocus(true), true);
	assert.equal(inputFocus.target, f.panel.control.options.controls.at(-1)!.field.focusTarget);
});

test('stable panel updates keep field draft history, placement and header geometry generations', t => {
	const f = fixture(t), field = f.panel.control.controls[0];
	field.field.focusTarget.focus(); setFieldText(field.field, '31', true);
	const layout = f.panel.layoutState.actionRevision, projection = f.view.projection.subject;
	let fieldChanges = 0; const unbind = field.field.onDidChangeText(() => { fieldChanges++; }); t.after(unbind);
	for (let index = 0; index < 100; index++) f.panel.update();
	assert.equal(fieldChanges, 0); assert.equal(field.pending, true);
	assert.equal(f.view.projection.subject, projection);
	assert.equal(f.panel.layoutState.actionRevision, layout);
	assert.equal(f.model.buffer.getText(), SOURCE);
});

test('panel detach revokes its own source of input and field draft while retaining source selection and reading state', t => {
	const f = fixture(t), field = f.panel.control.controls[0], selected = f.context.selection;
	field.field.focusTarget.focus(); setFieldText(field.field, '31', true);
	const generation = f.panel.scope.contextGeneration;
	f.panel.detach();
	assert.equal(f.panel.attached, false); assert.ok(f.panel.scope.contextGeneration > generation);
	assert.equal(field.pending, false); assert.equal(f.context.selection, selected);
	assert.equal(inputFocus.target, f.focusReturn);
	assert.equal(f.model.buffer.getText(), SOURCE);
	f.panel.attach(f.bounds); assert.equal(f.panel.control.controls[0].field.text, '1');
});

test('re-showing a panel during retirement cannot retain an armed header activation', t => {
	const f = fixture(t), actions = f.panel.actionBar.focusTarget;
	actions.focus(); inputFocus.handleKeyboard(new KeyInputEvent('Space', KeyModifier.none));
	const unbind = f.panel.scope.onDidRetireContext(() => f.panel.attach(f.bounds)); t.after(unbind);
	f.panel.detach();
	assert.equal(f.panel.attached, true);
	inputFocus.handleKeyboard(new KeyInputEvent('Space', KeyModifier.none, false, false));
	assert.deepEqual(f.saved, []);
});

test('a panel container has its own native keyboard behavior and returns to its real focus owner', t => {
	const f = fixture(t);
	f.panel.commandTarget.focus(); inputFocus.handleKeyboard(new KeyInputEvent('ArrowDown', KeyModifier.none));
	assert.equal(inputFocus.target, f.panel.commandTarget);
	inputFocus.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none));
	assert.equal(inputFocus.target, f.focusReturn);
});

test('the native header context menu ends with its region attachment, not the shared semantic owner', t => {
	const f = fixture(t), actions = f.panel.actionBar.focusTarget;
	actions.focus(); inputFocus.executeCommand('contextMenu', actions); assert.equal(f.menu.visible, true);
	f.panel.detach(); assert.equal(f.menu.visible, false);
	f.panel.attach(f.bounds); actions.focus(); inputFocus.executeCommand('contextMenu', actions);
	assert.equal(f.menu.visible, true);
});

for (const owner of ['own', 'sibling'] as const) test(`panel detach cancels only its ${owner === 'own' ? 'own' : 'not its sibling\'s'} captured pointer route`, t => {
	const f = fixture(t), scope = owner === 'own' ? f.panel.scope.surfaceScope : Symbol('other region');
	const pointer = { valid: true, insideViewport: true, viewportX: 10, viewportY: 10,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 };
	let cancelled = 0;
	const target = { handleCapturedPointer() {}, releaseCapturedPointer() {}, cancelPointer() { cancelled++; } };
	pointerCapture.beginRoute(scope, pointer); pointerCapture.capture(target, PointerButton.Primary, scope);
	f.panel.detach();
	assert.equal(cancelled, owner === 'own' ? 1 : 0);
	assert.equal(pointerCapture.active, owner !== 'own');
	assert.equal(pointerCapture.draining, owner === 'own');
});
