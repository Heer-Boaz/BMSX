import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createSceneSourceFixture } from '../helpers/scene_sources';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { installSceneOutline, selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { layoutSceneEditor, measureSceneEditorMinimumWidth } from '../../ide/workbench/contrib/scene_editor/layout';
import { drawSceneEditor } from '../../ide/workbench/contrib/scene_editor/render';
import { workbenchListRowIndexAtPosition } from '../../ide/workbench/ui/list_view';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { api } from '../../ide/runtime/overlay_api';
import { HostOverlayQuadStream } from '../../machine/ts/render/host_overlay/quad_stream';
import { inputFocus } from '../../ide/input/focus';
import { SceneDetailsControl } from '../../ide/workbench/contrib/scene_editor/details_control';
import { layoutSceneDetails } from '../../ide/workbench/contrib/scene_editor/details_layout';
import { layoutSceneHierarchy } from '../../ide/workbench/contrib/scene_editor/hierarchy_layout';
import { drawSceneHierarchy } from '../../ide/workbench/contrib/scene_editor/hierarchy_render';
import type { SceneEditorViewState } from '../../ide/workbench/contrib/scene_editor/view_state';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { InputFocusScope } from '../../ide/input/focus';
import type { EditorCommandRunner } from '../../ide/common/commands';
import type { RectBounds } from '../../machine/ts/common/rect';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { captureSceneEditorView, restoreSceneEditorView } from '../../ide/workbench/contrib/scene_editor/view_snapshot';
import { mapSceneReading } from '../../ide/workbench/contrib/scene_editor/reading_snapshot';
import * as colors from '../../ide/common/constants';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';

function scene(t: TestContext, path = 'viewport.lua') {
	const { model, documents } = createSceneSourceFixture(t, SCENE_VIEWPORT_SOURCE, path);
	const input = new SceneEditorInput(model, documents);
	installSceneOutline(input.view.hierarchy);
	selectSceneOutlineRow(input.view.hierarchy, 1);
	return input;
}

// A focused layout fixture arranges the real sibling owners after the composition allocates them.
function arrangeScene(view: SceneEditorViewState, contentChanged: boolean, selectionChanged: boolean, bounds: RectBounds): boolean {
	const hierarchyRevision = view.hierarchy.outlineRevision;
	view.hierarchy.refresh();
	const hierarchyChanged = hierarchyRevision !== view.hierarchy.outlineRevision, detailsChanged = view.details.refresh();
	const changed = layoutSceneEditor(view, contentChanged, selectionChanged, bounds);
	const treeChanged = layoutSceneHierarchy(view.hierarchy, view.layout.hierarchyBounds, contentChanged || hierarchyChanged);
	const inspectorChanged = layoutSceneDetails(view.details, contentChanged || detailsChanged, view.layout.detailsBounds);
	return changed || treeChanged || inspectorChanged;
}

function detailsControl(t: TestContext, view: SceneEditorViewState) {
	const scope = new InputFocusScope(Symbol('layout inspector'), inputFocus.workbenchScope);
	const parent = inputFocus.createTarget(null, scope);
	const menu = new ContextMenuController(inputFocus, pointerCapture);
	const commands: EditorCommandRunner = {
		isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target),
	};
	const navigation = { isEnabled: () => true, run: () => assert.fail('layout/paint invoked navigation') };
	const control = new SceneDetailsControl(commands, menu, scope, parent, { outline: navigation, details: navigation });
	control.setView(view.details, view.layout.detailsBounds);
	t.after(() => { control.dispose(); menu.dispose(); inputFocus.setTarget(null); });
	return control;
}

for (const variant of ['tiny', 'msx'] as const) test(`Scene ${variant} responsive boundary uses measured columns and offset pane bounds`, t => {
	configureFontVariant(variant);
	const input = scene(t);
	t.after(() => { input.dispose(); });
	const threshold = 2 * (editorViewState.font.advance('M') * 24 + 8 + colors.SCROLLBAR_WIDTH) + 1;
	const bounds = { left: 37, top: 49, right: 37 + threshold - 1, bottom: 249 };
	arrangeScene(input.view, true, false, bounds);
	assert.equal(input.view.section, 'outline'); assert.equal(input.view.layout.mode, 'outline');
	assert.equal(input.view.layout.splitMinimumWidth, threshold);
	assert.equal(input.view.details.viewport.height, 0);
	assert.equal(input.view.details.viewport.bounds.right, input.view.details.viewport.bounds.left);
	for (const property of [...input.view.details.properties, ...input.view.details.optionProperties]) assert.equal(property.bounds.left, property.bounds.right, 'a hidden field has no horizontal hit area');
	const detailsAction = input.view.actionBar.items.find(item => item.command === 'sceneEditor.details')!;
	const outlineAction = input.view.actionBar.items.find(item => item.command === 'sceneEditor.outline')!;
	assert.equal(detailsAction.visible, true); assert.equal(detailsAction.icon, 'info');
	assert.equal(outlineAction.visible, false);
	input.view.section = 'details'; arrangeScene(input.view, false, false, bounds);
	assert.equal(input.view.layout.mode, 'details');
	assert.equal(input.view.hierarchy.outline.layout.contentRight, input.view.hierarchy.outline.layout.contentLeft);
	assert.equal(input.view.hierarchy.outline.layout.contentBottom, input.view.hierarchy.outline.layout.contentTop);
	assert.equal(workbenchListRowIndexAtPosition(input.view.hierarchy.outline, bounds.left + 5, bounds.top + 40), -1);
	assert.equal(detailsAction.visible, false); assert.equal(outlineAction.visible, true); assert.equal(outlineAction.icon, 'back');
	assert.equal(input.view.details.viewport.bounds.left, bounds.left);
	bounds.right += 1; arrangeScene(input.view, false, false, bounds);
	assert.equal(input.view.layout.mode, 'split'); assert.equal(input.view.section, 'details');
	assert.equal(input.view.layout.detailsLeft, bounds.left + (threshold >> 1));
	assert.equal(input.view.hierarchy.outline.layout.contentLeft, bounds.left + 4);
	assert.equal(input.view.hierarchy.outline.layout.contentRight, input.view.layout.detailsLeft - 4);
	assert.equal(input.view.details.viewport.bounds.left, input.view.layout.detailsLeft);
	assert.equal(input.view.details.viewport.bounds.right, bounds.right - colors.SCROLLBAR_WIDTH);
	assert.equal(detailsAction.visible, false); assert.equal(outlineAction.visible, false);
	bounds.right += 1; arrangeScene(input.view, false, false, bounds);
	assert.equal(input.view.layout.detailsLeft, bounds.left + ((threshold + 1) >> 1));
	assert.equal(input.view.layout.mode, 'split');
	assert.equal(input.workingCopy.buffer.getText(), SCENE_VIEWPORT_SOURCE); assert.equal(input.workingCopy.dirty, false);
});

test('a font change re-evaluates Scene composition without changing the retained compact section', t => {
	const input = scene(t); t.after(() => { input.dispose(); });
	const bounds = { left: 17, top: 31, right: 317, bottom: 200 };
	configureFontVariant('tiny');
	input.view.section = 'details'; arrangeScene(input.view, true, false, bounds);
	assert.equal(input.view.layout.mode, 'split');
	configureFontVariant('msx');
	arrangeScene(input.view, false, false, bounds);
	assert.equal(input.view.layout.mode, 'details'); assert.equal(input.view.section, 'details');
	assert.equal(input.view.hierarchy.outline.layout.visibleRowCount, 0);
	configureFontVariant('tiny');
	arrangeScene(input.view, false, false, bounds);
	assert.equal(input.view.layout.mode, 'split'); assert.equal(input.view.section, 'details');
});

test('presentation-only Scene transitions retain source, field draft and both scroll positions', t => {
	configureFontVariant('tiny');
	const input = scene(t); t.after(() => { input.dispose(); });
	const bounds = { left: 23, top: 37, right: 203, bottom: 72 };
	input.view.section = 'details'; arrangeScene(input.view, true, false, bounds);
	input.view.details.viewport.scrollbar.setScroll(43);
	const scroll = input.view.details.viewport.scrollTop;
	assert.ok(scroll > 0);
	const details = detailsControl(t, input.view);
	const options = details.options;
	const field = options.controls[0]; setFieldText(field.field, '0x123456', true);
	const draft = field.field.text;
	input.view.section = 'outline'; arrangeScene(input.view, false, false, bounds);
	input.view.hierarchy.outline.scroll = 1;
	arrangeScene(input.view, false, false, bounds);
	assert.equal(input.view.details.viewport.scrollTop, scroll);
	assert.equal(input.view.details.viewport.height, 0); assert.equal(field.pending, true);
	input.view.section = 'details'; arrangeScene(input.view, false, false, bounds);
	assert.equal(input.view.details.viewport.scrollTop, scroll); assert.equal(input.view.hierarchy.outline.scroll, 1);
	assert.equal(field.field.text, draft); assert.equal(field.pending, true);
	input.view.section = 'outline'; arrangeScene(input.view, false, false, bounds);
	assert.equal(input.view.hierarchy.outline.scroll, 1);
	assert.equal(input.workingCopy.buffer.getText(), SCENE_VIEWPORT_SOURCE); assert.equal(input.workingCopy.dirty, false);
});

test('a fresh Scene view restores its pending Details scroll after its first compact outline-only layout', t => {
	configureFontVariant('tiny');
	const old = scene(t); t.after(() => { old.dispose(); });
	const bounds = { left: 19, top: 33, right: 199, bottom: 68 };
	old.view.section = 'details'; arrangeScene(old.view, true, false, bounds);
	old.view.details.viewport.scrollbar.setScroll(47);
	const scroll = old.view.details.viewport.scrollTop; assert.ok(scroll > 0);
	old.view.section = 'outline'; arrangeScene(old.view, false, false, bounds);
	const snapshot = captureSceneEditorView(old.view);
	assert.equal(snapshot.section, 'outline'); assert.equal(snapshot.detailsScroll, scroll);
	const fresh = scene(t); t.after(() => { fresh.dispose(); });
	restoreSceneEditorView(fresh.view, snapshot);
	arrangeScene(fresh.view, true, false, bounds);
	assert.equal(fresh.view.layout.mode, 'outline'); assert.equal(fresh.view.details.viewport.height, 0);
	assert.equal(fresh.view.details.position, scroll);
	assert.deepEqual(captureSceneEditorView(fresh.view), snapshot, 'hidden-first layout cannot consume or replace the Details bookmark');
	fresh.view.hierarchy.outline.scroll = 1;
	arrangeScene(fresh.view, false, false, bounds);
	assert.equal(captureSceneEditorView(fresh.view).outlineScroll, 1,
		'the pending Details bookmark cannot replay an already-restored outline scroll');
	fresh.view.section = 'details'; arrangeScene(fresh.view, false, false, bounds);
	assert.equal(fresh.view.details.position, undefined); assert.equal(fresh.view.details.viewport.scrollTop, scroll);
	assert.equal(fresh.view.hierarchy.outline.selectionIndex, 1);
	assert.deepEqual(fresh.view.details.properties.map(property => property.descriptor.value), [11, -22, 33]);
	assert.equal(fresh.workingCopy.buffer.getText(), SCENE_VIEWPORT_SOURCE); assert.equal(fresh.workingCopy.dirty, false);
});

test('replacing selected Scene source with the same member name retires the Details view target', t => {
	configureFontVariant('tiny');
	const input = scene(t); t.after(() => { input.dispose(); });
	input.view.section = 'details';
	const snapshot = captureSceneEditorView(input.view), selected = snapshot.selected!;
	const originalLabel = input.view.hierarchy.outline.rows[input.view.hierarchy.outline.selectionIndex].element.label;
	const source = input.workingCopy.buffer.getText();
	const replacement = source.slice(selected.span.start, selected.span.end).replace('x = 11', 'x = 12');
	const changes = [{ offset: selected.span.start, deletedLength: selected.span.end - selected.span.start, insertedLength: replacement.length }];
	input.workingCopy.pushEditOperations([{ offset: selected.span.start, deleteLength: replacement.length, text: replacement }]);
	mapSceneReading(snapshot, changes);
	installSceneOutline(input.view.hierarchy);
	restoreSceneEditorView(input.view, snapshot);
	assert.equal(selected.span.start, selected.span.end, 'a complete replacement retires the tracked source occurrence');
	assert.ok(input.view.hierarchy.outline.rows.some(row => row.element.label === originalLabel), 'a same-named source occurrence still exists');
	assert.equal(input.view.hierarchy.outline.selectionIndex, -1);
	arrangeScene(input.view, true, false, { left: 0, top: 24, right: 180, bottom: 180 });
	assert.equal(input.view.details.projection.subject, undefined);
	assert.equal(input.view.details.viewport.contentHeight, 0);
	assert.equal(input.view.details.properties.length, 0);
	assert.equal(input.view.details.optionProperties.length, 0);
});

for (const variant of ['tiny', 'msx'] as const) test(`a long authored Scene basename retains compact navigation and More in a narrow ${variant} pane`, t => {
	configureFontVariant(variant);
	const input = scene(t, `scenes/${'long_authored_scene_'.repeat(12)}.lua`);
	const width = variant === 'tiny' ? 78 : 118;
	arrangeScene(input.view, true, false, { left: 0, top: 24, right: width, bottom: 276 });
	const bar = input.view.actionBar, layout = input.view.layout, more = bar.overflow!.button;
	assert.equal(more.visible, true); assert.ok(more.bounds.right - more.bounds.left >= 13);
	assert.ok(more.bounds.left >= layout.left + 4 && more.bounds.right <= layout.right - 4);
	assert.ok(editorViewState.font.measure(input.view.sourceText) <= layout.sourceBounds.right - layout.sourceBounds.left);
	assert.equal(layout.mode, 'outline');
	assert.ok(editorViewState.font.measure(layout.outlineTitle) <= layout.right - layout.left - 8);
	assert.equal(layout.detailsTitle, '');
	assert.equal(input.view.details.viewport.bounds.right, input.view.details.viewport.bounds.left);
	assert.equal(input.view.details.viewport.bounds.bottom, input.view.details.viewport.bounds.top);
	assert.equal(bar.items.find(item => item.command === 'sceneEditor.details')!.visible, true);
	assert.equal(bar.items.find(item => item.command === 'sceneEditor.outline')!.visible, false);
	assert.equal(input.workingCopy.resource.path, `scenes/${'long_authored_scene_'.repeat(12)}.lua`);
	input.dispose();
});

for (const font of ['tiny', 'msx'] as const) for (const width of [256, 384]) {
	test(`scene details measure and scroll in ${font}, ${width}px, independent of pane height`, t => {
		configureFontVariant(font);
		editorViewState.viewportWidth = width; editorViewState.viewportHeight = 288;
		editorViewState.editorAreaTop = 31; editorViewState.editorAreaBottom = 275;
		const input = scene(t); input.view.section = 'details';
		t.after(() => { input.dispose(); });
		arrangeScene(input.view, true, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
		assert.deepEqual(input.view.details.properties.map(property => property.descriptor.value), [11, -22, 33]);
		const height = input.view.details.viewport.contentHeight;
		assert.ok(height > 0);
		for (const line of input.view.details.detailsText) assert.ok(editorViewState.font.measure(line.text) <= input.view.details.viewport.bounds.right - input.view.details.viewport.bounds.left - 8);
		editorViewState.editorAreaBottom = 120;
		assert.equal(arrangeScene(input.view, false, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom }), true);
		assert.equal(input.view.details.viewport.contentHeight, height, 'content extent is independent of viewport height');
		assert.equal(input.view.details.viewport.scrollbar.isVisible(), true);
		const row = input.view.details.properties[2];
		input.view.details.viewport.scrollbar.reveal(row.contentBounds.top, row.contentBounds.bottom, 2);
		arrangeScene(input.view, false, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
		assert.ok(row.bounds.top >= input.view.details.viewport.bounds.top && row.bounds.bottom <= input.view.details.viewport.bounds.bottom);
		const option = input.view.details.optionProperties.at(-1)!;
		input.view.details.viewport.scrollbar.reveal(option.contentBounds.top, option.contentBounds.bottom, 2);
		arrangeScene(input.view, false, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
		assert.ok(option.bounds.top >= input.view.details.viewport.bounds.top && option.bounds.bottom <= input.view.details.viewport.bounds.bottom);
		const runs = input.view.details.detailsText.slice();
		const contentBounds = row.contentBounds;
		const screenBounds = row.bounds;
		const revision = input.view.details.viewport.revision;
		const advance = t.mock.method(editorViewState.font, 'advance', () => assert.fail('scroll/stable layout remeasured text'));
		input.view.details.viewport.scrollbar.setScroll(height); arrangeScene(input.view, false, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
		const note = input.view.details.detailsText.at(-1)!;
		assert.ok(input.view.details.viewport.offsetTop + note.top + editorViewState.lineHeight <= input.view.details.viewport.bounds.bottom);
		for (let index = 0; index < 100; index += 1) assert.equal(arrangeScene(input.view, false, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom }), false);
		advance.mock.restore();
		assert.deepEqual(input.view.details.detailsText, runs); assert.equal(input.view.details.detailsText[0], runs[0]);
		assert.equal(input.view.details.viewport.revision, revision); assert.equal(row.contentBounds, contentBounds); assert.equal(row.bounds, screenBounds);
		const tree = input.view.hierarchy.outline.layout;
		assert.equal(workbenchListRowIndexAtPosition(input.view.hierarchy.outline, tree.contentLeft, tree.contentBottom), -1);
		editorViewState.editorAreaBottom = editorViewState.editorAreaTop; arrangeScene(input.view, false, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
		assert.equal(input.view.details.viewport.height, 0); assert.equal(input.view.details.viewport.scrollbar.isVisible(), false);
		assert.equal(input.view.hierarchy.outline.layout.visibleRowCount, 0);
		editorViewState.editorAreaBottom = 275; arrangeScene(input.view, false, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
		selectSceneOutlineRow(input.view.hierarchy, 2); arrangeScene(input.view, false, true, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
		assert.deepEqual(input.view.details.properties.map(property => property.descriptor.value), [null, 2, null]);
		selectSceneOutlineRow(input.view.hierarchy, 0); arrangeScene(input.view, false, true, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
		assert.ok(input.view.details.viewport.contentHeight < height);
		selectSceneOutlineRow(input.view.hierarchy, -1); arrangeScene(input.view, false, true, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
		assert.equal(input.view.details.projection.subject, undefined);
		assert.equal(input.view.details.viewport.contentHeight, 0); assert.equal(input.view.details.viewport.scrollTop, 0);
		assert.equal(input.view.details.detailsText.length, 0); assert.equal(input.view.details.properties.length, 0);
		assert.equal(input.workingCopy.dirty, false, 'layout, scroll and selection do not edit source');
	});
}

test('scene painting publishes nested content clips and reuses quad storage on stable frames', t => {
	configureFontVariant('tiny');
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	editorViewState.editorAreaTop = 31; editorViewState.editorAreaBottom = 98;
	const input = scene(t); arrangeScene(input.view, true, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom });
	const details = detailsControl(t, input.view);
	t.after(() => input.dispose());
	const overlay = createHostOverlayFixture(384, 288); const stream = new HostOverlayQuadStream();
	const draw = () => {
		details.layout(input.view.layout.detailsBounds);
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		drawSceneEditor(input.view); drawSceneHierarchy(input.view.hierarchy, false); details.draw(); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(); stream.reset(384, 288);
		for (let index = 0; index < frame.commandCount; index += 1) stream.appendEntry(frame.commandKinds[index], frame.commandRefs[index]);
		return frame;
	};
	draw(); const storage = stream.floatData;
	assert.ok(stream.batches.slice(0, stream.batchCount).some(batch => batch.clip.left === input.view.details.viewport.bounds.left && batch.clip.top === input.view.details.viewport.bounds.top));
	for (let index = 0; index < stream.batchCount; index += 1) {
		const end = index + 1 < stream.batchCount ? stream.batches[index + 1].start : stream.count;
		if (end > stream.batches[index].start) assert.ok(stream.batches[index].clip.bottom <= 98);
	}
	for (let index = 0; index < 100; index += 1) draw();
	assert.equal(stream.floatData, storage);
	input.view.details.viewport.scrollbar.setScroll(input.view.details.viewport.contentHeight); arrangeScene(input.view, false, false, { left: 0, top: editorViewState.editorAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.editorAreaBottom }); draw();
	const text = input.view.details.detailsText[0];
	const theme = colors.getActiveIdeThemeVariant();
	t.after(() => colors.setIdeThemeVariant(theme));
	for (const variant of ['dark', 'light']) {
		colors.setIdeThemeVariant(variant);
		const frame = draw();
		let warning = false;
		for (let index = 0; index < frame.commandCount; index += 1) {
			if (frame.commandKinds[index] !== Host2DKind.Glyphs) continue;
			const glyphs = frame.commandRefs[index] as GlyphRenderSubmission;
			if (input.view.details.detailsText.some(line => line.warning && glyphs.items === line.text)) {
				warning = true;
				assert.equal(glyphs.color, resolveThemeTokenColor(colors.COLOR_CONTENT_WARNING_TEXT));
			}
		}
		assert.equal(warning, true);
		assert.equal(input.view.details.detailsText[0], text, 'theme changes do not remeasure content or retain an obsolete palette token');
	}
	assert.equal(input.workingCopy.dirty, false);
});

test('Scene intrinsic compact minimum uses current font before arrangement and does not demand its internal split', t => {
	configureFontVariant('tiny');
	const input = scene(t); t.after(() => { input.dispose(); });
	const bounds = { left: 17, top: 31, right: 717, bottom: 231 };
	input.view.section = 'details'; arrangeScene(input.view, true, false, bounds);
	const tiny = measureSceneEditorMinimumWidth(), arrangedFont = input.view.layout.font;
	assert.equal(input.view.layout.splitMinimumWidth, tiny * 2 + 1);
	configureFontVariant('msx');
	const msx = measureSceneEditorMinimumWidth();
	assert.ok(msx > tiny); assert.equal(input.view.layout.font, arrangedFont); assert.equal(input.view.section, 'details');
	bounds.right = bounds.left + msx; arrangeScene(input.view, false, false, bounds);
	assert.equal(input.view.layout.mode, 'details');
	assert.equal(input.view.details.viewport.bounds.right - input.view.details.viewport.bounds.left, msx - colors.SCROLLBAR_WIDTH);
	const advance = t.mock.method(editorViewState.font, 'advance');
	for (let frame = 0; frame < 1000; frame++) assert.equal(measureSceneEditorMinimumWidth(), msx);
	assert.equal(advance.mock.callCount(), 0);
});
