import { clamp } from '../utils/clamp';
import { get_easing } from '../utils/easing';

export const TIMELINE_START_INDEX = -1;

export type TimelinePlaybackMode = 'once' | 'loop' | 'pingpong';

export type TimelineTape<T = any> = T[];

export type TimelineFrameMarkerAt = { frame: number };
export type TimelineUTMarkerAt = { u: number };

export type TimelineMarkerAt = TimelineFrameMarkerAt | TimelineUTMarkerAt;

export type TimelineMarker = TimelineMarkerAt & {
	event: string;
	payload?: Record<string, any>;
	add_tags?: string[];
	remove_tags?: string[];
};

export type TimelineWindow = {
	name: string;
	start: TimelineMarkerAt;
	end: TimelineMarkerAt;
	tag?: string;
	payloadstart?: Record<string, any>;
	payloadend?: Record<string, any>;
};

export interface CompiledTimelineMarker {
	frame: number;
	event: string;
	payload?: Record<string, any>;
	addtags?: string[];
	removetags?: string[];
}

export interface CompiledTimelineMarkerCache {
	by_frame: Record<number, CompiledTimelineMarker[]>;
	controlled_tags: string[];
}

export interface TimelineDefinition<T = any> {
	id: string;
	frames: TimelineTape<T>;
	ticks_per_frame?: number;
	playback_mode?: TimelinePlaybackMode;
	easing?: string;
	repetitions?: number;
	autotick?: boolean;
	markers?: TimelineMarker[];
	windows?: TimelineWindow[];
}

export type TimelineFrameChangeReason = 'advance' | 'seek' | 'snap';

export interface TimelineFrameEvent<T = any> {
	kind: 'frame';
	previous: number;
	current: number;
	value: T | undefined;
	rewound: boolean;
	reason: TimelineFrameChangeReason;
	direction: 1 | -1;
}

export interface TimelineEndEvent {
	kind: 'end';
	frame: number;
	mode: TimelinePlaybackMode;
	wrapped: boolean;
}

export type TimelineEvent<T = any> = TimelineFrameEvent<T> | TimelineEndEvent;

export function expand_timeline_windows(markers: TimelineMarker[] = [], windows: TimelineWindow[] = []): TimelineMarker[] {
	if (!windows || windows.length === 0) return markers;
	const out = [...markers];
	for (const windowDef of windows) {
		const tag = windowDef.tag ?? `timeline.window.${windowDef.name}`;
		out.push(
			{ ...windowDef.start, event: `window.${windowDef.name}.start`, payload: windowDef.payloadstart, add_tags: [tag] },
			{ ...windowDef.end, event: `window.${windowDef.name}.end`, payload: windowDef.payloadend, remove_tags: [tag] },
		);
	}
	return out;
}

export function compile_timeline_markers<T>(def: TimelineDefinition<T>): CompiledTimelineMarkerCache {
	const cache: CompiledTimelineMarkerCache = { by_frame: {}, controlled_tags: [] };
	const frames = expandTimelineFrames(def.frames ?? [], def.repetitions ?? 1);
	if (frames.length === 0) return cache;
	const rawMarkers = def.markers ? [...def.markers] : [];
	const expanded = expand_timeline_windows(rawMarkers, def.windows);
	const controlled = new Set<string>();
	for (const marker of expanded) {
		const frame = clamp_marker_frame(marker, frames.length);
		let bucket = cache.by_frame[frame];
		if (!bucket) {
			bucket = [];
			cache.by_frame[frame] = bucket;
		}
		if (marker.add_tags) marker.add_tags.forEach(tag => controlled.add(tag));
		if (marker.remove_tags) marker.remove_tags.forEach(tag => controlled.add(tag));
		bucket.push({
			frame,
			event: marker.event,
			payload: marker.payload,
			addtags: marker.add_tags,
			removetags: marker.remove_tags,
		});
	}
	cache.controlled_tags = Array.from(controlled);
	return cache;
}

function clamp_marker_frame(at: TimelineMarkerAt, length: number): number {
	if ((at as TimelineFrameMarkerAt).frame !== undefined) {
		return clamp((at as TimelineFrameMarkerAt).frame, 0, Math.max(0, length - 1));
	}
	const normalized = clamp((at as TimelineUTMarkerAt).u, 0, 1);
	return clamp(Math.round(normalized * (length - 1)), 0, Math.max(0, length - 1));
}

export class Timeline<T = any> {
	public readonly def: TimelineDefinition<T>;
	public readonly id: string;

	private readonly frames: TimelineTape<T>;
	private readonly ticks_per_frame: number;
	private readonly playback_mode: TimelinePlaybackMode;
	private readonly easing_fn?: (t: number) => number;
	private readonly auto_tick: boolean;

	private _head: number = TIMELINE_START_INDEX;
	private _ticks = 0;
	private _tick_threshold = Number.POSITIVE_INFINITY;
	private _direction: 1 | -1 = 1;

	constructor(def: TimelineDefinition<T>) {
		if (!def || typeof def.id !== 'string' || def.id.length === 0) {
			throw new Error('[Timeline] Timeline requires a non-empty id.');
		}
		if (!Array.isArray(def.frames)) {
			throw new Error(`[Timeline] Timeline '${def.id}' requires a frames array.`);
		}
		this.def = { ...def };
		this.id = def.id;
		this.frames = expandTimelineFrames(def.frames, def.repetitions ?? 1);
		this.ticks_per_frame = def.ticks_per_frame ?? 0;
		this.playback_mode = def.playback_mode ?? 'once';
		this.easing_fn = def.easing ? get_easing(def.easing) : undefined;
		this.auto_tick = def.autotick ?? (this.ticks_per_frame !== 0);
		this.updateTickThreshold();
	}

	get length(): number {
		return this.frames.length;
	}

	get head(): number {
		return this._head;
	}

	get direction(): 1 | -1 {
		return this._direction;
	}

	get value(): T | undefined {
		if (this._head < 0 || this._head >= this.frames.length) return undefined;
		return this.frames[this._head];
	}

	public rewind(): void {
		this._head = TIMELINE_START_INDEX;
		this._ticks = 0;
		this._direction = 1;
		this.updateTickThreshold();
	}

	public tick(dt: number): TimelineEvent<T>[] {
		if (!this.auto_tick || this.frames.length === 0) return [];
		this._ticks += dt;
		if (this.ticks_per_frame <= 0 || this._ticks >= this._tick_threshold) {
			return this.advanceInternal('advance');
		}
		return [];
	}

	public advance(): TimelineEvent<T>[] {
		return this.advanceInternal('advance');
	}

	public seek(frame: number): TimelineEvent<T>[] {
		return this.applyFrame(frame, 'seek');
	}

	public snap_to_start(): TimelineEvent<T>[] {
		return this.applyFrame(0, 'snap');
	}

	public force_seek(frame: number): void {
		if (this.frames.length === 0) {
			this._head = TIMELINE_START_INDEX;
			this._ticks = 0;
			this._direction = 1;
			this.updateTickThreshold();
			return;
		}
		const clamped = clamp(frame, TIMELINE_START_INDEX, this.frames.length - 1);
		this._head = clamped;
		this._ticks = 0;
		if (this.playback_mode !== 'pingpong') {
			this._direction = 1;
		} else if (clamped <= 0) {
			this._direction = 1;
		}
		this.updateTickThreshold();
	}

	private advanceInternal(reason: TimelineFrameChangeReason): TimelineEvent<T>[] {
		if (this.frames.length === 0) return [];
		const delta = this.playback_mode === 'pingpong' ? this._direction : 1;
		const target = this._head + (this._head === TIMELINE_START_INDEX ? 1 : delta);
		return this.applyFrame(target, reason);
	}

	private applyFrame(target: number, reason: TimelineFrameChangeReason): TimelineEvent<T>[] {
		const events: TimelineEvent<T>[] = [];
		if (this.frames.length === 0) return events;

		const lastIndex = this.frames.length - 1;
		const previous = this._head;
		let next = target;
		let rewound = false;
		let emitFrame = true;
		let emitEnd = false;
		let wrapped = false;

		if (reason === 'seek') {
			this._direction = 1;
		}

		if (next < 0) {
			next = 0;
			this._direction = 1;
			emitEnd = true;
		} else if (next > lastIndex) {
			if (this.playback_mode === 'loop') {
				next = 0;
				rewound = true;
				emitEnd = true;
				wrapped = true;
				this._direction = 1;
			} else if (this.playback_mode === 'pingpong') {
				next = lastIndex;
				if (lastIndex > 0) this._direction = -1;
				if (previous === next) emitFrame = false;
				emitEnd = true;
			} else {
				next = lastIndex;
				if (previous === next) emitFrame = false;
				emitEnd = true;
				this._direction = 1;
			}
		}

		if (previous === next && !rewound && !emitEnd && reason === 'advance') {
			return events;
		}

		this._head = next;
		this._ticks = 0;
		this.updateTickThreshold();

		if (emitFrame) {
			events.push({
				kind: 'frame',
				previous,
				current: next,
				value: this.frames[next],
				rewound,
				direction: this._direction,
				reason,
			});
		}

		if (emitEnd) {
			events.push({
				kind: 'end',
				frame: this._head,
				mode: this.playback_mode,
				wrapped,
			});
		}

		return events;
	}

	private updateTickThreshold(): void {
		if (!this.easing_fn) {
			this._tick_threshold = this.ticks_per_frame;
			return;
		}
		if (this.ticks_per_frame <= 0 || this.frames.length === 0) {
			this._tick_threshold = this.ticks_per_frame;
			return;
		}
		const before = computeProgress(this._head, this.frames.length);
		const after = computeProgress(this._head + this._direction, this.frames.length);
		if (after === before) {
			this._tick_threshold = Number.POSITIVE_INFINITY;
			return;
		}
		const easedBefore = this.easing_fn(before);
		const easedAfter = this.easing_fn(after);
		const delta = Math.abs(easedAfter - easedBefore);
		const scaled = this.ticks_per_frame * (delta > 0 ? delta * this.frames.length : 1);
		this._tick_threshold = Math.max(scaled, Number.EPSILON);
	}
}

export function expandTimelineFrames<T>(frames: TimelineTape<T>, repetitions: number): TimelineTape<T> {
	if (!frames || frames.length === 0) return [];
	if (repetitions <= 1) return [...frames];
	const out: T[] = [];
	for (let i = 0; i < repetitions; i++) {
		out.push(...frames);
	}
	return out;
}

function computeProgress(index: number, length: number): number {
	if (length === 0) return 0;
	const clamped = clamp(index, TIMELINE_START_INDEX, length);
	if (clamped <= TIMELINE_START_INDEX) return 0;
	if (clamped >= length) return 1;
	return (clamped + 1) / length;
}
