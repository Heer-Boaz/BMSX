import { Float32ArrayPool } from '../../common/pool';
import type { AmbientLight } from '../3d/light';
import {
	consumeHardwareLightingDirty,
	getHardwareDirectionalLights,
	getHardwarePointLights,
	resolveHardwareAmbientLight,
} from '../shared/hardware/lighting';
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
	const dirs = getHardwareDirectionalLights();
	const pts = getHardwarePointLights();
	const dirCount = Math.min(dirs.size, frame.dirCount, DEFAULT_MAX_DIR_LIGHTS);
	const pointCount = Math.min(pts.size, frame.pointCount, DEFAULT_MAX_POINT_LIGHTS);

	const dirDirections = poolDirDirections.ensure();
	const dirColors = poolDirColors.ensure();
	const dirIntensity = poolDirIntensity.ensure();
	const pointPositions = poolPointPositions.ensure();
	const pointColors = poolPointColors.ensure();
	const pointParams = poolPointParams.ensure();
	const ambientColor = poolAmbientColor.ensure();

	// Fill (only active range) -----------------------------------------------------------------
	let dirIndex = 0;
	for (const light of dirs.values()) {
		if (dirIndex >= dirCount) {
			break;
		}
		const base = dirIndex * 3;
		dirDirections[base] = light.orientation[0];
		dirDirections[base + 1] = light.orientation[1];
		dirDirections[base + 2] = light.orientation[2];
		dirColors[base] = light.color[0];
		dirColors[base + 1] = light.color[1];
		dirColors[base + 2] = light.color[2];
		dirIntensity[dirIndex] = light.intensity;
		dirIndex += 1;
	}
	// Optionally zero the unused tail (not strictly required if consumer respects counts)
	// for (let i = dirCount * 3; i < dirDirections.length; i++) dirDirections[i] = 0; // skipped for perf

	let pointIndex = 0;
	for (const light of pts.values()) {
		if (pointIndex >= pointCount) {
			break;
		}
		const vecBase = pointIndex * 3;
		const paramBase = pointIndex * 2;
		pointPositions[vecBase] = light.pos[0];
		pointPositions[vecBase + 1] = light.pos[1];
		pointPositions[vecBase + 2] = light.pos[2];
		pointColors[vecBase] = light.color[0];
		pointColors[vecBase + 1] = light.color[1];
		pointColors[vecBase + 2] = light.color[2];
		pointParams[paramBase] = light.range;
		pointParams[paramBase + 1] = light.intensity;
		pointIndex += 1;
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
