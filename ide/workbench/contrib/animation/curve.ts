import { create_rect_bounds, write_rect_bounds } from '../../../../machine/ts/common/rect';
import type { AnimationKeyViewport } from './key_viewport';
import type { AnimationTrackSource } from './model';
import { formatNumber } from '../../../../machine/ts/common/number_format';

export type AnimationCurveField = 'value' | 'arrive' | 'leave';
const enum ResolvedFields { Value = 1, Arrive = 2, Leave = 4 }

/** Display geometry for written scalar keys. Never a playback/evaluation owner. */
export class AnimationCurve {
	public readonly bounds = create_rect_bounds();
	/** Connected visible runs. Storage is retained across dirty projections. */
	public readonly paths: number[][] = [];
	public pathCount = 0;
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
	private track: AnimationTrackSource | undefined;
	/** Resolution is a fact of authored source, not a track-wide playback grant. */
	private readonly fields: number[] = [];
	private topologyKnown = false;

	public bind(keys: AnimationKeyViewport): void {
		const track = keys.track;
		this.previewField = undefined;
		this.revision++;
		if (this.track === track) return;
		this.track = track;
		this.available = false; this.fields.length = 0;
		if (track?.kind !== 'value' || track.unit === undefined || track.unit === 'u'
			|| track.interpolation !== 'linear' && track.interpolation !== 'cubic' && track.interpolation !== 'step') return;
		this.topologyKnown = keys.timeOrder.length === track.keys.length;
		for (const key of track.keys) {
			let resolved = 0;
			if (key.value !== undefined && key.value.value !== null) resolved |= ResolvedFields.Value;
			if (key.arrive !== undefined && key.arrive.value !== null) resolved |= ResolvedFields.Arrive;
			if (key.leave !== undefined && key.leave.value !== null) resolved |= ResolvedFields.Leave;
			this.fields.push(resolved);
		}
		for (const index of keys.timeOrder) {
			if ((this.fields[index] & ResolvedFields.Value) === 0) continue;
			const value = track.keys[index].value!.value!;
			if (!this.available) { this.minimum = this.maximum = value; this.available = true; }
			else { this.minimum = Math.min(this.minimum, value); this.maximum = Math.max(this.maximum, value); }
		}
		if (!this.available) return;
		if (this.topologyKnown && track.interpolation === 'cubic') for (let segment = 0; segment + 1 < keys.timeOrder.length; segment++) {
			const first = keys.timeOrder[segment], next = keys.timeOrder[segment + 1];
			if (this.segmentResolved(first, next)) this.includeSegmentExtrema(keys, first, next);
		}
		const padding = this.maximum === this.minimum ? Math.max(1, Math.abs(this.minimum) * 0.1) : (this.maximum - this.minimum) * 0.2;
		this.minimum -= padding; this.maximum += padding;
		this.minimumLabel = formatNumber(this.minimum); this.maximumLabel = formatNumber(this.maximum);
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
			if ((this.fields[index] & ResolvedFields.Value) === 0) continue;
			const dx = keys.xAt(keys.positionAt(index)) - x, dy = this.yAt(this.fieldValue(keys, index, 'value')) - y;
			const squared = dx * dx + dy * dy;
			if (squared < distance) { closest = index; distance = squared; }
		}
		return closest;
	}
	public handleAt(x: number, y: number): 'arrive' | 'leave' | undefined {
		if (this.arriveHandle.length && Math.abs(x - this.arriveHandle[2]) < 6 && Math.abs(y - this.arriveHandle[3]) < 6) return 'arrive';
		if (this.leaveHandle.length && Math.abs(x - this.leaveHandle[2]) < 6 && Math.abs(y - this.leaveHandle[3]) < 6) return 'leave';
		return undefined;
	}
	public update(keys: AnimationKeyViewport): void {
		const revision = this.revision + keys.revision;
		if (this.geometryRevision === revision) return;
		this.geometryRevision = revision;
		this.pathCount = 0; this.markers.length = 0; this.arriveHandle.length = 0; this.leaveHandle.length = 0;
		const order = keys.timeOrder;
		if (!this.available) return;
		let path: number[] | undefined;
		if (this.topologyKnown && (this.fields[order[0]] & ResolvedFields.Value) !== 0
			&& keys.track!.interpolation !== 'step' && keys.range.minimum < keys.positionAt(order[0])) {
			const y = this.yAt(this.fieldValue(keys, order[0], 'value'));
			path = this.beginPath();
			path.push(keys.xAt(keys.range.minimum), y, keys.xAt(Math.min(keys.range.maximum, keys.positionAt(order[0]))), y);
		}
		const endSegment = keys.timeIndex(keys.range.maximum, true);
		for (let segment = Math.max(0, keys.timeIndex(keys.range.minimum) - 1); segment < endSegment; segment++) {
			const index = order[segment], x = keys.positionAt(index);
			if ((this.fields[index] & ResolvedFields.Value) !== 0 && x >= keys.range.minimum && x <= keys.range.maximum) {
				const pixelX = keys.xAt(x), pixelY = this.yAt(this.fieldValue(keys, index, 'value'));
				this.markers.push(index, pixelX, pixelY);
				if (path !== undefined && keys.track!.interpolation === 'step') path.push(pixelX, pixelY);
			}
			if (!this.topologyKnown || segment + 1 >= order.length) continue;
			const next = order[segment + 1], end = keys.positionAt(next), span = end - x;
			if (span <= 0 || !this.segmentResolved(index, next)) { path = undefined; continue; }
			const left = Math.max(x, keys.range.minimum), right = Math.min(end, keys.range.maximum);
			if (right < left) continue;
			if (path === undefined) path = this.beginPath();
			if (keys.track!.interpolation === 'step') {
				path.push(keys.xAt(left), this.yAt(this.fieldValue(keys, index, 'value')), keys.xAt(right), this.yAt(this.fieldValue(keys, index, 'value')));
			} else {
				const count = Math.max(1, (Math.abs(keys.xAt(right) - keys.xAt(left)) / 4) | 0);
				for (let sample = 0; sample <= count; sample++) {
					const position = left + (right - left) * sample / count;
					path.push(keys.xAt(position), this.yAt(this.segmentValue(keys, index, next, (position - x) / span)));
				}
			}
		}
		const last = order[order.length - 1];
		if (this.topologyKnown && (this.fields[last] & ResolvedFields.Value) !== 0 && keys.range.maximum > keys.positionAt(last)) {
			const y = this.yAt(this.fieldValue(keys, last, 'value'));
			if (path === undefined) path = this.beginPath();
			path.push(keys.xAt(Math.max(keys.range.minimum, keys.positionAt(last))), y, keys.xAt(keys.range.maximum), y);
		}
		if (!this.topologyKnown || keys.selected < 0 || (this.fields[keys.selected] & ResolvedFields.Value) === 0 || keys.track!.interpolation !== 'cubic') return;
		const index = keys.selected, x = keys.xAt(keys.positionAt(index)), value = this.fieldValue(keys, index, 'value'), y = this.yAt(value);
		const unitsPerPixel = (keys.range.maximum - keys.range.minimum) / (keys.range.bounds.right - keys.range.bounds.left - 6);
		if (index !== order[0] && (this.fields[index] & ResolvedFields.Arrive) !== 0) this.projectTangent(this.arriveHandle, x, y, -1, this.fieldValue(keys, index, 'arrive'), unitsPerPixel);
		if (index !== last && (this.fields[index] & ResolvedFields.Leave) !== 0) this.projectTangent(this.leaveHandle, x, y, 1, this.fieldValue(keys, index, 'leave'), unitsPerPixel);
	}
	private beginPath(): number[] {
		if (this.pathCount === this.paths.length) this.paths.push([]);
		const path = this.paths[this.pathCount++]; path.length = 0;
		return path;
	}
	/** A segment consumes its native fields; unknown source expressions remain gaps. */
	private segmentResolved(first: number, next: number): boolean {
		if ((this.fields[first] & ResolvedFields.Value) === 0) return false;
		if (this.track!.interpolation === 'step') return true;
		if ((this.fields[next] & ResolvedFields.Value) === 0) return false;
		return this.track!.interpolation !== 'cubic' || (this.fields[first] & ResolvedFields.Leave) !== 0 && (this.fields[next] & ResolvedFields.Arrive) !== 0;
	}
	/** A slope owns a direction, not an arbitrary horizontal arm or a native handle length. */
	private projectTangent(handle: number[], x: number, y: number, side: number, slope: number, unitsPerPixel: number): void {
		const gradient = slope * unitsPerPixel / this.valueDelta(1);
		const length = 32 / Math.hypot(1, gradient);
		handle.push(x, y, x + side * length, y + side * gradient * length);
	}
	/** Fit native Hermite extrema once, rather than sampling every segment repeatedly. */
	private includeSegmentExtrema(keys: AnimationKeyViewport, first: number, next: number): void {
		const a = this.fieldValue(keys, first, 'value'), b = this.fieldValue(keys, next, 'value');
		const span = keys.positionAt(next) - keys.positionAt(first);
		const leave = this.fieldValue(keys, first, 'leave') * span, arrive = this.fieldValue(keys, next, 'arrive') * span;
		const cubic = 2 * a - 2 * b + leave + arrive, quadratic = -3 * a + 3 * b - 2 * leave - arrive;
		let firstRoot: number, secondRoot: number;
		if (cubic === 0) {
			if (quadratic === 0) return;
			firstRoot = secondRoot = -leave / (2 * quadratic);
		} else {
			const discriminant = quadratic * quadratic - 3 * cubic * leave;
			if (discriminant < 0) return;
			const root = Math.sqrt(discriminant);
			firstRoot = (-quadratic - root) / (3 * cubic); secondRoot = (-quadratic + root) / (3 * cubic);
		}
		for (let index = 0; index < (firstRoot === secondRoot ? 1 : 2); index++) {
			const u = index === 0 ? firstRoot : secondRoot;
			if (u > 0 && u < 1) {
				const value = this.segmentValue(keys, first, next, u);
				this.minimum = Math.min(this.minimum, value); this.maximum = Math.max(this.maximum, value);
			}
		}
	}
	private segmentValue(keys: AnimationKeyViewport, first: number, next: number, u: number): number {
		const a = this.fieldValue(keys, first, 'value'), b = this.fieldValue(keys, next, 'value');
		if (keys.track!.interpolation !== 'cubic') return a + (b - a) * u;
		const span = keys.positionAt(next) - keys.positionAt(first);
		const leave = this.fieldValue(keys, first, 'leave') * span, arrive = this.fieldValue(keys, next, 'arrive') * span;
		return (((2 * a - 2 * b + leave + arrive) * u + (-3 * a + 3 * b - 2 * leave - arrive)) * u + leave) * u + a;
	}
}
