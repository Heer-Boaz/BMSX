import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { insertValue } from '../../ide/editor/ui/inline/text_field';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { WorkbenchPropertyEdit } from '../../ide/workbench/ui/property_edit';
import { createWorkbenchPropertyTree, layoutWorkbenchPropertyTree, type WorkbenchPropertyElement } from '../../ide/workbench/ui/property_tree';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows } from '../../ide/workbench/ui/tree_view';

function fixture(t: TestContext, variant: 'tiny' | 'msx' = 'tiny') {
	configureFontVariant(variant);
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
	const model = new EditorTextModel({ contextLabel: 'Fixture project', sourceFilePath: 'source.lua', location: { kind: 'workspace' as const, path: 'source.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'source.lua', source: { type: 'lua', resid: 'source' } }, 'lua', 'return 17');
	const edit = new WorkbenchPropertyEdit<string>(parent, text => text, surfaces, owner, root);
	let applied = 0;
	const open = (sourceModel = model) => edit.open({ model: sourceModel, tree, row,
		parse: text => text === '-' ? { error: 'Incomplete expression' } : { value: text },
		apply: text => { applied++; sourceModel.pushEditOperations([{ offset: 7, deleteLength: sourceModel.buffer.length - 7, text }]); },
	}, '17');
	t.after(() => { edit.dispose(); inputFocus.setTarget(null); pointerCapture.cancel(); surfaces.dispose(); model.dispose(); });
	const press = (code: string) => { inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, true)); inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, false)); };
	return { edit, model, tree, row, root, pane, surfaces, owner, guest, parent, open, press, applied: () => applied };
}

for (const variant of ['tiny', 'msx'] as const) test(`${variant} property input publishes its arranged native caret with its first focus notification before paint`, t => {
	const f = fixture(t, variant), field = f.edit.control.field;
	let published: { x: number; y: number; width: number; height: number } | undefined;
	t.after(inputFocus.onDidChangeTarget(() => {
		if (inputFocus.target === field.focusTarget) published = { ...field.caretRect() };
	}));
	f.open();
	assert.ok(published !== undefined);
	assert.ok(published.width > 0 && published.height > 0, 'native focus must not depend on a first paint');
	assert.ok(published.x >= f.edit.fieldBounds.left + 3 && published.x + published.width <= f.edit.fieldBounds.right - 3);
	assert.ok(published.y >= f.edit.fieldBounds.top + 2 && published.y + published.height <= f.edit.fieldBounds.bottom);
	assert.equal(f.applied(), 0); assert.equal(f.model.buffer.getText(), 'return 17');
});

test('property native input projects a trusted replacement and selection against its arranged client before another update', t => {
	const f = fixture(t), field = f.edit.control.field; f.open();
	assert.equal(field.replaceText(0, 2, '99999'), true);
	let caret = field.caretRect();
	assert.equal(caret.x, f.edit.fieldBounds.left + 3 + editorViewState.font.measure('99999'));
	assert.equal(caret.y, f.edit.fieldBounds.top + 2);
	field.setSelection(1, 1); caret = field.caretRect();
	assert.equal(caret.x, f.edit.fieldBounds.left + 3 + editorViewState.font.measure('9'));
	assert.equal(caret.width, editorViewState.font.advance('9'));
	assert.equal(f.applied(), 0); assert.equal(f.model.buffer.getText(), 'return 17');
});

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
	configureFontVariant('msx'); f.root.right = 256; f.edit.update();
	assert.ok(f.edit.bounds.right <= 256); assert.equal(f.edit.control.field.text, '42');
	f.model.pushEditOperations([{ offset: 7, deleteLength: 2, text: '60' }]);
	assert.equal(f.edit.active, false); assert.equal(f.model.buffer.getText(), 'return 60'); assert.equal(f.applied(), 0);
});

for (const writableRoundtrip of [false, true]) test(`readonly source publication immediately retires a property draft${writableRoundtrip ? ' across a writable roundtrip' : ''}`, t => {
	const f = fixture(t), resource = f.model.resource;
	f.open(); insertValue(f.edit.control.field, '99');
	assert.equal(f.edit.control.pending, true);
	const version = f.model.version, canUndo = f.model.canUndo, canRedo = f.model.canRedo;
	const scope = f.edit.control.field.focusTarget.scope.surfaceScope;
	const snapshot = { valid: true, insideViewport: true, viewportX: f.edit.fieldBounds.left + 5, viewportY: f.edit.fieldBounds.top + 3,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 };
	pointerCapture.beginRoute(scope, snapshot); f.edit.handlePointer(snapshot);
	f.model.refreshResource({ ...resource, source: { ...resource.source, generated: true } });
	assert.equal(f.edit.active, false, 'source authority loss retires the actual popup before another frame or blur');
	assert.equal(f.edit.control.pending, false); assert.ok(inputFocus.target === f.parent);
	assert.equal(f.surfaces.findByScope(scope), undefined); assert.equal(pointerCapture.draining, true);
	if (writableRoundtrip) f.model.refreshResource(resource);
	f.press('Enter'); f.parent.focus(); f.edit.update();
	assert.equal(f.applied(), 0); assert.equal(f.edit.active, false);
	assert.equal(f.model.buffer.getText(), 'return 17'); assert.equal(f.model.version, version);
	assert.equal(f.model.canUndo, canUndo); assert.equal(f.model.canRedo, canRedo);
});

test('a property popup owns only its attached source readonly subscription', t => {
	const f = fixture(t), other = new EditorTextModel({ contextLabel: 'Fixture project', ...f.model.resource,
		location: { kind: 'workspace', path: 'other.lua' }, path: 'other.lua', source: { type: 'lua', resid: 'other' } }, 'lua', 'return 17');
	t.after(() => other.dispose());
	const firstSubscribe = f.model.onDidChangeReadOnly, nextSubscribe = other.onDidChangeReadOnly;
	let firstSubscriptions = 0, nextSubscriptions = 0;
	t.mock.method(f.model, 'onDidChangeReadOnly', listener => {
		const unbind = firstSubscribe.call(f.model, listener); firstSubscriptions++;
		return () => { firstSubscriptions--; unbind(); };
	});
	t.mock.method(other, 'onDidChangeReadOnly', listener => {
		const unbind = nextSubscribe.call(other, listener); nextSubscriptions++;
		return () => { nextSubscriptions--; unbind(); };
	});
	f.open(); insertValue(f.edit.control.field, '42');
	assert.equal(firstSubscriptions, 1); assert.equal(nextSubscriptions, 0);
	f.open(other); insertValue(f.edit.control.field, '60');
	assert.equal(firstSubscriptions, 0); assert.equal(nextSubscriptions, 1);
	f.model.refreshResource({ ...f.model.resource, source: { ...f.model.resource.source, generated: true } });
	assert.equal(f.edit.active, true); assert.equal(f.edit.control.field.text, '60');
	assert.ok(inputFocus.target === f.edit.control.field.focusTarget); assert.equal(f.applied(), 0);
	f.edit.close();
	assert.equal(firstSubscriptions, 0); assert.equal(nextSubscriptions, 0); assert.equal(f.applied(), 0);
	other.refreshResource({ ...other.resource, source: { ...other.resource.source, generated: true } });
	assert.equal(f.edit.active, false); assert.ok(inputFocus.target === f.parent);
	assert.equal(f.model.buffer.getText(), 'return 17'); assert.equal(other.buffer.getText(), 'return 17');
});
