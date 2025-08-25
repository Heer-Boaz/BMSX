import { Float32ArrayPool } from '../../core/utils';
import * as GLView3D from '../3d/glview.3d';
import type { AmbientLight, Light } from '../3d/light';
import { MAX_DIR_LIGHTS, MAX_POINT_LIGHTS } from '../glview.constants';

export interface LightingFrameState {
	ambient: AmbientLight | null;
	dirCount: number;
	pointCount: number;
	dirty: boolean; // true if any light data (counts/buffers or ambient) changed this frame
	dirBinding?: number; // optional binding indices (debug / future backend bridging)
	pointBinding?: number;
	dirBuffer?: WebGLBuffer; // exposed for diagnostics / WebGPU transition planning
	pointBuffer?: WebGLBuffer;
}

// Central lighting update system akin to Unreal's FDeferredLightUniformStruct population.
export class LightingSystem {
	private _lastAmbient: AmbientLight | null = null;
	private _frameState: LightingFrameState = { ambient: null, dirCount: 0, pointCount: 0, dirty: true };

	constructor(private gl: WebGL2RenderingContext) { }

	update(ambient: AmbientLight | null): LightingFrameState {
		const lightsMutated = GLView3D.consumeLightsDirty();
		let ambientChanged = false;
		if (ambient && ambient !== this._lastAmbient) {
			GLView3D.setAmbientLight(this.gl, ambient);
			this._lastAmbient = ambient;
			ambientChanged = true;
		} else if (!ambient && this._lastAmbient) {
			// If ambient removed, reset to zero intensity
			this._lastAmbient = null;
			ambientChanged = true;
			// Optional: could push zero to shader here.
		}
		const dirCount = GLView3D.getDirectionalLightCount();
		const pointCount = GLView3D.getPointLightCount();
		const dirty = lightsMutated || ambientChanged;
		// Only rebuild frame state object if something changed to reduce churn
		if (dirty || this._frameState.dirCount !== dirCount || this._frameState.pointCount !== pointCount || this._frameState.ambient !== this._lastAmbient) {
			this._frameState = {
				ambient: this._lastAmbient,
				dirCount,
				pointCount,
				dirty,
				dirBinding: GLView3D.DIR_LIGHT_UNIFORM_BINDING,
				pointBinding: GLView3D.POINT_LIGHT_UNIFORM_BINDING,
				dirBuffer: GLView3D.getDirectionalLightBuffer(),
				pointBuffer: GLView3D.getPointLightBuffer(),
			};
		} else {
			// ensure dirty cleared if no changes
			this._frameState.dirty = false;
		}
		return this._frameState;
	}

	get frameState(): LightingFrameState { return this._frameState; }
}

// Type guard for ambient light
export function isAmbientLight(l: Light | null | undefined): l is AmbientLight {
	return l?.type === 'ambient';
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
	const dirs = GLView3D.getDirectionalLights();
	const pts = GLView3D.getPointLightsAll();
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
const poolDirDirections = new Float32ArrayPool(3 * MAX_DIR_LIGHTS);
const poolDirColors = new Float32ArrayPool(3 * MAX_DIR_LIGHTS);
const poolDirIntensity = new Float32ArrayPool(MAX_DIR_LIGHTS);
const poolPointPositions = new Float32ArrayPool(3 * MAX_POINT_LIGHTS);
const poolPointColors = new Float32ArrayPool(3 * MAX_POINT_LIGHTS);
const poolPointParams = new Float32ArrayPool(2 * MAX_POINT_LIGHTS);
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
	const dirs = GLView3D.getDirectionalLights();
	const pts = GLView3D.getPointLightsAll();
	const dirCount = Math.min(dirs.length, frame.dirCount, MAX_DIR_LIGHTS);
	const pointCount = Math.min(pts.length, frame.pointCount, MAX_POINT_LIGHTS);

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

	return {
		ambientColor,
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
