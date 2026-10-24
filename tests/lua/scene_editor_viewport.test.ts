import assert from 'node:assert/strict';
import test from 'node:test';
import { semanticSnapshot } from './semantic_test_harness';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { buildSceneSourceDocument } from '../../ide/workbench/contrib/scene_editor/source';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { installSceneOutline, selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { layoutSceneEditor, measureSceneEditorMinimumWidth } from '../../ide/workbench/contrib/scene_editor/layout';
import { drawSceneEditor } from '../../ide/workbench/contrib/scene_editor/render';
import { workbenchListRowIndexAtPosition } from '../../ide/workbench/ui/list_view';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { api } from '../../ide/runtime/overlay_api';
import { HostOverlayQuadStream } from '../../machine/ts/render/host_overlay/quad_stream';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { inputFocus } from '../../ide/input/focus';
import { SceneOptionEditor } from '../../ide/workbench/contrib/scene_editor/option_editor';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { captureSceneEditorView, mapSceneEditorView, restoreSceneEditorView } from '../../ide/workbench/contrib/scene_editor/view_snapshot';
import * as colors from '../../ide/common/constants';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';

function scene(path = 'viewport.lua') {
	const model = new EditorTextModel({ domain: 0, path, source: { resid: 'viewport', type: 'lua' } }, 'lua', SCENE_VIEWPORT_SOURCE);
	const input = new SceneEditorInput(model);
	installSceneOutline(input, buildSceneSourceDocument(model.resource, semanticSnapshot(buildLuaFileSemanticData(SCENE_VIEWPORT_SOURCE, path))));
	selectSceneOutlineRow(input, 1);
	return input;
}

for (const variant of ['tiny', 'msx'] as const) test(`Scene ${variant} responsive boundary uses measured columns and offset pane bounds`, t => {
	configureFontVariant(new VirtualHeadlessClock(), variant, null);
	const input = scene();
	t.after(() => { input.dispose(); input.workingCopy.dispose(); });
	const threshold = 2 * (editorViewState.font.advance('M') * 24 + 8 + colors.SCROLLBAR_WIDTH) + 1;
	const bounds = { left: 37, top: 49, right: 37 + threshold - 1, bottom: 249 };
	layoutSceneEditor(input, true, false, bounds);
	assert.equal(input.section, 'outline'); assert.equal(input.layout.mode, 'outline');
	assert.equal(input.layout.splitMinimumWidth, threshold);
	assert.equal(input.details.height, 0);
	assert.equal(input.details.bounds.right, input.details.bounds.left);
	for (const property of [...input.properties, ...input.optionProperties]) assert.deepEqual(property.bounds, { left: 0, top: 0, right: 0, bottom: 0 });
	const detailsAction = input.actionBar.items.find(item => item.command === 'sceneEditor.details')!;
	const outlineAction = input.actionBar.items.find(item => item.command === 'sceneEditor.outline')!;
	assert.equal(detailsAction.visible, true); assert.equal(detailsAction.icon, 'info');
	assert.equal(outlineAction.visible, false);
	input.section = 'details'; layoutSceneEditor(input, false, false, bounds);
	assert.equal(input.layout.mode, 'details');
	assert.equal(input.outline.layout.contentRight, input.outline.layout.contentLeft);
	assert.equal(input.outline.layout.contentBottom, input.outline.layout.contentTop);
	assert.equal(workbenchListRowIndexAtPosition(input.outline, bounds.left + 5, bounds.top + 40), -1);
	assert.equal(detailsAction.visible, false); assert.equal(outlineAction.visible, true); assert.equal(outlineAction.icon, 'back');
	assert.equal(input.details.bounds.left, bounds.left);
	bounds.right += 1; layoutSceneEditor(input, false, false, bounds);
	assert.equal(input.layout.mode, 'split'); assert.equal(input.section, 'details');
	assert.equal(input.layout.detailsLeft, bounds.left + (threshold >> 1));
	assert.equal(input.outline.layout.contentLeft, bounds.left + 4);
	assert.equal(input.outline.layout.contentRight, input.layout.detailsLeft - 4);
	assert.equal(input.details.bounds.left, input.layout.detailsLeft);
	assert.equal(input.details.bounds.right, bounds.right - colors.SCROLLBAR_WIDTH);
	assert.equal(detailsAction.visible, false); assert.equal(outlineAction.visible, false);
	bounds.right += 1; layoutSceneEditor(input, false, false, bounds);
	assert.equal(input.layout.detailsLeft, bounds.left + ((threshold + 1) >> 1));
	assert.equal(input.layout.mode, 'split');
	assert.equal(input.workingCopy.buffer.getText(), SCENE_VIEWPORT_SOURCE); assert.equal(input.workingCopy.dirty, false);
});

test('a font change re-evaluates Scene composition without changing the retained compact section', t => {
	const input = scene(); t.after(() => { input.dispose(); input.workingCopy.dispose(); });
	const bounds = { left: 17, top: 31, right: 317, bottom: 200 };
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	input.section = 'details'; layoutSceneEditor(input, true, false, bounds);
	assert.equal(input.layout.mode, 'split');
	configureFontVariant(new VirtualHeadlessClock(), 'msx', null);
	layoutSceneEditor(input, false, false, bounds);
	assert.equal(input.layout.mode, 'details'); assert.equal(input.section, 'details');
	assert.equal(input.outline.layout.visibleRowCount, 0);
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	layoutSceneEditor(input, false, false, bounds);
	assert.equal(input.layout.mode, 'split'); assert.equal(input.section, 'details');
});

test('presentation-only Scene transitions retain source, field draft and both scroll positions', t => {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	const input = scene(); t.after(() => { input.dispose(); input.workingCopy.dispose(); });
	const bounds = { left: 23, top: 37, right: 203, bottom: 72 };
	input.section = 'details'; layoutSceneEditor(input, true, false, bounds);
	input.details.scrollbar.setScroll(43);
	const scroll = input.details.scrollTop;
	assert.ok(scroll > 0);
	const parent = inputFocus.createTarget();
	const options = new SceneOptionEditor(parent, () => assert.fail('layout committed a field'), () => {}, {
		outline: { isEnabled: () => true, run: () => { input.section = 'outline'; } },
		details: { isEnabled: () => true, run: () => { input.section = 'details'; } },
	});
	options.bind(input); t.after(() => options.clear());
	const field = options.controls[0]; setFieldText(field.field, '0x123456', true);
	const draft = field.field.text;
	input.section = 'outline'; layoutSceneEditor(input, false, false, bounds);
	input.outline.scroll = 1;
	layoutSceneEditor(input, false, false, bounds);
	assert.equal(input.details.scrollTop, scroll);
	assert.equal(input.details.height, 0); assert.equal(field.pending, true);
	input.section = 'details'; layoutSceneEditor(input, false, false, bounds);
	assert.equal(input.details.scrollTop, scroll); assert.equal(input.outline.scroll, 1);
	assert.equal(field.field.text, draft); assert.equal(field.pending, true);
	input.section = 'outline'; layoutSceneEditor(input, false, false, bounds);
	assert.equal(input.outline.scroll, 1);
	assert.equal(input.workingCopy.buffer.getText(), SCENE_VIEWPORT_SOURCE); assert.equal(input.workingCopy.dirty, false);
});

test('a fresh Scene view restores its pending Details scroll after its first compact outline-only layout', t => {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	const old = scene(); t.after(() => { old.dispose(); old.workingCopy.dispose(); });
	const bounds = { left: 19, top: 33, right: 199, bottom: 68 };
	old.section = 'details'; layoutSceneEditor(old, true, false, bounds);
	old.details.scrollbar.setScroll(47);
	const scroll = old.details.scrollTop; assert.ok(scroll > 0);
	old.section = 'outline'; layoutSceneEditor(old, false, false, bounds);
	const snapshot = captureSceneEditorView(old);
	assert.equal(snapshot.section, 'outline'); assert.equal(snapshot.detailsScroll, scroll);
	const fresh = scene(); t.after(() => { fresh.dispose(); fresh.workingCopy.dispose(); });
	restoreSceneEditorView(fresh, snapshot);
	layoutSceneEditor(fresh, true, false, bounds);
	assert.equal(fresh.layout.mode, 'outline'); assert.equal(fresh.details.height, 0);
	assert.equal(fresh.position!.detailsScroll, scroll);
	assert.deepEqual(captureSceneEditorView(fresh), snapshot, 'hidden-first layout cannot consume or replace the Details bookmark');
	fresh.outline.scroll = 1;
	layoutSceneEditor(fresh, false, false, bounds);
	assert.equal(captureSceneEditorView(fresh).outlineScroll, 1,
		'the pending Details bookmark cannot replay an already-restored outline scroll');
	fresh.section = 'details'; layoutSceneEditor(fresh, false, false, bounds);
	assert.equal(fresh.position, undefined); assert.equal(fresh.details.scrollTop, scroll);
	assert.equal(fresh.outline.selectionIndex, 1);
	assert.deepEqual(fresh.properties.map(property => property.value), [11, -22, 33]);
	assert.equal(fresh.workingCopy.buffer.getText(), SCENE_VIEWPORT_SOURCE); assert.equal(fresh.workingCopy.dirty, false);
});

test('replacing selected Scene source with the same member name retires the Details view target', t => {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	const input = scene(); t.after(() => { input.dispose(); input.workingCopy.dispose(); });
	input.section = 'details';
	const snapshot = captureSceneEditorView(input), selected = snapshot.selected!;
	const originalLabel = input.outline.rows[input.outline.selectionIndex].element.label;
	const source = input.workingCopy.buffer.getText();
	const replacement = source.slice(selected.span.start, selected.span.end).replace('x = 11', 'x = 12');
	const changes = [{ offset: selected.span.start, deletedLength: selected.span.end - selected.span.start, insertedLength: replacement.length }];
	input.workingCopy.pushEditOperations([{ offset: selected.span.start, deleteLength: replacement.length, text: replacement }]);
	mapSceneEditorView(snapshot, changes);
	const text = input.workingCopy.buffer.getText();
	installSceneOutline(input, buildSceneSourceDocument(input.workingCopy.resource, semanticSnapshot(buildLuaFileSemanticData(text, input.workingCopy.resource.path))));
	restoreSceneEditorView(input, snapshot);
	assert.equal(selected.span.start, selected.span.end, 'a complete replacement retires the tracked source occurrence');
	assert.ok(input.outline.rows.some(row => row.element.label === originalLabel), 'a same-named source occurrence still exists');
	assert.equal(input.outline.selectionIndex, -1); assert.equal(input.section, 'outline');
	layoutSceneEditor(input, true, false, { left: 0, top: 24, right: 180, bottom: 180 });
	assert.equal(input.layout.mode, 'outline'); assert.equal(input.details.height, 0);
});

for (const variant of ['tiny', 'msx'] as const) test(`a long authored Scene basename retains compact navigation and More in a narrow ${variant} pane`, () => {
	configureFontVariant(new VirtualHeadlessClock(), variant, null);
	const input = scene(`scenes/${'long_authored_scene_'.repeat(12)}.lua`);
	const width = variant === 'tiny' ? 78 : 118;
	layoutSceneEditor(input, true, false, { left: 0, top: 24, right: width, bottom: 276 });
	const bar = input.actionBar, layout = input.layout, more = bar.overflow!.button;
	assert.equal(more.visible, true); assert.ok(more.bounds.right - more.bounds.left >= 13);
	assert.ok(more.bounds.left >= layout.left + 4 && more.bounds.right <= layout.right - 4);
	assert.ok(editorViewState.font.measure(input.sourceText) <= layout.sourceBounds.right - layout.sourceBounds.left);
	assert.equal(layout.mode, 'outline');
	assert.ok(editorViewState.font.measure(layout.outlineTitle) <= layout.right - layout.left - 8);
	assert.equal(layout.detailsTitle, '');
	assert.equal(input.details.bounds.right, input.details.bounds.left);
	assert.equal(input.details.bounds.bottom, input.details.bounds.top);
	assert.equal(bar.items.find(item => item.command === 'sceneEditor.details')!.visible, true);
	assert.equal(bar.items.find(item => item.command === 'sceneEditor.outline')!.visible, false);
	assert.equal(input.workingCopy.resource.path, `scenes/${'long_authored_scene_'.repeat(12)}.lua`);
	input.dispose(); input.workingCopy.dispose();
});

for (const font of ['tiny', 'msx'] as const) for (const width of [256, 384]) {
	test(`scene details measure and scroll in ${font}, ${width}px, independent of pane height`, t => {
		configureFontVariant(new VirtualHeadlessClock(), font, null);
		editorViewState.viewportWidth = width; editorViewState.viewportHeight = 288;
		editorViewState.codeAreaTop = 31; editorViewState.codeAreaBottom = 275;
		const input = scene(); input.section = 'details';
		t.after(() => { input.dispose(); input.workingCopy.dispose(); });
		layoutSceneEditor(input, true, false, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom });
		assert.deepEqual(input.properties.map(property => property.value), [11, -22, 33]);
		const height = input.details.contentHeight;
		assert.ok(height > 0);
		for (const line of input.detailsText) assert.ok(editorViewState.font.measure(line.text) <= input.details.bounds.right - input.details.bounds.left - 8);
		editorViewState.codeAreaBottom = 120;
		assert.equal(layoutSceneEditor(input, false, false, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom }), true);
		assert.equal(input.details.contentHeight, height, 'content extent is independent of viewport height');
		assert.equal(input.details.scrollbar.isVisible(), true);
		const row = input.properties[2];
		input.details.scrollbar.reveal(row.contentBounds.top, row.contentBounds.bottom, 2);
		layoutSceneEditor(input, false, false, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom });
		assert.ok(row.bounds.top >= input.details.bounds.top && row.bounds.bottom <= input.details.bounds.bottom);
		const option = input.optionProperties.at(-1)!;
		input.details.scrollbar.reveal(option.contentBounds.top, option.contentBounds.bottom, 2);
		layoutSceneEditor(input, false, false, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom });
		assert.ok(option.bounds.top >= input.details.bounds.top && option.bounds.bottom <= input.details.bounds.bottom);
		const runs = input.detailsText.slice();
		const contentBounds = row.contentBounds;
		const screenBounds = row.bounds;
		const revision = input.details.revision;
		const advance = t.mock.method(editorViewState.font, 'advance', () => assert.fail('scroll/stable layout remeasured text'));
		input.details.scrollbar.setScroll(height); layoutSceneEditor(input, false, false, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom });
		const note = input.detailsText.at(-1)!;
		assert.ok(input.details.offsetTop + note.top + editorViewState.lineHeight <= input.details.bounds.bottom);
		for (let index = 0; index < 100; index += 1) assert.equal(layoutSceneEditor(input, false, false, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom }), false);
		advance.mock.restore();
		assert.deepEqual(input.detailsText, runs); assert.equal(input.detailsText[0], runs[0]);
		assert.equal(input.details.revision, revision); assert.equal(row.contentBounds, contentBounds); assert.equal(row.bounds, screenBounds);
		const tree = input.outline.layout;
		assert.equal(workbenchListRowIndexAtPosition(input.outline, tree.contentLeft, tree.contentBottom), -1);
		editorViewState.codeAreaBottom = editorViewState.codeAreaTop; layoutSceneEditor(input, false, false, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom });
		assert.equal(input.details.height, 0); assert.equal(input.details.scrollbar.isVisible(), false);
		assert.equal(input.outline.layout.visibleRowCount, 0);
		editorViewState.codeAreaBottom = 275; layoutSceneEditor(input, false, false, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom });
		selectSceneOutlineRow(input, 2); layoutSceneEditor(input, false, true, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom });
		assert.deepEqual(input.properties.map(property => property.value), [null, 2, null]);
		selectSceneOutlineRow(input, 0); layoutSceneEditor(input, false, true, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom });
		assert.ok(input.details.contentHeight < height);
		selectSceneOutlineRow(input, -1); layoutSceneEditor(input, false, true, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom });
		if (input.layout.mode === 'split') {
			assert.equal(input.details.contentHeight, 0); assert.equal(input.details.scrollTop, 0); assert.equal(input.detailsText.length, 0);
		} else {
			assert.equal(input.layout.mode, 'outline');
			assert.equal(input.details.height, 0);
			for (const property of input.properties) assert.deepEqual(property.bounds, { left: 0, top: 0, right: 0, bottom: 0 });
		}
		assert.equal(input.workingCopy.dirty, false, 'layout, scroll and selection do not edit source');
	});
}

test('scene painting publishes nested content clips and reuses quad storage on stable frames', t => {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	editorViewState.codeAreaTop = 31; editorViewState.codeAreaBottom = 98;
	const input = scene(); layoutSceneEditor(input, true, false, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom });
	const parent = inputFocus.createTarget();
	const controls = input.properties.map(property => {
		const field = new ValueInput(parent, INTEGER_INPUT_FORMAT, () => assert.fail('paint accepted a value'));
		field.setValue(property.value!); return field;
	});
	const options = new SceneOptionEditor(parent, () => assert.fail('paint committed source'), () => {}, {
		outline: { isEnabled: () => true, run: () => assert.fail('paint invoked outline navigation') },
		details: { isEnabled: () => true, run: () => assert.fail('paint invoked details navigation') },
	});
	options.bind(input);
	for (let index = 0; index < controls.length; index++) {
		const bounds = input.properties[index].bounds;
		controls[index].layout(bounds.right - bounds.left);
	}
	for (let index = 0; index < options.controls.length; index++) {
		const bounds = input.optionProperties[index].bounds;
		options.controls[index].layout(bounds.right - bounds.left);
	}
	t.after(() => { for (const control of controls) control.dispose(); options.clear(); });
	const overlay = createHostOverlayFixture(384, 288); const stream = new HostOverlayQuadStream();
	const draw = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		drawSceneEditor(input, controls, options.controls, false, true); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(); stream.reset(384, 288);
		for (let index = 0; index < frame.commandCount; index += 1) stream.appendEntry(frame.commandKinds[index], frame.commandRefs[index]);
		return frame;
	};
	draw(); const storage = stream.floatData;
	assert.ok(stream.batches.slice(0, stream.batchCount).some(batch => batch.clip.left === input.details.bounds.left && batch.clip.top === input.details.bounds.top));
	for (let index = 0; index < stream.batchCount; index += 1) {
		const end = index + 1 < stream.batchCount ? stream.batches[index + 1].start : stream.count;
		if (end > stream.batches[index].start) assert.ok(stream.batches[index].clip.bottom <= 98);
	}
	for (let index = 0; index < 100; index += 1) draw();
	assert.equal(stream.floatData, storage);
	input.details.scrollbar.setScroll(input.details.contentHeight); layoutSceneEditor(input, false, false, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom }); draw();
	const text = input.detailsText[0];
	const theme = colors.getActiveIdeThemeVariant();
	t.after(() => colors.setIdeThemeVariant(theme));
	for (const variant of ['dark', 'light']) {
		colors.setIdeThemeVariant(variant);
		const frame = draw();
		let warning = false;
		for (let index = 0; index < frame.commandCount; index += 1) {
			if (frame.commandKinds[index] !== Host2DKind.Glyphs) continue;
			const glyphs = frame.commandRefs[index] as GlyphRenderSubmission;
			if (glyphs.items === 'DEFINITION ONLY') {
				warning = true;
				assert.equal(glyphs.color, resolveThemeTokenColor(colors.COLOR_CONTENT_WARNING_TEXT));
			}
		}
		assert.equal(warning, true);
		assert.equal(input.detailsText[0], text, 'theme changes do not remeasure content or retain an obsolete palette token');
	}
	assert.equal(input.workingCopy.dirty, false);
});

test('Scene intrinsic compact minimum uses current font before arrangement and does not demand its internal split', t => {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	const input = scene(); t.after(() => { input.dispose(); input.workingCopy.dispose(); });
	const bounds = { left: 17, top: 31, right: 717, bottom: 231 };
	input.section = 'details'; layoutSceneEditor(input, true, false, bounds);
	const tiny = measureSceneEditorMinimumWidth(), arrangedFont = input.layout.font;
	assert.equal(input.layout.splitMinimumWidth, tiny * 2 + 1);
	configureFontVariant(new VirtualHeadlessClock(), 'msx', null);
	const msx = measureSceneEditorMinimumWidth();
	assert.ok(msx > tiny); assert.equal(input.layout.font, arrangedFont); assert.equal(input.section, 'details');
	bounds.right = bounds.left + msx; layoutSceneEditor(input, false, false, bounds);
	assert.equal(input.layout.mode, 'details');
	assert.equal(input.details.bounds.right - input.details.bounds.left, msx - colors.SCROLLBAR_WIDTH);
	const advance = t.mock.method(editorViewState.font, 'advance');
	for (let frame = 0; frame < 1000; frame++) assert.equal(measureSceneEditorMinimumWidth(), msx);
	assert.equal(advance.mock.callCount(), 0);
});
