import type { Light } from '../../render/3d/light';
import { insavegame } from '../../serializer/gameserializer';
import { WorldObject } from './worldobject';

@insavegame
export abstract class LightObject extends WorldObject {
    public light: Light;
    public active: boolean;

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

    constructor(light: Light, id?: string) {
        super(id);
        this.light = light;
        this.active = true;
    }

}

@insavegame
export class AmbientLightObject extends LightObject {
    public static readonly DEFAULT_COLOR: [number, number, number] = [1, 1, 1];
    public static readonly DEFAULT_INTENSITY: number = 1;
    public static readonly DEFAULT_ID: string = 'ambient_light';

    public static createDefault(): AmbientLightObject {
        return new AmbientLightObject(AmbientLightObject.DEFAULT_COLOR, AmbientLightObject.DEFAULT_INTENSITY, AmbientLightObject.DEFAULT_ID);
    }

    constructor(color: [number, number, number], intensity: number, id?: string) {
        super({ type: 'ambient', color, intensity }, id);
    }

}

@insavegame
export class DirectionalLightObject extends LightObject {
    constructor(orientation: [number, number, number], color: [number, number, number], intensity: number = 1, id?: string) {
        super({ type: 'directional', orientation: orientation, color, intensity }, id);
    }

}

@insavegame
export class PointLightObject extends LightObject {
    constructor(pos: [number, number, number], color: [number, number, number], range: number, intensity: number = 1, id?: string) {
        super({ type: 'point', pos, color, range, intensity }, id);
    }

}
