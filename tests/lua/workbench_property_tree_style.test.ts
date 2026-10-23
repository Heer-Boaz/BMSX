import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import * as colors from '../../ide/common/constants';
import { api } from '../../ide/runtime/overlay_api';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';
import { drawWorkbenchPropertyTree } from '../../ide/workbench/render/property_tree';
import { createWorkbenchPropertyTree, layoutWorkbenchPropertyTree, type WorkbenchPropertyElement } from '../../ide/workbench/ui/property_tree';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows } from '../../ide/workbench/ui/tree_view';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { Font, type FontVariant } from '../../machine/ts/render/shared/bmsx_font';
import { RectRenderKind, type GlyphRenderSubmission, type RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { createHostOverlayFixture } from '../helpers/host_overlay';

function fixture(t: TestContext, theme: string, variant: FontVariant) {
	const previousTheme = colors.getActiveIdeThemeVariant();
	colors.setIdeThemeVariant(theme); t.after(() => colors.setIdeThemeVariant(previousTheme));
	const font = new Font({ variant }), tree = createWorkbenchPropertyTree<WorkbenchPropertyElement>();
	const group = appendWorkbenchTreeNode(tree, null, { kind: 'group', label: 'Group', value: '2 entries', description: '', warning: false,
		displayLabel: '', displayValue: '', displayValueLeft: 0 });
	appendWorkbenchTreeNode(tree, group, { kind: 'property', label: 'Value', value: 'raw', description: '', warning: false,
		displayLabel: '', displayValue: '', displayValueLeft: 0 });
	appendWorkbenchTreeNode(tree, group, { kind: 'property', label: 'Warning', value: 'source changed', description: '', warning: true,
		displayLabel: '', displayValue: '', displayValueLeft: 0 });
	const warning = appendWorkbenchTreeNode(tree, null, { kind: 'group', label: 'Unsupported', value: '1 entry', description: '', warning: true,
		displayLabel: '', displayValue: '', displayValueLeft: 0 });
	appendWorkbenchTreeNode(tree, warning, { kind: 'property', label: 'Source', value: 'authored', description: '', warning: false,
		displayLabel: '', displayValue: '', displayValueLeft: 0 });
	rebuildWorkbenchTreeRows(tree, group); tree.selectionIndex = -1;
	layoutWorkbenchPropertyTree(tree, font, (text, start, end) => font.measure(text.slice(start, end)), 4, 24, 380, 268);
	const overlay = createHostOverlayFixture(384, 288);
	const paint = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		api.fill_rect(0, 0, 384, 288, 0, colors.COLOR_CODE_BACKGROUND);
		drawWorkbenchPropertyTree(tree); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(), glyphs: GlyphRenderSubmission[] = [], fills: RectRenderSubmission[] = [];
		for (let index = 0; index < frame.commandCount; index++) {
			if (frame.commandKinds[index] === Host2DKind.Glyphs) glyphs.push(frame.commandRefs[index] as GlyphRenderSubmission);
			if (frame.commandKinds[index] === Host2DKind.Rect) {
				const rect = frame.commandRefs[index] as RectRenderSubmission;
				if (rect.kind === RectRenderKind.Fill) fills.push(rect);
			}
		}
		return { glyphs, fills };
	};
	return { tree, paint };
}

for (const theme of ['light', 'dark']) for (const variant of ['tiny', 'msx'] as const) {
	test(`${theme}/${variant} ordinary and warning group ink follows the painted idle, hover and selected surface`, t => {
		const { tree, paint } = fixture(t, theme, variant), layout = tree.layout;
		for (const index of [0, 3]) for (const state of ['idle', 'hovered', 'selected', 'selected-hovered'] as const) {
			tree.hoverIndex = state === 'hovered' || state === 'selected-hovered' ? index : -1;
			tree.selectionIndex = state === 'selected' || state === 'selected-hovered' ? index : -1;
			const selected = tree.selectionIndex === index, hovered = tree.hoverIndex === index, row = tree.rows[index];
			const background = selected ? colors.SELECTION_OVERLAY : hovered ? colors.HIGHLIGHT_OVERLAY : colors.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND;
			const foreground = selected ? colors.COLOR_SELECTION_TEXT : row.element.warning
				? hovered ? colors.COLOR_INSPECTOR_WARNING_TEXT : colors.COLOR_PROBLEMS_PANEL_WARNING
				: hovered ? colors.COLOR_RESOURCE_VIEWER_TEXT : colors.COLOR_PROBLEMS_PANEL_HEADER_TEXT;
			const top = layout.contentTop + index * layout.rowHeight;
			const frame = paint();
			const rowFills = frame.fills.filter(rect => rect.area.left === layout.contentLeft && rect.area.right === layout.contentRight
				&& rect.area.top === top && rect.area.bottom === top + layout.rowHeight);
			assert.ok(rowFills.length > 0, 'the actual group header must paint its full row background');
			assert.equal(rowFills.at(-1)!.color, resolveThemeTokenColor(background), `${state} must use its actual final row surface`);
			for (const text of [row.element.displayLabel, row.element.displayValue]) {
				const run = frame.glyphs.find(run => run.items === text)!;
				assert.ok(run, 'both retained group label and value must be painted');
				assert.equal(run.color, resolveThemeTokenColor(foreground), `${state} group ${text} must match its surface ink`);
			}
			const disclosure = frame.fills.filter(rect => rect.area.left >= layout.contentLeft && rect.area.right <= layout.contentLeft + layout.twistieWidth
				&& rect.area.top >= top && rect.area.bottom <= top + layout.rowHeight);
			assert.ok(disclosure.length > 0, 'the actual expandable group must draw its chevron');
			for (const rect of disclosure) assert.equal(rect.color, resolveThemeTokenColor(foreground), 'the chevron shares the group ink');
			for (const text of ['Value', 'raw']) assert.equal(frame.glyphs.find(run => run.items === text)!.color,
				resolveThemeTokenColor(colors.COLOR_RESOURCE_VIEWER_TEXT), 'ordinary leaf ink is independent of a group header');
		}
	});
	test(`${theme}/${variant} ordinary and warning leaves retain their body roles until selection overrides them`, t => {
		const { tree, paint } = fixture(t, theme, variant);
		for (const index of [1, 2]) for (const state of ['idle', 'hovered', 'selected', 'selected-hovered'] as const) {
			tree.hoverIndex = state === 'hovered' || state === 'selected-hovered' ? index : -1;
			tree.selectionIndex = state === 'selected' || state === 'selected-hovered' ? index : -1;
			const selected = tree.selectionIndex === index;
			const foreground = selected ? colors.COLOR_SELECTION_TEXT : index === 2 ? colors.COLOR_INSPECTOR_WARNING_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT;
			const frame = paint(), row = tree.rows[index];
			for (const text of [row.element.displayLabel, row.element.displayValue]) assert.equal(frame.glyphs.find(run => run.items === text)!.color,
				resolveThemeTokenColor(foreground), `${state} ${row.element.kind} must retain its owning foreground`);
			if (selected) {
				const top = tree.layout.contentTop + index * tree.layout.rowHeight;
				assert.ok(frame.fills.some(rect => rect.area.left === tree.layout.contentLeft && rect.area.right === tree.layout.contentRight
					&& rect.area.top === top && rect.area.bottom === top + tree.layout.rowHeight && rect.color === resolveThemeTokenColor(colors.SELECTION_OVERLAY)),
					'selected leaf text must consume the actual painted selection pair');
			}
		}
	});
}
