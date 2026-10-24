import assert from 'node:assert/strict';
import test from 'node:test';
import * as colors from '../../ide/common/constants';
import { editorFeedbackState, showEditorMessage } from '../../ide/common/feedback_state';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { createRuntimeFaultState } from '../../ide/runtime/fault_state';
import { RuntimeLuaEvaluation } from '../../ide/runtime/lua_evaluation';
import { renderStatusBar } from '../../ide/workbench/render/status_bar';
import { api } from '../../ide/runtime/overlay_api';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';
import { contrastRatio } from '../helpers/contrast.mjs';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { drawValueInput } from '../../ide/editor/ui/inline/value_input_render';
import { applyInlineFieldEditing, setFieldText } from '../../ide/editor/ui/inline/text_field';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { inputFocus } from '../../ide/input/focus';

const hiddenResources: Parameters<typeof renderStatusBar>[0] = {
	focusTarget: inputFocus.createTarget(),
	isVisible: () => false,
	getMode: () => 'resources',
	getFilterMode: () => 'all',
};

for (const variant of ['tiny', 'msx'] as const) for (const kind of ['info', 'success', 'warning', 'error'] as const) {
	test(`${variant} retained ${kind} feedback resolves its actual status-surface ink after a theme change`, t => {
		configureFontVariant(new VirtualHeadlessClock(), variant, null);
		editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
		const originalTheme = colors.getActiveIdeThemeVariant();
		t.after(() => { editorFeedbackState.message.visible = false; colors.setIdeThemeVariant(originalTheme); });
		const overlay = createHostOverlayFixture(384, 288), fault = createRuntimeFaultState();
		// No guest operation is active; feedback rendering never enters these evaluation dependencies.
		const evaluation = new RuntimeLuaEvaluation(null, null, null, null, fault, null, null, null);
		colors.setIdeThemeVariant('light'); showEditorMessage('SEVERITY', kind, 4);
		assert.equal(editorFeedbackState.message.kind, kind);
		assert.equal(Object.hasOwn(editorFeedbackState.message, 'color'), false, 'feedback carries intent, not retained theme data');
		const message = { ...editorFeedbackState.message }, ink: number[] = [];
		for (const theme of ['light', 'dark']) {
			colors.setIdeThemeVariant(theme);
			overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
			renderStatusBar(hiddenResources, fault, null, evaluation, 'standalone', null);
			overlay.renderer.endFrame(); const frame = overlay.queue.consumeOverlayFrame();
			let glyph: GlyphRenderSubmission | undefined;
			for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Glyphs) {
				const candidate = frame.commandRefs[index] as GlyphRenderSubmission;
				if (candidate.items === 'SEVERITY') glyph = candidate;
			}
			assert.ok(glyph); ink.push(glyph.color);
			assert.equal(glyph.color, resolveThemeTokenColor(colors.STATUS_MESSAGE_TEXT_COLORS[kind]));
			assert.ok(contrastRatio(glyph.color, resolveThemeTokenColor(colors.COLOR_STATUS_BACKGROUND)) >= 4.5);
			assert.deepEqual(editorFeedbackState.message, message, 'retheming does not republish, expire or recolor the message model');
		}
		if (kind === 'warning' || kind === 'error') assert.notEqual(ink[0], ink[1], 'these status themes deliberately require different ink');
	});
}

for (const theme of ['light', 'dark']) test(`${theme} non-source content and graph ink belongs to its actual surface`, t => {
	const originalTheme = colors.getActiveIdeThemeVariant();
	t.after(() => colors.setIdeThemeVariant(originalTheme)); colors.setIdeThemeVariant(theme);
	for (const foreground of [colors.COLOR_CONTENT_PROGRESS_TEXT, colors.COLOR_CONTENT_SUCCESS_TEXT,
		colors.COLOR_CONTENT_WARNING_TEXT, colors.COLOR_CONTENT_ERROR_TEXT, colors.COLOR_DESCRIPTION_TEXT]) {
		const ink = resolveThemeTokenColor(foreground), background = resolveThemeTokenColor(colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
		assert.equal(ink >>> 24, 255); assert.ok(contrastRatio(ink, background) >= 4.5);
	}
	for (const background of [colors.COLOR_RESOURCE_VIEWER_BACKGROUND, colors.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND]) {
		assert.ok(contrastRatio(resolveThemeTokenColor(colors.COLOR_GRAPH_MUTED), resolveThemeTokenColor(background)) >= 3);
	}
	assert.ok(contrastRatio(resolveThemeTokenColor(colors.COLOR_CONTENT_ERROR_TEXT), resolveThemeTokenColor(colors.COLOR_QUICK_OPEN_BACKGROUND)) >= 4.5);
	for (const foreground of [colors.COLOR_INPUT_TEXT, colors.COLOR_INPUT_PLACEHOLDER])
		assert.ok(contrastRatio(resolveThemeTokenColor(foreground), resolveThemeTokenColor(colors.COLOR_INPUT_BACKGROUND)) >= 4.5);
	for (const foreground of [colors.COLOR_INPUT_OUTLINE, colors.COLOR_FOCUS_BORDER, colors.COLOR_CONTENT_ERROR_TEXT])
		assert.ok(contrastRatio(resolveThemeTokenColor(foreground), resolveThemeTokenColor(colors.COLOR_INPUT_BACKGROUND)) >= 3);
	assert.ok(contrastRatio(resolveThemeTokenColor(colors.COLOR_FOCUS_BORDER), resolveThemeTokenColor(colors.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND)) >= 3);
	for (const background of [colors.COLOR_QUICK_OPEN_BACKGROUND, colors.COLOR_QUICK_OPEN_HOVER_BACKGROUND]) {
		for (const foreground of [colors.COLOR_QUICK_OPEN_TEXT, colors.COLOR_QUICK_OPEN_KIND, colors.COLOR_QUICK_OPEN_MATCH])
			assert.ok(contrastRatio(resolveThemeTokenColor(foreground), resolveThemeTokenColor(background)) >= 4.5,
				`${theme} quick-pick text ${foreground} on ${background}`);
	}
	for (const foreground of [colors.COLOR_QUICK_OPEN_SELECTION_TEXT, colors.COLOR_QUICK_OPEN_SELECTION_MATCH])
		assert.ok(contrastRatio(resolveThemeTokenColor(foreground), resolveThemeTokenColor(colors.COLOR_QUICK_OPEN_SELECTION_BACKGROUND)) >= 4.5);
});

for (const theme of ['light', 'dark']) for (const variant of ['tiny', 'msx'] as const) {
	test(`${theme}/${variant} a rejected numeric draft paints input-owned fill, error ink and focus borders`, t => {
		configureFontVariant(new VirtualHeadlessClock(), variant, null); colors.setIdeThemeVariant(theme);
		const input = new ValueInput(null, INTEGER_INPUT_FORMAT, () => {});
		t.after(() => { input.field.focusTarget.release(); input.dispose(); editorFeedbackState.message.visible = false; });
		input.setValue(7); input.layout(90);
		const fills: number[] = [], borders: number[] = [], glyphs: number[] = [];
		t.mock.method(api, 'fill_rect', (...args: Parameters<typeof api.fill_rect>) => { fills.push(args[5]); });
		t.mock.method(api, 'blit_rect', (...args: Parameters<typeof api.blit_rect>) => { borders.push(args[5]); });
		t.mock.method(api, 'fill_rect_color', () => {}); t.mock.method(api, 'blit_text_inline_with_font', () => {});
		t.mock.method(api, 'blit_text_inline_span_with_font', (...args: Parameters<typeof api.blit_text_inline_span_with_font>) => { glyphs.push(args[6]); });
		const bounds = { left: 0, top: 0, right: 90, bottom: 20 };
		drawValueInput(input, bounds);
		assert.equal(fills[0], colors.COLOR_INPUT_BACKGROUND); assert.equal(borders.at(-1), colors.COLOR_INPUT_OUTLINE);
		input.field.focusTarget.focus(); applyInlineFieldEditing(new KeyInputEvent('End', KeyModifier.none), input.field);
		drawValueInput(input, bounds); assert.equal(borders.at(-1), colors.COLOR_FOCUS_BORDER);
		setFieldText(input.field, '-', true); assert.equal(input.commit(), false); input.layout(90);
		drawValueInput(input, bounds);
		assert.equal(borders.at(-1), colors.COLOR_CONTENT_ERROR_TEXT); assert.equal(glyphs.at(-1), colors.COLOR_CONTENT_ERROR_TEXT);
	});
}
