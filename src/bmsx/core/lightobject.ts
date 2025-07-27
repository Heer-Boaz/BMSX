import type { AmbientLight, DirectionalLight, Light, PointLight } from '../render/3d/light';
import { GLView } from '../render/glview';
import { insavegame } from '../serializer/gameserializer';
import { GameObject } from './gameobject';

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
            view.view3d.setAmbientLight(l.color, l.intensity);
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
            view.view3d.addDirectionalLight(l.id, l.direction, l.color);
        } else {
            view.view3d.removeDirectionalLight(l.id);
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
            view.view3d.addPointLight(l.id, l.position, l.color, l.range);
        } else {
            view.view3d.removePointLight(l.id);
        }
    }

}
