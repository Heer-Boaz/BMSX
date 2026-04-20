import { Float32ArrayPool } from '../../common/pool';
import type { AmbientLight } from '../3d/light';
import { addDirectionalLight, addPointLight, clearLights, directionalLightList, pointLightList } from '../3d/mesh_pipeline';
import {
	consumeHardwareLightingDirty,
	getHardwareDirectionalLights,
	getHardwarePointLights,
	resolveHardwareAmbientLight,
} from '../shared/hardware_lighting';
// Avoid backend-specific imports here; use conservative defaults for pooled arrays
const DEFAULT_MAX_DIR_LIGHTS = 4;
const DEFAULT_MAX_POINT_LIGHTS = 4;

function ambientLightsEqual(left: AmbientLight | null, right: AmbientLight | null): boolean {
	if (left === right) {
		return true;
	}
	if (!left || !right) {
		return false;
	}
	return left.intensity === right.intensity
		&& left.color[0] === right.color[0]
		&& left.color[1] === right.color[1]
		&& left.color[2] === right.color[2];
}

export interface LightingFrameState {
	ambient: AmbientLight;
	dirCount: number;
	pointCount: number;
	dirty: boolean; // true if any light data (counts/buffers or ambient) changed this frame
}

// Central lighting update system akin to Unreal's FDeferredLightUniformStruct population.
export class LightingSystem {
	private _lastAmbient: AmbientLight = null;
	private _frameState: LightingFrameState = { ambient: null, dirCount: 0, pointCount: 0, dirty: true };

	constructor() { }

	update(): LightingFrameState {
		const hardwareDirty = consumeHardwareLightingDirty();
		const ambient = resolveHardwareAmbientLight();
		const directionalLights = getHardwareDirectionalLights();
		const pointLights = getHardwarePointLights();
		const dirCount = directionalLights.size;
		const pointCount = pointLights.size;

		if (hardwareDirty) {
			clearLights();
			for (const [id, light] of directionalLights) {
				addDirectionalLight(id, light);
			}
			for (const [id, light] of pointLights) {
				addPointLight(id, light);
			}
		}

		const dirty = hardwareDirty
			|| this._frameState.dirCount !== dirCount
			|| this._frameState.pointCount !== pointCount
			|| !ambientLightsEqual(this._lastAmbient, ambient);
		this._lastAmbient = ambient;
		if (dirty) {
			this._frameState = {
				ambient,
				dirCount,
				pointCount,
				dirty,
			};
		} else {
			this._frameState.dirty = false;
		}
		return this._frameState;
	}

	get frameState(): LightingFrameState { return this._frameState; }
}

// GPU-agnostic descriptor (backend independent); arrays sized to counts.
export interface LightingDescriptor {
	ambientColor: Float32Array; // length 3 (RGB) or zero-length if none
	ambientIntensity: number;
	dirDirections: Float32Array; // length dirCount*3
	dirColors: Float32Array;     // length dirCount*3
	dirIntensity: Float32Array;  // length dirCount
	pointPositions: Float32Array; // length pointCount*3
	pointColors: Float32Array;    // length pointCount*3
	pointParams: Float32Array;    // packed [range,intensity,0,0]? keep minimal: length pointCount*2 (range,intensity)
	dirCount: number;
	pointCount: number;
}

// Build a descriptor snapshot for any backend (e.g. WebGPU) from current GL-side light lists.
export function buildLightingDescriptor(frame: LightingFrameState): LightingDescriptor {
	const dirs = directionalLightList;
	const pts = pointLightList;
	const dirCount = Math.min(dirs.length, frame.dirCount);
	const pointCount = Math.min(pts.length, frame.pointCount);
	const dirDirections = new Float32Array(dirCount * 3);
	const dirColors = new Float32Array(dirCount * 3);
	const dirIntensity = new Float32Array(dirCount);
	for (let i = 0; i < dirCount; i++) {
		dirDirections.set(dirs[i].orientation, i * 3);
		dirColors.set(dirs[i].color, i * 3);
		dirIntensity[i] = dirs[i].intensity;
	}
	const pointPositions = new Float32Array(pointCount * 3);
	const pointColors = new Float32Array(pointCount * 3);
	const pointParams = new Float32Array(pointCount * 2);
	for (let i = 0; i < pointCount; i++) {
		pointPositions.set(pts[i].pos!, i * 3);
		pointColors.set(pts[i].color!, i * 3);
		pointParams[i * 2] = pts[i].range!;
		pointParams[i * 2 + 1] = pts[i].intensity;
	}
	return {
		ambientColor: frame.ambient ? new Float32Array(frame.ambient.color) : new Float32Array(0),
		ambientIntensity: frame.ambient ? frame.ambient.intensity : 0,
		dirDirections,
		dirColors,
		dirIntensity,
		pointPositions,
		pointColors,
		pointParams,
		dirCount,
		pointCount,
	};
}

// --- Pooled descriptor strategy (no per-frame heap churn) ---
// Pools sized to maximum supported lights. Returned arrays are reused; treat them as transient for the current frame only.
const poolDirDirections = new Float32ArrayPool(3 * DEFAULT_MAX_DIR_LIGHTS);
const poolDirColors = new Float32ArrayPool(3 * DEFAULT_MAX_DIR_LIGHTS);
const poolDirIntensity = new Float32ArrayPool(DEFAULT_MAX_DIR_LIGHTS);
const poolPointPositions = new Float32ArrayPool(3 * DEFAULT_MAX_POINT_LIGHTS);
const poolPointColors = new Float32ArrayPool(3 * DEFAULT_MAX_POINT_LIGHTS);
const poolPointParams = new Float32ArrayPool(2 * DEFAULT_MAX_POINT_LIGHTS);
const poolAmbientColor = new Float32ArrayPool(3);

// Reset pools at frame start so each ensure() yields the first buffer instance; callers should invoke once per frame.
export function resetLightingDescriptorPools(): void {
	poolDirDirections.reset();
	poolDirColors.reset();
	poolDirIntensity.reset();
	poolPointPositions.reset();
	poolPointColors.reset();
	poolPointParams.reset();
	poolAmbientColor.reset();
}

export function buildLightingDescriptorPooled(frame: LightingFrameState): LightingDescriptor {
	const dirs = directionalLightList;
	const pts = pointLightList;
	const dirCount = Math.min(dirs.length, frame.dirCount, DEFAULT_MAX_DIR_LIGHTS);
	const pointCount = Math.min(pts.length, frame.pointCount, DEFAULT_MAX_POINT_LIGHTS);

	const dirDirections = poolDirDirections.ensure();
	const dirColors = poolDirColors.ensure();
	const dirIntensity = poolDirIntensity.ensure();
	const pointPositions = poolPointPositions.ensure();
	const pointColors = poolPointColors.ensure();
	const pointParams = poolPointParams.ensure();
	const ambientColor = poolAmbientColor.ensure();

	// Fill (only active range) -----------------------------------------------------------------
	for (let i = 0; i < dirCount; i++) {
		dirDirections[i * 3] = dirs[i].orientation[0];
		dirDirections[i * 3 + 1] = dirs[i].orientation[1];
		dirDirections[i * 3 + 2] = dirs[i].orientation[2];
		dirColors[i * 3] = dirs[i].color[0];
		dirColors[i * 3 + 1] = dirs[i].color[1];
		dirColors[i * 3 + 2] = dirs[i].color[2];
		dirIntensity[i] = dirs[i].intensity;
	}
	// Optionally zero the unused tail (not strictly required if consumer respects counts)
	// for (let i = dirCount * 3; i < dirDirections.length; i++) dirDirections[i] = 0; // skipped for perf

	for (let i = 0; i < pointCount; i++) {
		pointPositions[i * 3] = pts[i].pos![0];
		pointPositions[i * 3 + 1] = pts[i].pos![1];
		pointPositions[i * 3 + 2] = pts[i].pos![2];
		pointColors[i * 3] = pts[i].color![0];
		pointColors[i * 3 + 1] = pts[i].color![1];
		pointColors[i * 3 + 2] = pts[i].color![2];
		pointParams[i * 2] = pts[i].range!;
		pointParams[i * 2 + 1] = pts[i].intensity;
	}

	if (frame.ambient) {
		ambientColor[0] = frame.ambient.color[0];
		ambientColor[1] = frame.ambient.color[1];
		ambientColor[2] = frame.ambient.color[2];
	} else {
		ambientColor[0] = ambientColor[1] = ambientColor[2] = 0;
	}

	const ambientIntensity = frame.ambient ? frame.ambient.intensity : 0;

	return {
		ambientColor,
		ambientIntensity,
		dirDirections,
		dirColors,
		dirIntensity,
		pointPositions,
		pointColors,
		pointParams,
		dirCount,
		pointCount,
	};
}
