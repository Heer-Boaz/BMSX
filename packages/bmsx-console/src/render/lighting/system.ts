import { Float32ArrayPool } from '../../common/pool';
import type { AmbientLight } from '../3d/light';
import type { GameView } from '../gameview';
// Avoid backend-specific imports here; use conservative defaults for pooled arrays
const DEFAULT_MAX_DIR_LIGHTS = 4;
const DEFAULT_MAX_POINT_LIGHTS = 4;

export interface LightingFrameState {
	ambient: AmbientLight | null;
	dirCount: number;
	pointCount: number;
	dirDirections: Float32Array;
	dirColors: Float32Array;
	dirIntensity: Float32Array;
	pointPositions: Float32Array;
	pointColors: Float32Array;
	pointParams: Float32Array;
	dirty: boolean; // true if any light data (counts/buffers or ambient) changed this frame
}

// Central lighting update system akin to Unreal's FDeferredLightUniformStruct population.
export class LightingSystem {
	private readonly ambient: AmbientLight = { type: 'ambient', color: [0, 0, 0], intensity: 0 };
	private _frameState: LightingFrameState = {
		ambient: null,
		dirCount: 0,
		pointCount: 0,
		dirDirections: null,
		dirColors: null,
		dirIntensity: null,
		pointPositions: null,
		pointColors: null,
		pointParams: null,
		dirty: true,
	};

	constructor() { }

	update(view: GameView): LightingFrameState {
		const ambientWords = view.vdpAmbientLightColorIntensity;
		this.ambient.color[0] = ambientWords[0];
		this.ambient.color[1] = ambientWords[1];
		this.ambient.color[2] = ambientWords[2];
		this.ambient.intensity = ambientWords[3];
		const dirCount = view.vdpDirectionalLightCount;
		const pointCount = view.vdpPointLightCount;
		this._frameState.ambient = ambientWords[3] !== 0 ? this.ambient : null;
		this._frameState.dirCount = dirCount;
		this._frameState.pointCount = pointCount;
		this._frameState.dirDirections = view.vdpDirectionalLightDirections;
		this._frameState.dirColors = view.vdpDirectionalLightColors;
		this._frameState.dirIntensity = view.vdpDirectionalLightIntensities;
		this._frameState.pointPositions = view.vdpPointLightPositions;
		this._frameState.pointColors = view.vdpPointLightColors;
		this._frameState.pointParams = view.vdpPointLightParams;
		this._frameState.dirty = true;
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
	const dirCount = frame.dirCount;
	const pointCount = frame.pointCount;

	const dirDirections = poolDirDirections.ensure();
	const dirColors = poolDirColors.ensure();
	const dirIntensity = poolDirIntensity.ensure();
	const pointPositions = poolPointPositions.ensure();
	const pointColors = poolPointColors.ensure();
	const pointParams = poolPointParams.ensure();
	const ambientColor = poolAmbientColor.ensure();

	for (let index = 0; index < dirCount; index += 1) {
		const base = index * 3;
		dirDirections[base] = frame.dirDirections[base];
		dirDirections[base + 1] = frame.dirDirections[base + 1];
		dirDirections[base + 2] = frame.dirDirections[base + 2];
		dirColors[base] = frame.dirColors[base];
		dirColors[base + 1] = frame.dirColors[base + 1];
		dirColors[base + 2] = frame.dirColors[base + 2];
		dirIntensity[index] = frame.dirIntensity[index];
	}

	for (let index = 0; index < pointCount; index += 1) {
		const vecBase = index * 3;
		const paramBase = index * 2;
		pointPositions[vecBase] = frame.pointPositions[vecBase];
		pointPositions[vecBase + 1] = frame.pointPositions[vecBase + 1];
		pointPositions[vecBase + 2] = frame.pointPositions[vecBase + 2];
		pointColors[vecBase] = frame.pointColors[vecBase];
		pointColors[vecBase + 1] = frame.pointColors[vecBase + 1];
		pointColors[vecBase + 2] = frame.pointColors[vecBase + 2];
		pointParams[paramBase] = frame.pointParams[paramBase];
		pointParams[paramBase + 1] = frame.pointParams[paramBase + 1];
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
