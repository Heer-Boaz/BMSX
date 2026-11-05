import * as colors from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import { api } from '../../../runtime/overlay_api';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { ActorLabInput } from './editor_input';
import { drawWorkbenchSlider } from '../../render/slider';
import { drawWorkbenchGraph } from '../../render/graph';
import type { WorkbenchGraphItem } from '../../ui/graph/model';
import type { ActorLabViewport } from './viewport';
import { drawWorkbenchIcon } from '../../render/icon';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import type { ActorOutlinerControl } from './outliner_control';

export function drawActorLab(input: ActorLabInput, sliderFocused: boolean, graphHover: WorkbenchGraphItem | null,
	graphFocused: boolean, viewport: ActorLabViewport, outliner: ActorOutlinerControl): void {
	const { layout, outline } = input;
	const font = editorViewState.font.renderFont();
	const color = colors.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT;
	api.pushClipRect(layout.left, layout.top, layout.right, layout.bottom);
	api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
	const graph = input.presentation === 'graph' ? input.stateGraph : undefined;
	const actions = input.presentation === 'world' ? input.worldActions : graph === undefined ? input.actionBar : input.stateGraphActions;
	renderWorkbenchActionBar(actions, font, color, colors.COLOR_DESCRIPTION_TEXT);
	const tree = outline.layout;
	if (input.presentation === 'world') {
		api.pushClipRect(layout.left + 4, layout.top, actions.bounds.left, tree.contentTop);
		api.blit_text_inline_with_font('OUTLINER', layout.left + 4, layout.top + 4, 0, color, font);
		api.popClipRect();
		outliner.draw();
	} else if (graph !== undefined) {
		const left = graph.viewport.canvas.left;
		api.pushClipRect(graph.viewport.canvas.left, tree.contentTop, graph.viewport.canvas.right, graph.viewport.canvas.bottom);
		api.fill_rect(left + 1, tree.contentTop + 3, left + 3, tree.contentTop + font.lineHeight, 0, colors.COLOR_GRAPH_ACTIVE_BODY);
		api.blit_text_inline_with_font(graph.titleLabel, left + 8, tree.contentTop + 2, 0, color, font);
		drawWorkbenchGraph(graph.viewport, graphHover, graphFocused);
		if (graph.status !== 'available') {
			api.blit_text_inline_with_font(graph.status === 'missing' ? 'FSM NOT PRESENT AT THIS FRAME' : 'GUEST HEAP REPLACED',
				left + 4, graph.viewport.bounds.top + 8, 0, color, font);
			if (graph.status === 'heap-replaced') api.blit_text_inline_with_font('SELECT AGAIN IN ACTOR TREE', left + 4, graph.viewport.bounds.top + 8 + font.lineHeight, 0, color, font);
		}
		api.popClipRect();
	} else {
		api.pushClipRect(tree.contentLeft, tree.contentTop, tree.contentRight, tree.contentBottom);
		const firstRow = outline.scroll | 0;
		const selected = input.controller.inspected(input);
		for (let visible = 0; input.actorPresent && visible < tree.visibleRowCount && firstRow + visible < outline.rows.length; visible += 1) {
			const index = firstRow + visible;
			const row = outline.rows[index];
			const top = tree.contentTop + visible * tree.rowHeight;
			if (row.element.node === selected) api.fill_rect(tree.contentLeft, top, tree.contentRight, top + tree.rowHeight, 0, colors.COLOR_RESOURCE_PANEL_HIGHLIGHT);
			const left = outline.rowLeft + row.depth * tree.indentWidth;
			if (row.children.length !== 0) drawWorkbenchIcon(row.collapsed ? 'chevronRight' : 'chevronDown',
				left + ((tree.indentWidth - WORKBENCH_ICON_SIZE) >> 1), top + ((tree.rowHeight - WORKBENCH_ICON_SIZE) >> 1), color);
			const activeTop = top + ((tree.rowHeight - 3) >> 1);
			if (row.element.node.active) api.fill_rect(left + tree.indentWidth, activeTop, left + tree.indentWidth + 3, activeTop + 3, 0, colors.COLOR_SYNTAX_HIGHLIGHTS.COLOR_STRING);
			api.blit_text_inline_with_font(row.element.label, left + tree.indentWidth * 2, top + 2, 0, color, font);
		}
		if (!input.actorPresent || outline.rows.length === 0) api.blit_text_inline_with_font(input.status, tree.contentLeft, tree.contentTop + 3, 0, color, font);
		api.popClipRect();
		outline.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
		outline.horizontalScrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	}
	if (layout.previewVisible) {
		const preview = input.previewBounds;
		if (input.worldView.mode !== 'game') input.worldView.draw();
		else if (viewport.kind === 'direct') api.drawFrame(preview.left, preview.top, preview.right, preview.bottom);
		else if (viewport.frames.bitmap !== undefined) api.drawBitmap(viewport.frames.bitmap, preview.left, preview.top, preview.right, preview.bottom);
		const overlay = input.viewportActions.bounds;
		api.fill_rect(overlay.left, overlay.top, overlay.right, overlay.bottom, 0, colors.COLOR_HEADER_BUTTON_BACKGROUND);
		renderWorkbenchActionBar(input.viewportActions, font, color, colors.COLOR_DESCRIPTION_TEXT);
	}
	const timeline = input.timeline;
	if (timeline.visible) {
		const { top, durationLeft, labelTop } = input.timelineLayout;
		api.fill_rect(layout.left, top, layout.right, top + 1, 0, colors.SCROLLBAR_THUMB_COLOR);
		api.blit_text_inline_with_font(timeline.positionLabel, layout.left + 4, labelTop, 0, color, font);
		drawWorkbenchSlider(timeline.slider, sliderFocused);
		api.blit_text_inline_with_font(timeline.durationLabel, durationLeft, labelTop, 0, color, font);
	}
	api.popClipRect();
}
