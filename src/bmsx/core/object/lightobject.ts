import type { Identifier } from 'bmsx/rompack/rompack';
import type { Light } from '../../render/3d/light';
import { insavegame, type RevivableObjectArgs } from '../../serializer/gameserializer';
import { WorldObject } from './worldobject';

@insavegame
export abstract class LightObject extends WorldObject {
    public light: Light;

    public get color() {
        return this.light.color;
    }

    public set color(c: [number, number, number]) {
        this.light.color = c;
    }

    public get intensity() {
        return this.light.intensity;
    }

    public set intensity(i: number) {
        this.light.intensity = i;
    }

    public get type() {
        return this.light.type;
    }

    constructor(opts: RevivableObjectArgs & { light: Light, id?: string }) {
        super(opts);
        this.light = opts.light;
        this.active = true;
    }

}

@insavegame
export class AmbientLightObject extends LightObject {
    public static readonly DEFAULT_COLOR: [number, number, number] = [1, 1, 1];
    public static readonly DEFAULT_INTENSITY: number = 1;
    public static readonly DEFAULT_ID: string = 'ambient_light';

    public static createDefault(): AmbientLightObject {
        return new AmbientLightObject({ color: AmbientLightObject.DEFAULT_COLOR, intensity: AmbientLightObject.DEFAULT_INTENSITY });
    }

    constructor(opts: RevivableObjectArgs & { id?: Identifier, color: [number, number, number], intensity: number }) {
        super({ light: { type: 'ambient', ...opts } });
    }

}

@insavegame
export class DirectionalLightObject extends LightObject {
    constructor(opts: RevivableObjectArgs & { orientation: [number, number, number], color: [number, number, number], intensity: number, id?: string }) {
        super({ light: { type: 'directional', ...opts } });
    }

}

@insavegame
export class PointLightObject extends LightObject {
    constructor(opts: RevivableObjectArgs & { light: { pos: [number, number, number], color: [number, number, number], range: number, intensity: number, id?: string } }) {
        super({ light: { type: 'point', ...opts.light } });
    }

}
