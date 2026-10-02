import * as colors from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import { api } from '../../../runtime/overlay_api';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { ActorLabInput } from './editor_input';
import { drawWorkbenchSlider } from '../../render/slider';
import { drawWorkbenchGraph } from '../../render/graph';
import type { WorkbenchGraphItem } from '../../ui/graph/model';

export function drawActorLab(input: ActorLabInput, playbackState: string, sliderFocused: boolean, graphHover: WorkbenchGraphItem | null, graphFocused: boolean): void {
	const { layout, outline } = input;
	const font = editorViewState.font.renderFont();
	const color = colors.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT;
	api.pushClipRect(layout.left, layout.top, layout.right, layout.bottom);
	api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
	const graph = input.stateGraph;
	renderWorkbenchActionBar(graph === undefined ? input.actionBar : input.stateGraphActions, font);
	api.blit_text_inline_with_font(graph === undefined ? playbackState : graph.titleLabel, 4, layout.top + 2, 0, color, font);
	const tree = outline.layout;
	if (graph !== undefined) {
		api.pushClipRect(graph.viewport.canvas.left, tree.contentTop, graph.viewport.canvas.right, graph.viewport.canvas.bottom);
		api.fill_rect(5, tree.contentTop + 3, 7, tree.contentTop + font.lineHeight, 0, colors.COLOR_GRAPH_ACTIVE);
		api.blit_text_inline_with_font('ACTIVE PATH', 12, tree.contentTop + 2, 0, color, font);
		drawWorkbenchGraph(graph.viewport, graphHover, graphFocused);
		if (graph.status !== 'available') {
			api.blit_text_inline_with_font(graph.status === 'missing' ? 'FSM INSTANCE RETIRED' : 'GUEST HEAP REPLACED',
				8, graph.viewport.bounds.top + 8, 0, color, font);
			api.blit_text_inline_with_font('SELECT AGAIN IN ACTOR TREE', 8, graph.viewport.bounds.top + 8 + font.lineHeight, 0, color, font);
		}
		api.popClipRect();
	} else {
		api.pushClipRect(tree.contentLeft, tree.contentTop, tree.contentRight, tree.contentBottom);
		for (let visible = 0; visible < tree.visibleRowCount && outline.scroll + visible < outline.rows.length; visible += 1) {
			const index = outline.scroll + visible;
			const row = outline.rows[index];
			const top = tree.contentTop + visible * tree.rowHeight;
			if (index === outline.selectionIndex) api.fill_rect(tree.contentLeft, top, tree.contentRight, top + tree.rowHeight, 0, colors.COLOR_RESOURCE_PANEL_HIGHLIGHT);
			const left = tree.contentLeft + row.depth * tree.indentWidth;
			if (row.children.length !== 0) api.blit_text_inline_with_font(row.collapsed ? '+' : '-', left, top + 2, 0, color, font);
			if (row.element.node.active) api.fill_rect(left + tree.indentWidth, top + 3, left + tree.indentWidth + 3, top + 6, 0, colors.COLOR_SYNTAX_HIGHLIGHTS.COLOR_STRING);
			api.blit_text_inline_with_font(row.element.displayLabel, left + tree.indentWidth * 2, top + 2, 0, color, font);
		}
		if (outline.rows.length === 0) api.blit_text_inline_with_font(input.status, 4, tree.contentTop + 3, 0, color, font);
		api.popClipRect();
		outline.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	}
	const preview = input.previewBounds;
	api.blit_text_inline_with_font('GAME FRAME', preview.left, tree.contentTop + 2, 0, color, font);
	api.drawFrame(preview.left, preview.top, preview.right, preview.bottom);
	const timeline = input.timeline;
	if (timeline.visible) {
		const { top, label, positionLeft, durationLeft, endLabelTop } = input.timelineLayout;
		api.fill_rect(0, top, layout.right, top + 1, 0, colors.SCROLLBAR_THUMB_COLOR);
		api.blit_text_inline_with_font(label, 4, top + 4, 0, color, font);
		api.blit_text_inline_with_font(timeline.positionLabel, positionLeft, top + 4, 0, color, font);
		drawWorkbenchSlider(timeline.slider, sliderFocused);
		api.blit_text_inline_with_font('0 MS', 4, endLabelTop, 0, color, font);
		api.blit_text_inline_with_font(timeline.durationLabel, durationLeft, endLabelTop, 0, color, font);
	}
	api.popClipRect();
}
