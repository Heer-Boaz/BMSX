import { GameObject } from './gameobject';
import { insavegame } from '../serializer/gameserializer';
import type { AmbientLight, DirectionalLight, PointLight, Light } from '../render/light';
import { GLView } from '../render/glview';
import type { Vector } from '../rompack/rompack';

@insavegame
export abstract class LightObject extends GameObject {
    public light: Light;
    public active: boolean;

    constructor(light: Light, id?: string) {
        super(id);
        this.light = light;
        this.active = true;
    }

    public abstract applyToView(view: GLView): void;
}

export class AmbientLightObject extends LightObject {
    constructor(id: string, color: [number, number, number], intensity: number) {
        super({ id, type: 'ambient', color, intensity });
    }

    override applyToView(view: GLView): void {
        if (this.active) {
            const l = this.light as AmbientLight;
            view.setAmbientLight(l.color, l.intensity);
        }
    }

}

export class DirectionalLightObject extends LightObject {
    constructor(id: string, direction: [number, number, number], color: [number, number, number]) {
        super({ id, type: 'directional', direction, color, intensity: 1 });
    }

    override applyToView(view: GLView): void {
        const l = this.light as DirectionalLight;
        if (this.active) {
            view.addDirectionalLight(l.id, l.direction, l.color);
        } else {
            view.removeDirectionalLight(l.id);
        }
    }

}

export class PointLightObject extends LightObject {
    constructor(id: string, position: [number, number, number], color: [number, number, number], range: number) {
        super({ id, type: 'point', position, color, range, intensity: 1 });
    }

    override applyToView(view: GLView): void {
        const l = this.light as PointLight;
        if (this.active) {
            view.addPointLight(l.id, l.position, l.color, l.range);
        } else {
            view.removePointLight(l.id);
        }
    }

}
