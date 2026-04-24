import type { AmbientLight, DirectionalLight, PointLight } from '../../3d/light';

const ambientLights = new Map<string, AmbientLight>();
const directionalLights = new Map<string, DirectionalLight>();
const pointLights = new Map<string, PointLight>();
let hardwareLightingDirty = false;

function cloneVec3(source: readonly number[]): [number, number, number] {
	return [source[0], source[1], source[2]];
}

function cloneAmbientLight(light: AmbientLight): AmbientLight {
	return {
		type: 'ambient',
		color: cloneVec3(light.color),
		intensity: light.intensity,
	};
}

function cloneDirectionalLight(light: DirectionalLight): DirectionalLight {
	return {
		type: 'directional',
		color: cloneVec3(light.color),
		intensity: light.intensity,
		orientation: cloneVec3(light.orientation),
	};
}

function clonePointLight(light: PointLight): PointLight {
	return {
		type: 'point',
		color: cloneVec3(light.color),
		intensity: light.intensity,
		pos: cloneVec3(light.pos),
		range: light.range,
	};
}

export function putHardwareAmbientLight(id: string, light: AmbientLight): void {
	ambientLights.set(id, cloneAmbientLight(light));
	hardwareLightingDirty = true;
}

export function putHardwareDirectionalLight(id: string, light: DirectionalLight): void {
	directionalLights.set(id, cloneDirectionalLight(light));
	hardwareLightingDirty = true;
}

export function putHardwarePointLight(id: string, light: PointLight): void {
	pointLights.set(id, clonePointLight(light));
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
