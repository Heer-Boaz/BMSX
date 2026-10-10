import { create_rect_bounds, write_rect_bounds } from '../../../../machine/ts/common/rect';
import type { AnimationKeyViewport } from './key_viewport';
import { formatNumber } from '../../../../machine/ts/common/number_format';

export type AnimationCurveField = 'value' | 'arrive' | 'leave';

/** Display geometry for written scalar keys. Never a playback/evaluation owner. */
export class AnimationCurve {
	public readonly bounds = create_rect_bounds();
	public readonly points: number[] = [];
	/** Visible key indices and pixels are retained with the polyline, not recomputed during draw. */
	public readonly markers: number[] = [];
	public readonly arriveHandle: number[] = [];
	public readonly leaveHandle: number[] = [];
	public available = false;
	public minimum = 0;
	public maximum = 1;
	public minimumLabel = '';
	public maximumLabel = '';
	public previewField: AnimationCurveField | undefined;
	public previewValue = 0;
	public revision = 0;
	private geometryRevision = -1;

	public bind(keys: AnimationKeyViewport): void {
		const track = keys.track;
		this.previewField = undefined;
		this.available = track?.kind === 'value' && track.unit !== undefined && track.unit !== 'u'
			&& (track.interpolation === 'linear' || track.interpolation === 'cubic' || track.interpolation === 'step')
			&& keys.timeOrder.length === track.keys.length && track.keys.length > 0
			&& track.keys.every(key => key.value?.value !== undefined && key.value.value !== null
				&& (track.interpolation !== 'cubic' || key.arrive?.value !== undefined && key.arrive.value !== null && key.leave?.value !== undefined && key.leave.value !== null));
		if (this.available) {
			this.minimum = this.maximum = track!.keys[0].value!.value!;
			for (let segment = 0; segment < keys.timeOrder.length; segment++) {
				const index = keys.timeOrder[segment], key = track!.keys[index];
				this.minimum = Math.min(this.minimum, key.value!.value!); this.maximum = Math.max(this.maximum, key.value!.value!);
				if (track!.interpolation === 'cubic' && segment + 1 < keys.timeOrder.length) for (let sample = 1; sample < 32; sample++) {
					const value = this.segmentValue(keys, index, keys.timeOrder[segment + 1], sample / 32);
					this.minimum = Math.min(this.minimum, value); this.maximum = Math.max(this.maximum, value);
				}
			}
			const padding = this.maximum === this.minimum ? Math.max(1, Math.abs(this.minimum) * 0.1) : (this.maximum - this.minimum) * 0.2;
			this.minimum -= padding; this.maximum += padding;
			this.minimumLabel = formatNumber(this.minimum); this.maximumLabel = formatNumber(this.maximum);
		}
		this.revision++;
	}
	public layout(left: number, top: number, right: number, bottom: number): void {
		if (this.bounds.left === left && this.bounds.top === top && this.bounds.right === right && this.bounds.bottom === bottom) return;
		write_rect_bounds(this.bounds, left, top, right, bottom); this.revision++;
	}
	public yAt(value: number): number { return this.bounds.bottom - 6 - Math.round((value - this.minimum) / (this.maximum - this.minimum) * (this.bounds.bottom - this.bounds.top - 12)); }
	public valueDelta(pixels: number): number { return -pixels * (this.maximum - this.minimum) / (this.bounds.bottom - this.bounds.top - 12); }
	public preview(field: AnimationCurveField, value: number): void { if (this.previewField !== field || this.previewValue !== value) { this.previewField = field; this.previewValue = value; this.revision++; } }
	public cancel(): void { if (this.previewField !== undefined) { this.previewField = undefined; this.revision++; } }
	public fieldValue(keys: AnimationKeyViewport, index: number, field: AnimationCurveField): number {
		return index === keys.selected && this.previewField === field ? this.previewValue : keys.track!.keys[index][field]!.value!;
	}
	public keyAt(keys: AnimationKeyViewport, x: number, y: number): number {
		let closest = -1, distance = 64;
		const end = keys.timeIndex(keys.valueAt(x + 9, false), true);
		for (let ordered = keys.timeIndex(keys.valueAt(x - 9, false)); ordered < end; ordered++) {
			const index = keys.timeOrder[ordered];
			const dx = keys.xAt(keys.positionAt(index)) - x, dy = this.yAt(this.fieldValue(keys, index, 'value')) - y;
			const squared = dx * dx + dy * dy;
			if (squared < distance) { closest = index; distance = squared; }
		}
		return closest;
	}
	public handleAt(x: number, y: number): AnimationCurveField | undefined {
		if (this.arriveHandle.length && Math.abs(x - this.arriveHandle[2]) < 6 && Math.abs(y - this.arriveHandle[3]) < 6) return 'arrive';
		if (this.leaveHandle.length && Math.abs(x - this.leaveHandle[2]) < 6 && Math.abs(y - this.leaveHandle[3]) < 6) return 'leave';
		return undefined;
	}
	public update(keys: AnimationKeyViewport): void {
		const revision = this.revision + keys.revision;
		if (this.geometryRevision === revision) return;
		this.geometryRevision = revision;
		this.points.length = 0; this.markers.length = 0; this.arriveHandle.length = 0; this.leaveHandle.length = 0;
		if (!this.available) return;
		const order = keys.timeOrder;
		if (keys.range.minimum < keys.positionAt(order[0])) {
			const y = this.yAt(this.fieldValue(keys, order[0], 'value'));
			this.points.push(keys.xAt(keys.range.minimum), y, keys.xAt(Math.min(keys.range.maximum, keys.positionAt(order[0]))), y);
		}
		const endSegment = keys.timeIndex(keys.range.maximum, true);
		for (let segment = Math.max(0, keys.timeIndex(keys.range.minimum) - 1); segment < endSegment; segment++) {
			const index = order[segment], x = keys.positionAt(index);
			if (x >= keys.range.minimum && x <= keys.range.maximum) {
				const pixelX = keys.xAt(x), pixelY = this.yAt(this.fieldValue(keys, index, 'value'));
				this.points.push(pixelX, pixelY); this.markers.push(index, pixelX, pixelY);
			}
			if (segment + 1 >= order.length) continue;
			const next = order[segment + 1], end = keys.positionAt(next), span = end - x;
			if (span <= 0) continue; // Equal-time keys retain their ordered discontinuity.
			const left = Math.max(x, keys.range.minimum), right = Math.min(end, keys.range.maximum);
			if (right < left) continue;
			if (keys.track!.interpolation === 'step') {
				this.points.push(keys.xAt(left), this.yAt(this.fieldValue(keys, index, 'value')), keys.xAt(right), this.yAt(this.fieldValue(keys, index, 'value')));
			} else {
				const count = Math.max(1, (Math.abs(keys.xAt(right) - keys.xAt(left)) / 4) | 0);
				for (let sample = 0; sample <= count; sample++) {
					const position = left + (right - left) * sample / count;
					this.points.push(keys.xAt(position), this.yAt(this.segmentValue(keys, index, next, (position - x) / span)));
				}
			}
		}
		const last = order[order.length - 1];
		if (keys.range.maximum > keys.positionAt(last)) {
			const y = this.yAt(this.fieldValue(keys, last, 'value'));
			this.points.push(keys.xAt(Math.max(keys.range.minimum, keys.positionAt(last))), y, keys.xAt(keys.range.maximum), y);
		}
		if (keys.selected < 0 || keys.track!.interpolation !== 'cubic') return;
		const index = keys.selected, x = keys.xAt(keys.positionAt(index)), value = this.fieldValue(keys, index, 'value'), y = this.yAt(value);
		const dx = 32, span = dx * (keys.range.maximum - keys.range.minimum) / (keys.range.bounds.right - keys.range.bounds.left - 6);
		this.arriveHandle.push(x, y, x - dx, this.yAt(value - this.fieldValue(keys, index, 'arrive') * span));
		this.leaveHandle.push(x, y, x + dx, this.yAt(value + this.fieldValue(keys, index, 'leave') * span));
	}
	private segmentValue(keys: AnimationKeyViewport, first: number, next: number, u: number): number {
		const a = this.fieldValue(keys, first, 'value'), b = this.fieldValue(keys, next, 'value');
		if (keys.track!.interpolation !== 'cubic') return a + (b - a) * u;
		const span = keys.positionAt(next) - keys.positionAt(first);
		const leave = this.fieldValue(keys, first, 'leave') * span, arrive = this.fieldValue(keys, next, 'arrive') * span;
		return (((2 * a - 2 * b + leave + arrive) * u + (-3 * a + 3 * b - 2 * leave - arrive)) * u + leave) * u + a;
	}
}
