import { $ } from '../../core/game';
import { RenderPassLibrary } from '../backend/renderpasslib';
import { SpritesPipelineState, MeshBatchPipelineState, ParticlePipelineState } from '../backend/pipeline_interfaces';
import { M4 } from '../3d/math3d';
import {
	beginSpriteQueue,
	forEachSprite,
	beginMeshQueue,
	forEachMeshQueue,
	beginParticleQueue,
	forEachParticleQueue,
	meshQueueBackSize,
	particleQueueBackSize,
	type SpriteQueueItem,
} from '../shared/render_queues';
import type { MeshRenderSubmission, ParticleRenderSubmission } from '../shared/render_types';
import { updateFallbackCamera, FALLBACK_CAMERA } from '../shared/fallback_camera';

export function registerHeadlessPasses(registry: RenderPassLibrary): void {
	registerFramePasses(registry);
	registerSpritePass(registry);
	registerMeshPass(registry);
	registerParticlePass(registry);
}

function registerFramePasses(registry: RenderPassLibrary): void {
	registry.register({ id: 'frame_resolve', name: 'HeadlessFrameResolve', stateOnly: true, exec: () => { /* noop */ } });
	registry.register({ id: 'frame_shared', name: 'HeadlessFrameShared', stateOnly: true, exec: () => { /* noop */ } });
}

type Snapshot = string[];

let previousSpriteSnapshot: Snapshot;
let previousMeshSnapshot: Snapshot;
let previousParticleSnapshot: Snapshot;

const headlessFallbackParticleState: ParticlePipelineState = {
	width: FALLBACK_CAMERA.width,
	height: FALLBACK_CAMERA.height,
	viewProj: FALLBACK_CAMERA.viewProj,
	camRight: FALLBACK_CAMERA.camRight,
	camUp: FALLBACK_CAMERA.camUp,
};

function formatNumber(value: number): string {
	return Number.isFinite(value) ? value.toFixed(2) : 'NaN';
}

function formatVec3(input: { x: number; y: number; z: number } | Float32Array | [number, number, number]): string {
	if (input instanceof Float32Array) {
		return `(${formatNumber(input[0] ?? 0)}, ${formatNumber(input[1] ?? 0)}, ${formatNumber(input[2] ?? 0)})`;
	}
	if (Array.isArray(input)) {
		return `(${formatNumber(input[0] ?? 0)}, ${formatNumber(input[1] ?? 0)}, ${formatNumber(input[2] ?? 0)})`;
	}
	return `(${formatNumber(input.x)}, ${formatNumber(input.y)}, ${formatNumber(input.z)})`;
}

function formatScale(scale: { x: number; y: number }): string {
	return `(${formatNumber(scale?.x ?? 1)}, ${formatNumber(scale?.y ?? 1)})`;
}

function translationFromMatrix(m: Float32Array): string {
	return `(${formatNumber(m[12])}, ${formatNumber(m[13])}, ${formatNumber(m[14])})`;
}

function computeDiff(previous: Snapshot, current: Snapshot): Snapshot {
	if (!previous) return current.map((line) => `+ ${line}`);
	const max = Math.max(previous.length, current.length);
	const diff: Snapshot = [];
	for (let i = 0; i < max; i += 1) {
		const prevLine = previous[i];
		const nextLine = current[i];
		if (prevLine === nextLine) continue;
		if (prevLine === undefined) {
			diff.push(`+ ${nextLine}`);
		} else if (nextLine === undefined) {
			diff.push(`- ${prevLine}`);
		} else {
			diff.push(`~ ${nextLine}`);
		}
	}
	return diff;
}

function emitDiff(label: string, previous: Snapshot, current: Snapshot): Snapshot {
	const diff = computeDiff(previous, current);
	if (diff.length !== 0) {
		// Headless output is a state diff between frames (first frame is effectively full listing).
		// Kept verbose for regression hunting; can be gated later with a verbosity flag if needed.
		console.log(`[headless:${label}] diff`);
		for (const line of diff) console.log(`  ${line}`);
	}
	return current;
}

function makeSpriteState(): SpritesPipelineState {
	const gv = $.view;
	return {
		width: gv.offscreenCanvasSize.x,
		height: gv.offscreenCanvasSize.y,
		baseWidth: gv.viewportSize.x,
		baseHeight: gv.viewportSize.y,
		atlasTex: null,
		atlasDynamicTex: null,
		atlasEngineTex: null,
		ambientEnabledDefault: gv.spriteAmbientEnabledDefault,
		ambientFactorDefault: gv.spriteAmbientFactorDefault,
		ambientColor: [0, 0, 0], // Ambient sprites disabled; update when a new path is implemented.
		ambientIntensity: 0,
		viewportTypeIde: gv.viewportTypeIde,
		psxDither2dEnabled: gv.psx_dither_2d_enabled,
	};
}

function registerSpritePass(registry: RenderPassLibrary): void {
	registry.register({
		id: 'sprites',
		name: 'HeadlessSprites',
		stateOnly: true,
		prepare: () => {
			registry.setState('sprites', makeSpriteState());
		},
		exec: (_backend, _fbo, state: unknown) => {
			const spriteState = state as SpritesPipelineState;
			const count = beginSpriteQueue();
			const snapshot: Snapshot = [
				`draws=${count} viewport=${spriteState.width}x${spriteState.height} base=${spriteState.baseWidth}x${spriteState.baseHeight} ambient_default=disabled`,
			];
			if (count > 0) {
				let index = 0;
				forEachSprite((submission: SpriteQueueItem) => {
					const { options, imgmeta } = submission;
					const layer = options.layer ?? 'world';
					const pos = formatVec3({ x: options.pos.x, y: options.pos.y, z: options.pos.z ?? 0 });
					const scale = formatScale(options.scale);
					const flipH = options.flip?.flip_h ? 'H' : '-';
					const flipV = options.flip?.flip_v ? 'V' : '-';
					const atlas = imgmeta.atlasid ?? 'na';
					// Ambient sprites are disabled in the runtime; logging follows suit until a new approach is added.
					snapshot.push(`[sprite#${index}] id=${options.imgid} layer=${layer} pos=${pos} scale=${scale} flip=${flipH}${flipV} ambient=disabled atlas=${atlas}`);
					index += 1;
				});
			}
			previousSpriteSnapshot = emitDiff('sprites', previousSpriteSnapshot, snapshot);
		},
	});
}

function makeMeshState(registry: RenderPassLibrary): MeshBatchPipelineState {
	const gv = $.view;
	const cam = $.world.activeCamera3D;
	const mats = cam.getMatrices();
	const frustum = cam.frustumPlanesPacked.slice();
	const frameShared = registry.getState('frame_shared');
	return {
		width: gv.offscreenCanvasSize.x,
		height: gv.offscreenCanvasSize.y,
		camPos: cam.position,
		viewProj: mats.vp,
		cameraFrustum: frustum,
		lighting: frameShared ? frameShared.lighting : undefined,
	};
}

function registerMeshPass(registry: RenderPassLibrary): void {
	registry.register({
		id: 'meshbatch',
		name: 'HeadlessMeshes',
		stateOnly: true,
		shouldExecute: () => meshQueueBackSize() > 0,
		prepare: () => {
			registry.setState('meshbatch', makeMeshState(registry));
		},
		exec: (_backend, _fbo, state: unknown) => {
			const meshState = state as MeshBatchPipelineState;
			const count = beginMeshQueue();
			const snapshot: Snapshot = [`draws=${count} viewport=${meshState.width}x${meshState.height}`];
			if (count > 0) {
				let index = 0;
				forEachMeshQueue((submission: MeshRenderSubmission) => {
					const translation = translationFromMatrix(submission.matrix);
					const shadow = submission.receive_shadow === undefined ? 'default' : submission.receive_shadow ? 'yes' : 'no';
					const morphCount = submission.morph_weights ? submission.morph_weights.length : 0;
					snapshot.push(`[mesh#${index}] mesh=${submission.mesh.name} translate=${translation} shadow=${shadow} morphs=${morphCount}`);
					index += 1;
				});
			}
			previousMeshSnapshot = emitDiff('mesh', previousMeshSnapshot, snapshot);
		},
	});
}

function makeParticleState(): ParticlePipelineState {
	const gv = $.view;
	const width = gv.offscreenCanvasSize.x;
	const height = gv.offscreenCanvasSize.y;
	const cam = $.world.activeCamera3D;
	if (!cam) {
		const fallback = updateFallbackCamera(width, height);
		headlessFallbackParticleState.width = fallback.width;
		headlessFallbackParticleState.height = fallback.height;
		return headlessFallbackParticleState;
	}
	const camRight = new Float32Array(3);
	const camUp = new Float32Array(3);
	M4.viewRightUpInto(cam.view, camRight, camUp);
	return {
		width,
		height,
		viewProj: cam.viewProjection,
		camRight,
		camUp,
	};
}

function registerParticlePass(registry: RenderPassLibrary): void {
	registry.register({
		id: 'particles',
		name: 'HeadlessParticles',
		stateOnly: true,
		shouldExecute: () => particleQueueBackSize() > 0,
		prepare: () => {
			registry.setState('particles', makeParticleState());
		},
		exec: (_backend, _fbo, state: unknown) => {
			const particleState = state as ParticlePipelineState;
			const count = beginParticleQueue();
			const snapshot: Snapshot = [`draws=${count} viewport=${particleState.width}x${particleState.height}`];
			if (count > 0) {
				let index = 0;
				forEachParticleQueue((submission: ParticleRenderSubmission) => {
					const textureTag = submission.texture ? 'custom' : 'default';
					snapshot.push(`[particle#${index}] pos=${formatVec3(submission.position)} size=${formatNumber(submission.size)} texture=${textureTag}`);
					index += 1;
				});
			}
			previousParticleSnapshot = emitDiff('particles', previousParticleSnapshot, snapshot);
		},
	});
}
