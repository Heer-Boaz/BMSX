import assert from 'node:assert/strict';
import test from 'node:test';
import * as colors from '../../ide/common/constants';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { inputFocus } from '../../ide/input/focus';
import { api } from '../../ide/runtime/overlay_api';
import { resolveRuntimeResource } from '../../ide/runtime/sources';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';
import { AnimationEditorController } from '../../ide/workbench/contrib/animation/controller';
import { AnimationEditorInput } from '../../ide/workbench/contrib/animation/editor_input';
import { AnimationKeyControl } from '../../ide/workbench/contrib/animation/key_control';
import { layoutAnimationEditor, measureAnimationEditor } from '../../ide/workbench/contrib/animation/layout';
import { drawAnimationEditor } from '../../ide/workbench/contrib/animation/render';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission, RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

const source = `return {duration_ms=100,tracks={
	{kind='value',path={'x'},interpolation='linear',keys={{time_ms=0,value=-10},{time_ms=100,value=25}}},
	{kind='event',keys={{u=0.5,event='cue'}}}
}}`;

for (const variant of ['tiny', 'msx'] as const) for (const theme of ['light', 'dark'] as const) {
	test(`${variant}/${theme} animation labels and retained curve evidence use their actual non-source body pair`, t => {
		const previousFont = editorViewState.font, previousTheme = colors.getActiveIdeThemeVariant();
		configureFontVariant(variant); colors.setIdeThemeVariant(theme);
		const resource = { domain: 0 as const, path: 'body.lua', source: { type: 'lua' as const, resid: 'body.lua' } };
		const sources = createScenarioTestSourceState([createScenarioTestSourceRecord(resource.path, 1, source)]);
		const model = editorTextModelService.retain(resolveRuntimeResource(sources, resource)!, 'lua', source);
		const input = new AnimationEditorInput(model, model.resource.domain);
		// These deferred authoring services are not used by source projection, layout or this read-only renderer.
		const controller = new AnimationEditorController(sources, undefined!, undefined!, undefined!);
		controller.refresh(input); controller.selectTrack(input, 1); controller.selectKey(input, 0);
		const keys = new AnimationKeyControl(inputFocus.createTarget(), controller, controller.authoring); keys.setInput(input);
		t.after(() => {
			keys.dispose(); input.dispose(); editorTextModelService.clear(); inputFocus.setTarget(null);
			editorViewState.font = previousFont; colors.setIdeThemeVariant(previousTheme);
		});
		// This renderer contract exercises overview and curve ink together, not a fixed physical viewport's layout mode.
		const measured = measureAnimationEditor(editorViewState.font);
		const bounds = { left: 4, top: 24, right: 4 + measured.expandedWidth, bottom: 24 + measured.expandedHeight };
		layoutAnimationEditor(input, bounds, keys); input.keys.update(); input.keys.curve.update(input.keys); input.overview.update(input);
		assert.equal(input.keys.curve.available, true);
		const unitLabel = input.overview.lanes.find(lane => lane.label !== '');
		assert.ok(unitLabel, 'the actual mismatched-unit track supplies explanatory overview text');
		const overlay = createHostOverlayFixture(bounds.right + 4, bounds.bottom + 4);
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		drawAnimationEditor(input, bounds, false); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(), glyphs: GlyphRenderSubmission[] = [];
		for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Glyphs)
			glyphs.push(frame.commandRefs[index] as GlyphRenderSubmission);
		assert.equal(frame.commandKinds[0], Host2DKind.Rect);
		const body = frame.commandRefs[0] as RectRenderSubmission;
		assert.deepEqual(body.area, { ...bounds, z: 0 }); assert.equal(body.color, resolveThemeTokenColor(colors.COLOR_RESOURCE_VIEWER_BACKGROUND));
		const curve = input.keys.curve;
		for (const [text, x, y] of [
			[unitLabel.label, input.overview.bounds.left + 4, unitLabel.top + 2],
			[curve.maximumLabel, curve.bounds.left + 4, curve.bounds.top + 2],
			[curve.minimumLabel, curve.bounds.left + 4, curve.bounds.bottom - editorViewState.font.lineHeight - 2],
		] as const) {
			const glyph = glyphs.find(run => run.x === x && run.y === y && run.items === text.toUpperCase());
			assert.ok(glyph, `actual renderer omitted ${text}`);
			assert.equal(glyph.color, resolveThemeTokenColor(colors.COLOR_RESOURCE_VIEWER_TEXT), 'body annotations cannot borrow status-bar ink');
		}
		assert.equal(model.buffer.getText(), source); assert.equal(model.canUndo, false);
	});
}
