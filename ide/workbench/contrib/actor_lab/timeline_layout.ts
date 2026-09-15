import { measureText, truncateTextToWidth } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import type { ActorTimelineTransport } from './timeline';
import type { FullWidthWorkbenchLayout } from '../../common/layout';

/** Measure only changed timeline text or viewport/font geometry, never during paint. */
export class ActorTimelineLayout {
	public label = '';
	public positionLeft = 0;
	public durationLeft = 0;
	public top = 0;
	public height = 0;
	public endLabelTop = 0;
	private labelRevision = -1;
	private font: object | undefined;
	private right = -1;
	public update(timeline: ActorTimelineTransport, layout: FullWidthWorkbenchLayout): void {
		const { right, bottom, rowHeight } = layout;
		const font = editorViewState.font;
		const height = rowHeight * 2 + 30;
		if (this.labelRevision === timeline.labelRevision && this.font === font && this.right === right && this.height === height && this.top === bottom - height) return;
		this.labelRevision = timeline.labelRevision; this.font = font; this.right = right; this.height = height; this.top = bottom - height;
		this.endLabelTop = bottom - rowHeight - 2;
		timeline.slider.layout(4, this.top + rowHeight + 10, right - 4, bottom - rowHeight - 4);
		this.positionLeft = right - measureText(timeline.positionLabel) - 4;
		this.durationLeft = right - measureText(timeline.durationLabel) - 4;
		this.label = truncateTextToWidth(timeline.label, this.positionLeft - 8);
	}
}
