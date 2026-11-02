import { createSceneDocumentFixture } from '../helpers/scene_document_fixture';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createSceneSourceFixture } from '../helpers/scene_sources';
import { SCENE_VIEWPORT_IMPORTS, SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { installSceneOutline, selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { workbenchListRowIndexAtPosition } from '../../ide/workbench/ui/list_view';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { api } from '../../ide/runtime/overlay_api';
import { HostOverlayQuadStream } from '../../machine/ts/render/host_overlay/quad_stream';
import { layoutSceneDetails } from '../../ide/workbench/contrib/scene_editor/details_layout';
import { layoutSceneHierarchy } from '../../ide/workbench/contrib/scene_editor/hierarchy_layout';
import { drawSceneHierarchy } from '../../ide/workbench/contrib/scene_editor/hierarchy_render';
import type { SceneViewState } from '../../ide/workbench/contrib/scene_editor/scene_view';
import type { RectBounds } from '../../machine/ts/common/rect';
import { captureSceneEditorView, restoreSceneEditorView } from '../../ide/workbench/contrib/scene_editor/view_snapshot';
import { mapSceneReading } from '../../ide/workbench/contrib/scene_editor/reading_snapshot';
import * as colors from '../../ide/common/constants';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';

function scene(t: TestContext, path = 'viewport.lua', source = SCENE_VIEWPORT_SOURCE) {
	const { model, documents, sources } = createSceneSourceFixture(t, source, path, undefined, SCENE_VIEWPORT_IMPORTS);
	const input = new SceneEditorInput(model, documents, sources.catalog);
	installSceneOutline(input.view.hierarchy);
	selectSceneOutlineRow(input.view.hierarchy, 1);
	return input;
}

// A focused layout fixture arranges the real sibling owners after the composition allocates them.
function arrangeScene(view: SceneViewState, contentChanged: boolean, bounds: RectBounds): boolean {
	const hierarchyRevision = view.hierarchy.outlineRevision;
	view.hierarchy.refresh();
	const hierarchyChanged = hierarchyRevision !== view.hierarchy.outlineRevision, detailsChanged = view.details.refresh();
	const middle = bounds.left + ((bounds.right - bounds.left) >> 1);
	const treeChanged = layoutSceneHierarchy(view.hierarchy, { ...bounds, right: middle }, contentChanged || hierarchyChanged);
	const inspectorChanged = layoutSceneDetails(view.details, contentChanged || detailsChanged, { ...bounds, left: middle });
	return treeChanged || inspectorChanged;
}

test('replacing selected Scene source with the same member name retires the Details view target', t => {
	configureFontVariant('tiny');
	const input = scene(t); t.after(() => { input.dispose(); });

	const snapshot = captureSceneEditorView(input.view), selected = snapshot.selected!;
	const originalLabel = input.view.hierarchy.outline.rows[input.view.hierarchy.outline.selectionIndex].element.label;
	const source = input.workingCopy.buffer.getText();
	const replacement = source.slice(selected.span.start, selected.span.end).replace('x = 11,', 'x = 12,');
	const changes = [{ offset: selected.span.start, deletedLength: selected.span.end - selected.span.start, insertedLength: replacement.length }];
	input.workingCopy.pushEditOperations([{ offset: selected.span.start, deleteLength: replacement.length, text: replacement }]);
	mapSceneReading(snapshot, changes);
	installSceneOutline(input.view.hierarchy);
	restoreSceneEditorView(input.view, snapshot);
	assert.equal(selected.span.start, selected.span.end, 'a complete replacement retires the tracked source occurrence');
	assert.ok(input.view.hierarchy.outline.rows.some(row => row.element.label === originalLabel), 'a same-named source occurrence still exists');
	assert.equal(input.view.hierarchy.outline.selectionIndex, -1);
	arrangeScene(input.view, true, { left: 0, top: 24, right: 180, bottom: 180 });
	assert.equal(input.view.details.projection.subject, undefined);
	assert.equal(input.view.details.viewport.contentHeight, 0);
	assert.equal(input.view.details.properties.length, 0);
	assert.equal(input.view.details.optionProperties.length, 0);
});

for (const font of ['tiny', 'msx'] as const) for (const width of [256, 384]) {
	test(`scene details measure and scroll in ${font}, ${width}px, independent of pane height`, t => {
		configureFontVariant(font);
		editorViewState.viewportWidth = width; editorViewState.viewportHeight = 288;
		editorViewState.editorAreaTop = 31; editorViewState.editorAreaBottom = 275;
		const input = scene(t);
		t.after(() => { input.dispose(); });
		arrangeScene(input.view, true, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
		assert.deepEqual(input.view.details.properties.map(property => property.descriptor.value), [11, -22, 33]);
		const height = input.view.details.viewport.contentHeight;
		assert.ok(height > 0);
		for (const line of input.view.details.detailsText) assert.ok(editorViewState.font.measure(line.text) <= input.view.details.viewport.bounds.right - input.view.details.viewport.bounds.left - 8);
		editorViewState.editorAreaBottom = 120;
		assert.equal(arrangeScene(input.view, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom }), true);
		assert.equal(input.view.details.viewport.contentHeight, height, 'content extent is independent of viewport height');
		assert.equal(input.view.details.viewport.scrollbar.isVisible(), true);
		const row = input.view.details.properties[2];
		input.view.details.viewport.scrollbar.reveal(row.contentBounds.top, row.contentBounds.bottom, 2);
		arrangeScene(input.view, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
		assert.ok(row.bounds.top >= input.view.details.viewport.bounds.top && row.bounds.bottom <= input.view.details.viewport.bounds.bottom);
		const option = input.view.details.optionProperties.at(-1)!;
		input.view.details.viewport.scrollbar.reveal(option.contentBounds.top, option.contentBounds.bottom, 2);
		arrangeScene(input.view, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
		assert.ok(option.bounds.top >= input.view.details.viewport.bounds.top && option.bounds.bottom <= input.view.details.viewport.bounds.bottom);
		const runs = input.view.details.detailsText.slice();
		const contentBounds = row.contentBounds;
		const screenBounds = row.bounds;
		const revision = input.view.details.viewport.revision;
		const advance = t.mock.method(editorViewState.font, 'advance', () => assert.fail('scroll/stable layout remeasured text'));
		input.view.details.viewport.scrollbar.setScroll(height); arrangeScene(input.view, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
		const note = input.view.details.detailsText.at(-1)!;
		assert.ok(input.view.details.viewport.offsetTop + note.top + editorViewState.lineHeight <= input.view.details.viewport.bounds.bottom);
		for (let index = 0; index < 100; index += 1) assert.equal(arrangeScene(input.view, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom }), false);
		advance.mock.restore();
		assert.deepEqual(input.view.details.detailsText, runs); assert.equal(input.view.details.detailsText[0], runs[0]);
		assert.equal(input.view.details.viewport.revision, revision); assert.equal(row.contentBounds, contentBounds); assert.equal(row.bounds, screenBounds);
		const tree = input.view.hierarchy.outline.layout;
		assert.equal(workbenchListRowIndexAtPosition(input.view.hierarchy.outline, tree.contentLeft, tree.contentBottom), -1);
		editorViewState.editorAreaBottom = editorViewState.editorAreaTop; arrangeScene(input.view, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
		assert.equal(input.view.details.viewport.height, 0); assert.equal(input.view.details.viewport.scrollbar.isVisible(), false);
		assert.equal(input.view.hierarchy.outline.layout.visibleRowCount, 0);
		editorViewState.editorAreaBottom = 275; arrangeScene(input.view, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
		selectSceneOutlineRow(input.view.hierarchy, 2); arrangeScene(input.view, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
		assert.equal(input.view.details.properties.length, 0, 'computed placement does not grant editable coordinates from a fabricated partial pose');
		selectSceneOutlineRow(input.view.hierarchy, 0); arrangeScene(input.view, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
		assert.ok(input.view.details.viewport.contentHeight < height);
		selectSceneOutlineRow(input.view.hierarchy, -1); arrangeScene(input.view, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
		assert.equal(input.view.details.projection.subject, undefined);
		assert.equal(input.view.details.viewport.contentHeight, 0); assert.equal(input.view.details.viewport.scrollTop, 0);
		assert.equal(input.view.details.detailsText.length, 0); assert.equal(input.view.details.properties.length, 0);
		assert.equal(input.workingCopy.dirty, false, 'layout, scroll and selection do not edit source');
	});
}


test('Scene companion painting clips content and reuses overlay storage', async t => {
	const source = `local scenes = require('cartlib/world/scene_library')
local prefab = require('cartlib/world/prefab')
prefab.define({def_id='partial.actor',class=require('cartlib/world/object_3d')})
scenes.register('partial', {objects={
 {member_id='authored',definition_id='partial.actor',position={x=11,y=-22,z=33},
  options={color=0xffabcdef,visible=true,region={width=16,height=24}}},
 build_member(),
}})`;
	const f = await createSceneDocumentFixture(t, source, SCENE_VIEWPORT_IMPORTS);
	selectSceneOutlineRow(f.view.hierarchy, 1); f.update();
	const overlay = createHostOverlayFixture(384, 288), stream = new HostOverlayQuadStream();
	const draw = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		drawSceneHierarchy(f.view.hierarchy, false); f.primary.details.control.draw(); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(); stream.reset(384, 288);
		for (let index = 0; index < frame.commandCount; index += 1) stream.appendEntry(frame.commandKinds[index], frame.commandRefs[index]);
		return frame;
	};
	draw(); const storage = stream.floatData, viewport = f.view.details.viewport.bounds;
	assert.ok(stream.batches.slice(0, stream.batchCount).some(batch => batch.clip.left === viewport.left && batch.clip.top === viewport.top));
	for (let index = 0; index < 100; index += 1) draw();
	assert.equal(stream.floatData, storage);
	const theme = colors.getActiveIdeThemeVariant(); t.after(() => colors.setIdeThemeVariant(theme));
	for (const variant of ['dark', 'light']) {
		colors.setIdeThemeVariant(variant);
		const frame = draw(); let warning = false;
		for (let index = 0; index < frame.commandCount; index += 1) {
			if (frame.commandKinds[index] !== Host2DKind.Glyphs) continue;
			const glyphs = frame.commandRefs[index] as GlyphRenderSubmission;
			if (f.view.details.detailsText.some(line => line.tone === 'warning' && glyphs.items === line.text)) {
				warning = true; assert.equal(glyphs.color, resolveThemeTokenColor(colors.COLOR_CONTENT_WARNING_TEXT));
			}
		}
		assert.equal(warning, true);
	}
	assert.equal(f.model.dirty, false);
});
