import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { point_in_rect, type RectBounds } from '../../../../machine/ts/common/rect';
import * as colors from '../../../common/constants';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { writeWrappedMeasuredText } from '../../../common/text';
import { measureTextRange } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import type { InputFocusTarget } from '../../../input/focus';
import { api } from '../../../runtime/overlay_api';
import { updateFullWidthWorkbenchLayout, type FullWidthWorkbenchLayout } from '../../common/layout';

export type WorkbenchViewMessage = { readonly paragraphs: readonly string[]; readonly warning: boolean };

/** Honest unavailable/empty content shares the panel's real native target; it is not an editable model. */
export class WorkbenchViewMessageControl {
	private view: WorkbenchViewMessage | undefined;
	private readonly lines: string[] = [];
	private readonly scratch: string[] = [];
	private readonly bounds: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null };
	public constructor(public readonly focusTarget: InputFocusTarget) {}
	public get canFocus(): boolean { return this.view !== undefined && this.bounds.left < this.bounds.right && this.bounds.top < this.bounds.bottom; }
	public setView(view: WorkbenchViewMessage, bounds: Readonly<RectBounds>): void {
		this.view = view; this.bounds.font = null; this.layout(bounds);
	}
	public clearView(): void { this.view = undefined; }
	public layout(bounds: Readonly<RectBounds>): void {
		if (!updateFullWidthWorkbenchLayout(this.bounds, bounds)) return;
		this.lines.length = 0;
		const width = bounds.right - bounds.left - 8;
		for (const paragraph of this.view!.paragraphs) {
			writeWrappedMeasuredText(this.scratch, paragraph, width, width, paragraph.length, measureTextRange);
			for (const line of this.scratch) this.lines.push(line);
		}
	}
	public draw(): void {
		if (this.view === undefined) return;
		const b = this.bounds, font = editorViewState.font.renderFont();
		api.pushClipRect(b.left, b.top, b.right, b.bottom);
		let top = b.top + 4;
		for (const line of this.lines) {
			if (top >= b.bottom) break;
			api.blit_text_inline_with_font(line, b.left + 4, top, 0,
				this.view.warning ? colors.COLOR_CONTENT_WARNING_TEXT : colors.COLOR_DESCRIPTION_TEXT, font);
			top += b.rowHeight;
		}
		api.popClipRect();
	}
	public focus(): boolean { return this.focusTarget.focus(); }
	public setFocusNeighbors(previous: InputFocusTarget, next: InputFocusTarget): void {
		this.focusTarget.previous = previous; this.focusTarget.next = next;
		previous.next = this.focusTarget; next.previous = this.focusTarget;
	}
	public handlePointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean {
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.bounds)) return false;
		if (justPressed && (snapshot.justPressedButtons & PointerButton.Primary) !== 0) this.focus();
		return true;
	}
	public handleWheel(_event: WheelInputSnapshot): boolean { return false; }
	public dispose(): void { this.clearView(); }
}
