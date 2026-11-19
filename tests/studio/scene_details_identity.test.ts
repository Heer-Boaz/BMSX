import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { SCROLLBAR_WIDTH } from '../../ide/common/constants';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneDetailsControl } from '../../ide/workbench/contrib/scene_editor/details_control';
import { SceneDetailsViewState } from '../../ide/workbench/contrib/scene_editor/details_view';
import { createSceneSourceFixture } from '../helpers/scene_sources';

const MEMBER = 'authored.namespace.with.a.long.shared.prefix.Member01';
const DEFINITION = 'authored.namespace.with.a.long.shared.prefix.Prefab02';

function fixture(t: TestContext, member = `'${MEMBER}'`, definition = `'${DEFINITION}'`) {
	const source = `local scenes=require('cartlib/world/scene_library')
local prefab=require('cartlib/world/prefab')
prefab.define({def_id='${DEFINITION}',class={}})
scenes.register('room',{objects={{member_id=${member},definition_id=${definition}}}})`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, [['cartlib/world/prefab.lua', 'return {define=function() end}']]);
	const authoring = new SceneAuthoringContext(f.model, f.documents), view = new SceneDetailsViewState(authoring);
	const scope = new InputFocusScope(Symbol('Details identity'), inputFocus.workbenchScope), parent = inputFocus.createTarget(null, scope);
	const bounds = { left: 30, top: 20, right: 160, bottom: 100 };
	const navigation = { isEnabled: () => true, run: () => {} };
	const control = new SceneDetailsControl({ isEnabled: () => false, execute() {} }, scope, parent,
		{ outline: navigation, details: navigation });
	const document = authoring.document!, scene = document.scenes[0];
	authoring.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 });
	control.setView(view, bounds);
	t.after(() => { control.dispose(); view.dispose(); authoring.dispose(); inputFocus.setTarget(null); pointerCapture.interrupt(false); });
	return { ...f, source, authoring, view, control, bounds };
}

for (const font of ['tiny', 'msx'] as const) test(`${font} identity wrapping preserves exact authored names across panel widths`, t => {
	configureFontVariant(font);
	const f = fixture(t), version = f.model.version;
	for (const width of [110, 160, 400]) {
		f.bounds.right = f.bounds.left + width; f.control.layout(f.bounds);
		const labels = f.view.detailsText.filter(line => line.tone === 'normal');
		const details = f.view.detailsText.filter(line => line.tone === 'description');
		// Exact source identifiers are a data-integrity contract; this is a focused wrapping algorithm test.
		assert.equal(labels.map(line => line.text).join(''), MEMBER);
		assert.equal(details.map(line => line.text).join(''), DEFINITION);
		const textWidth = width - 8 - SCROLLBAR_WIDTH;
		for (const line of [...labels, ...details]) assert.ok(editorViewState.font.measure(line.text) <= textWidth);
	}
	assert.equal(f.model.version, version); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.dirty, false);
});

test('identity wrapping retains whitespace and authored line breaks without duplicating equal decoded identifiers', t => {
	configureFontVariant('tiny');
	const literal = fixture(t, `'${DEFINITION}'`), multiline = fixture(t, '[[first  line\nsecond line]]');
	assert.equal(literal.view.detailsText.filter(line => line.tone === 'description').length, 0);
	assert.equal(literal.view.detailsText.filter(line => line.tone === 'normal').map(line => line.text).join(''), DEFINITION);
	assert.equal(multiline.view.detailsText.filter(line => line.tone === 'normal').map(line => line.text).join(''), 'first  linesecond line');
	assert.equal(multiline.view.projection.subject!.label, 'first  line\nsecond line');
	assert.equal(multiline.model.buffer.getText(), multiline.source);
});
