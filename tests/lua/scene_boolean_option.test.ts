import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneDetailsControl } from '../../ide/workbench/contrib/scene_editor/details_control';
import { SceneDetailsViewState } from '../../ide/workbench/contrib/scene_editor/details_view';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchMenu } from '../../ide/workbench/ui/menu/model';
import { createSceneSourceFixture } from '../helpers/scene_sources';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('checkbox', { objects = {
 { member_id = 'first', definition_id = 'actor', options = { score = 7, visible = true, caption = 'false' } },
 { member_id = 'second', definition_id = 'actor', options = { score = 7, visible = true, caption = 'false' } },
} })
`;

function fixture(t: TestContext, source = SOURCE, font: 'tiny' | 'msx' = 'tiny') {
	configureFontVariant(font);
	const f = createSceneSourceFixture(t, source), authoring = new SceneAuthoringContext(f.model, f.documents);
	const scene = authoring.document!.scenes[0];
	authoring.select(authoring.document!, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 });
	const view = new SceneDetailsViewState(authoring), scope = new InputFocusScope(Symbol('boolean inspector'), inputFocus.workbenchScope);
	const parent = inputFocus.createTarget(null, scope), bounds = { left: 0, top: 20, right: 384, bottom: 276 };
	const unbindParent = parent.bindKeyboard(() => {});
	const menu = new ContextMenuController(inputFocus, pointerCapture, bounds);
	const navigation = { isEnabled: () => true, run() {} };
	const details = new SceneDetailsControl({ isEnabled: () => false, execute() {} }, menu, scope, parent,
		{ outline: navigation, details: navigation }, new WorkbenchMenu([], undefined));
	details.setView(view, bounds);
	const entry = (key: string) => details.options.controls[view.optionProperties.findIndex(property => property.descriptor.label === key)];
	const checkbox = (key = 'visible') => { const result = entry(key); assert.ok(result.kind === 'boolean'); return result.control; };
	const value = (key: string) => { const result = entry(key); assert.ok(result.kind === 'value'); return result.control; };
	const key = (code: string, down = true) => inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, down));
	let pointerPoint = { x: 0, y: 0 };
	const pointer = (down: boolean, button = PointerButton.Primary, outside = false) => {
		if (down) {
			const property = view.optionProperties.find(property => property.descriptor.label === 'visible')!;
			pointerPoint = { x: property.bounds.left + 3, y: (property.bounds.top + property.bounds.bottom) / 2 };
		}
		const snapshot = { valid: true, insideViewport: true, viewportX: outside ? bounds.right - 1 : pointerPoint.x,
			viewportY: outside ? bounds.bottom - 1 : pointerPoint.y,
			pressedButtons: down ? button : 0, justPressedButtons: down ? button : 0, justReleasedButtons: down ? 0 : button,
			modifiers: KeyModifier.none, spaceDown: false };
		pointerCapture.beginRoute(details.inputScope.surfaceScope, snapshot);
		if (!pointerCapture.dispatch(snapshot, false, 0, details.inputScope.surfaceScope)) details.handlePointer(snapshot, down);
		pointerCapture.endRoute(snapshot); details.update();
	};
	t.after(() => { details.dispose(); view.dispose(); authoring.dispose(); menu.dispose(); inputFocus.setTarget(null); unbindParent(); pointerCapture.interrupt(false); });
	return { ...f, authoring, details, view, entry, checkbox, value, key, pointer };
}

test('only authored boolean literals become checkbox controls, not truthiness, names or computed values', t => {
	const source = SOURCE.replace("caption = 'false'", "caption = 'false', alias = flag, call = choose(), number = 0, unary = not false");
	const f = fixture(t, source);
	assert.ok(f.entry('visible').kind === 'boolean');
	for (const key of ['score', 'caption', 'alias', 'call', 'number', 'unary']) assert.ok(f.entry(key).kind === 'value');
	for (const key of ['alias', 'call', 'unary']) {
		assert.equal(f.value(key).field.readOnly, true);
		assert.equal(f.value(key).field.focusTarget.focus(), false);
	}
	for (const key of ['score', 'caption', 'number']) assert.equal(f.value(key).field.readOnly, false);
	assert.equal(f.checkbox().input!.checked, true); assert.equal(f.model.canUndo, false);
});

test('the actually hovered checkbox discloses its label before another focused checkbox', t => {
	const first = `property_${'a'.repeat(100)}`, second = `property_${'b'.repeat(100)}`;
	const source = SOURCE.replace("score = 7, visible = true, caption = 'false'", `${first} = true, ${second} = false`);
	const f = fixture(t, source), a = f.checkbox(first), b = f.checkbox(second);
	a.focusTarget.focus(); assert.ok(f.details.tooltipItem === a.tooltipItem);
	const bounds = b.bounds;
	f.details.handlePointer({ valid: true, insideViewport: true, viewportX: b.labelX + 1,
		viewportY: (bounds.top + bounds.bottom) / 2, modifiers: KeyModifier.none, spaceDown: false,
		pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0 }, false);
	assert.equal(b.hovered, true); assert.ok(f.details.tooltipItem === b.tooltipItem);
	f.details.onPointerLeave(); assert.ok(f.details.tooltipItem === a.tooltipItem);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.canUndo, false);
});

for (const font of ['tiny', 'msx'] as const) test(`${font} checkbox acceptance replaces only its boolean token and has exactly one document Undo`, t => {
	const source = SOURCE.replace('visible = true,', 'visible = (( --[[group]] true )), -- keep trivia\n');
	const f = fixture(t, source, font), checkbox = f.checkbox(), version = f.model.version;
	assert.equal(checkbox.focusTarget.focus(), true);
	f.key('Space'); assert.equal(f.model.version, version);
	f.key('Space', false); f.details.update();
	const expected = source.replace('--[[group]] true', '--[[group]] false');
	assert.equal(f.model.buffer.getText(), expected); assert.equal(f.model.version, version + 1);
	assert.ok(f.checkbox() === checkbox); assert.equal(f.checkbox().input!.checked, false);
	f.model.undo(); f.details.update(); assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.canUndo, false);
	f.model.redo(); f.details.update(); assert.equal(f.model.buffer.getText(), expected);
});

test('a primary click commits on release and right click cannot toggle the authored value', t => {
	const f = fixture(t), version = f.model.version;
	f.pointer(true); assert.equal(f.model.version, version);
	f.pointer(false); assert.equal(f.model.buffer.getText(), SOURCE.replace('visible = true', 'visible = false'));
	f.model.undo(); f.details.update(); f.pointer(true, PointerButton.Secondary); f.pointer(false, PointerButton.Secondary);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

for (const font of ['tiny', 'msx'] as const) test(`${font} keyboard traversal reveals and edits a boolean initially outside the inspector viewport`, t => {
	const preceding = Array.from({ length: 12 }, (_, index) => `field_${index} = ${index}, `).join('');
	const source = SOURCE.replace('score = 7, ', `score = 7, ${preceding}`), f = fixture(t, source, font);
	f.value('score').field.focusTarget.focus();
	for (let index = 0; index < 13; index++) assert.equal(inputFocus.moveFocus(false), true);
	assert.ok(inputFocus.target === f.checkbox().focusTarget);
	f.key('Space'); assert.equal(f.checkbox().pressed, true); f.key('Space', false); f.details.update();
	assert.equal(f.model.buffer.getText(), source.replace('visible = true', 'visible = false'));
});

test('a valid departing draft settles before the original checkbox occurrence is armed', t => {
	const f = fixture(t), score = f.value('score');
	score.field.focusTarget.focus(); setFieldText(score.field, '234', true);
	f.pointer(true); assert.equal(f.model.buffer.getText(), SOURCE.replace('score = 7', 'score = 234'));
	f.pointer(false);
	assert.equal(f.model.buffer.getText(), SOURCE.replace('score = 7', 'score = 234').replace('visible = true', 'visible = false'));
	f.model.undo(); f.details.update(); assert.equal(f.model.buffer.getText(), SOURCE.replace('score = 7', 'score = 234'));
	f.model.undo(); f.details.update(); assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('an invalid departing draft neither accepts a checkbox nor rewrites the source', t => {
	const f = fixture(t), score = f.value('score');
	score.field.focusTarget.focus(); setFieldText(score.field, '7, other = false', true);
	f.pointer(true); f.pointer(false);
	assert.equal(score.pending, true); assert.ok(inputFocus.target === score.field.focusTarget);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('a newer field focus chosen during draft acceptance is not stolen by the old checkbox press', t => {
	const f = fixture(t), score = f.value('score'), caption = f.value('caption');
	score.field.focusTarget.focus(); setFieldText(score.field, '234', true);
	const unbind = f.model.onDidChangeContent(() => { unbind(); caption.field.focusTarget.focus(); });
	t.after(unbind);
	f.pointer(true); f.pointer(false);
	assert.ok(inputFocus.target === caption.field.focusTarget);
	assert.equal(f.checkbox().input!.checked, true);
	assert.equal(f.model.buffer.getText(), SOURCE.replace('score = 7', 'score = 234'));
});

test('a selection made during draft acceptance cannot transfer the old checkbox click to another member', t => {
	const f = fixture(t), score = f.value('score');
	score.field.focusTarget.focus(); setFieldText(score.field, '234', true);
	const unbind = f.model.onDidChangeContent(() => {
		unbind();
		assert.equal(f.authoring.isCurrent, true);
		const document = f.authoring.document!, scene = document.scenes[0];
		assert.equal(f.authoring.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[1], index: 1 }), true);
	});
	t.after(unbind);
	f.pointer(true); f.pointer(false);
	assert.equal(f.checkbox().input!.checked, true);
	assert.equal(f.model.buffer.getText(), SOURCE.replace('score = 7', 'score = 234'));
});

test('a checkbox occurrence removed during draft acceptance cannot fall through to the next boolean', t => {
	const f = fixture(t), score = f.value('score');
	score.field.focusTarget.focus(); setFieldText(score.field, '234', true);
	const unbind = f.model.onDidChangeContent(() => {
		unbind();
		const text = f.model.buffer.getText(), offset = text.indexOf('visible = true, ');
		f.model.pushEditOperations([{ offset, deleteLength: 'visible = true, '.length, text: '' }]);
	});
	t.after(unbind);
	f.pointer(true); f.pointer(false);
	assert.equal(f.model.buffer.getText(), SOURCE.replace('score = 7', 'score = 234').replace('visible = true, ', ''));
});

for (const retirement of ['selection', 'readonly', 'replacement', 'hidden', 'detach'] as const)
	test(`armed checkbox cannot follow ${retirement} into another value or native attachment`, t => {
		const f = fixture(t), checkbox = f.checkbox();
		checkbox.focusTarget.focus(); f.key('Space');
		assert.equal(checkbox.pressed, true);
		let expected = SOURCE;
		switch (retirement) {
			case 'selection': {
				const scene = f.authoring.document!.scenes[0];
				f.authoring.select(f.authoring.document!, f.model.version, { kind: 'member', scene, entry: scene.objects[1], index: 1 });
				break;
			}
			case 'readonly': f.model.refreshResource({ ...f.model.resource, source: { ...f.model.resource.source, generated: true } }); break;
			case 'replacement': {
				const at = SOURCE.indexOf('visible = true') + 'visible = '.length;
				f.model.pushEditOperations([{ offset: at, deleteLength: 4, text: '123' }]); expected = SOURCE.slice(0, at) + '123' + SOURCE.slice(at + 4);
				break;
			}
			case 'hidden': f.details.layout({ left: 0, top: 0, right: 0, bottom: 0 }); break;
			case 'detach': f.details.clearView(); break;
		}
		if (retirement !== 'detach') f.details.update();
		f.key('Space', false);
		assert.equal(f.model.buffer.getText(), expected);
		if (retirement !== 'replacement') assert.equal(f.model.canUndo, false);
	});
