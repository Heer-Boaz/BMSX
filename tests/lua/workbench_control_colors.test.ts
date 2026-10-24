import assert from 'node:assert/strict';
import test from 'node:test';
import * as colors from '../../ide/common/constants';
import { resolveThemeTokenColor, THEME_TOKEN_MUTED_GREY } from '../../ide/theme/tokens';
import { WORKBENCH_CONTROL_COLORS } from '../../ide/theme/workbench_control_colors';
import { contrastRatio } from '../helpers/contrast.mjs';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { RectRenderKind, type RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { api } from '../../ide/runtime/overlay_api';
import { drawWorkbenchGraph } from '../../ide/workbench/render/graph';
import { createWorkbenchGraphModel, createWorkbenchGraphNode } from '../../ide/workbench/ui/graph/model';
import { WorkbenchGraphViewport } from '../../ide/workbench/ui/graph/viewport';
import { createHostOverlayFixture } from '../helpers/host_overlay';

for (const theme of ['light', 'dark'] as const) {
	test(`${theme} enabled button states own readable opaque foreground/background pairs`, () => {
		const { button } = WORKBENCH_CONTROL_COLORS[theme];
		for (const state of ['normal', 'highlighted', 'pressed'] as const) {
			const pair = button[state], foreground = resolveThemeTokenColor(pair.foreground), background = resolveThemeTokenColor(pair.background);
			assert.equal(foreground >>> 24, 255, `${state} foreground is not surface-dependent`);
			assert.equal(background >>> 24, 255, `${state} paints its own surface`);
			const ratio = contrastRatio(foreground, background);
			assert.ok(ratio >= 4.5, `${theme} ${state} button contrast is ${ratio}:1`);
		}
		assert.notEqual(button.highlighted.foreground, button.normal.foreground);
		assert.notEqual(button.highlighted.background, button.normal.background);
		assert.notEqual(button.highlighted.background, button.pressed.background);
		assert.ok(contrastRatio(resolveThemeTokenColor(button.border), resolveThemeTokenColor(button.normal.background)) >= 3);
	});

	test(`${theme} disabled buttons retain neutral opaque ink rather than semantic or selection colors`, () => {
		const { button } = WORKBENCH_CONTROL_COLORS[theme];
		assert.equal(button.disabled.foreground, THEME_TOKEN_MUTED_GREY);
		assert.equal(resolveThemeTokenColor(button.disabled.foreground) >>> 24, 255);
		assert.equal(resolveThemeTokenColor(button.disabled.background) >>> 24, 255);
		assert.notEqual(button.disabled.foreground, button.highlighted.foreground);
		assert.notEqual(button.disabled.foreground, button.pressed.foreground);
		// Inactive controls are contrast-exempt; neutrality is their separate state contract.
	});

	test(`${theme} connection and fault markers remain visible on actual status chrome`, () => {
		colors.setIdeThemeVariant(theme);
		const { chrome } = WORKBENCH_CONTROL_COLORS[theme].markers;
		assert.equal(colors.COLOR_SERVER_CONNECTED, chrome.success);
		assert.equal(colors.COLOR_SERVER_CONNECTING, chrome.warning);
		assert.equal(colors.COLOR_SERVER_DISCONNECTED, chrome.error);
		assert.equal(colors.COLOR_STATUS_FAULT_MARKER, chrome.error);
		for (const state of ['success', 'warning', 'error'] as const) {
			const foreground = resolveThemeTokenColor(chrome[state]), background = resolveThemeTokenColor(colors.COLOR_STATUS_BACKGROUND);
			assert.equal(foreground >>> 24, 255);
			assert.equal(background >>> 24, 255);
			const ratio = contrastRatio(foreground, background);
			assert.ok(ratio >= 3, `${theme} chrome ${state} marker contrast is ${ratio}:1`);
		}
	});

	test(`${theme} one dirty marker remains visible on both active and inactive tabs`, () => {
		colors.setIdeThemeVariant(theme);
		assert.equal(colors.COLOR_TAB_DIRTY_MARKER, WORKBENCH_CONTROL_COLORS[theme].markers.dirtyTab);
		const foreground = resolveThemeTokenColor(WORKBENCH_CONTROL_COLORS[theme].markers.dirtyTab);
		for (const background of [colors.COLOR_TAB_ACTIVE_BACKGROUND, colors.COLOR_TAB_INACTIVE_BACKGROUND]) {
			const ratio = contrastRatio(foreground, resolveThemeTokenColor(background));
			assert.ok(ratio >= 3, `${theme} dirty tab marker contrast is ${ratio}:1`);
		}
	});

	test(`${theme} body markers cover transcript stripes and both sides of image tile frames`, () => {
		colors.setIdeThemeVariant(theme);
		assert.equal(colors.COLOR_BODY_ACCENT, WORKBENCH_CONTROL_COLORS[theme].markers.bodyAccent);
		const foreground = resolveThemeTokenColor(WORKBENCH_CONTROL_COLORS[theme].markers.bodyAccent);
		const backgrounds = [colors.COLOR_RESOURCE_VIEWER_BACKGROUND, colors.COLOR_CODE_BACKGROUND, colors.COLOR_MARKDOWN_CODE_BACKGROUND];
		for (const background of backgrounds) {
			const ratio = contrastRatio(foreground, resolveThemeTokenColor(background));
			assert.ok(ratio >= 3, `${theme} body/tile marker contrast is ${ratio}:1`);
		}
		const highlight = resolveThemeTokenColor(colors.HIGHLIGHT_OVERLAY);
		assert.equal(highlight >>> 24, theme === 'light' ? 0 : 255, 'the user stripe uses the real highlight composition');
		if (theme === 'dark') assert.ok(contrastRatio(foreground, highlight) >= 3);
	});

	test(`${theme} graph markers match body, card, hover and selected node surfaces`, () => {
		colors.setIdeThemeVariant(theme);
		const { graph } = WORKBENCH_CONTROL_COLORS[theme].markers;
		const pairs = [
			[graph.body, colors.COLOR_RESOURCE_VIEWER_BACKGROUND],
			[graph.body, colors.COLOR_CODE_BACKGROUND],
			[graph.card, colors.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND],
			[colors.COLOR_SELECTION_TEXT, colors.SELECTION_OVERLAY],
		];
		// A transparent light hover leaves both flat bodies and grey cards unchanged.
		for (const background of theme === 'light'
			? [colors.COLOR_RESOURCE_VIEWER_BACKGROUND, colors.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND]
			: [colors.HIGHLIGHT_OVERLAY]) pairs.push([graph.hover, background]);
		for (const [foreground, background] of pairs) {
			const ink = resolveThemeTokenColor(foreground), surface = resolveThemeTokenColor(background);
			assert.equal(surface >>> 24, 255);
			const ratio = contrastRatio(ink, surface);
			assert.ok(ratio >= 3, `${theme} graph marker contrast is ${ratio}:1`);
		}
	});
	for (const variant of ['tiny', 'msx'] as const) test(`${theme}/${variant} active graph nodes resolve markers from the actual painted state`, t => {
		const previousTheme = colors.getActiveIdeThemeVariant();
		t.after(() => colors.setIdeThemeVariant(previousTheme)); colors.setIdeThemeVariant(theme);
		const font = new Font({ variant }), node = { ...createWorkbenchGraphNode(font, 'ACTIVE', 20, 20), active: true };
		const view = new WorkbenchGraphViewport(createWorkbenchGraphModel(font, [node], []));
		view.layout(0, 0, 160, 100);
		const overlay = createHostOverlayFixture(160, 100);
		for (const state of ['idle', 'hovered', 'selected'] as const) {
			view.selection = state === 'selected' ? node : null;
			overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
			drawWorkbenchGraph(view, state === 'hovered' ? node : null, false); overlay.renderer.endFrame();
			const frame = overlay.queue.consumeOverlayFrame();
			let stripe: RectRenderSubmission | undefined;
			for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Rect) {
				const rect = frame.commandRefs[index] as RectRenderSubmission;
				if (rect.kind === RectRenderKind.Fill && rect.area.left === node.bounds.left + 1 && rect.area.right === node.bounds.left + 3) stripe = rect;
			}
			assert.ok(stripe);
			assert.equal(stripe.color, resolveThemeTokenColor(state === 'selected' ? colors.COLOR_SELECTION_TEXT
				: state === 'hovered' ? colors.COLOR_GRAPH_ACTIVE_HOVER : colors.COLOR_GRAPH_ACTIVE_CARD));
			const surface = state === 'selected' ? colors.SELECTION_OVERLAY
				: state === 'hovered' && theme === 'dark' ? colors.HIGHLIGHT_OVERLAY : colors.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND;
			assert.ok(contrastRatio(stripe.color, resolveThemeTokenColor(surface)) >= 3);
		}
	});
}
