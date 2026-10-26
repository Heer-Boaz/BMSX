import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { InputFocusService } from '../../ide/input/focus';
import { api } from '../../ide/runtime/overlay_api';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { SceneOutlineFeedback } from '../../ide/workbench/contrib/scene_editor/feedback';
import { layoutSceneEditor } from '../../ide/workbench/contrib/scene_editor/layout';
import { installSceneOutline, selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { buildSceneSourceDocument } from '../../ide/workbench/contrib/scene_editor/source';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { semanticSnapshot } from './semantic_test_harness';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('room', { objects = {
	{ member_id = 'same  member', definition_id = 'actor', options = { pos = { x = 1, y = 2, z = 3 } } },
	{ member_id = 'same  member', definition_id = 'actor', options = { pos = { x = 4, y = 5, z = 6 } } },
} })
scenes.register('other room', { objects = {
	{ member_id = 'same  member', definition_id = 'actor', options = { pos = { x = 7, y = 8, z = 9 } } },
} })
`;

function scene(t: TestContext, domain: 0 | 1 = 0) {
	const path = 'scenes/room.lua';
	const model = new EditorTextModel({ sourceFilePath: path, location: { kind: 'workspace' as const, path }, domain, path, source: { resid: path, type: 'lua' } }, 'lua', SOURCE);
	const input = new SceneEditorInput(model);
	installSceneOutline(input, buildSceneSourceDocument(model.resource, semanticSnapshot(buildLuaFileSemanticData(SOURCE, path))));
	selectSceneOutlineRow(input, 1);
	t.after(() => { input.dispose(); model.dispose(); });
	return input;
}

test('Scene full identity keeps written member expressions, source correspondence and duplicate membership', t => {
	const input = scene(t), otherSlot = scene(t, 1);
	const members = input.outline.rows.filter(row => row.element.kind === 'member');
	assert.deepEqual(members.map(row => row.element.label), ["'same  member'", "'same  member'", "'same  member'"]);
	assert.equal(new Set(members.map(row => row.element.identity)).size, members.length, 'identical labels are distinguished by their actual containing scene and source range');
	for (const row of members) {
		assert.ok(row.element.identity.includes('scenes/room.lua:' + row.element.source.start.line + ':' + row.element.source.start.column));
		assert.ok(row.element.identity.includes("Member 'same  member'"));
		assert.ok(row.element.identity.includes("Definition 'actor'"));
	}
	assert.ok(members[0].element.identity.includes("Scene 'room'"));
	assert.ok(members[2].element.identity.includes("Scene 'other room'"));
	assert.notEqual(members[0].element.identity, otherSlot.outline.rows[1].element.identity, 'the same source path in another cartridge retains its physical domain');
	assert.equal(input.outline.rows[1].element.source, input.document!.analysis.chunk.locations.range(input.document!.scenes[0].objects[0].field.span));
	assert.equal(input.workingCopy.buffer.getText(), SOURCE);
});

for (const variant of ['tiny', 'msx'] as const) test(`Scene ${variant} Details names the selected member, not only its parent scene`, t => {
	configureFontVariant(variant);
	const input = scene(t), member = input.outline.rows[1].element;
	layoutSceneEditor(input, true, false, { left: 0, top: 24, right: 384, bottom: 276 });
	assert.equal(input.detailsText[0].text, member.label);
	assert.equal(member.labelClipped, false);
	layoutSceneEditor(input, false, false, { left: 0, top: 24, right: variant === 'tiny' ? 78 : 118, bottom: 276 });
	const tree = input.outline.layout;
	assert.equal(input.layout.mode, 'outline');
	assert.equal(member.labelClipped, editorViewState.font.measure(member.label) > tree.contentRight - tree.contentLeft - tree.indentWidth - tree.twistieWidth);
	selectSceneOutlineRow(input, 0);
	layoutSceneEditor(input, false, true, { left: 0, top: 24, right: 384, bottom: 276 });
	assert.equal(input.detailsText[0].text, "'room'");
	assert.equal(input.workingCopy.buffer.getText(), SOURCE);
});

function feedbackFixture(t: TestContext, variant: 'tiny' | 'msx') {
	configureFontVariant(variant);
	const input = scene(t), font = editorViewState.font.renderFont();
	const area = { left: 0, top: 24, right: 384, bottom: 276 };
	layoutSceneEditor(input, true, false, { ...area, right: variant === 'tiny' ? 78 : 94 });
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
		viewportX: 24, viewportY: input.outline.layout.contentTop + input.outline.layout.rowHeight + 2 };
	t.after(() => { feedback.dispose(); surfaces.dispose(); });
	return { input, font, area, parent, treeFocus, surfaces, owner, feedback, labels, point, paint, update, measurements: () => measurements };
}

for (const variant of ['tiny', 'msx'] as const) test(`Scene ${variant} full identity follows explicit hover/keyboard ownership without idle work`, t => {
	const f = feedbackFixture(t, variant), member = f.input.outline.rows[1];
	f.input.outline.hoverIndex = 1; f.feedback.pointer(f.input, 1, f.point); f.update(); f.paint();
	assert.ok(f.labels.join('').includes("Member 'same  member'"));
	assert.ok(f.labels.join('').includes('scenes/room.lua:3:2'));
	assert.equal(f.surfaces.hitTest(f.point.viewportX, f.point.viewportY), f.owner, 'identity feedback never intercepts pointer input');
	const measured = f.measurements();
	for (let frame = 0; frame < 1000; frame++) f.update();
	assert.equal(f.measurements(), measured, 'an unchanged row does not rebuild or remeasure full identity');
	f.feedback.onPointerLeave(); f.paint(); assert.deepEqual(f.labels, []);
	f.treeFocus.focus(); f.feedback.keyboardSelection(f.input); f.update(); f.paint();
	assert.ok(f.labels.join('').includes("Member 'same  member'"));
	f.parent.focus(); f.paint(); assert.deepEqual(f.labels, [], 'field/pane focus departure immediately retires keyboard identity');
	f.treeFocus.focus(); f.feedback.keyboardSelection(f.input); f.update();
	f.input.outline.hoverIndex = -1; f.point.viewportX++; f.feedback.pointer(f.input, -1, f.point); f.update(); f.paint();
	assert.deepEqual(f.labels, [], 'headers and empty space do not inherit a row identity');
	f.input.outline.hoverIndex = 1; f.point.viewportX++; f.feedback.pointer(f.input, 1, f.point); f.update();
	f.input.outline.scroll++; f.update(); f.paint(); assert.deepEqual(f.labels, []);
	f.input.outline.scroll--; f.feedback.pointer(f.input, 1, f.point); f.update(); f.paint();
	assert.deepEqual(f.labels, [], 'stationary hover cannot adopt a row after scroll');
	f.point.viewportX++; f.feedback.pointer(f.input, 1, f.point); f.update(); f.paint(); assert.ok(f.labels.length > 0);
	installSceneOutline(f.input, f.input.document!); selectSceneOutlineRow(f.input, 1);
	assert.notEqual(f.input.outline.rows[1], member);
	f.update(); f.paint(); assert.deepEqual(f.labels, [], 'equal labels at the same index cannot inherit another projection identity');
	layoutSceneEditor(f.input, true, false, f.area);
	f.treeFocus.focus(); f.feedback.keyboardSelection(f.input); f.update(); f.paint();
	assert.deepEqual(f.labels, [], 'fitting keyboard labels do not produce an unsolicited explanation layer');
	f.input.outline.hoverIndex = 1; f.point.viewportX++; f.feedback.pointer(f.input, 1, f.point); f.update(); f.paint();
	assert.ok(f.labels.join('').includes("Scene 'room'"), 'explicit hover exposes full qualification even when the short member label fits');
	const modal = f.surfaces.attach({ role: 'modal', blockedScope: null, captureScope: Symbol('modal'), isVisible: () => true,
		getBounds: () => f.area, getClip: () => f.area, draw() {} });
	f.paint(); assert.deepEqual(f.labels, [], 'an owned hint cannot paint above a modal blocking its Scene'); modal.dispose();
	f.feedback.clear(); f.paint(); assert.deepEqual(f.labels, []);
	f.point.viewportX++; f.feedback.pointer(f.input, 1, f.point); f.update(); f.paint(); assert.ok(f.labels.length > 0);
	f.owner.dispose(); f.update(); f.paint(); assert.deepEqual(f.labels, [], 'the actual pane surface owns feedback lifetime');
	assert.equal(f.input.workingCopy.buffer.getText(), SOURCE);
});
