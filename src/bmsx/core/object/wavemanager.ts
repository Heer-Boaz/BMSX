import { EventEmitter } from '../eventemitter';
import { EventTimeline } from '../eventtimeline';
import { GameObject } from './gameobject';

export type SpawnFactory = (data?: any) => GameObject | void;
interface Handler { name: string; fn: SpawnFactory; }

// Generic wave / spawn manager listening to an EventTimeline instead of rail events.
export class WaveManager extends EventEmitter {
    private timeline: EventTimeline; private handlers: Handler[] = [];
    constructor(timeline: EventTimeline) { super(); this.timeline = timeline; }
    onSpawn(eventName: string, factory: SpawnFactory): this {
        this.handlers.push({ name: eventName, fn: factory });
        this.timeline.on(eventName, (data: any) => {
            const go = factory(data);
            if (go) this.emit('spawned', go);
        }, this);
        return this;
    }
}
