import { quoteLuaString } from '../../toolchain/ts/lua/syntax/string_literal';
import { WorkbenchMenu } from '../../ide/workbench/ui/menu/model';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createSceneSourceFixture } from '../helpers/scene_sources';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneDetailsViewState } from '../../ide/workbench/contrib/scene_editor/details_view';
import { SceneDetailsControl } from '../../ide/workbench/contrib/scene_editor/details_control';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { pointerCapture } from '../../ide/input/pointer/capture';
import type { EditorCommandRunner } from '../../ide/common/commands';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('room', { objects = {
	{ member_id = 'actor', definition_id = 'sprite', position = { x = 1, y = 2, z = 3 }, options = {
		color = 0xff00aabb; -- keep the scene artist's comment
		visible = true,
		imgid = 'hero',
		region = { x = 8, width = 16 },
		items = { 'a', 'b' },
		['custom-key'] = math.max(1, 2),
		callback = function()
			return 'leave this implementation in Lua'
		end,
	} },
} })
`;

function fixture(t: TestContext, source = SOURCE) {
	configureFontVariant('tiny');
	const { model, documents } = createSceneSourceFixture(t, source, 'room.lua');
	const authoring = new SceneAuthoringContext(model, documents), view = new SceneDetailsViewState(authoring);
	const scene = authoring.document!.scenes[0];
	assert.equal(authoring.select(authoring.document!, model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }), true);
	const scope = new InputFocusScope(Symbol('option editor fixture'), inputFocus.workbenchScope), parent = inputFocus.createTarget(null, scope);
	const bounds = { left: 0, top: 24, right: 384, bottom: 276 };
	const menu = new ContextMenuController(inputFocus, pointerCapture, bounds);
	const commands: EditorCommandRunner = {
		isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target),
	};
	const navigation = { isEnabled: () => true, run: () => assert.fail('source editing invoked view navigation') };
	const details = new SceneDetailsControl(commands, menu, scope, parent, { outline: navigation, details: navigation }, new WorkbenchMenu([], undefined));
	details.setView(view, bounds);
	t.after(() => { details.dispose(); view.dispose(); authoring.dispose(); menu.dispose(); inputFocus.setTarget(null); });
	return { model, view, editor: details.options, refresh: () => details.update(),
		control: (label: string) => details.options.controls[view.optionProperties.findIndex(property => property.descriptor.label === label)] };
}

test('scene inspector admits typed strings and expressions without exposing spatial matrix storage', t => {
	const f = fixture(t);
	assert.deepEqual(f.view.optionProperties.map(property => property.descriptor.label),
		['color', 'visible', 'imgid', 'region.x', 'region.width', 'items[1]', 'items[2]', "['custom-key']", 'callback']);
	assert.equal(f.control('imgid').field.text, 'hero');
	assert.equal(f.control('items[1]').field.text, 'a');
	assert.equal(f.control("['custom-key']").field.text, 'math.max(1, 2)');
	assert.equal(f.control('callback').field.readOnly, true, 'multiline implementation remains source-owned');
	assert.equal(f.view.optionProperties.find(property => property.descriptor.label === 'callback')!.descriptor.preview, 'function()');
	assert.equal(f.view.projection.subject!.resolution, 'complete');
	assert.equal(f.view.detailsText.some(line => line.tone === 'warning'), false, 'complete authored content does not claim an unavailable or partial state');
	assert.equal(f.model.dirty, false);
});

test('option acceptance edits only its source expression and shares document undo/redo', t => {
	const f = fixture(t);
	const edit = (label: string, text: string) => {
		const control = f.control(label);
		setFieldText(control.field, text, true);
		assert.equal(control.commit(), true);
		f.refresh();
	};
	const retained = f.control('color');
	retained.field.focusTarget.focus();
	edit('color', '0xff102030');
	assert.equal(f.control('color'), retained, 'accepted source generation retains the input control');
	assert.equal(retained.field.focusTarget.hasFocus, true, 'Save can accept a value without stealing focus');
	assert.equal(retained.pending, false);
	retained.field.focusTarget.release();
	assert.equal(f.model.buffer.getText(), SOURCE.replace('0xff00aabb', '0xff102030'));
	f.model.undo(); f.refresh(); assert.equal(f.model.buffer.getText(), SOURCE);
	f.model.redo(); f.refresh(); assert.equal(f.control('color').field.text, '0xff102030');
	edit('visible', 'false'); edit('imgid', 'enemy'); edit('region.width', '24');
	assert.equal(f.model.buffer.getText(), SOURCE.replace('0xff00aabb', '0xff102030').replace('visible = true', 'visible = false')
		.replace("imgid = 'hero'", "imgid = 'enemy'").replace('width = 16', 'width = 24'));
});

test('invalid and revoked option drafts cannot damage enclosing Lua or a different source field', t => {
	const f = fixture(t);
	const control = f.control('color');
	for (const text of ['1, visible = false', '17 -- eats the separator', 'math.max(']) {
		setFieldText(control.field, text, true);
		assert.equal(control.commit(), false); assert.notEqual(control.error, '');
		assert.equal(f.model.buffer.getText(), SOURCE);
	}
	setFieldText(control.field, '123', true);
	const offset = SOURCE.indexOf('color =');
	// Another editor changes the selected source before the next view update.
	f.model.pushEditOperations([{ offset, deleteLength: SOURCE.indexOf('\n', offset) - offset, text: 'new_color = 456,' }]);
	const external = f.model.buffer.getText();
	assert.equal(control.commit(), true);
	assert.equal(f.model.buffer.getText(), external, 'beforeCommit revoked the obsolete draft rather than writing through its old offset');
	assert.equal(f.control('new_color').field.text, '456');
});

test('dynamic option builders and empty authored tables remain their actual expression target', t => {
	for (const value of ['make_options()', '{}']) {
		const f = fixture(t, `local scenes = require('cartlib/world/scene_library')\nscenes.register('r', { objects = { { member_id = 'x', definition_id = 'p', options = ${value} } } })`);
		assert.deepEqual(f.view.optionProperties.map(property => property.descriptor.label), ['options']);
		assert.equal(f.control('options').field.text, value);
	}
});

const STRING_CASES = [
	{ literal: String.raw`'A\x42\\C\'D'`, value: "AB\\C'D", quote: "'" },
	{ literal: String.raw`"A\x42\\C\"D"`, value: 'AB\\C"D', quote: '"' },
	{ literal: "[=[MiXeD ` ' \" \\value]=]", value: "MiXeD ` ' \" \\value", quote: "'" },
	{ literal: "''", value: '', quote: "'" },
] as const;
for (const { literal, value, quote } of STRING_CASES) test(`string property round-trips decoded content and canonical source from ${literal}`, t => {
	const source = SOURCE.replace("'hero'", literal), f = fixture(t, source), control = f.control('imgid');
	assert.equal(control.field.text, value, 'the string control receives decoded value, not source quotes or escapes');
	assert.equal(f.view.optionProperties.find(property => property.descriptor.label === 'imgid')!.text, value);
	assert.equal(control.pending, false); assert.equal(control.commit(), true);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.canUndo, false, 'reading/accepting unchanged values preserves original spelling');
	const changed = "MiXeD ` ' \" \\end\t\x00x; visible=false --", encoded = quoteLuaString(changed, quote);
	setFieldText(control.field, changed, true); assert.equal(control.commit(), true); f.refresh();
	assert.equal(f.model.buffer.getText(), source.replace(literal, encoded), 'only the original literal token changes, preserving its short-quote style');
	const property = f.view.optionProperties.find(property => property.descriptor.label === 'imgid')!.descriptor;
	assert.equal(property.kind, 'string'); if (property.kind === 'string') assert.equal(property.literal.value, changed);
	assert.equal(f.control('imgid').field.text, changed);
	f.model.undo(); f.refresh(); assert.equal(f.model.buffer.getText(), source); assert.equal(f.control('imgid').field.text, value);
	f.model.redo(); f.refresh(); assert.equal(f.model.buffer.getText(), source.replace(literal, encoded)); assert.equal(f.control('imgid').field.text, changed);
});

test('literal text never becomes executable source; an actual expression keeps expression editing', t => {
	const f = fixture(t), literal = f.control('imgid'), text = 'math.max(7, 9)';
	setFieldText(literal.field, text, true); assert.equal(literal.commit(), true); f.refresh();
	assert.equal(f.model.buffer.getText(), SOURCE.replace("'hero'", "'math.max(7, 9)'"));
	assert.equal(f.control('imgid').field.text, text);
	const expression = f.control("['custom-key']");
	setFieldText(expression.field, 'math.min(3, 4)', true); assert.equal(expression.commit(), true); f.refresh();
	assert.equal(f.model.buffer.getText(), SOURCE.replace("'hero'", "'math.max(7, 9)'").replace('math.max(1, 2)', 'math.min(3, 4)'));
});

test('multiline string values retain decoded read-only previews instead of exposing source delimiters', t => {
	const source = SOURCE.replace("'hero'", '[[MiXeD first\nsecond]]'), f = fixture(t, source);
	const property = f.view.optionProperties.find(property => property.descriptor.label === 'imgid')!;
	assert.equal(property.descriptor.preview, 'MiXeD first…'); assert.equal(property.text, 'MiXeD first…');
	assert.equal(f.control('imgid').field.readOnly, true); assert.equal(f.model.buffer.getText(), source);
});

test('a revoked string draft cannot quote or overwrite the replacement expression', t => {
	const f = fixture(t), literal = f.control('imgid');
	setFieldText(literal.field, "discard ' this", true);
	const offset = SOURCE.indexOf("'hero'");
	f.model.pushEditOperations([{ offset, deleteLength: "'hero'".length, text: 'choose_image()' }]);
	const external = f.model.buffer.getText(); assert.equal(literal.commit(), true);
	assert.equal(f.model.buffer.getText(), external); assert.equal(f.control('imgid').field.text, 'choose_image()');
});
