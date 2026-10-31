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
import { editorViewState } from '../../ide/editor/ui/view/state';
import { api } from '../../ide/runtime/overlay_api';
import { createWorkbenchViewPanelLayout, layoutWorkbenchViewPanel } from '../../ide/workbench/ui/view_panel/layout';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('room', { objects = {
 { member_id = 'first', definition_id = 'actor', spatial = { local_transform = { 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 2, 3 } }, options = { strength = 5 } },
} })`;
function fixture(t: TestContext, font: 'tiny' | 'msx' = 'tiny') {
	configureFontVariant(font);
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
	const menu = new ContextMenuController(inputFocus, pointerCapture, bounds);
	const commands: EditorCommandRunner = { isEnabled: (command, target) => target?.resolveCommand(command)?.isEnabled() === true,
		execute: (command, target) => { const action = target?.resolveCommand(command); if (action?.isEnabled()) action.run(); } };
	const actions = new WorkbenchMenu([{ type: 'command', command: 'save' }], undefined);
	const sections = { outline: { isEnabled: () => true, run: () => { focusReturn.focus(); } }, details: { isEnabled: () => true, run: () => {} } };
	const panel = new WorkbenchViewPanel({ title: 'Details', description: f.resource.path, view, actions: createWorkbenchActionBar(actions, true),
		contextActions: actions, bodyContextMenu: 'content', commands, contextMenu: menu, surfaces, surface, workArea: bounds, scope, commandTarget: semantic, focusReturn,
		isPresented: () => true, measureContent: measureSceneDetails,
		createControl: region => new SceneDetailsControl(commands, menu, region, semantic, sections, actions) });
	panel.attach(bounds);
	t.after(() => { panel.dispose(); view.dispose(); context.dispose(); menu.dispose(); surfaces.dispose(); inputFocus.setTarget(null); pointerCapture.interrupt(false); });
	return { ...f, context, view, panel, bounds, focusReturn, menu, saved, actions };
}

for (const font of ['tiny', 'msx'] as const) test(`${font} a container-owned header consumes exactly its allocation without rebinding the body`, t => {
	const f = fixture(t, font), field = f.panel.control.controls[0], selected = f.context.selection;
	const setView = t.mock.method(f.panel.control, 'setView'), clearView = t.mock.method(f.panel.control, 'clearView');
	field.field.focusTarget.focus(); setFieldText(field.field, '31', true);
	const generation = f.panel.scope.contextGeneration, projection = f.view.projection.subject;
	const visible = { minimumWidth: 0, preferredWidth: 0, minimumHeight: 0 }, hidden = { ...visible }, content = { ...visible };
	f.panel.measure(editorViewState.font, visible); measureSceneDetails(editorViewState.font, content);
	f.panel.setHeaderVisible(false); f.panel.measure(editorViewState.font, hidden);
	// Header allocation is the focused layout contract; body content must receive the whole supplied rectangle.
	assert.equal(visible.minimumHeight, content.minimumHeight + editorViewState.font.lineHeight + 4);
	assert.deepEqual(hidden, content);
	assert.deepEqual(f.panel.layoutState.client, f.bounds);
	assert.equal(f.panel.layoutState.header.top, f.panel.layoutState.header.bottom);
	assert.equal(f.panel.actionBar.focusTarget.canFocus!(), false);
	assert.ok(f.panel.contextActions === f.actions); assert.equal(f.panel.description, f.resource.path);
	assert.ok(inputFocus.target === field.field.focusTarget); assert.equal(field.pending, true);
	assert.equal(f.panel.scope.contextGeneration, generation); assert.ok(f.context.selection === selected);
	assert.ok(f.view.projection.subject === projection); assert.equal(f.model.buffer.getText(), SOURCE);
	f.panel.setHeaderVisible(true);
	assert.equal(f.panel.actionBar.focusTarget.canFocus!(), true);
	assert.equal(f.panel.layoutState.client.top, f.bounds.top + editorViewState.font.lineHeight + 4);
	assert.ok(inputFocus.target === field.field.focusTarget); assert.equal(field.pending, true);
	assert.equal(setView.mock.callCount(), 0); assert.equal(clearView.mock.callCount(), 0);
});

test('header mode is retained before attachment and the layout default remains the embedded header', t => {
	const f = fixture(t);
	f.panel.detach(); f.panel.setHeaderVisible(false); f.panel.attach(f.bounds);
	assert.deepEqual(f.panel.layoutState.client, f.bounds);
	assert.equal(f.panel.actionBar.focusTarget.canFocus!(), false);
	const layout = createWorkbenchViewPanelLayout(), actions = createWorkbenchActionBar(f.actions, true);
	layoutWorkbenchViewPanel(layout, f.bounds, 'Details', actions);
	assert.equal(layout.client.top, f.bounds.top + editorViewState.font.lineHeight + 4);
	assert.equal(layoutWorkbenchViewPanel(layout, f.bounds, 'Details', actions), false);
	layoutWorkbenchViewPanel(layout, f.bounds, 'Details', actions, false);
	assert.deepEqual(layout.client, f.bounds);
	assert.equal(layoutWorkbenchViewPanel(layout, f.bounds, 'Details', actions, false), false);
});

test('headerless painting and pointer routing belong entirely to the retained body', t => {
	const f = fixture(t);
	const bounds = { ...f.panel.layoutState.header };
	const bodyPointer = t.mock.method(f.panel.control, 'handlePointer', () => false);
	f.panel.setHeaderVisible(false);
	for (const down of [true, false]) f.panel.handlePointer({ valid: true, insideViewport: true,
		viewportX: (bounds.left + bounds.right) / 2, viewportY: bounds.top + 1,
		modifiers: KeyModifier.none, spaceDown: false,
		pressedButtons: down ? PointerButton.Primary : 0, justPressedButtons: down ? PointerButton.Primary : 0,
		justReleasedButtons: down ? 0 : PointerButton.Primary });
	assert.equal(bodyPointer.mock.callCount(), 2); assert.deepEqual(f.saved, []); assert.equal(f.menu.visible, false);
	t.mock.method(f.panel.control, 'draw', () => {});
	t.mock.method(api, 'pushClipRect', () => {}); t.mock.method(api, 'popClipRect', () => {});
	t.mock.method(api, 'blit_rect', () => {}); t.mock.method(api, 'blit_text_inline_span_with_font', () => {});
	const text = t.mock.method(api, 'blit_text_inline_with_font', () => {}), fill = t.mock.method(api, 'fill_rect', () => {});
	f.panel.draw();
	assert.equal(text.mock.callCount(), 0); assert.equal(fill.mock.callCount(), 1);
	f.panel.setHeaderVisible(true); f.panel.draw();
	assert.ok(text.mock.callCount() > 0); assert.ok(fill.mock.callCount() > 2);
});

test('a headerless native context menu is anchored to the actual client and retains its source owner', t => {
	const f = fixture(t), bounds = { left: 40, top: 30, right: 230, bottom: 220 };
	f.panel.layout(bounds); f.panel.setHeaderVisible(false);
	const show = t.mock.method(f.menu, 'show');
	f.panel.commandTarget.focus(); inputFocus.executeCommand('contextMenu', f.panel.commandTarget);
	assert.equal(f.menu.visible, true);
	assert.equal(show.mock.calls[0].arguments[0], bounds.left + 4);
	assert.equal(show.mock.calls[0].arguments[1], bounds.top);
	assert.ok(f.menu.returnFocus === f.panel.commandTarget);
	assert.equal(f.panel.actionBar.focusTarget.getCommand('contextMenu')!.isEnabled(), false);
	inputFocus.executeCommand('contextMenu', f.panel.actionBar.focusTarget);
	assert.equal(show.mock.callCount(), 1);
	f.panel.detach(); assert.equal(f.menu.visible, false);
});

test('hiding only the header cancels its activation but retains body focus traversal and captures', t => {
	const f = fixture(t), actions = f.panel.actionBar.focusTarget;
	actions.focus(); inputFocus.handleKeyboard(new KeyInputEvent('Space', KeyModifier.none));
	f.panel.setHeaderVisible(false);
	inputFocus.handleKeyboard(new KeyInputEvent('Space', KeyModifier.none, false, false));
	assert.deepEqual(f.saved, []); assert.ok(inputFocus.target === f.panel.control.focusTarget);
	assert.equal(inputFocus.moveFocus(true), true);
	assert.ok(inputFocus.target === f.panel.control.options.controls.at(-1)!.field.focusTarget);
	assert.equal(inputFocus.moveFocus(false), true); assert.ok(inputFocus.target === f.panel.control.focusTarget);
	const pointer = { valid: true, insideViewport: true, viewportX: 10, viewportY: 40,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 };
	let cancelled = 0;
	const target = { handleCapturedPointer() {}, releaseCapturedPointer() {}, cancelPointer() { cancelled++; } };
	pointerCapture.beginRoute(f.panel.scope.surfaceScope, pointer); pointerCapture.capture(target, PointerButton.Primary, f.panel.scope.surfaceScope);
	f.panel.setHeaderVisible(true); f.panel.setHeaderVisible(false);
	assert.equal(pointerCapture.active, true); assert.equal(cancelled, 0);
});

test('a header-retirement callback can detach the panel without a stale body layout', t => {
	const f = fixture(t), actions = f.panel.actionBar.focusTarget;
	actions.focus(); const layout = t.mock.method(f.panel.control, 'layout');
	const unbind = actions.onDidBlur(() => f.panel.detach()); t.after(unbind);
	f.panel.setHeaderVisible(false);
	assert.equal(f.panel.attached, false); assert.equal(layout.mock.callCount(), 0);
	f.panel.attach(f.bounds); assert.deepEqual(f.panel.layoutState.client, f.bounds);
});

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
