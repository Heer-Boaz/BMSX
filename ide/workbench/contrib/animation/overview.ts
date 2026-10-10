import { create_rect_bounds, write_rect_bounds } from '../../../../machine/ts/common/rect';
import type { AnimationEditorInput } from './editor_input';
import type { AnimationSourceDocument } from './model';
import { animationKeyTimeIndex } from './key_index';

type AnimationLaneGeometry = { index: number; top: number; readonly dots: number[]; readonly cells: number[]; label: string };

/** Only visible lanes are projected, on source/view/scroll changes rather than every draw. */
export class AnimationOverview {
	public readonly bounds = create_rect_bounds();
	public readonly lanes: AnimationLaneGeometry[] = [];
	private document: AnimationSourceDocument | undefined;
	private revision = -1;
	private scroll = -1;
	private layoutRevision = 0;
	private projectedLayout = -1;
	public layout(left: number, top: number, right: number, bottom: number): void {
		if (this.bounds.left === left && this.bounds.top === top && this.bounds.right === right && this.bounds.bottom === bottom) return;
		write_rect_bounds(this.bounds, left, top, right, bottom); this.layoutRevision++;
	}
	public update(input: AnimationEditorInput): void {
		const list = input.tracks, keys = input.keys;
		if (this.document === input.document && this.revision === keys.revision && this.scroll === list.scroll && this.projectedLayout === this.layoutRevision) return;
		this.document = input.document; this.revision = keys.revision; this.scroll = list.scroll; this.projectedLayout = this.layoutRevision;
		const count = Math.min(list.rows.length - list.scroll, list.layout.visibleRowCount);
		for (let visible = 0; visible < count; visible++) {
			let geometry = this.lanes[visible];
			if (geometry === undefined) { geometry = { index: 0, top: 0, dots: [], cells: [], label: '' }; this.lanes.push(geometry); }
			const index = list.scroll + visible, row = list.rows[index];
			geometry.index = index; geometry.top = list.layout.contentTop + visible * list.layout.rowHeight;
			geometry.dots.length = 0; geometry.cells.length = 0; geometry.label = '';
			if (row.frames) {
				const frames = input.document!.framesSource;
				if (keys.unit !== 'frame' || frames === undefined || !frames.array) geometry.label = frames === undefined ? 'Source' : 'frame';
				else {
					const end = Math.min(frames.table.fields.length, (keys.range.maximum | 0) + 2);
					for (let frame = Math.max(0, (keys.range.minimum | 0) - 1); frame < end; frame++) geometry.cells.push(keys.xAt(frame), keys.xAt(frame + 1));
				}
			} else if (row.track !== undefined) {
				const track = row.track;
				if (track.unit === undefined || track.unit !== keys.unit) geometry.label = track.unit === undefined ? 'Source' : track.unit;
				else {
					const selected = track === keys.track, { positions } = track.keyIndex, order = selected ? keys.timeOrder : track.keyIndex.order;
					const start = selected ? keys.timeIndex(keys.range.minimum) : animationKeyTimeIndex(positions, order, keys.range.minimum);
					const end = selected ? keys.timeIndex(keys.range.maximum, true) : animationKeyTimeIndex(positions, order, keys.range.maximum, true);
					for (let ordered = start; ordered < end; ordered++) {
						const index = order[ordered], position = selected ? keys.positionAt(index) : positions[index]!;
						geometry.dots.push(keys.xAt(position), index);
					}
					if (track.kind === 'tag' && positions.length === 2 && positions[0] !== null && positions[1] !== null) {
						geometry.cells.push(keys.xAt(selected ? keys.positionAt(0) : positions[0]), keys.xAt(selected ? keys.positionAt(1) : positions[1]));
					}
				}
			}
		}
		this.lanes.length = count;
	}
}
