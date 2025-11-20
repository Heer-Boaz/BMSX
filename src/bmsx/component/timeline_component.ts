import { Component, type ComponentAttachOptions } from './basecomponent';
import type { WorldObject } from '../core/object/worldobject';
import {
	Timeline,
	compile_timeline_markers,
	type TimelineDefinition,
	type CompiledTimelineMarkerCache,
	type TimelineEvent,
	type TimelineFrameEvent,
	type TimelineFrameChangeReason,
	type TimelinePlaybackMode,
} from '../timeline/timeline';
import { AbilitySystemComponent } from './abilitysystemcomponent';
import { create_gameevent } from '../core/game_event';
import { insavegame } from '../serializer/serializationhooks';
import { unique_strings } from '../utils/unique_strings';

export type TimelinePlayOptions = {
	rewind?: boolean; // if true, will rewind the timeline to start before playing
	snap_to_start?: boolean; // if true, will emit all frame events up to the current frame after rewinding
};

export type TimelineFrameEventPayload<T = unknown> = {
	timeline_id: string;
	frame_index: number;
	frame_value: T | undefined;
	rewound: boolean;
	reason: TimelineFrameChangeReason;
	direction: 1 | -1;
};

export type TimelineEndEventPayload = {
	timeline_id: string;
	mode: TimelinePlaybackMode;
	wrapped: boolean;
};

export type TimelineListener = {
	frame?(event: TimelineFrameEventPayload): void;
	end?(event: TimelineEndEventPayload): void;
};

type RegisteredTimeline = {
	instance: Timeline;
	compiled: CompiledTimelineMarkerCache;
};

@insavegame
export class TimelineComponent extends Component<WorldObject> {
	public static override get unique(): boolean { return true; }

	private readonly registry = new Map<string, RegisteredTimeline>();
	private readonly active = new Set<string>();
	private readonly listeners = new Map<string, Set<TimelineListener>>();

	constructor(opts: ComponentAttachOptions) {
		super(opts);
	}

	public has(id: string): boolean {
		return this.registry.has(id);
	}

	public define(source: TimelineDefinition | Timeline): void {
		let instance: Timeline;
		if (source instanceof Timeline) {
			instance = source;
		} else {
			if (!source || typeof source.id !== 'string' || source.id.length === 0) {
				throw new Error('[TimelineComponent] define() requires a timeline definition with an id.');
			}
			const frames = Array.isArray(source.frames) ? [...source.frames] : [];
			const normalized: TimelineDefinition = {
				...source,
				id: source.id,
				frames,
			};
			instance = new Timeline(normalized);
		}
		const compiled = compile_timeline_markers(instance.def);
		this.registry.set(instance.id, { instance, compiled });
	}

	public play(id: string, opts?: TimelinePlayOptions): Timeline {
		const entry = this.registry.get(id);
		if (!entry) throw new Error(`[TimelineComponent] Unknown timeline '${id}' requested on '${this.parent?.id}'.`);
		const { instance } = entry;
		const rewind = opts?.rewind ?? true;
		const snap = opts?.snap_to_start ?? true;
		if (rewind) {
			instance.rewind();
			this.resync_tags(entry);
		}
		if (snap && instance.length > 0) {
			this.process_events(entry, instance.snap_to_start());
		}
		this.active.add(id);
		return instance;
	}

	public stop(id: string): void {
		this.active.delete(id);
	}

	public rewind(id: string): void {
		const entry = this.registry.get(id);
		if (!entry) return;
		entry.instance.rewind();
		this.resync_tags(entry);
	}

	public seek(id: string, frame: number): void {
		const entry = this.registry.get(id);
		if (!entry) return;
		const events = entry.instance.seek(frame);
		if (events.length === 0) return;
		this.process_events(entry, events);
	}

	public force_seek(id: string, frame: number): void {
		const entry = this.registry.get(id);
		if (!entry) return;
		entry.instance.force_seek(frame);
		this.resync_tags(entry);
	}

	public advance(id: string): void {
		const entry = this.registry.get(id);
		if (!entry) return;
		const events = entry.instance.advance();
		if (events.length === 0) return;
		this.process_events(entry, events);
	}

	public tick_active(dt: number): void {
		for (const id of [...this.active]) {
			const entry = this.registry.get(id);
			if (!entry) continue;
			const events = entry.instance.tick(dt);
			if (events.length === 0) continue;
			this.process_events(entry, events);
		}
	}

	public get<T = Timeline>(id: string): Timeline<T> | undefined {
		return this.registry.get(id)?.instance as Timeline<T> | undefined;
	}

	public add_listener(id: string, listener: TimelineListener): () => void {
		let bucket = this.listeners.get(id);
		if (!bucket) {
			bucket = new Set();
			this.listeners.set(id, bucket);
		}
		bucket.add(listener);
		return () => {
			const existing = this.listeners.get(id);
			if (!existing) return;
			existing.delete(listener);
			if (existing.size === 0) {
				this.listeners.delete(id);
			}
		};
	}

	private process_events(entry: RegisteredTimeline, events: TimelineEvent[]): void {
		for (const evt of events) {
			// if ($.debug) {
			// 	console.log('[Timeline][event]', {
			// 		parent: this.parent.id,
			// 		timeline: entry.instance.id,
			// 		kind: evt.kind,
			// 		current: (evt as TimelineFrameEvent).current ?? (evt as TimelineEndEvent).frame,
			// 		value: evt.kind === 'frame' ? (evt as TimelineFrameEvent).value : undefined,
			// 	});
			// }
			if (evt.kind === 'frame') {
				const payload: TimelineFrameEventPayload = {
					timeline_id: entry.instance.id,
					frame_index: evt.current,
					frame_value: evt.value,
					rewound: evt.rewound,
					reason: evt.reason,
					direction: evt.direction,
				};
				this.apply_markers(entry, evt);
				this.emit_frameevent(entry, payload);
				this.dispatch_frame_listeners(entry.instance.id, payload);
			} else {
				const payload: TimelineEndEventPayload = {
					timeline_id: entry.instance.id,
					mode: evt.mode,
					wrapped: evt.wrapped,
				};
				this.emit_endevent(payload);
				this.dispatch_end_listeners(entry.instance.id, payload);
				const shouldStop = evt.mode === 'once';
				if (shouldStop) {
					this.active.delete(entry.instance.id);
				}
			}
		}
	}

	private resync_tags(entry: RegisteredTimeline): void {
		const compiled = entry.compiled;
		if (!compiled || compiled.controlled_tags.length === 0) return;
		const abilitySystem = (this.parent as WorldObject & { abilitySystem?: AbilitySystemComponent }).abilitysystem;
		if (!abilitySystem) return;
		const tags = unique_strings(compiled.controlled_tags);
		if (tags.length === 0) return;
		abilitySystem.remove_tags(...tags);
	}

	private apply_markers(entry: RegisteredTimeline, event: TimelineFrameEvent): void {
		const compiled = entry.compiled;
		if (!compiled) return;
		const bucket = compiled.by_frame[event.current];
		if (!bucket || bucket.length === 0) return;
		const target = this.parent as WorldObject & { abilitySystem?: AbilitySystemComponent };
		for (const marker of bucket) {
			if ((marker.addtags || marker.removetags) && !target.abilitysystem) {
				throw new Error(`[TimelineComponent] Marker '${marker.event}' requires ability system on '${target.id}'.`);
			}
			if (marker.addtags && marker.addtags.length > 0) {
				target.abilitysystem?.add_tags(...unique_strings(marker.addtags));
			}
			if (marker.removetags && marker.removetags.length > 0) {
				target.abilitysystem?.remove_tags(...unique_strings(marker.removetags));
			}
			const payload = marker.payload ? { ...marker.payload } : undefined;
			target.events.emit(marker.event, payload);
		}
	}

	private emit_frameevent(_entry: RegisteredTimeline, payload: TimelineFrameEventPayload): void {
		const owner = this.parent!;
		this.dispatchTimelineEvents(owner, 'timeline.frame', payload);
	}

	private emit_endevent(payload: TimelineEndEventPayload): void {
		const owner = this.parent!;
		this.dispatchTimelineEvents(owner, 'timeline.end', payload);
	}

	private dispatchTimelineEvents(
		owner: WorldObject,
		baseType: 'timeline.frame' | 'timeline.end',
		payload: TimelineFrameEventPayload | TimelineEndEventPayload,
	): void {
		const baseEvent = create_gameevent({ type: baseType, emitter: owner, ...payload });
		owner.events.emitEvent(baseEvent);
		owner.sc.dispatch_event(baseEvent);
		const scopedType = `${baseType}.${payload.timeline_id}`;
		const scopedEvent = create_gameevent({ type: scopedType, emitter: owner, ...payload });
		owner.events.emitEvent(scopedEvent);
		owner.sc.dispatch_event(scopedEvent);
	}

	private dispatch_frame_listeners(id: string, payload: TimelineFrameEventPayload): void {
		const listeners = this.listeners.get(id);
		if (!listeners || listeners.size === 0) return;
		for (const listener of [...listeners]) {
			listener.frame?.(payload);
		}
	}

	private dispatch_end_listeners(id: string, payload: TimelineEndEventPayload): void {
		const listeners = this.listeners.get(id);
		if (!listeners || listeners.size === 0) return;
		for (const listener of [...listeners]) {
			listener.end?.(payload);
		}
	}
}
