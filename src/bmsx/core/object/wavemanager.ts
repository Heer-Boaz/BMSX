import { EventEmitter } from '../eventemitter';
import { EventTimeline } from '../eventtimeline';
import { WorldObject } from './worldobject';

export type SpawnFactory = (data?: any) => WorldObject | void;
interface Handler { name: string; fn: SpawnFactory; }

// Generic wave / spawn manager listening to an EventTimeline instead of rail events.
export class WaveManager extends EventEmitter {
	private timeline: EventTimeline; private handlers: Handler[] = [];
	constructor(timeline: EventTimeline) { super(); this.timeline = timeline; }
		onSpawn(eventName: string, factory: SpawnFactory): this {
			this.handlers.push({ name: eventName, fn: factory });
			this.timeline.on(eventName, (_event, _emitter, payload) => {
				const wo = factory(payload);
				if (wo) this.emit('spawned', wo);
			}, this);
			return this;
		}
}
