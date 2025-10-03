import { $ } from '../../core/game';
import { RenderPassLibrary, SpritesPipelineState, MeshBatchPipelineState, ParticlePipelineState } from '../backend/renderpasslib';
import {
	beginSpriteQueue,
	forEachSpriteQueue,
	beginMeshQueue,
	forEachMeshQueue,
	beginParticleQueue,
	forEachParticleQueue,
	type SpriteQueueItem,
} from '../shared/render_queues';
import type { MeshRenderSubmission, ParticleRenderSubmission } from '../shared/render_types';

function formatNumber(value: number): string {
	return Number.isFinite(value) ? value.toFixed(2) : 'NaN';
}

function formatVec3(input: { x: number; y: number; z: number } | Float32Array | [number, number, number] | undefined): string {
	if (!input) return '(0.00, 0.00, 0.00)';
	if (input instanceof Float32Array) {
		return `(${formatNumber(input[0] ?? 0)}, ${formatNumber(input[1] ?? 0)}, ${formatNumber(input[2] ?? 0)})`;
	}
	if (Array.isArray(input)) {
		return `(${formatNumber(input[0] ?? 0)}, ${formatNumber(input[1] ?? 0)}, ${formatNumber(input[2] ?? 0)})`;
	}
	return `(${formatNumber(input.x)}, ${formatNumber(input.y)}, ${formatNumber(input.z)})`;
}

function formatScale(scale: { x: number; y: number } | undefined): string {
	return `(${formatNumber(scale?.x ?? 1)}, ${formatNumber(scale?.y ?? 1)})`;
}

function formatAmbient(enabled: boolean | undefined, factor: number | undefined): string {
	if (enabled === undefined && factor === undefined) return 'default';
	const flag = enabled === undefined ? 'default' : enabled ? 'on' : 'off';
	const f = factor === undefined ? 'default' : formatNumber(factor);
	return `${flag}@${f}`;
}

function translationFromMatrix(m: Float32Array, fallback: string): string {
	if (!m || m.length < 16) return fallback;
	return `(${formatNumber(m[12]), formatNumber(m[13]), formatNumber(m[14])})`;
}

export function registerHeadlessPasses(registry: RenderPassLibrary): void {
	registerFramePasses(registry);
	registerSpritePass(registry);
	registerMeshPass(registry);
	registerParticlePass(registry);
}

function registerFramePasses(registry: RenderPassLibrary): void {
	registry.register({ id: 'frame_resolve', label: 'frame_resolve', name: 'HeadlessFrameResolve', stateOnly: true, exec: () => { /* noop */ } });
	registry.register({ id: 'frame_shared', label: 'frame_shared', name: 'HeadlessFrameShared', stateOnly: true, exec: () => { /* noop */ } });
}

function resolveSpriteMetrics(state: SpritesPipelineState | undefined): { width: number; height: number; baseWidth: number; baseHeight: number; ambientEnabled: boolean; ambientFactor: number; } {
	const view = $.view;
	return {
		width: state?.width ?? view.viewportSize.x,
		height: state?.height ?? view.viewportSize.y,
		baseWidth: state?.baseWidth ?? view.canvasSize.x,
		baseHeight: state?.baseHeight ?? view.canvasSize.y,
		ambientEnabled: state?.ambientEnabledDefault ?? view.spriteAmbientEnabledDefault,
		ambientFactor: state?.ambientFactorDefault ?? view.spriteAmbientFactorDefault,
	};
}

function registerSpritePass(registry: RenderPassLibrary): void {
	registry.register({
		id: 'sprites',
		label: 'sprites_headless',
		name: 'HeadlessSprites',
		stateOnly: true,
		exec: (_backend, _fbo, state: unknown) => {
			const resolved = resolveSpriteMetrics(state as SpritesPipelineState | undefined);
			const count = beginSpriteQueue();
			if (count === 0) {
				console.log('[headless:sprites] draws=0');
				return;
			}
			console.log(`[headless:sprites] draws=${count} viewport=${resolved.width}x${resolved.height} base=${resolved.baseWidth}x${resolved.baseHeight}`);
			let index = 0;
			forEachSpriteQueue((submission: SpriteQueueItem) => {
				const { options, imgmeta } = submission;
				const layer = options.layer ?? 'world';
				const pos = formatVec3({ x: options.pos.x, y: options.pos.y, z: options.pos.z ?? 0 });
				const scale = formatScale(options.scale);
				const flipH = options.flip?.flip_h ? 'H' : '-';
				const flipV = options.flip?.flip_v ? 'V' : '-';
				const ambient = formatAmbient(options.ambientAffected ?? resolved.ambientEnabled, options.ambientFactor ?? resolved.ambientFactor);
				const atlas = imgmeta.atlasid ?? 'na';
				console.log(`  [sprite#${index}] id=${options.imgid} layer=${layer} pos=${pos} scale=${scale} flip=${flipH}${flipV} ambient=${ambient} atlas=${atlas}`);
				index += 1;
			});
		},
	});
}

function resolveMeshMetrics(state: MeshBatchPipelineState | undefined): { width: number; height: number; } {
	const view = $.view;
	return {
		width: state?.width ?? view.viewportSize.x,
		height: state?.height ?? view.viewportSize.y,
	};
}

function registerMeshPass(registry: RenderPassLibrary): void {
	registry.register({
		id: 'meshbatch',
		label: 'mesh_headless',
		name: 'HeadlessMeshes',
		stateOnly: true,
		exec: (_backend, _fbo, state: unknown) => {
			const metrics = resolveMeshMetrics(state as MeshBatchPipelineState | undefined);
			const count = beginMeshQueue();
			if (count === 0) {
				console.log('[headless:mesh] draws=0');
				return;
			}
			console.log(`[headless:mesh] draws=${count} viewport=${metrics.width}x${metrics.height}`);
			let index = 0;
			forEachMeshQueue((submission: MeshRenderSubmission) => {
				const meshName = submission.mesh?.name ?? '<unnamed>';
				const matrix = submission.matrix;
				const translation = matrix ? translationFromMatrix(matrix, '(0.00, 0.00, 0.00)') : '(0.00, 0.00, 0.00)';
				const receivesShadow = submission.receiveShadow === undefined ? 'default' : submission.receiveShadow ? 'yes' : 'no';
				const morphCount = submission.morphWeights ? submission.morphWeights.length : 0;
				console.log(`  [mesh#${index}] mesh=${meshName} translate=${translation} shadow=${receivesShadow} morphs=${morphCount}`);
				index += 1;
			});
		},
	});
}

function resolveParticleMetrics(state: ParticlePipelineState | undefined): { width: number; height: number; } {
	const view = $.view;
	return {
		width: state?.width ?? view.viewportSize.x,
		height: state?.height ?? view.viewportSize.y,
	};
}

function registerParticlePass(registry: RenderPassLibrary): void {
	registry.register({
		id: 'particles',
		label: 'particles_headless',
		name: 'HeadlessParticles',
		stateOnly: true,
		exec: (_backend, _fbo, state: unknown) => {
			const metrics = resolveParticleMetrics(state as ParticlePipelineState | undefined);
			const count = beginParticleQueue();
			if (count === 0) {
				console.log('[headless:particles] draws=0');
				return;
			}
			console.log(`[headless:particles] draws=${count} viewport=${metrics.width}x${metrics.height}`);
			let index = 0;
			forEachParticleQueue((submission: ParticleRenderSubmission) => {
				const pos = formatVec3(submission.position);
				const ambient = formatAmbient(submission.ambientMode === undefined ? undefined : submission.ambientMode === 1, submission.ambientFactor);
				const textureTag = submission.texture ? 'custom' : 'default';
				console.log(`  [particle#${index}] pos=${pos} size=${formatNumber(submission.size)} texture=${textureTag} ambient=${ambient}`);
				index += 1;
			});
		},
	});
}
