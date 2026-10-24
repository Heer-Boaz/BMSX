import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { insertValue } from '../../ide/editor/ui/inline/text_field';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { WorkbenchPropertyEdit } from '../../ide/workbench/ui/property_edit';
import { createWorkbenchPropertyTree, layoutWorkbenchPropertyTree, type WorkbenchPropertyElement } from '../../ide/workbench/ui/property_tree';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows } from '../../ide/workbench/ui/tree_view';

function fixture(t: TestContext, variant: 'tiny' | 'msx' = 'tiny') {
	configureFontVariant(new VirtualHeadlessClock(), variant, null);
	const root = { left: 0, top: 24, right: 384, bottom: 274 }, pane = { ...root, right: variant === 'tiny' ? 78 : 118 };
	const surfaces = new WorkbenchSurfaceService(), parent = inputFocus.createTarget();
	parent.bindKeyboard(() => {}); parent.focus();
	const owner = surfaces.attach({ role: 'content', captureScope: parent.scope.surfaceScope, isVisible: () => true,
		getBounds: () => pane, getClip: () => pane, draw() {} });
	const guest = surfaces.attach({ role: 'content', captureScope: Symbol('preview'), isVisible: () => true,
		getBounds: () => ({ ...root, left: pane.right }), getClip: () => root, draw() {} });
	const tree = createWorkbenchPropertyTree<WorkbenchPropertyElement>();
	const row = appendWorkbenchTreeNode<WorkbenchPropertyElement>(tree, null, { kind: 'property', label: 'time_ms', value: '17', description: 'source.lua:2', warning: false,
		displayLabel: '', displayValue: '', displayValueLeft: 0 });
	rebuildWorkbenchTreeRows(tree, row);
	layoutWorkbenchPropertyTree(tree, editorViewState.font.renderFont(), (text, a, b) => editorViewState.font.measure(text.slice(a, b)), 4, 60, pane.right - 4, 250);
	const model = new EditorTextModel({ domain: 0, path: 'source.lua', source: { type: 'lua', resid: 'source' } }, 'lua', 'return 17');
	const edit = new WorkbenchPropertyEdit<string>(parent, text => text, surfaces, owner, root);
	let applied = 0;
	const open = () => edit.open({ model, tree, row,
		parse: text => text === '-' ? { error: 'Incomplete expression' } : { value: text },
		apply: text => { applied++; model.pushEditOperations([{ offset: 7, deleteLength: model.buffer.length - 7, text }]); },
	}, '17');
	t.after(() => { edit.dispose(); inputFocus.setTarget(null); pointerCapture.cancel(); surfaces.dispose(); model.dispose(); });
	const press = (code: string) => { inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, true)); inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, false)); };
	return { edit, model, tree, row, root, pane, surfaces, owner, guest, parent, open, press, applied: () => applied };
}

for (const variant of ['tiny', 'msx'] as const) test(`${variant} property edit has 24 readable font cells beyond a minimum pane and shares paint/hit/focus ownership`, t => {
	const f = fixture(t, variant), { edit } = f; f.open();
	assert.ok(edit.fieldBounds.right - edit.fieldBounds.left - 6 >= editorViewState.charAdvance * 24);
	assert.ok(edit.bounds.right > f.pane.right, 'the editor is not constrained to an unreadable property column');
	assert.ok(edit.bounds.left >= f.root.left && edit.bounds.right <= f.root.right && edit.bounds.top >= f.root.top && edit.bounds.bottom <= f.root.bottom);
	const surface = f.surfaces.findByScope(edit.control.field.focusTarget.scope.surfaceScope)!;
	assert.equal(surface.role, 'transient'); assert.equal(surface.lifetimeOwner, f.owner);
	assert.equal(f.surfaces.hitTest(edit.fieldBounds.right - 2, edit.fieldBounds.top + 2), surface);
	assert.equal(inputFocus.target, edit.control.field.focusTarget);
	assert.ok(edit.control.viewport.end > edit.control.viewport.start);
	const bounds = edit.bounds, viewport = edit.control.viewport, font = editorViewState.font;
	const measure = font.advance.bind(font); let measures = 0;
	t.mock.method(font, 'advance', (...args: Parameters<typeof measure>) => { measures++; return measure(...args); });
	Object.defineProperty(f.tree.rows, 'indexOf', { value: () => assert.fail('an unchanged source binding must not re-search its row per frame') });
	for (let frame = 0; frame < 1000; frame++) edit.update();
	assert.equal(measures, 0); assert.equal(edit.bounds, bounds); assert.equal(edit.control.viewport, viewport);
	insertValue(edit.control.field, '29'); f.press('Escape');
	assert.equal(edit.active, false); assert.equal(inputFocus.target, f.parent); assert.equal(f.model.buffer.getText(), 'return 17');
	assert.equal(f.surfaces.findByScope(surface.captureScope), undefined);
	assert.equal(f.surfaces.hitTest(200, 100), f.guest, 'the temporary editor must leave no invisible input rectangle');
});

test('property draft keeps local Undo, invalid input and normal blur commits exactly once without a source transaction', t => {
	const f = fixture(t); f.open();
	insertValue(f.edit.control.field, '-'); f.press('Enter');
	assert.equal(f.edit.active, true); assert.equal(f.edit.control.error, 'Incomplete expression'); assert.equal(f.applied(), 0);
	inputFocus.executeCommand('undo'); assert.equal(f.edit.control.field.text, '17');
	insertValue(f.edit.control.field, '33'); f.parent.focus();
	assert.equal(f.edit.active, false); assert.equal(f.applied(), 1); assert.equal(f.model.buffer.getText(), 'return 33');
	f.parent.focus(); assert.equal(f.applied(), 1);
});

test('retiring an edited source attachment cancels its physical hold and draft rather than publishing or leaking a release', t => {
	const f = fixture(t); f.open(); insertValue(f.edit.control.field, '99');
	const scope = f.edit.control.field.focusTarget.scope.surfaceScope;
	const snapshot = { valid: true, insideViewport: true, viewportX: f.edit.fieldBounds.left + 5, viewportY: f.edit.fieldBounds.top + 3,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 };
	pointerCapture.beginRoute(scope, snapshot); f.edit.handlePointer(snapshot);
	f.owner.dispose();
	assert.equal(f.edit.active, false); assert.equal(f.applied(), 0); assert.equal(f.model.buffer.getText(), 'return 17');
	assert.notEqual(inputFocus.target, f.edit.control.field.focusTarget); assert.equal(pointerCapture.draining, true);
	assert.equal(f.surfaces.findByScope(scope), undefined);
});

test('an external source publication and changed font/work area do not transfer the old value draft to a different target', t => {
	const f = fixture(t), lifetime = f.open();
	lifetime.add({ dispose: f.model.onDidChangeContent(() => f.edit.close()) });
	insertValue(f.edit.control.field, '42');
	configureFontVariant(new VirtualHeadlessClock(), 'msx', null); f.root.right = 256; f.edit.update();
	assert.ok(f.edit.bounds.right <= 256); assert.equal(f.edit.control.field.text, '42');
	f.model.pushEditOperations([{ offset: 7, deleteLength: 2, text: '60' }]);
	assert.equal(f.edit.active, false); assert.equal(f.model.buffer.getText(), 'return 60'); assert.equal(f.applied(), 0);
});
