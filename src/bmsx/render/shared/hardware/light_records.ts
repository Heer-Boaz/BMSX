import type { DirectionalLight, PointLight } from '../../3d/light';

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
