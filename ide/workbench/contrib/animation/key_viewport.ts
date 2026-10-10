import { WorkbenchSlider } from '../../ui/slider';
import type { AnimationKeyUnit, AnimationSourceDocument, AnimationTrackSource } from './model';
import { formatNumber } from '../../../../machine/ts/common/number_format';
import { AnimationCurve } from './curve';
import { animationKeyTimeIndex, EMPTY_ANIMATION_KEY_INDEX } from './key_index';

/** Native coordinate mapping and retained dots. This is neither animation playback nor machine rewind. */
export class AnimationKeyViewport {
	public readonly range = new WorkbenchSlider();
	public readonly curve = new AnimationCurve();
	public revision = 0;
	public extentMinimum = 0;
	public extentMaximum = 1;
	public snap = true;
	public track: AnimationTrackSource | undefined;
	public unit: AnimationKeyUnit | undefined;
	public positions: readonly (number | null)[] = EMPTY_ANIMATION_KEY_INDEX.positions;
	public readonly timeOrder: number[] = [];
	public readonly pixels: number[] = [];
	private projectedRevision = -1;
	private selectedOrder = -1;
	public selected = -1;
	public caption = '';
	public startLabel = '';
	public endLabel = '';
	public endLabelWidth = 0;
	public selectionLabel = '';
	public dragValue: number | undefined;
	public cursor = 0;

	public bind(track: AnimationTrackSource | undefined, selected: number, document: AnimationSourceDocument | undefined, unit = track?.unit): void {
		const previousUnit = this.unit;
		this.track = track;
		this.unit = unit;
		this.positions = track === undefined ? EMPTY_ANIMATION_KEY_INDEX.positions : track.keyIndex.positions;
		this.timeOrder.length = 0;
		this.selected = selected;
		this.dragValue = undefined;
		let low = 0, high = unit === 'u' ? 1 : 0;
		const duration = unit === 'time_ms' ? document?.durationMs : unit === 'frame' ? document?.durationFrames : undefined;
		if (duration !== undefined && duration !== null) high = duration;
		if (unit !== undefined) for (const lane of document!.tracks) {
			if (lane.unit !== unit) continue;
			const { positions, order } = lane.keyIndex;
			if (order.length > 0) {
				low = Math.min(low, positions[order[0]]!); high = Math.max(high, positions[order[order.length - 1]]!);
			}
		}
		if (unit === 'time_ms') for (const clip of document!.clips) {
			const start = clip.start === undefined ? 0 : clip.start.value;
			if (start !== null && clip.duration?.value !== undefined && clip.duration.value !== null) {
				low = Math.min(low, start, start + clip.duration.value); high = Math.max(high, start, start + clip.duration.value);
			}
		}
		if (unit === 'frame' && document?.framesSource?.array) high = Math.max(high, document.framesSource.table.fields.length);
		if (track !== undefined) for (const index of track.keyIndex.order) this.timeOrder.push(index);
		this.selectedOrder = this.timeOrder.indexOf(selected);
		this.extentMinimum = low; this.extentMaximum = high === low ? low + 1 : high;
		if (previousUnit !== unit || previousUnit === undefined) { this.cursor = low; this.fit(); }
		this.caption = unit === undefined ? 'Source' : unit === 'time_ms' ? 'ms' : unit === 'frame' ? 'frame' : 'u';
		this.curve.bind(this);
		this.revision++;
		this.updateSelectionLabel();
	}
	public fit(): void { this.setView(this.extentMinimum, this.extentMaximum); }
	public setView(minimum: number, maximum: number): void {
		if (this.range.minimum === minimum && this.range.maximum === maximum && this.startLabel !== '') return;
		this.range.setRange(minimum, maximum, this.unit === 'u' ? 0.01 : 1);
		this.startLabel = formatNumber(minimum); this.endLabel = formatNumber(maximum); this.revision++;
	}
	public zoom(x: number, factor: number): void {
		const ratio = (x - this.range.bounds.left - 3) / (this.range.bounds.right - this.range.bounds.left - 6);
		const span = this.range.maximum - this.range.minimum, anchor = this.range.minimum + span * ratio;
		const next = Math.max(this.range.step * 2, Math.min((this.extentMaximum - this.extentMinimum) * 16, span * factor));
		this.setView(anchor - next * ratio, anchor + next * (1 - ratio));
	}
	public valueAt(x: number, snap = this.snap): number {
		const value = this.range.minimum + (x - this.range.bounds.left - 3) * (this.range.maximum - this.range.minimum) / (this.range.bounds.right - this.range.bounds.left - 6);
		return snap ? Math.round(value / this.range.step) * this.range.step : value;
	}
	/** A newly inserted/selected element stays visible without changing the user's zoom. */
	public reveal(start: number, end = start): void {
		const span = this.range.maximum - this.range.minimum;
		if (end > this.range.maximum) this.setView(end - span, end);
		if (start < this.range.minimum) this.setView(start, start + span);
	}
	public positionAt(index: number): number { return index === this.selected && this.dragValue !== undefined ? this.dragValue : this.positions[index]!; }
	/** Insertion position in the presentation order; authored array order is untouched. */
	public timeIndex(position: number, afterEquals = false): number {
		return animationKeyTimeIndex(this.positions, this.timeOrder, position, afterEquals, this.selected, this.dragValue);
	}
	public update(): void {
		if (this.projectedRevision === this.revision) return;
		this.projectedRevision = this.revision; this.pixels.length = 0;
		for (let ordered = this.timeIndex(this.range.minimum); ordered < this.timeOrder.length; ordered++) {
			const index = this.timeOrder[ordered], value = this.positionAt(index);
			if (value > this.range.maximum) break;
			this.pixels.push(index, this.xAt(value));
		}
	}

	public select(index: number): void {
		this.selected = index; this.dragValue = undefined;
		this.selectedOrder = this.timeOrder.indexOf(index);
		const position = this.positions[index];
		if (position !== undefined && position !== null) this.cursor = position;
		this.updateSelectionLabel();
		this.revision++;
	}
	public preview(value: number): void { if (this.dragValue !== value) { this.dragValue = value; this.orderSelectedKey(); this.updateSelectionLabel(); this.revision++; } }
	public cancel(): void { if (this.dragValue !== undefined) { this.dragValue = undefined; this.orderSelectedKey(); this.updateSelectionLabel(); this.revision++; } this.curve.cancel(); }
	private orderSelectedKey(): void {
		const order = this.timeOrder, value = this.positionAt(this.selected);
		let index = this.selectedOrder;
		if (index < 0) return;
		while (index > 0 && (this.positionAt(order[index - 1]) > value || this.positionAt(order[index - 1]) === value && order[index - 1] > this.selected)) {
			order[index] = order[index - 1]; order[--index] = this.selected;
		}
		while (index + 1 < order.length && (this.positionAt(order[index + 1]) < value || this.positionAt(order[index + 1]) === value && order[index + 1] < this.selected)) {
			order[index] = order[index + 1]; order[++index] = this.selected;
		}
		this.selectedOrder = index;
	}
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
		const index = this.selectedOrder;
		if (index < 0) {
			const adjacent = direction === 'ArrowLeft' ? this.timeIndex(this.cursor) - 1 : this.timeIndex(this.cursor, true);
			return adjacent < 0 || adjacent >= order.length ? -1 : order[adjacent];
		}
		return order[Math.max(0, Math.min(order.length - 1, index + (direction === 'ArrowLeft' ? -1 : 1)))];
	}
	public xAt(value: number): number {
		const { range } = this;
		return range.bounds.left + 3 + Math.round((value - range.minimum) / (range.maximum - range.minimum) * (range.bounds.right - range.bounds.left - 6));
	}
	public keyAt(x: number): number {
		let selected = -1, distance = 6;
		const end = this.timeIndex(this.valueAt(x + 7, false), true);
		for (let ordered = this.timeIndex(this.valueAt(x - 7, false)); ordered < end; ordered++) {
			const index = this.timeOrder[ordered], value = this.positionAt(index);
			const delta = Math.abs(this.xAt(value) - x);
			if (delta < distance || selected >= 0 && delta === distance && index === this.selected) { distance = delta; selected = index; }
		}
		return selected;
	}
}
