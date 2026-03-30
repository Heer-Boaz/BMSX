import { $ } from '../../core/engine_core';
import { RenderPassLibrary } from '../backend/renderpasslib';
import { Framebuffer2DPipelineState, MeshBatchPipelineState, ParticlePipelineState } from '../backend/pipeline_interfaces';
import { M4 } from '../3d/math3d';
import {
	beginMeshQueue,
	forEachMeshQueue,
	beginParticleQueue,
	forEachParticleQueue,
	meshQueueBackSize,
	particleQueueBackSize,
} from '../shared/render_queues';
import type { MeshRenderSubmission, ParticleRenderSubmission } from '../shared/render_types';
import { updateFallbackCamera, FALLBACK_CAMERA } from '../shared/fallback_camera';
import { resolveActiveCamera3D } from '../shared/hardware_camera';
import { ENGINE_ATLAS_INDEX } from '../../rompack/rompack';
import { VRAM_ATLAS_SLOT_SIZE, VRAM_SKYBOX_FACE_BYTES, VRAM_SYSTEM_ATLAS_SLOT_SIZE } from '../../emulator/memory_map';
import type { Mesh } from '../3d/mesh';
import { Runtime } from '../../emulator/runtime';

export function registerHeadlessPasses(registry: RenderPassLibrary): void {
	registerFramePasses(registry);
	registerSkyboxPass(registry);
	registerFrameBuffer2DPass(registry);
	registerMeshPass(registry);
	registerParticlePass(registry);
}

function registerFramePasses(registry: RenderPassLibrary): void {
	registry.register({ id: 'frame_resolve', name: 'HeadlessFrameResolve', stateOnly: true, graph: { skip: true }, exec: () => { /* noop */ } });
	registry.register({ id: 'frame_shared', name: 'HeadlessFrameShared', stateOnly: true, graph: { skip: true }, exec: () => { /* noop */ } });
}

type Snapshot = string[];

let previousMeshSnapshot: Snapshot = [];
let previousParticleSnapshot: Snapshot = [];
let previousSkyboxSnapshot: Snapshot = [];
let previousFrameBufferSnapshot: Snapshot = [];

let diffMatrix = new Uint32Array(0);

const headlessFallbackParticleState: ParticlePipelineState = {
	width: FALLBACK_CAMERA.width,
	height: FALLBACK_CAMERA.height,
	viewProj: FALLBACK_CAMERA.viewProj,
	camRight: FALLBACK_CAMERA.camRight,
	camUp: FALLBACK_CAMERA.camUp,
};

const validatedAtlasByKey = new Set<string>();
const validatedMesh = new WeakMap<Mesh, boolean>();
const MAX_MORPH_TARGETS = 8;
const MAX_JOINTS = 32;
const HEADLESS_VERBOSE_DIFF = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.BMSX_HEADLESS_VERBOSE === '1';

function ensureAtlasResource(atlasId: number, slotBytes: number, label: string): void {
	const key = `${atlasId}:${slotBytes}`;
	if (validatedAtlasByKey.has(key)) {
		return;
	}
	let found = false;
	for (const asset of Runtime.instance.listImageAssets()) {
		if (asset.type !== 'atlas') continue;
		const meta = asset.imgmeta;
		if (!meta || meta.atlasid !== atlasId) continue;
		if (meta.width <= 0 || meta.height <= 0) {
			throw new Error(`[${label}] Atlas ${atlasId} has invalid dimensions (${meta.width}x${meta.height}).`);
		}
		const bytes = meta.width * meta.height * 4;
		if (bytes > slotBytes) {
			throw new Error(`[${label}] Atlas ${atlasId} size ${meta.width}x${meta.height} exceeds slot bytes (${slotBytes}).`);
		}
		found = true;
		break;
	}
	if (!found) {
		throw new Error(`[${label}] Atlas ${atlasId} not registered in assets.`);
	}
	validatedAtlasByKey.add(key);
}

function resolveHeadlessAtlasSlots(): { primary: number | null; secondary: number | null } {
	const primaryFromView = $.view.primaryAtlasIdInSlot;
	const secondaryFromView = $.view.secondaryAtlasIdInSlot;
	if (primaryFromView !== null || secondaryFromView !== null) {
		return { primary: primaryFromView, secondary: secondaryFromView };
	}
	return { primary: null, secondary: null };
}

function validateMeshAsset(mesh: Mesh): void {
	if (validatedMesh.has(mesh)) {
		return;
	}
	const positions = mesh.positions;
	if (!positions || positions.length === 0 || positions.length % 3 !== 0) {
		throw new Error(`[HeadlessMeshes] Mesh '${mesh.name}' has invalid positions buffer.`);
	}
	const vertexCount = mesh.vertexCount;
	if (!Number.isFinite(vertexCount) || vertexCount <= 0) {
		throw new Error(`[HeadlessMeshes] Mesh '${mesh.name}' has invalid vertex count (${vertexCount}).`);
	}
	if (mesh.indices && mesh.indices.length > 0) {
		let maxIndex = 0;
		for (let i = 0; i < mesh.indices.length; i += 1) {
			const idx = mesh.indices[i] as number;
			if (idx > maxIndex) maxIndex = idx;
		}
		if (maxIndex >= vertexCount) {
			throw new Error(`[HeadlessMeshes] Mesh '${mesh.name}' index buffer out of range (max ${maxIndex}, verts ${vertexCount}).`);
		}
	}
	if (mesh.texcoords && mesh.texcoords.length > 0 && mesh.texcoords.length < vertexCount * 2) {
		throw new Error(`[HeadlessMeshes] Mesh '${mesh.name}' has invalid texcoord buffer length (${mesh.texcoords.length}).`);
	}
	if (mesh.normals && mesh.normals.length > 0 && mesh.normals.length < vertexCount * 3) {
		throw new Error(`[HeadlessMeshes] Mesh '${mesh.name}' has invalid normals buffer length (${mesh.normals.length}).`);
	}
	if (mesh.tangents && mesh.tangents.length > 0) {
		const len = mesh.tangents.length;
		if (len !== vertexCount * 3 && len !== vertexCount * 4) {
			throw new Error(`[HeadlessMeshes] Mesh '${mesh.name}' has invalid tangent buffer length (${len}).`);
		}
	}
	if (mesh.hasSkinning) {
		if (!mesh.jointIndices || !mesh.jointWeights) {
			throw new Error(`[HeadlessMeshes] Mesh '${mesh.name}' skinning data is incomplete.`);
		}
		if (mesh.jointIndices.length < vertexCount * 4 || mesh.jointWeights.length < vertexCount * 4) {
			throw new Error(`[HeadlessMeshes] Mesh '${mesh.name}' skinning buffers are too small.`);
		}
	}
	if (mesh.morphPositions && mesh.morphPositions.length > 0) {
		for (const morph of mesh.morphPositions) {
			if (morph.length !== positions.length) {
				throw new Error(`[HeadlessMeshes] Mesh '${mesh.name}' has morph position buffer mismatch.`);
			}
		}
	}
	if (mesh.morphNormals && mesh.morphNormals.length > 0 && mesh.normals) {
		for (const morph of mesh.morphNormals) {
			if (morph.length !== mesh.normals.length) {
				throw new Error(`[HeadlessMeshes] Mesh '${mesh.name}' has morph normal buffer mismatch.`);
			}
		}
	}
	if (mesh.morphTangents && mesh.morphTangents.length > 0 && mesh.tangents) {
		for (const morph of mesh.morphTangents) {
			if (morph.length !== mesh.tangents.length) {
				throw new Error(`[HeadlessMeshes] Mesh '${mesh.name}' has morph tangent buffer mismatch.`);
			}
		}
	}
	validatedMesh.set(mesh, true);
}

function requireMaterialTexture(mesh: Mesh, slot: 'albedo' | 'normal' | 'metallicRoughness' | 'occlusion' | 'emissive'): void {
	const material = mesh.material;
	if (!material) {
		return;
	}
	const index = material.textures[slot];
	if (index === undefined || index === null) {
		return;
	}
	const model = (mesh as unknown as { _sourceModel?: { imageBuffers?: ArrayBuffer[]; imageURIs?: string[] } })._sourceModel;
	if (model) {
		const count = model.imageBuffers ? model.imageBuffers.length : (model.imageURIs ? model.imageURIs.length : 0);
		if (index < 0 || index >= count) {
			throw new Error(`[HeadlessMeshes] Mesh '${mesh.name}' material texture '${slot}' index ${index} out of range (images=${count}).`);
		}
	}
	const key = material.gpuTextures[slot];
	if (!key) {
		throw new Error(`[HeadlessMeshes] Mesh '${mesh.name}' material texture '${slot}' missing GPU binding.`);
	}
	const handle = $.texmanager.getTexture(key);
	if (!handle) {
		throw new Error(`[HeadlessMeshes] Mesh '${mesh.name}' material texture '${slot}' not loaded (key='${key}').`);
	}
}

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

function translationFromMatrix(m: Float32Array): string {
	return `(${formatNumber(m[12])}, ${formatNumber(m[13])}, ${formatNumber(m[14])})`;
}

function computeDiff(previous: Snapshot, current: Snapshot): Snapshot {
	const prevCount = previous.length;
	const currCount = current.length;
	if (prevCount === 0) return current.map((line) => `+ ${line}`);
	if (currCount === 0) return previous.map((line) => `- ${line}`);

	const cols = currCount + 1;
	const rows = prevCount + 1;
	const needed = rows * cols;
	if (diffMatrix.length < needed) diffMatrix = new Uint32Array(needed);

	const table = diffMatrix;
	const lastRow = rows - 1;
	const lastCol = cols - 1;
	const lastRowOffset = lastRow * cols;
	for (let j = 0; j < cols; j += 1) table[lastRowOffset + j] = 0;
	for (let i = 0; i < rows; i += 1) table[i * cols + lastCol] = 0;

	// LCS diff to keep insertions/removals from shifting every subsequent line.
	for (let i = prevCount - 1; i >= 0; i -= 1) {
		const rowOffset = i * cols;
		const nextRowOffset = (i + 1) * cols;
		for (let j = currCount - 1; j >= 0; j -= 1) {
			if (previous[i] === current[j]) {
				table[rowOffset + j] = table[nextRowOffset + j + 1] + 1;
			} else {
				const skipPrev = table[nextRowOffset + j];
				const skipCurr = table[rowOffset + j + 1];
				table[rowOffset + j] = skipPrev >= skipCurr ? skipPrev : skipCurr;
			}
		}
	}

	const diff: Snapshot = [];
	let i = 0;
	let j = 0;
	while (i < prevCount && j < currCount) {
		if (previous[i] === current[j]) {
			i += 1;
			j += 1;
			continue;
		}
		const skipPrev = table[(i + 1) * cols + j];
		const skipCurr = table[i * cols + j + 1];
		if (skipPrev >= skipCurr) {
			diff.push(`- ${previous[i]}`);
			i += 1;
		} else {
			diff.push(`+ ${current[j]}`);
			j += 1;
		}
	}
	for (; i < prevCount; i += 1) diff.push(`- ${previous[i]}`);
	for (; j < currCount; j += 1) diff.push(`+ ${current[j]}`);
	return diff;
}

function emitDiff(label: string, previous: Snapshot, current: Snapshot): Snapshot {
	const diff = computeDiff(previous, current);
	if (diff.length !== 0) {
		if (!HEADLESS_VERBOSE_DIFF && label === 'overlay') {
			return current;
		}
		if (!HEADLESS_VERBOSE_DIFF && label === 'sprites' && diff.length <= 2) {
			return current;
		}
		if (HEADLESS_VERBOSE_DIFF) {
			console.log(`[headless:${label}] diff`);
			for (const line of diff) console.log(`  ${line}`);
		} else {
			const prevHeadline = previous[0] ?? '';
			const headline = current[0] ?? 'changed';
			if (headline === prevHeadline) {
				return current;
			}
			console.log(`[headless:${label}] ${headline} (${diff.length} changes)`);
		}
	}
	return current;
}

function registerFrameBuffer2DPass(registry: RenderPassLibrary): void {
	registry.register({
		id: 'framebuffer_2d',
		name: 'HeadlessFramebuffer2D',
		stateOnly: true,
		prepare: () => {
			registry.setState('framebuffer_2d', {
				width: $.view.offscreenCanvasSize.x,
				height: $.view.offscreenCanvasSize.y,
				baseWidth: $.view.viewportSize.x,
				baseHeight: $.view.viewportSize.y,
				colorTex: $.view.textures[Runtime.instance.vdp.frameBufferTextureKey],
			} as Framebuffer2DPipelineState);
		},
		exec: (backend, _fbo, state: Framebuffer2DPipelineState) => {
			const frameBufferWidth = Runtime.instance.vdp.frameBufferWidth;
			const frameBufferHeight = Runtime.instance.vdp.frameBufferHeight;
			if (frameBufferWidth <= 0 || frameBufferHeight <= 0) {
				throw new Error(`[HeadlessFramebuffer2D] Invalid framebuffer dimensions ${frameBufferWidth}x${frameBufferHeight}.`);
			}
			if (!state.colorTex) {
				throw new Error(`[HeadlessFramebuffer2D] Missing framebuffer texture '${Runtime.instance.vdp.frameBufferTextureKey}'.`);
			}
			const pixels = backend.readTextureRegion(state.colorTex, 0, 0, frameBufferWidth, frameBufferHeight);
			const expectedByteLength = frameBufferWidth * frameBufferHeight * 4;
			if (pixels.byteLength !== expectedByteLength) {
				throw new Error(`[HeadlessFramebuffer2D] Framebuffer byte length mismatch (${pixels.byteLength} != ${expectedByteLength}).`);
			}
			let active = 0;
			for (let index = 3; index < pixels.length; index += 4) {
				if (pixels[index] !== 0) {
					active += 1;
				}
			}
			const snapshot: Snapshot = [
				`pixels=${pixels.length >> 2} active=${active} framebuffer=${frameBufferWidth}x${frameBufferHeight} present=${state.width}x${state.height} logical=${state.baseWidth}x${state.baseHeight}`,
			];
			previousFrameBufferSnapshot = emitDiff('framebuffer', previousFrameBufferSnapshot, snapshot);
		},
	});
}

function registerSkyboxPass(registry: RenderPassLibrary): void {
	registry.register({
		id: 'skybox',
		name: 'HeadlessSkybox',
		stateOnly: true,
		shouldExecute: () => !!$.view.skyboxFaceIds,
		exec: () => {
			const ids = $.view.skyboxFaceIds;
			if (!ids) {
				return;
			}
			if (VRAM_SKYBOX_FACE_BYTES <= 0) {
				throw new Error('[HeadlessSkybox] VRAM_SKYBOX_FACE_BYTES is not configured.');
			}
			const faces: Array<[string, string]> = [
				['posx', ids.posx],
				['negx', ids.negx],
				['posy', ids.posy],
				['negy', ids.negy],
				['posz', ids.posz],
				['negz', ids.negz],
			];
			const snapshot: Snapshot = [`faces=${faces.map((face) => face[1]).join(',')}`];
			for (const [face, id] of faces) {
				const meta = Runtime.instance.getImageMeta(id);
				if (meta.atlassed) {
					throw new Error(`[HeadlessSkybox] Skybox image '${id}' must not be atlassed.`);
				}
				if (meta.width <= 0 || meta.height <= 0) {
					throw new Error(`[HeadlessSkybox] Skybox image '${id}' has invalid dimensions (${meta.width}x${meta.height}).`);
				}
				const bytes = meta.width * meta.height * 4;
				if (bytes > VRAM_SKYBOX_FACE_BYTES) {
					throw new Error(`[HeadlessSkybox] Skybox image '${id}' size ${meta.width}x${meta.height} exceeds VRAM_SKYBOX_FACE_BYTES (${VRAM_SKYBOX_FACE_BYTES}).`);
				}
				snapshot.push(`[skybox:${face}] id=${id} size=${meta.width}x${meta.height}`);
			}
			previousSkyboxSnapshot = emitDiff('skybox', previousSkyboxSnapshot, snapshot);
		},
	});
}

function makeMeshState(registry: RenderPassLibrary): MeshBatchPipelineState {
	const gv = $.view;
	const cam = resolveActiveCamera3D();
	if (!cam) {
		throw new Error('[HeadlessMeshes] No active 3D camera found.');
	}
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
					const mesh = submission.mesh;
					validateMeshAsset(mesh);
					requireMaterialTexture(mesh, 'albedo');
					requireMaterialTexture(mesh, 'normal');
					requireMaterialTexture(mesh, 'metallicRoughness');
					requireMaterialTexture(mesh, 'occlusion');
					requireMaterialTexture(mesh, 'emissive');
					const matrix = submission.matrix;
					if (!matrix || matrix.length !== 16) {
						throw new Error(`[HeadlessMeshes] Mesh '${mesh.name}' has invalid matrix.`);
					}
					for (let i = 0; i < 16; i += 1) {
						if (!Number.isFinite(matrix[i])) {
							throw new Error(`[HeadlessMeshes] Mesh '${mesh.name}' matrix contains non-finite values.`);
						}
					}
					const jointMatrices = submission.joint_matrices;
					if (jointMatrices && jointMatrices.length > 0) {
						if (!mesh.hasSkinning) {
							throw new Error(`[HeadlessMeshes] Mesh '${mesh.name}' has joint_matrices but no skinning data.`);
						}
						if (jointMatrices.length > MAX_JOINTS) {
							throw new Error(`[HeadlessMeshes] Mesh '${mesh.name}' joint count ${jointMatrices.length} exceeds MAX_JOINTS (${MAX_JOINTS}).`);
						}
						for (let j = 0; j < jointMatrices.length; j += 1) {
							const jointMatrix = jointMatrices[j];
							if (!jointMatrix || jointMatrix.length !== 16) {
								throw new Error(`[HeadlessMeshes] Mesh '${mesh.name}' joint matrix ${j} is invalid.`);
							}
						}
					}
					const morphWeights = submission.morph_weights;
					if (morphWeights && morphWeights.length > 0) {
						if (!mesh.hasMorphTargets) {
							throw new Error(`[HeadlessMeshes] Mesh '${mesh.name}' has morph_weights but no morph targets.`);
						}
						if (morphWeights.length > MAX_MORPH_TARGETS) {
							throw new Error(`[HeadlessMeshes] Mesh '${mesh.name}' morph count ${morphWeights.length} exceeds MAX_MORPH_TARGETS (${MAX_MORPH_TARGETS}).`);
						}
					}
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
	const cam = resolveActiveCamera3D();
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
			if (count <= 0) {
				return;
			}
			const slots = resolveHeadlessAtlasSlots();
			const primaryAtlasId = slots.primary;
			const secondaryAtlasId = slots.secondary;
			const snapshot: Snapshot = [`draws=${count} viewport=${particleState.width}x${particleState.height}`];
			let needsPrimaryAtlas = false;
			let needsSecondaryAtlas = false;
			let needsEngineAtlas = false;
			if (count > 0) {
				let index = 0;
				forEachParticleQueue((submission: ParticleRenderSubmission) => {
					const uv0 = submission.uv0;
					const uv1 = submission.uv1;
					if (!uv0 || !uv1) {
						throw new Error('[HeadlessParticles] Particle missing atlas UVs.');
					}
					const atlas = submission.atlasBinding;
					if (atlas === undefined || atlas === null) {
						throw new Error('[HeadlessParticles] Particle missing atlas binding.');
					}
					if (atlas !== 0 && atlas !== 1 && atlas !== ENGINE_ATLAS_INDEX) {
						throw new Error(`[HeadlessParticles] Particle has invalid atlas binding (${atlas}).`);
					}
					if (atlas === 0) needsPrimaryAtlas = true;
					if (atlas === 1) needsSecondaryAtlas = true;
					if (atlas === ENGINE_ATLAS_INDEX) needsEngineAtlas = true;
					if (!Number.isFinite(uv0[0]) || !Number.isFinite(uv0[1]) || !Number.isFinite(uv1[0]) || !Number.isFinite(uv1[1])) {
						throw new Error('[HeadlessParticles] Particle UVs must be finite numbers.');
					}
					if (uv0[0] < 0 || uv0[1] < 0 || uv1[0] > 1 || uv1[1] > 1 || uv0[0] > uv1[0] || uv0[1] > uv1[1]) {
						throw new Error(`[HeadlessParticles] Particle UVs out of range (${uv0[0]}, ${uv0[1]})..(${uv1[0]}, ${uv1[1]}).`);
					}
					snapshot.push(`[particle#${index}] pos=${formatVec3(submission.position)} size=${formatNumber(submission.size)} atlas=${atlas}`);
					index += 1;
				});
			}
			if (needsPrimaryAtlas) {
				if (primaryAtlasId === null || primaryAtlasId === undefined) {
					throw new Error('[HeadlessParticles] Primary atlas slot is not set.');
				}
				ensureAtlasResource(primaryAtlasId, VRAM_ATLAS_SLOT_SIZE, 'HeadlessParticles');
			}
			if (needsSecondaryAtlas) {
				if (secondaryAtlasId === null || secondaryAtlasId === undefined) {
					throw new Error('[HeadlessParticles] Secondary atlas slot is not set.');
				}
				ensureAtlasResource(secondaryAtlasId, VRAM_ATLAS_SLOT_SIZE, 'HeadlessParticles');
			}
			if (needsEngineAtlas) {
				ensureAtlasResource(ENGINE_ATLAS_INDEX, VRAM_SYSTEM_ATLAS_SLOT_SIZE, 'HeadlessParticles');
			}
			previousParticleSnapshot = emitDiff('particles', previousParticleSnapshot, snapshot);
		},
	});
}
