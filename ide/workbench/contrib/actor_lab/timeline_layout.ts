import { measureText } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import type { ActorTimelineTransport } from './timeline';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';

/** Measure only changed timeline text or viewport/font geometry, never during paint. */
export class ActorTimelineLayout {
	public durationLeft = 0;
	public top = 0;
	public height = 0;
	public labelTop = 0;
	private labelRevision = -1;
	private font: object | undefined;
	private left = -1;
	private right = -1;
	private positionWidth = 0;
	private durationWidth = 0;
	public update(timeline: ActorTimelineTransport, layout: FullWidthWorkbenchLayout): void {
		const { left, right, bottom, rowHeight } = layout;
		const font = editorViewState.font;
		const height = Math.max(rowHeight + 8, WORKBENCH_ICON_SIZE + 10);
		const textChanged = this.labelRevision !== timeline.labelRevision || this.font !== font;
		if (!textChanged && this.left === left && this.right === right && this.height === height && this.top === bottom - height) return;
		if (textChanged) {
			this.durationWidth = measureText(timeline.durationLabel);
			this.positionWidth = Math.max(measureText(timeline.positionLabel), this.durationWidth);
		}
		this.labelRevision = timeline.labelRevision; this.font = font; this.left = left; this.right = right; this.height = height; this.top = bottom - height;
		this.labelTop = this.top + ((height - rowHeight) >> 1);
		this.durationLeft = right - this.durationWidth - 4;
		timeline.slider.layout(left + this.positionWidth + 9, this.top + 2, this.durationLeft - 5, bottom - 2);
	}
}
