import assert from 'node:assert/strict';
import test from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { buildSceneSourceDocument } from '../../ide/workbench/contrib/scene_editor/source';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { installSceneOutline, selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { layoutSceneEditor } from '../../ide/workbench/contrib/scene_editor/layout';
import { drawSceneEditor } from '../../ide/workbench/contrib/scene_editor/render';
import { workbenchListRowIndexAtPosition } from '../../ide/workbench/ui/list_view';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { api } from '../../ide/runtime/overlay_api';
import { HostOverlayQuadStream } from '../../machine/ts/render/host_overlay/quad_stream';
import { IntegerInput } from '../../ide/editor/ui/inline/integer_input';
import { inputFocus } from '../../ide/input/focus';
import * as colors from '../../ide/common/constants';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';

function scene() {
	const path = 'viewport.lua';
	const model = new EditorTextModel({ domain: 0, path, source: { resid: 'viewport', type: 'lua' } }, 'lua', SCENE_VIEWPORT_SOURCE);
	const input = new SceneEditorInput(model);
	installSceneOutline(input, buildSceneSourceDocument(model.resource, buildLuaFileSemanticData(SCENE_VIEWPORT_SOURCE, path)));
	selectSceneOutlineRow(input, 1);
	return input;
}

for (const font of ['tiny', 'msx'] as const) for (const width of [256, 384]) {
	test(`scene details measure and scroll in ${font}, ${width}px, independent of pane height`, t => {
		configureFontVariant(new VirtualHeadlessClock(), font, null);
		editorViewState.viewportWidth = width; editorViewState.viewportHeight = 288;
		editorViewState.codeAreaTop = 31; editorViewState.codeAreaBottom = 275;
		const input = scene(); layoutSceneEditor(input, true);
		assert.deepEqual(input.properties.map(property => property.value), [11, -22, 33]);
		const height = input.details.contentHeight;
		assert.ok(height > 0);
		for (const line of input.detailsText) assert.ok(editorViewState.font.measure(line.text) <= input.details.bounds.right - input.details.bounds.left - 8);
		editorViewState.codeAreaBottom = 120;
		assert.equal(layoutSceneEditor(input, false), true);
		assert.equal(input.details.contentHeight, height, 'content extent is independent of viewport height');
		assert.equal(input.details.scrollbar.isVisible(), true);
		const row = input.properties[2];
		input.details.scrollbar.reveal(row.contentBounds.top, row.contentBounds.bottom, 2);
		layoutSceneEditor(input, false);
		assert.ok(row.bounds.top >= input.details.bounds.top && row.bounds.bottom <= input.details.bounds.bottom);
		const runs = input.detailsText.slice();
		const contentBounds = row.contentBounds;
		const screenBounds = row.bounds;
		const revision = input.details.revision;
		const advance = t.mock.method(editorViewState.font, 'advance', () => assert.fail('scroll/stable layout remeasured text'));
		input.details.scrollbar.setScroll(height); layoutSceneEditor(input, false);
		const note = input.detailsText.at(-1)!;
		assert.ok(input.details.offsetTop + note.top + editorViewState.lineHeight <= input.details.bounds.bottom);
		for (let index = 0; index < 100; index += 1) assert.equal(layoutSceneEditor(input, false), false);
		advance.mock.restore();
		assert.deepEqual(input.detailsText, runs); assert.equal(input.detailsText[0], runs[0]);
		assert.equal(input.details.revision, revision); assert.equal(row.contentBounds, contentBounds); assert.equal(row.bounds, screenBounds);
		const tree = input.outline.layout;
		assert.equal(workbenchListRowIndexAtPosition(input.outline, tree.contentLeft, tree.contentBottom), -1);
		editorViewState.codeAreaBottom = editorViewState.codeAreaTop; layoutSceneEditor(input, false);
		assert.equal(input.details.height, 0); assert.equal(input.details.scrollbar.isVisible(), false);
		assert.equal(input.outline.layout.visibleRowCount, 0);
		editorViewState.codeAreaBottom = 275; layoutSceneEditor(input, false);
		selectSceneOutlineRow(input, 2); layoutSceneEditor(input, false, true);
		assert.deepEqual(input.properties.map(property => property.value), [null, 2, null]);
		selectSceneOutlineRow(input, 0); layoutSceneEditor(input, false, true);
		assert.ok(input.details.contentHeight < height);
		selectSceneOutlineRow(input, -1); layoutSceneEditor(input, false, true);
		assert.equal(input.details.contentHeight, 0); assert.equal(input.details.scrollTop, 0); assert.equal(input.detailsText.length, 0);
		assert.equal(input.workingCopy.dirty, false, 'layout, scroll and selection do not edit source');
	});
}

test('scene painting publishes nested content clips and reuses quad storage on stable frames', t => {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	editorViewState.codeAreaTop = 31; editorViewState.codeAreaBottom = 98;
	const input = scene(); layoutSceneEditor(input, true);
	const parent = inputFocus.createTarget();
	const controls = input.properties.map(property => {
		const field = new IntegerInput(parent, { text: '', isSupported: () => false, writeText: async () => {} }, () => assert.fail('paint accepted a value'));
		field.setValue(property.value!); return field;
	});
	t.after(() => { for (const control of controls) control.dispose(); });
	const overlay = createHostOverlayFixture(384, 288); const stream = new HostOverlayQuadStream();
	const commands = { isEnabled: () => true };
	const draw = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		drawSceneEditor(input, controls, commands, true); overlay.renderer.endFrame();
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
	input.details.scrollbar.setScroll(input.details.contentHeight); layoutSceneEditor(input, false); draw();
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
				assert.equal(glyphs.color, resolveThemeTokenColor(colors.COLOR_STATUS_WARNING));
			}
		}
		assert.equal(warning, true);
		assert.equal(input.detailsText[0], text, 'theme changes do not remeasure content or retain an obsolete palette token');
	}
	assert.equal(input.workingCopy.dirty, false);
});
