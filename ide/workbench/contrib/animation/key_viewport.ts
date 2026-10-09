import { WorkbenchSlider } from '../../ui/slider';
import type { AnimationSourceDocument, AnimationTrackSource } from './model';
import { formatNumber } from '../../../../machine/ts/common/number_format';

/** Native coordinate mapping and retained dots. This is neither animation playback nor machine rewind. */
export class AnimationKeyViewport {
	public readonly range = new WorkbenchSlider();
	public track: AnimationTrackSource | undefined;
	public positions: (number | null)[] = [];
	public readonly timeOrder: number[] = [];
	public selected = -1;
	public caption = '';
	public startLabel = '';
	public endLabel = '';
	public endLabelWidth = 0;
	public selectionLabel = '';
	public dragValue: number | undefined;
	public cursor = 0;

	public bind(track: AnimationTrackSource | undefined, selected: number, document: AnimationSourceDocument | undefined): void {
		this.track = track;
		this.positions.length = 0;
		this.timeOrder.length = 0;
		this.selected = selected;
		this.dragValue = undefined;
		let low = 0, high = track?.unit === 'u' ? 1 : 0;
		const duration = track?.unit === 'time_ms' ? document?.durationMs : track?.unit === 'frame' ? document?.durationFrames : undefined;
		if (duration !== undefined && duration !== null) high = duration;
		if (track !== undefined) for (let index = 0; index < track.keys.length; index++) {
			const position = track.unit === undefined ? undefined : track.keys[index].coordinate?.value;
			this.positions.push(position === undefined ? null : position);
			if (position !== undefined && position !== null) {
				low = Math.min(low, position); high = Math.max(high, position);
				this.timeOrder.push(index);
			}
		}
		this.timeOrder.sort((left, right) => this.positions[left]! - this.positions[right]! || left - right);
		this.range.setRange(low, high, track?.unit === 'u' ? 0.01 : 1);
		this.caption = track === undefined ? '' : track.unit === undefined ? 'KEYS / SOURCE' : track.unit === 'time_ms' ? 'KEYS / MS' : track.unit === 'frame' ? 'KEYS / FRAME' : 'KEYS / U';
		this.startLabel = formatNumber(low);
		this.endLabel = formatNumber(high);
		this.updateSelectionLabel();
	}

	public select(index: number): void {
		this.selected = index; this.dragValue = undefined;
		const position = this.positions[index];
		if (position !== undefined && position !== null) this.cursor = position;
		this.updateSelectionLabel();
	}
	public preview(value: number): void { this.dragValue = value; this.updateSelectionLabel(); }
	public cancel(): void { this.dragValue = undefined; this.updateSelectionLabel(); }
	private updateSelectionLabel(): void {
		const key = this.track?.keys[this.selected];
		const value = this.dragValue === undefined ? key?.coordinate?.value : this.dragValue;
		this.selectionLabel = key === undefined ? `+ ${formatNumber(this.cursor)}` : value === undefined || value === null ? 'SOURCE KEY' : formatNumber(value);
	}
	public setCursor(value: number): void { this.cursor = value; this.updateSelectionLabel(); }
	public adjacentKey(direction: 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'): number {
		const order = this.timeOrder;
		if (order.length === 0) return -1;
		if (direction === 'Home') return order[0];
		if (direction === 'End') return order[order.length - 1];
		const index = order.indexOf(this.selected);
		return order[Math.max(0, Math.min(order.length - 1, index + (direction === 'ArrowLeft' ? -1 : 1)))];
	}
	public xAt(value: number): number {
		const { range } = this;
		return range.bounds.left + 3 + (range.maximum === range.minimum ? 0 : Math.round((value - range.minimum) / (range.maximum - range.minimum) * (range.bounds.right - range.bounds.left - 6)));
	}
	public keyAt(x: number): number {
		let selected = -1, distance = 6;
		for (let index = 0; index < this.positions.length; index++) {
			const value = index === this.selected && this.dragValue !== undefined ? this.dragValue : this.positions[index];
			if (value === null) continue;
			const delta = Math.abs(this.xAt(value) - x);
			if (delta < distance) { distance = delta; selected = index; }
		}
		return selected;
	}
}
