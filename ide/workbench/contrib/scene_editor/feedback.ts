import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import type { PointerSnapshot } from '../../../common/models';
import type { TextRangeMeasure } from '../../../common/text';
import type { InputFocusTarget } from '../../../input/focus';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { WorkbenchTooltip } from '../../ui/tooltip';
import type { WorkbenchTreeNode } from '../../ui/tree_view';
import type { SceneEditorViewState } from './view_state';
import type { SceneOutlineElement } from './outline';

/** Retained authored membership, not another row which later occupies the same index. */
export class SceneOutlineFeedback {
	private readonly tooltip = new WorkbenchTooltip();
	private readonly anchor = create_rect_bounds();
	private readonly unbindBlur: () => void;
	private input: SceneEditorViewState | undefined;
	private row: WorkbenchTreeNode<SceneOutlineElement> | undefined;
	private keyboard = false;
	private scroll = 0;
	private pointerX = -1;
	private pointerY = -1;

	public constructor(surfaces: WorkbenchSurfaceService, private readonly owner: WorkbenchSurface,
		private readonly workArea: Readonly<RectBounds>, private readonly focus: InputFocusTarget) {
		this.tooltip.attach(surfaces, owner, workArea);
		this.unbindBlur = focus.onDidBlur(() => this.clear());
	}

	public clear(): void { this.tooltip.hide(); this.input = undefined; this.row = undefined; this.keyboard = false; }
	public dispose(): void { this.clear(); this.tooltip.detach(); this.unbindBlur(); }

	public keyboardSelection(input: SceneEditorViewState): void {
		this.tooltip.hide(); this.input = input; this.row = input.outline.rows[input.outline.selectionIndex];
		this.scroll = input.outline.scroll; this.keyboard = true;
	}

	/** Stationary pointer state cannot replace explicit keyboard intent or adopt a row after scrolling. */
	public pointer(input: SceneEditorViewState, index: number, snapshot: PointerSnapshot): void {
		const moved = this.pointerX !== snapshot.viewportX || this.pointerY !== snapshot.viewportY;
		this.pointerX = snapshot.viewportX; this.pointerY = snapshot.viewportY;
		if (snapshot.pressedButtons !== 0 || snapshot.justPressedButtons !== 0) { this.clear(); return; }
		if (!moved) return;
		this.tooltip.hide(); this.input = input; this.row = input.outline.rows[index];
		this.scroll = input.outline.scroll; this.keyboard = false;
	}

	public onPointerLeave(): void {
		if (!this.keyboard) this.clear();
		this.pointerX = -1; this.pointerY = -1;
	}

	/** Projection owns the full identity string; stable feedback performs no source reads or measurements. */
	public update(font: BFont, measure: TextRangeMeasure, measureText: (text: string) => number): void {
		const input = this.input, row = this.row;
		if (input === undefined || row === undefined) return;
		const outline = input.outline, index = this.keyboard ? outline.selectionIndex : outline.hoverIndex;
		if (this.owner.retired || outline.rows[index] !== row || outline.scroll !== this.scroll || this.keyboard && !this.focus.hasFocus) {
			this.clear(); return;
		}
		if (this.keyboard && !row.element.labelClipped) { this.tooltip.hide(); return; }
		const layout = outline.layout, top = layout.contentTop + (index - (outline.scroll | 0)) * layout.rowHeight;
		if (top < layout.contentTop || top + layout.rowHeight > layout.contentBottom) { this.clear(); return; }
		write_rect_bounds(this.anchor, layout.contentLeft, top, layout.contentRight, top + layout.rowHeight);
		this.tooltip.show(row.element.identity, this.anchor, font, measure, measureText, this.workArea);
	}
}
