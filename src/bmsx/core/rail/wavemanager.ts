// Wave / spawn manager that listens to rail events.
import { EventEmitter } from '../eventemitter';
import { GameObject } from '../gameobject';
import { RailPath } from './railpath';

export type SpawnFactory = (data?: any) => GameObject | void;
interface Handler { name: string; fn: SpawnFactory; }

export class WaveManager extends EventEmitter {
    private rail: RailPath; private handlers: Handler[] = [];
    constructor(rail: RailPath) { super(); this.rail = rail; }
    onSpawn(eventName: string, factory: SpawnFactory): this {
        this.handlers.push({ name: eventName, fn: factory });
        this.rail.on(eventName, (data: any) => { const go = factory(data); if (go) this.emit('spawned', go); }, this);
        return this;
    }
}
