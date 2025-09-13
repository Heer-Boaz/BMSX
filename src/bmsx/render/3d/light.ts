import type { vec3arr } from '../../rompack/rompack';

export interface BaseLight {
	color: vec3arr;
	intensity: number;
}

export interface AmbientLight extends BaseLight {
	type: 'ambient';
}

export interface DirectionalLight extends BaseLight {
	type: 'directional';
	orientation: vec3arr;
}

export interface PointLight extends BaseLight {
	type: 'point';
	pos: vec3arr;
	range: number;
}

export interface SpotLight extends BaseLight {
	type: 'spot';
	pos: vec3arr;
	orientation: vec3arr;
	angle: number;
	range: number;
}

export interface AreaLight extends BaseLight {
	type: 'area';
	pos: vec3arr;
	size: [number, number];
	normal: vec3arr;
}
export type Light = AmbientLight | DirectionalLight | PointLight | SpotLight | AreaLight;
export type LightType = Light['type'];
