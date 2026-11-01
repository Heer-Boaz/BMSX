import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchMenu } from '../../ide/workbench/ui/menu/model';
import { readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneViewportControl } from '../../ide/workbench/contrib/scene_editor/viewport/control';
import { SceneViewportViewState } from '../../ide/workbench/contrib/scene_editor/viewport/view_state';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createSceneSourceFixture } from '../helpers/scene_sources';

const BOUNDS = { left: 10, top: 20, right: 650, bottom: 500 };
const PREFABS = `local prefab=require('cartlib/world/prefab')
prefab.define({def_id='actor',class=require('cartlib/world/object_2d')})
prefab.define({def_id='other',class=require('cartlib/world/object_2d')})
prefab.define({def_id='mesh',class=require('cartlib/world/object_3d')})`;

function pointer(x: number, y: number, buttons = 0, justPressed = 0, justReleased = 0): PointerInputSnapshot {
	return { viewportX: x, viewportY: y, pressedButtons: buttons, justPressedButtons: justPressed, justReleasedButtons: justReleased,
		valid: true, insideViewport: true, modifiers: KeyModifier.none, spaceDown: false };
}

function fixture(t: TestContext, objects = "{{member_id='old',definition_id='actor'}}") {
	configureFontVariant('tiny');
	const source = `local scenes=require('cartlib/world/scene_library')
require('prefabs')
scenes.register('main',{objects=${objects}})`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined,
		[['cartlib/world/prefab.lua', 'return {define=function() end}'], ['prefabs.lua', PREFABS]]);
	const document = f.documents.get(f.model), context = new SceneAuthoringContext(f.model, f.documents,
		{ document, scene: document.scenes[0], sourceVersion: f.model.version });
	const menu = new ContextMenuController(inputFocus, pointerCapture, BOUNDS);
	const view = new SceneViewportViewState(context, f.sources.catalog), scope = new InputFocusScope(Symbol('add'), inputFocus.workbenchScope);
	const panel = inputFocus.createTarget(null, scope), control = new SceneViewportControl({ isEnabled: () => false, execute() {} }, menu, scope, panel, new WorkbenchMenu([], undefined)); panel.commandContext = panel;
	control.setView(view, BOUNDS);
	const state = view.camera.capture();
	view.camera.restore({ ...state, mode: '2d', modeIntent: 'manual', canvas: { centerX: 15.25, centerY: -7.75, scale: 2, reading: 'manual' } });
	control.update();
	const provider = resolveLuaTextFileModel(f.models, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.model.identity.contextId, path: 'prefabs.lua' })!);
	const select = () => {
		context.refresh(); const scene = context.subject!;
		assert.equal(context.select(context.document!, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }), true);
		control.update();
	};
	t.after(() => { control.dispose(); view.dispose(); context.dispose(); menu.dispose(); inputFocus.setTarget(null); pointerCapture.interrupt(false); });
	return { ...f, source, context, view, scope, panel, control, provider, select };
}

test('Add waits for a primary press, maps the current 2D canvas to integer scene pixels and commits exactly once', t => {
	const f = fixture(t), request = f.context.captureAddMember('2d')!;
	assert.ok(request); let placed = 0, changes = 0;
	t.after(f.model.onDidChangeContent(() => changes++));
	assert.equal(f.control.beginAddMember(request, request.choices[0], () => {
		placed++;
		assert.equal(f.context.selectedLocalTransform!.ox, -17);
		assert.equal(f.context.selectedLocalTransform!.oy, 44);
		assert.equal(f.model.canUndo, true, 'placement notification follows canonical publication and selection');
	}), true);
	const version = f.model.version;
	for (let step = 0; step < 50; step++) f.control.handlePointer(pointer(250 + step / 5, 350), false);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.version, version);
	assert.equal(f.model.canUndo, false); assert.equal(f.model.dirty, false); assert.equal(changes, 0); assert.equal(placed, 0);
	// With the explicit canvas reading above, this physical point is scene (-17.4, 43.6).
	// Exact authored coordinates are the pointer-to-source data-integrity contract, not a UI layout assertion.
	const x = (BOUNDS.left + BOUNDS.right) / 2 - 65.3, y = (BOUNDS.top + BOUNDS.bottom) / 2 + 102.7;
	assert.equal(f.control.handlePointer(pointer(x, y, PointerButton.Primary, PointerButton.Primary), true), true);
	assert.equal(changes, 1); assert.equal(placed, 1); assert.equal(request.isCurrent(), false);
	assert.equal(pointerCapture.active, false); assert.equal(f.context.subject!.objects.length, 2);
	const selected = f.context.selection!; assert.equal(selected.kind, 'member');
	if (selected.kind !== 'member') throw new Error('expected inserted member');
	assert.equal(selected.index, 1);
	assert.equal(readLuaSourceRange(f.model.buffer, f.context.document!.analysis.chunk.locations.range(selected.entry.field.span)),
		"{ member_id = 'actor', definition_id = 'actor', position = { x = -17, y = 44 } }");
	assert.equal(f.provider.buffer.getText(), PREFABS); assert.deepEqual(f.context.getWorkingCopies(), [f.model]);
	const committed = f.model.buffer.getText();
	f.control.handlePointer(pointer(x, y, 0, 0, PointerButton.Primary), false);
	f.control.handlePointer(pointer(x + 40, y, PointerButton.Primary, PointerButton.Primary), true);
	assert.equal(f.model.buffer.getText(), committed); assert.equal(changes, 1); assert.equal(placed, 1);
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false); assert.equal(f.model.dirty, false);
	f.model.redo(); assert.equal(f.model.buffer.getText(), committed);
});

for (const cancel of ['Escape', 'secondary press'] as const) test(`${cancel} abandons armed Add without source, history or completion`, t => {
	const f = fixture(t), request = f.context.captureAddMember('2d')!; let placed = 0;
	assert.equal(f.control.beginAddMember(request, request.choices[0], () => placed++), true);
	f.control.handlePointer(pointer(260, 350), false);
	if (cancel === 'Escape') inputFocus.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none));
	else f.control.handlePointer(pointer(260, 350, PointerButton.Secondary, PointerButton.Secondary), true);
	f.control.handlePointer(pointer(300, 350, PointerButton.Primary, PointerButton.Primary), true);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false); assert.equal(f.model.dirty, false);
	assert.equal(placed, 0); assert.equal(pointerCapture.active, false);
});

const RETIREMENTS: readonly [string, (f: ReturnType<typeof fixture>) => void][] = [
	['source generation', f => f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- external\n' }])],
	['semantic provider generation', f => f.provider.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- provider\n' }])],
	['read-only capability', f => f.model.refreshResource({ ...f.model.resource, source: { ...f.model.resource.source, generated: true } })],
	['selection intent', f => f.select()],
	['scope retirement', f => f.control.focusTarget.scope.retireContext()],
	['focus leaving the owning scope', () => inputFocus.setTarget(null)],
	['canvas allocation', f => f.control.layout({ ...BOUNDS, right: 750 })],
	['perspective mode', f => f.view.camera.setMode('3d')],
	['attachment replacement', f => {
		const incoming = new SceneViewportViewState(f.context, f.sources.catalog);
		f.control.setView(incoming, BOUNDS); incoming.dispose();
	}],
	['attachment removal', f => f.control.clearView()],
];
for (const [name, retire] of RETIREMENTS) test(`${name} retires armed Add instead of committing against a different owner generation`, t => {
	const f = fixture(t), request = f.context.captureAddMember('2d')!; let placed = 0;
	assert.equal(f.control.beginAddMember(request, request.choices[0], () => placed++), true);
	retire(f);
	const source = f.model.buffer.getText(), version = f.model.version, canUndo = f.model.canUndo;
	f.control.handlePointer(pointer(260, 350, PointerButton.Primary, PointerButton.Primary), true);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version); assert.equal(f.model.canUndo, canUndo);
	assert.equal(placed, 0); assert.equal(f.context.subject!.objects.length, 1); assert.equal(pointerCapture.active, false);
});

test('Add cannot arm a stale request or a perspective canvas', t => {
	const f = fixture(t), stale = f.context.captureAddMember('2d')!; let placed = 0;
	f.select(); assert.equal(stale.isCurrent(), false);
	assert.equal(f.control.beginAddMember(stale, stale.choices[0], () => placed++), false);
	const request = f.context.captureAddMember('2d')!;
	f.view.camera.setMode('3d'); f.control.update();
	assert.equal(f.control.beginAddMember(request, request.choices[0], () => placed++), false);
	f.control.handlePointer(pointer(260, 350, PointerButton.Primary, PointerButton.Primary), true);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false); assert.equal(placed, 0);
});

test('a completion callback can arm the next Add without the first placement retiring its successor', t => {
	const f = fixture(t), request = f.context.captureAddMember('2d')!; let placed = 0;
	assert.equal(f.control.beginAddMember(request, request.choices[0], () => {
		placed++;
		const next = f.context.captureAddMember('2d')!;
		assert.equal(f.control.beginAddMember(next, next.choices[1], () => placed++), true);
	}), true);
	f.control.handlePointer(pointer(260, 350, PointerButton.Primary, PointerButton.Primary), true);
	assert.equal(placed, 1); assert.equal(f.context.subject!.objects.length, 2);
	f.control.handlePointer(pointer(290, 360, PointerButton.Primary, PointerButton.Primary), true);
	assert.equal(placed, 2); assert.equal(f.context.subject!.objects.length, 3);
	f.model.undo(); assert.equal(f.context.isCurrent, true); assert.equal(f.context.subject!.objects.length, 2);
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('canonical publication replacing the viewport does not run the detached placement completion', t => {
	const f = fixture(t), request = f.context.captureAddMember('2d')!; let placed = 0;
	const incoming = new SceneViewportViewState(f.context, f.sources.catalog); t.after(() => incoming.dispose());
	assert.equal(f.control.beginAddMember(request, request.choices[0], () => placed++), true);
	const release = f.model.onDidChangeContent(() => { release(); f.control.setView(incoming, BOUNDS); }); t.after(release);
	f.control.handlePointer(pointer(260, 350, PointerButton.Primary, PointerButton.Primary), true);
	assert.equal(placed, 0); assert.equal(f.control.view, incoming); assert.equal(f.context.subject!.objects.length, 2);
	assert.equal(f.model.canUndo, true, 'an already-published canonical edit is not rolled back by presentation retirement');
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('an older layout continuation cannot retire a replacement attachment placement', t => {
	const f = fixture(t), incoming = new SceneViewportViewState(f.context, f.sources.catalog);
	t.after(() => incoming.dispose());
	let placed = 0;
	const unbind = f.view.camera.onDidChange(() => {
		unbind(); f.control.setView(incoming, BOUNDS);
		const request = f.context.captureAddMember('2d')!;
		assert.equal(f.control.beginAddMember(request, request.choices[0], () => placed++), true);
	});
	t.after(unbind);
	f.control.layout({ ...BOUNDS, right: 750 });
	assert.equal(f.control.view, incoming);
	f.control.handlePointer(pointer(260, 350, PointerButton.Primary, PointerButton.Primary), true);
	assert.equal(placed, 1); assert.equal(f.context.subject!.objects.length, 2);
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

for (const family of ['2d', '3d'] as const)
test(`the first ${family} placement in an empty scene adopts the displayed reading instead of reframing on commit`, t => {
	const f = fixture(t, '{}'), state = f.view.camera.capture();
	f.view.camera.restore({ ...state, mode: family, modeIntent: 'manual',
		canvas: { ...state.canvas, reading: 'initial' }, space: { ...state.space, reading: 'initial' } });
	f.control.update(); assert.equal(f.view.camera.initial, true);
	const reading = f.view.camera.capture(), request = f.context.captureAddMember(family)!;
	assert.equal(f.control.beginAddMember(request, request.choices[0], () => {}), true);
	assert.equal(f.view.camera.initial, false);
	f.control.handlePointer(pointer(350, 350, PointerButton.Primary, PointerButton.Primary), true);
	assert.equal(f.context.subject!.objects.length, 1);
	const expected = family === '2d' ? { ...reading.canvas, reading: 'manual' } : { ...reading.space, reading: 'manual' };
	const after = f.view.camera.capture(); assert.deepEqual(family === '2d' ? after.canvas : after.space, expected);
	f.model.undo(); f.control.update(); assert.equal(f.model.buffer.getText(), f.source);
	const undone = f.view.camera.capture(); assert.deepEqual(family === '2d' ? undone.canvas : undone.space, expected);
});
