import type { vec3arr } from '../../rompack/format';

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

export function ensureDirectionalLightRecord(records: Map<string, DirectionalLight>, id: string): DirectionalLight {
	let record = records.get(id);
	if (!record) {
		record = { type: 'directional', color: [0, 0, 0], intensity: 0, orientation: [0, 0, 0] };
		records.set(id, record);
	}
	return record;
}

export function ensurePointLightRecord(records: Map<string, PointLight>, id: string): PointLight {
	let record = records.get(id);
	if (!record) {
		record = { type: 'point', color: [0, 0, 0], intensity: 0, pos: [0, 0, 0], range: 0 };
		records.set(id, record);
	}
	return record;
}
