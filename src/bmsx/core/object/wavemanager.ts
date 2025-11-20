import { EventEmitter } from '../eventemitter';
import { create_gameevent, type GameEvent } from '../game_event';
import { EventTimeline } from '../eventtimeline';
import { WorldObject } from './worldobject';

export type SpawnFactory = (data?: any) => WorldObject | void;
interface Handler { name: string; fn: SpawnFactory; }

export class WaveManager extends EventEmitter {
	private readonly timeline: EventTimeline;
	private readonly handlers: Handler[] = [];

	constructor(timeline: EventTimeline) {
		super();
		this.timeline = timeline;
	}

	public onSpawn(eventName: string, factory: SpawnFactory): this {
		this.handlers.push({ name: eventName, fn: factory });
		this.timeline.on({
			event_name: eventName,
			handler: (event: GameEvent) => {
				const wo = factory(event);
				if (!wo) return;
				const spawnEvent = create_gameevent({ type: 'spawned', emitter: wo, object: wo });
				this.emit(spawnEvent);
			},
			subscriber: this,
		});
		return this;
	}
}
