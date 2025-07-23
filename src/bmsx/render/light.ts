import type { vec3arr } from '../rompack/rompack';

export interface BaseLight {
    /** Unique identifier for this light */
    id: string;
    color: vec3arr;
    intensity: number;
}

export interface AmbientLight extends BaseLight {
    type: 'ambient';
}

export interface DirectionalLight extends BaseLight {
    type: 'directional';
    direction: vec3arr;
}

export interface PointLight extends BaseLight {
    type: 'point';
    position: vec3arr;
    range: number;
}

export interface SpotLight extends BaseLight {
    type: 'spot';
    position: vec3arr;
    direction: vec3arr;
    angle: number;
    range: number;
}

export interface AreaLight extends BaseLight {
    type: 'area';
    position: vec3arr;
    size: [number, number];
    normal: vec3arr;
}

export type Light = AmbientLight | DirectionalLight | PointLight | SpotLight | AreaLight;

