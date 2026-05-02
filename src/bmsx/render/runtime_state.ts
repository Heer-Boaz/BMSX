import type {
	RuntimeAmbientLightState,
	RuntimeDirectionalLightState,
	RuntimePointLightState,
	RuntimeRenderState,
} from '../machine/runtime/contracts';
import { hardwareCameraBank0, resetHardwareCameraBank0 } from './shared/hardware/camera';
import {
	clearHardwareLighting,
	getHardwareAmbientLights,
	getHardwareDirectionalLights,
	getHardwarePointLights,
	putHardwareAmbientLight,
	putHardwareDirectionalLight,
	putHardwarePointLight,
} from './shared/hardware/lighting';

function compareEntryId<T extends { id: string }>(left: T, right: T): number {
	if (left.id < right.id) {
		return -1;
	}
	if (left.id > right.id) {
		return 1;
	}
	return 0;
}

function captureAmbientLights(): RuntimeAmbientLightState[] {
	const lights = Array.from(getHardwareAmbientLights(), ([id, light]) => ({
		id,
		color: [light.color[0], light.color[1], light.color[2]] as [number, number, number],
		intensity: light.intensity,
	}));
	lights.sort(compareEntryId);
	return lights;
}

function captureDirectionalLights(): RuntimeDirectionalLightState[] {
	const lights = Array.from(getHardwareDirectionalLights(), ([id, light]) => ({
		id,
		color: [light.color[0], light.color[1], light.color[2]] as [number, number, number],
		intensity: light.intensity,
		orientation: [light.orientation[0], light.orientation[1], light.orientation[2]] as [number, number, number],
	}));
	lights.sort(compareEntryId);
	return lights;
}

function capturePointLights(): RuntimePointLightState[] {
	const lights = Array.from(getHardwarePointLights(), ([id, light]) => ({
		id,
		color: [light.color[0], light.color[1], light.color[2]] as [number, number, number],
		intensity: light.intensity,
		pos: [light.pos[0], light.pos[1], light.pos[2]] as [number, number, number],
		range: light.range,
	}));
	lights.sort(compareEntryId);
	return lights;
}

export function captureRuntimeRenderState(): RuntimeRenderState {
	const camera = hardwareCameraBank0;
	return {
		camera: {
			view: Array.from(camera.view),
			proj: Array.from(camera.projection),
			eye: [camera.position.x, camera.position.y, camera.position.z],
		},
		ambientLights: captureAmbientLights(),
		directionalLights: captureDirectionalLights(),
		pointLights: capturePointLights(),
	};
}

export function applyRuntimeRenderState(state: RuntimeRenderState): void {
	if (state.camera) {
		hardwareCameraBank0.setExternalMatrices(Float32Array.from(state.camera.view), Float32Array.from(state.camera.proj), state.camera.eye[0], state.camera.eye[1], state.camera.eye[2]);
	} else {
		resetHardwareCameraBank0();
	}
	clearHardwareLighting();
	for (let index = 0; index < state.ambientLights.length; index += 1) {
		const light = state.ambientLights[index];
		putHardwareAmbientLight(light.id, {
			type: 'ambient',
			color: light.color,
			intensity: light.intensity,
		});
	}
	for (let index = 0; index < state.directionalLights.length; index += 1) {
		const light = state.directionalLights[index];
		putHardwareDirectionalLight(light.id, {
			type: 'directional',
			color: light.color,
			intensity: light.intensity,
			orientation: light.orientation,
		});
	}
	for (let index = 0; index < state.pointLights.length; index += 1) {
		const light = state.pointLights[index];
		putHardwarePointLight(light.id, {
			type: 'point',
			color: light.color,
			intensity: light.intensity,
			pos: light.pos,
			range: light.range,
		});
	}
}

export function resetRuntimeRenderState(): void {
	resetHardwareCameraBank0();
	clearHardwareLighting();
}
