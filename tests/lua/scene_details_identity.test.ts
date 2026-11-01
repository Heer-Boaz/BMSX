import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneDetailsControl } from '../../ide/workbench/contrib/scene_editor/details_control';
import { SceneDetailsViewState } from '../../ide/workbench/contrib/scene_editor/details_view';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchMenu } from '../../ide/workbench/ui/menu/model';
import { WorkbenchTooltip } from '../../ide/workbench/ui/tooltip';
import { createSceneSourceFixture } from '../helpers/scene_sources';
import { createActualSourcePanes } from '../helpers/source_panes';
import { SCENE_VIEWPORT_IMPORTS } from '../fixtures/studio/scene_viewport';

const MEMBER = 'authored.namespace.with.a.long.shared.prefix.Member01';
const DEFINITION = 'authored.namespace.with.a.long.shared.prefix.Prefab02';

function fixture(t: TestContext, member = `'${MEMBER}'`, definition = `'${DEFINITION}'`) {
	const source = `local scenes=require('cartlib/world/scene_library')
local prefab=require('cartlib/world/prefab')
prefab.define({def_id='${DEFINITION}',class=require('cartlib/world/object_2d')})
scenes.register('room',{objects={{member_id=${member},definition_id=${definition},options={strength=5,armor=2,speed=3,score=4}}}})`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, [['cartlib/world/prefab.lua', 'return {define=function() end}']]);
	const authoring = new SceneAuthoringContext(f.model, f.documents), view = new SceneDetailsViewState(authoring);
	const scope = new InputFocusScope(Symbol('Details identity'), inputFocus.workbenchScope), parent = inputFocus.createTarget(null, scope);
	const bounds = { left: 30, top: 20, right: 160, bottom: 100 }, menu = new ContextMenuController(inputFocus, pointerCapture, bounds);
	const navigation = { isEnabled: () => true, run: () => {} };
	const control = new SceneDetailsControl({ isEnabled: () => false, execute() {} }, menu, scope, parent,
		{ outline: navigation, details: navigation }, new WorkbenchMenu([], undefined));
	const document = authoring.document!, scene = document.scenes[0];
	authoring.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 });
	control.setView(view, bounds); parent.focus();
	const hover = (x: number, y: number) => {
		const snapshot: PointerInputSnapshot = { valid: true, insideViewport: true, viewportX: x, viewportY: y,
			pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0, modifiers: KeyModifier.none, spaceDown: false };
		pointerHover.beginDispatch(scope.surfaceScope); control.handlePointer(snapshot, false); pointerHover.endDispatch();
	};
	t.after(() => { control.dispose(); view.dispose(); authoring.dispose(); menu.dispose(); inputFocus.setTarget(null); pointerCapture.interrupt(false); });
	return { ...f, source, authoring, view, control, parent, bounds, hover };
}

for (const font of ['tiny', 'msx'] as const) test(`${font} identity layout is bounded independently of identifier length and retains exact data`, t => {
	configureFontVariant(font);
	const f = fixture(t), version = f.model.version, subject = f.view.projection.subject!;
	// Identity row count and measured clipping are this focused layout contract,
	// not coordinate/wording assertions over a user workflow.
	for (const width of [110, 160, 400]) {
		f.bounds.right = f.bounds.left + width; f.control.layout(f.bounds);
		assert.equal(f.view.detailsText.length, 3 + f.view.optionProperties.length,
			'the two identity rows cannot insert wrapped rows ahead of the short fixture property labels');
		const identity = f.view.identity;
		assert.equal(identity.contentBounds.bottom - identity.contentBounds.top, f.view.layout.rowHeight * 2);
		assert.equal(identity.tooltip, MEMBER + '\n' + DEFINITION, 'full tooltip content is exact projected identifier data');
		assert.ok(f.view.detailsText.slice(0, 2).every(line => !line.text.includes('\n')
			&& editorViewState.font.measure(line.text) <= identity.contentBounds.right - identity.contentBounds.left));
		assert.ok(f.view.projection.subject === subject); assert.equal(subject.label, MEMBER); assert.equal(subject.detail, DEFINITION);
	}
	assert.equal(f.model.version, version); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.dirty, false);
});

test('only decoded equal identifiers omit the repeated description; equal dynamic expressions remain two facts', t => {
	configureFontVariant('tiny');
	const literal = fixture(t, `'${DEFINITION}'`), dynamic = fixture(t, 'choose_id()', 'choose_id()');
	assert.equal(literal.view.identity.contentBounds.bottom - literal.view.identity.contentBounds.top, literal.view.layout.rowHeight);
	assert.equal(literal.view.identity.tooltip, DEFINITION);
	assert.equal(dynamic.view.identity.contentBounds.bottom - dynamic.view.identity.contentBounds.top, dynamic.view.layout.rowHeight * 2);
	assert.equal(dynamic.view.projection.subject!.label, 'choose_id()'); assert.equal(dynamic.view.projection.subject!.detail, 'choose_id()');
});

test('multiline identifier previews occupy one row while feedback preserves their complete decoded data', t => {
	configureFontVariant('tiny');
	const f = fixture(t, '[[first line\nsecond line]]');
	assert.equal(f.view.identity.tooltip, 'first line\nsecond line\n' + DEFINITION);
	assert.equal(f.view.identity.contentBounds.bottom - f.view.identity.contentBounds.top, f.view.layout.rowHeight * 2);
	assert.equal(f.view.detailsText[0].text.includes('\n'), false); assert.equal(f.view.identity.clipped, true);
	assert.equal(f.model.buffer.getText(), f.source);
});

for (const font of ['tiny', 'msx'] as const) test(`${font} full identity feedback follows routed hover and section focus, never a stale source or scroll hit`, t => {
	configureFontVariant(font);
	const f = fixture(t), identity = f.view.identity, selectionRevision = f.authoring.selectionRevision, version = f.model.version;
	const x = (identity.bounds.left + identity.bounds.right) / 2, y = identity.bounds.top + 1;
	assert.equal(f.control.tooltipItem, undefined); f.hover(x, y);
	assert.equal(f.control.tooltipItem, identity);
	const advance = t.mock.method(editorViewState.font, 'advance', () => assert.fail('idle feedback remeasured text'));
	for (let frame = 0; frame < 100; frame++) { f.control.update(); assert.equal(f.control.tooltipItem, identity); }
	advance.mock.restore();
	f.view.viewport.scrollbar.setScroll(f.view.layout.rowHeight); f.control.update();
	assert.equal(f.control.tooltipItem, undefined);
	f.view.viewport.scrollbar.setScroll(0); f.control.update(); f.hover(x, y);
	assert.equal(f.control.tooltipItem, undefined, 'a stationary pointer cannot revive feedback retired by scrolling');
	f.hover(x + 1, y); assert.equal(f.control.tooltipItem, identity);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- newer source\n' }]); f.control.update(); f.hover(x + 1, y);
	assert.equal(f.control.tooltipItem, undefined, 'a new source publication does not inherit an old physical hit');
	f.hover(x + 2, y); assert.equal(f.control.tooltipItem, identity);
	assert.equal(f.control.focus(), true); assert.equal(f.control.tooltipItem, identity, 'section focus exposes the full clipped identity to keyboard users');
	assert.equal(f.control.controls[0].field.focusTarget.focus(), true); assert.equal(f.control.tooltipItem, undefined);
	f.hover(x + 3, y); assert.equal(f.control.tooltipItem, identity, 'a deliberate new hover remains available without taking field focus');
	assert.equal(f.control.controls[0].field.focusTarget.hasFocus, true);
	pointerHover.clear(); assert.equal(f.control.tooltipItem, undefined);
	assert.equal(f.authoring.selectionRevision, selectionRevision); assert.equal(f.model.version, version + 1);
	f.control.clearView(); assert.equal(f.control.tooltipItem, undefined); assert.equal(pointerHover.has(f.control), false);
});

test('document Scene source-caption hover takes precedence over its focused Details identity', t => {
	const source = `local scenes=require('cartlib/world/scene_library')
local prefab=require('cartlib/world/prefab')
prefab.define({def_id='${DEFINITION}',class=require('cartlib/world/object_2d')})
scenes.register('room',{objects={{member_id='${MEMBER.repeat(4)}',definition_id='${DEFINITION}'}}})`;
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', source], ['cartlib/world/scene_library.lua', 'return {}']]);
	f.editor.setFontVariant('tiny'); f.firstBounds.right = 600;
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	f.editor.sceneEditor.openResource(f.firstGroup, resource); f.update();
	const pane = f.firstGroup.panes.activePane; assert.ok(pane instanceof SceneEditorPane);
	pane.control.hierarchy.focus(); f.key('Home'); f.key('ArrowDown');
	f.editor.commands.execute('sceneEditor.details', pane.commandTarget); f.update();
	const details = pane.control.details;
	assert.ok(details.focusTarget.hasFocus && details.view.identity.clipped);
	assert.equal(details.tooltipItem, details.view.identity);
	const show = t.mock.method(WorkbenchTooltip.prototype, 'show'), bounds = pane.control.view.layout.sourceBounds;
	f.editor.dispatchPointer({ x: bounds.left + 1, y: bounds.top + 1, buttons: 0, pressedButtons: 0, releasedButtons: 0,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() }); f.update();
	assert.ok(show.mock.callCount() > 0);
	assert.equal(show.mock.calls.at(-1)!.arguments[0], resource.path, 'the source-caption feedback retains the actual resource identity');
	assert.equal(details.focusTarget.hasFocus, true);
	assert.equal(details.view.authoring.workingCopy.buffer.getText(), source); assert.equal(details.view.authoring.workingCopy.dirty, false);
});
