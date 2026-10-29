import { createSceneSourceFixture } from '../helpers/scene_sources';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { InputFocusService } from '../../ide/input/focus';
import { api } from '../../ide/runtime/overlay_api';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { SceneOutlineFeedback } from '../../ide/workbench/contrib/scene_editor/feedback';
import { layoutSceneDetails } from '../../ide/workbench/contrib/scene_editor/details_layout';
import { layoutSceneHierarchy } from '../../ide/workbench/contrib/scene_editor/hierarchy_layout';
import type { SceneEditorViewState } from '../../ide/workbench/contrib/scene_editor/view_state';
import type { RectBounds } from '../../machine/ts/common/rect';
import { layoutSceneEditor } from '../../ide/workbench/contrib/scene_editor/layout';
import { installSceneOutline, selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { readLuaSourceRange } from '../../ide/language/lua/source_edits';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('room', { objects = {
	{ member_id = 'same  member', definition_id = 'actor', options = { pos = { x = 1, y = 2, z = 3 } } },
	{ member_id = 'same  member', definition_id = 'actor', options = { pos = { x = 4, y = 5, z = 6 } } },
} })
scenes.register('other room', { objects = {
	{ member_id = 'same  member', definition_id = 'actor', options = { pos = { x = 7, y = 8, z = 9 } } },
} })
`;

function scene(t: TestContext, contextId: string = TEST_CARTRIDGE_CONTEXT_IDS[0], source = SOURCE) {
	const path = 'scenes/room.lua';
	const { model, documents } = createSceneSourceFixture(t, source, path, contextId);
	const input = new SceneEditorInput(model, documents);
	assert.equal(input.view.authoring.document!.analysis.syntaxError, null);
	installSceneOutline(input.view.hierarchy);
	selectSceneOutlineRow(input.view.hierarchy, 1);
	t.after(() => { input.dispose(); });
	return input;
}

function arrangeScene(view: SceneEditorViewState, contentChanged: boolean, selectionChanged: boolean, bounds: RectBounds): void {
	const hierarchyRevision = view.hierarchy.outlineRevision;
	view.hierarchy.refresh();
	const hierarchyChanged = hierarchyRevision !== view.hierarchy.outlineRevision, detailsChanged = view.details.refresh();
	layoutSceneEditor(view, contentChanged, selectionChanged, bounds);
	layoutSceneHierarchy(view.hierarchy, view.layout.hierarchyBounds, contentChanged || hierarchyChanged);
	layoutSceneDetails(view.details, contentChanged || detailsChanged, view.layout.detailsBounds);
}

test('Scene semantic captions keep source correspondence and duplicate membership', t => {
	const input = scene(t), otherSlot = scene(t, TEST_CARTRIDGE_CONTEXT_IDS[1]);
	const members = input.view.hierarchy.outline.rows.filter(row => row.element.kind === 'member');
	assert.deepEqual(members.map(row => row.element.label), ['same  member', 'same  member', 'same  member']);
	assert.equal(new Set(members.map(row => row.element.identity)).size, members.length, 'identical labels are distinguished by their actual containing scene and source range');
	for (const row of members) {
		assert.ok(row.element.identity.includes('scenes/room.lua:' + row.element.source.start.line + ':' + row.element.source.start.column));
	}
	assert.notEqual(members[0].element.source.path, otherSlot.view.hierarchy.outline.rows[1].element.source.path, 'equal human-readable labels do not merge source correspondence from distinct admitted contexts');
	assert.equal(input.view.hierarchy.outline.rows[1].element.source, input.view.authoring.document!.analysis.chunk.locations.range(input.view.authoring.document!.scenes[0].objects[0].field.span));
	assert.equal(input.workingCopy.buffer.getText(), SOURCE);
});

const IDENTIFIER_LITERALS = [
	{ source: "'Mixed Ship'", value: 'Mixed Ship' },
	{ source: '"MiXeD  \\"Ship\\""', value: 'MiXeD  "Ship"' },
	{ source: "'Capt\\'n `One'", value: "Capt'n `One" },
	{ source: '[=[Long  MiXeD "Ship"]=]', value: 'Long  MiXeD "Ship"' },
	{ source: '"Ship\\x20Name"', value: 'Ship Name' },
	{ source: "''", value: '' },
	{ source: "'ship   member'", value: 'ship   member' },
];

for (const variant of ['tiny', 'msx'] as const) test(`Scene ${variant} identifier captions consume decoded literals without changing their authored bytes or spans`, t => {
	configureFontVariant(variant);
	for (const literal of IDENTIFIER_LITERALS) {
		const source = `local scenes = require('cartlib/world/scene_library')\nscenes.register(${literal.source}, { objects = {\n { member_id = ${literal.source}, definition_id = ${literal.source} },\n} })`;
		const input = scene(t, TEST_CARTRIDGE_CONTEXT_IDS[0], source), document = input.view.authoring.document!;
		const root = input.view.hierarchy.outline.roots[0].element, member = input.view.hierarchy.outline.roots[0].children[0].element;
		const entry = document.scenes[0].objects[0];
		assert.ok(entry.kind === 'object');
		const locations = document.analysis.chunk.locations;
		assert.equal(root.label, literal.value, 'a Scene identifier is data, not its Lua token spelling');
		assert.equal(member.label, literal.value, 'the exact decoded member identifier supplies its caption');
		assert.equal(member.detail, literal.value, 'the definition caption uses the same semantic string boundary');
		assert.equal(root.preserveLabelCase, true); assert.equal(member.preserveLabelCase, true); assert.equal(member.preserveDetailCase, true);
		assert.equal(readLuaSourceRange(input.workingCopy.buffer, locations.range(document.scenes[0].id.span)), literal.source);
		assert.equal(readLuaSourceRange(input.workingCopy.buffer, locations.range(entry.memberId.span)), literal.source);
		assert.equal(readLuaSourceRange(input.workingCopy.buffer, locations.range(entry.definitionId.span)), literal.source);
		assert.equal(member.source, locations.range(entry.field.span), 'caption decoding does not replace the authored member occurrence');
		assert.ok(member.identity.includes(literal.value), 'qualification preserves the decoded identifier contents');
		assert.equal(member.identity.includes(literal.source), false, 'qualification does not expose the identifier literal token');
		const span = { ...member.span }, version = input.workingCopy.version;
		arrangeScene(input.view, true, false, { left: 0, top: 24, right: 800, bottom: 400 });
		assert.equal(root.displayLabel, literal.value); assert.equal(member.displayLabel, literal.value);
		assert.equal(input.view.details.detailsText[0].text, literal.value, 'literal identifier casing and internal spaces survive Details layout');
		assert.equal(input.view.details.detailsText[1].text, literal.value);
		assert.deepEqual(member.span, span); assert.deepEqual(input.view.authoring.selectionRange, span);
		assert.equal(input.workingCopy.version, version); assert.equal(input.workingCopy.buffer.getText(), source);
	}
});

test('equal decoded Scene identifiers retain distinct lexical source occurrences and dynamic expressions stay source previews', t => {
	const source = `local scenes = require('cartlib/world/scene_library')
scenes.register(scene_names.main, { objects = {
 { member_id = 'Ship', definition_id = 'Actor' },
 { member_id = [=[Ship]=], definition_id = "Actor" },
 { member_id = member_ids.ship, definition_id = actors.ship },
 'composition',
} })`;
	const input = scene(t, TEST_CARTRIDGE_CONTEXT_IDS[0], source), root = input.view.hierarchy.outline.roots[0];
	const [first, second, dynamic, composition] = root.children.map(row => row.element);
	assert.equal(first.label, second.label); assert.equal(first.detail, second.detail);
	assert.notDeepEqual(first.span, second.span); assert.notEqual(first.identity, second.identity);
	assert.equal(root.element.label, 'scene_names.main'); assert.equal(root.element.preserveLabelCase, false);
	assert.equal(dynamic.label, 'member_ids.ship'); assert.equal(dynamic.detail, 'actors.ship');
	assert.equal(dynamic.preserveLabelCase, false); assert.equal(dynamic.preserveDetailCase, false);
	assert.equal(composition.label, "'composition'", 'a string used as unresolved composition is still a Lua expression, not a fabricated identifier');
	selectSceneOutlineRow(input.view.hierarchy, 3);
	arrangeScene(input.view, true, false, { left: 0, top: 24, right: 800, bottom: 400 });
	assert.equal(root.element.displayLabel, '* SCENE_NAMES.MAIN'); assert.equal(dynamic.displayLabel, 'MEMBER_IDS.SHIP');
	assert.equal(input.view.details.detailsText[0].text, 'MEMBER_IDS.SHIP'); assert.equal(input.view.details.detailsText[1].text, 'ACTORS.SHIP');
	assert.equal(input.workingCopy.buffer.getText(), source);
});

for (const variant of ['tiny', 'msx'] as const) test(`Scene ${variant} Details names the selected member, not only its parent scene`, t => {
	configureFontVariant(variant);
	const input = scene(t), member = input.view.hierarchy.outline.rows[1].element;
	arrangeScene(input.view, true, false, { left: 0, top: 24, right: 384, bottom: 276 });
	assert.equal(input.view.details.detailsText[0].text, member.label);
	assert.equal(member.labelClipped, false);
	arrangeScene(input.view, false, false, { left: 0, top: 24, right: variant === 'tiny' ? 78 : 118, bottom: 276 });
	const tree = input.view.hierarchy.outline.layout;
	assert.equal(input.view.layout.mode, 'outline');
	assert.equal(member.labelClipped, editorViewState.font.measure(member.label) > tree.contentRight - tree.contentLeft - tree.indentWidth - tree.twistieWidth);
	selectSceneOutlineRow(input.view.hierarchy, 0);
	arrangeScene(input.view, false, true, { left: 0, top: 24, right: 384, bottom: 276 });
	assert.equal(input.view.details.detailsText[0].text, 'room');
	assert.equal(input.workingCopy.buffer.getText(), SOURCE);
});

function feedbackFixture(t: TestContext, variant: 'tiny' | 'msx') {
	configureFontVariant(variant);
	const source = SOURCE.replaceAll('same  member', 'same  member identity');
	const input = scene(t, TEST_CARTRIDGE_CONTEXT_IDS[0], source), font = editorViewState.font.renderFont();
	const area = { left: 0, top: 24, right: 384, bottom: 276 };
	arrangeScene(input.view, true, false, { ...area, right: variant === 'tiny' ? 78 : 94 });
	const focus = new InputFocusService(), parent = focus.createTarget(), treeFocus = focus.createTarget(parent);
	parent.bindKeyboard(() => {}); treeFocus.bindKeyboard(() => {});
	const surfaces = new WorkbenchSurfaceService();
	const owner = surfaces.attach({ role: 'content', captureScope: Symbol('Scene'), isVisible: () => true,
		getBounds: () => area, getClip: () => area, draw() {} });
	const feedback = new SceneOutlineFeedback(surfaces, owner, area, treeFocus);
	let measurements = 0;
	const measure = (text: string, start: number, end: number) => { measurements++; return font.measure(text.slice(start, end)); };
	const measureText = (text: string) => { measurements++; return font.measure(text); };
	const labels: string[] = [];
	t.mock.method(api, 'blit_text_inline_with_font', label => labels.push(label));
	const overlay = createHostOverlayFixture(384, 288);
	const paint = () => { labels.length = 0; overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); surfaces.draw(api); overlay.renderer.endFrame(); };
	const update = () => feedback.update(font, measure, measureText);
	const point = { valid: true, insideViewport: true, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0,
		viewportX: 24, viewportY: input.view.hierarchy.outline.layout.contentTop + input.view.hierarchy.outline.layout.rowHeight + 2 };
	t.after(() => { feedback.dispose(); surfaces.dispose(); });
	return { input, source, font, area, parent, treeFocus, surfaces, owner, feedback, labels, point, paint, update, measurements: () => measurements };
}

for (const variant of ['tiny', 'msx'] as const) test(`Scene ${variant} full identity follows explicit hover/keyboard ownership without idle work`, t => {
	const f = feedbackFixture(t, variant), member = f.input.view.hierarchy.outline.rows[1];
	assert.equal(member.element.labelClipped, true, 'the ownership fixture exercises full-identity feedback for an overflowing semantic caption');
	f.input.view.hierarchy.outline.hoverIndex = 1; f.feedback.pointer(f.input.view.hierarchy, 1, f.point); f.update(); f.paint();
	assert.ok(f.labels.length > 0, 'the admitted row paints its source-owned qualification');
	assert.ok(f.labels.join('').includes('scenes/room.lua:3:2'));
	assert.equal(f.surfaces.hitTest(f.point.viewportX, f.point.viewportY), f.owner, 'identity feedback never intercepts pointer input');
	const measured = f.measurements();
	for (let frame = 0; frame < 1000; frame++) f.update();
	assert.equal(f.measurements(), measured, 'an unchanged row does not rebuild or remeasure full identity');
	f.feedback.onPointerLeave(); f.paint(); assert.deepEqual(f.labels, []);
	f.treeFocus.focus(); f.feedback.keyboardSelection(f.input.view.hierarchy); f.update(); f.paint();
	assert.ok(f.labels.length > 0, 'the admitted row paints its source-owned qualification');
	f.parent.focus(); f.paint(); assert.deepEqual(f.labels, [], 'field/pane focus departure immediately retires keyboard identity');
	f.treeFocus.focus(); f.feedback.keyboardSelection(f.input.view.hierarchy); f.update();
	f.input.view.hierarchy.outline.hoverIndex = -1; f.point.viewportX++; f.feedback.pointer(f.input.view.hierarchy, -1, f.point); f.update(); f.paint();
	assert.deepEqual(f.labels, [], 'headers and empty space do not inherit a row identity');
	f.input.view.hierarchy.outline.hoverIndex = 1; f.point.viewportX++; f.feedback.pointer(f.input.view.hierarchy, 1, f.point); f.update();
	f.input.view.hierarchy.outline.scroll++; f.update(); f.paint(); assert.deepEqual(f.labels, []);
	f.input.view.hierarchy.outline.scroll--; f.feedback.pointer(f.input.view.hierarchy, 1, f.point); f.update(); f.paint();
	assert.deepEqual(f.labels, [], 'stationary hover cannot adopt a row after scroll');
	f.point.viewportX++; f.feedback.pointer(f.input.view.hierarchy, 1, f.point); f.update(); f.paint(); assert.ok(f.labels.length > 0);
	installSceneOutline(f.input.view.hierarchy); selectSceneOutlineRow(f.input.view.hierarchy, 1);
	assert.notEqual(f.input.view.hierarchy.outline.rows[1], member);
	f.update(); f.paint(); assert.deepEqual(f.labels, [], 'equal labels at the same index cannot inherit another projection identity');
	layoutSceneEditor(f.input.view, true, false, f.area);
	f.treeFocus.focus(); f.feedback.keyboardSelection(f.input.view.hierarchy); f.update(); f.paint();
	assert.deepEqual(f.labels, [], 'fitting keyboard labels do not produce an unsolicited explanation layer');
	f.input.view.hierarchy.outline.hoverIndex = 1; f.point.viewportX++; f.feedback.pointer(f.input.view.hierarchy, 1, f.point); f.update(); f.paint();
	assert.ok(f.labels.length > 0, 'explicit hover exposes full qualification even when the short member label fits');
	const modal = f.surfaces.attach({ role: 'modal', blockedScope: null, presentationParent: null, captureScope: Symbol('modal'), isVisible: () => true,
		getBounds: () => f.area, getClip: () => f.area, draw() {} });
	f.paint(); assert.deepEqual(f.labels, [], 'an owned hint cannot paint above a modal blocking its Scene'); modal.dispose();
	f.feedback.clear(); f.paint(); assert.deepEqual(f.labels, []);
	f.point.viewportX++; f.feedback.pointer(f.input.view.hierarchy, 1, f.point); f.update(); f.paint(); assert.ok(f.labels.length > 0);
	f.owner.dispose(); f.update(); f.paint(); assert.deepEqual(f.labels, [], 'the actual pane surface owns feedback lifetime');
	assert.equal(f.input.workingCopy.buffer.getText(), f.source);
});
