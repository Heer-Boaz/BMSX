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
	private right = -1;
	public update(timeline: ActorTimelineTransport, layout: FullWidthWorkbenchLayout): void {
		const { right, bottom, rowHeight } = layout;
		const font = editorViewState.font;
		const height = Math.max(rowHeight + 8, WORKBENCH_ICON_SIZE + 10);
		if (this.labelRevision === timeline.labelRevision && this.font === font && this.right === right && this.height === height && this.top === bottom - height) return;
		this.labelRevision = timeline.labelRevision; this.font = font; this.right = right; this.height = height; this.top = bottom - height;
		this.labelTop = this.top + ((height - rowHeight) >> 1);
		this.durationLeft = right - measureText(timeline.durationLabel) - 4;
		const positionWidth = Math.max(measureText(timeline.positionLabel), measureText(timeline.durationLabel));
		timeline.slider.layout(positionWidth + 9, this.top + 2, this.durationLeft - 5, bottom - 2);
	}
}
