import { ensureDirectionalLightRecord, ensurePointLightRecord, type AmbientLight, type DirectionalLight, type PointLight } from '../../3d/light';

const ambientLights = new Map<string, AmbientLight>();
const directionalLights = new Map<string, DirectionalLight>();
const pointLights = new Map<string, PointLight>();
let hardwareLightingDirty = false;

function writeVec3(target: [number, number, number], source: readonly number[]): void {
	target[0] = source[0];
	target[1] = source[1];
	target[2] = source[2];
}

function ambientLightRecord(id: string): AmbientLight {
	let record = ambientLights.get(id);
	if (!record) {
		record = { type: 'ambient', color: [0, 0, 0], intensity: 0 };
		ambientLights.set(id, record);
	}
	return record;
}

export function putHardwareAmbientLight(id: string, light: AmbientLight): void {
	const record = ambientLightRecord(id);
	writeVec3(record.color, light.color);
	record.intensity = light.intensity;
	hardwareLightingDirty = true;
}

export function putHardwareDirectionalLight(id: string, light: DirectionalLight): void {
	const record = ensureDirectionalLightRecord(directionalLights, id);
	writeVec3(record.color, light.color);
	writeVec3(record.orientation, light.orientation);
	record.intensity = light.intensity;
	hardwareLightingDirty = true;
}

export function putHardwarePointLight(id: string, light: PointLight): void {
	const record = ensurePointLightRecord(pointLights, id);
	writeVec3(record.color, light.color);
	writeVec3(record.pos, light.pos);
	record.range = light.range;
	record.intensity = light.intensity;
	hardwareLightingDirty = true;
}

export function clearHardwareLighting(): void {
	const hadLights = ambientLights.size !== 0 || directionalLights.size !== 0 || pointLights.size !== 0;
	ambientLights.clear();
	directionalLights.clear();
	pointLights.clear();
	if (hadLights) {
		hardwareLightingDirty = true;
	}
}

export function consumeHardwareLightingDirty(): boolean {
	if (!hardwareLightingDirty) {
		return false;
	}
	hardwareLightingDirty = false;
	return true;
}

export function getHardwareAmbientLights(): ReadonlyMap<string, AmbientLight> {
	return ambientLights;
}

export function getHardwareDirectionalLights(): ReadonlyMap<string, DirectionalLight> {
	return directionalLights;
}

export function getHardwarePointLights(): ReadonlyMap<string, PointLight> {
	return pointLights;
}

export function resolveHardwareAmbientLight(): AmbientLight | null {
	if (ambientLights.size === 0) {
		return null;
	}
	let totalIntensity = 0;
	let accumR = 0;
	let accumG = 0;
	let accumB = 0;
	for (const light of ambientLights.values()) {
		totalIntensity += light.intensity;
		accumR += light.color[0] * light.intensity;
		accumG += light.color[1] * light.intensity;
		accumB += light.color[2] * light.intensity;
	}
	if (totalIntensity <= 0) {
		return null;
	}
	return {
		type: 'ambient',
		color: [
			accumR / totalIntensity,
			accumG / totalIntensity,
			accumB / totalIntensity,
		],
		intensity: totalIntensity,
	};
}
