import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import type { TextRangeMeasure } from '../../../common/text';
import type { PointerSnapshot } from '../../../common/models';
import type { InputFocusTarget } from '../../../input/focus';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { WorkbenchTooltip } from '../../ui/tooltip';
import type { ScenarioLabPaneState, ScenarioLabResultRow, ScenarioLabTestRow, ScenarioLabViewState } from './view_model';

type ScenarioRow = ScenarioLabTestRow | ScenarioLabResultRow;

/** Source identity feedback belongs to one actual row, never the next row at the same index. */
export class ScenarioLabRowFeedback {
	private readonly tooltip = new WorkbenchTooltip();
	private readonly anchor = create_rect_bounds();
	private readonly unbindTestsBlur: () => void;
	private readonly unbindResultsBlur: () => void;
	private pane: ScenarioLabPaneState<ScenarioRow> | undefined;
	private row: ScenarioRow | undefined;
	private keyboard = false;
	private scroll = 0;
	private pointerX = -1;
	private pointerY = -1;

	public constructor(
		surfaces: WorkbenchSurfaceService,
		private readonly owner: WorkbenchSurface,
		private readonly getWorkArea: () => Readonly<RectBounds>,
		private readonly testsFocus: InputFocusTarget,
		private readonly resultsFocus: InputFocusTarget,
	) {
		this.tooltip.attach(surfaces, owner, getWorkArea);
		this.unbindTestsBlur = testsFocus.onDidBlur(() => this.clear());
		this.unbindResultsBlur = resultsFocus.onDidBlur(() => this.clear());
	}

	public clear(): void {
		this.tooltip.hide(); this.pane = undefined; this.row = undefined; this.keyboard = false;
	}

	public dispose(): void {
		this.clear(); this.tooltip.detach(); this.unbindTestsBlur(); this.unbindResultsBlur();
	}

	public keyboardSelection(state: ScenarioLabViewState): void {
		this.tooltip.hide();
		this.pane = state.focus === 'tests' ? state.testPane : state.resultPane;
		this.row = this.pane.rows[this.pane.selectionIndex];
		this.scroll = this.pane.scroll;
		this.keyboard = true;
	}

	public pointer(state: ScenarioLabViewState, snapshot: PointerSnapshot): void {
		const moved = this.pointerX !== snapshot.viewportX || this.pointerY !== snapshot.viewportY;
		this.pointerX = snapshot.viewportX; this.pointerY = snapshot.viewportY;
		if (snapshot.pressedButtons !== 0 || snapshot.justPressedButtons !== 0) { this.clear(); return; }
		if (!moved) return;
		this.tooltip.hide();
		this.pane = state.testPane.hoverIndex >= 0 ? state.testPane : state.resultPane;
		this.row = this.pane.rows[this.pane.hoverIndex];
		this.scroll = this.pane.scroll;
		this.keyboard = false;
	}

	public onPointerLeave(): void {
		if (!this.keyboard) this.clear();
		this.pointerX = -1; this.pointerY = -1;
	}

	/** The row's retained full strings and the shared tooltip cache make clean frames allocation-free. */
	public update(font: BFont, measure: TextRangeMeasure, measureText: (text: string) => number): void {
		const pane = this.pane, row = this.row;
		if (pane === undefined || row === undefined) return;
		const index = this.keyboard ? pane.selectionIndex : pane.hoverIndex;
		if (this.owner.retired || pane.rows[index] !== row || pane.scroll !== this.scroll
			|| this.keyboard && !this.testsFocus.hasFocus && !this.resultsFocus.hasFocus) { this.clear(); return; }
		const layout = pane.layout;
		const top = layout.contentTop + (index - (pane.scroll | 0)) * layout.rowHeight;
		if (top < layout.contentTop || top + layout.rowHeight > layout.contentBottom) { this.clear(); return; }
		write_rect_bounds(this.anchor, layout.contentLeft, top, layout.contentRight, top + layout.rowHeight);
		this.tooltip.show(row.feedbackText, this.anchor, font, measure, measureText, this.getWorkArea());
	}
}
