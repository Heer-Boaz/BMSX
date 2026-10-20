import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerInputSnapshot, PointerSnapshot } from '../../../common/models';
import * as colors from '../../../common/constants';
import { forEachWrappedMeasuredRange } from '../../../common/text';
import { measureTextRange } from '../../../editor/common/text/layout';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { api } from '../../../runtime/overlay_api';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { HostErrorInput } from './editor_input';

/** Read-only host text, with ordinary document scrolling and the original clipboard bytes. */
export class HostErrorPane extends FullWidthWorkbenchEditorPane<HostErrorInput> {
	private readonly scroll = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget);

	public constructor(resourcePanel: ResourcePanelController) {
		super(resourcePanel);
		this.scroll.focusTarget.clipboard = { readOnly: true, copy: () => this.input.stack };
	}
	public override focus(): void { this.scroll.focusTarget.focus(); }
	protected override activate(): void {
		super.activate();
		this.scroll.setInput(this.input.viewport);
		this.update();
	}
	public override clearInput(): void { this.scroll.clearInput(); super.clearInput(); }
	public override dispose(): void { this.scroll.dispose(); super.dispose(); }

	public override update(): void {
		const input = this.input, { layout, viewport, lines } = input;
		updateFullWidthWorkbenchLayout(layout, this.contentBounds);
		const width = layout.right - layout.left - colors.SCROLLBAR_WIDTH - 8;
		if (input.projectedStack !== input.stack || input.projectedWidth !== width || input.projectedFont !== layout.font) {
			lines.length = 0;
			for (const line of input.stack.split('\n'))
				forEachWrappedMeasuredRange(line, width, measureTextRange, (start, end) => lines.push(line.slice(start, end)), true);
			if (input.projectedStack !== input.stack) viewport.scrollbar.setScroll(0);
			input.projectedStack = input.stack;
			input.projectedWidth = width;
			input.projectedFont = layout.font;
		}
		viewport.layout(layout.left, layout.top, layout.right, layout.bottom, lines.length * layout.rowHeight + 8);
		this.scroll.lineStep = layout.rowHeight;
	}
	public draw(): void {
		const { layout, viewport, lines } = this.input, font = editorViewState.font.renderFont();
		api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		api.pushClipRect(viewport.bounds.left, viewport.bounds.top, viewport.bounds.right, viewport.bounds.bottom);
		let index = (viewport.scrollTop / layout.rowHeight) | 0;
		let top = viewport.offsetTop + 4 + index * layout.rowHeight;
		for (; index < lines.length && top < viewport.bounds.bottom; index++, top += layout.rowHeight)
			api.blit_text_inline_with_font(lines[index], layout.left + 4, top, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		api.popClipRect();
		viewport.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		drawEditorText(editorViewState.font, 'Ctrl+C: copy stack | Ctrl+W: close', bounds.left + 4, bounds.top + 2, 0, color);
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot): boolean { return this.scroll.handlePointer(snapshot); }
	public handleKeyboard(): void {}
	public handleWheel(direction: number, steps: number, pointer: PointerSnapshot | null, player: PlayerInput): void {
		if (pointer !== null && this.scroll.handleWheel(pointer, direction * steps * this.input.layout.rowHeight))
			player.inputHandlers.pointer.consumeButton('pointer_wheel');
	}
}
