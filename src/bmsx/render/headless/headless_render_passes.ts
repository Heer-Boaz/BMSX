import { $ } from '../../core/engine_core';
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
import { resolveActiveCamera3D } from '../shared/hardware_camera';
import { tokenKeyFromId } from '../../util/asset_tokens';
import { ENGINE_ATLAS_INDEX } from '../../rompack/rompack';
import { VRAM_ATLAS_SLOT_SIZE, VRAM_SKYBOX_FACE_BYTES, VRAM_SYSTEM_ATLAS_SLOT_SIZE } from '../../emulator/memory_map';
import type { Mesh } from '../3d/mesh';
import { consumeOverlayFrame, type EditorOverlayFrame } from '../editor/editor_overlay_queue';

export function registerHeadlessPasses(registry: RenderPassLibrary): void {
	registerFramePasses(registry);
	registerSkyboxPass(registry);
	registerSpritePass(registry);
	registerMeshPass(registry);
	registerParticlePass(registry);
}

function registerFramePasses(registry: RenderPassLibrary): void {
	registry.register({ id: 'frame_resolve', name: 'HeadlessFrameResolve', stateOnly: true, exec: () => { /* noop */ } });
	registry.register({ id: 'frame_shared', name: 'HeadlessFrameShared', stateOnly: true, exec: () => { /* noop */ } });
}

type Snapshot = string[];

type ResolvedSpriteMeta = {
	atlasId: number;
	width: number;
	height: number;
	texcoords: number[];
	texcoords_fliph: number[];
	texcoords_flipv: number[];
	texcoords_fliphv: number[];
};

let previousSpriteSnapshot: Snapshot = [];
let previousMeshSnapshot: Snapshot = [];
let previousParticleSnapshot: Snapshot = [];
let previousSkyboxSnapshot: Snapshot = [];
let previousOverlaySnapshot: Snapshot = [];

let diffMatrix = new Uint32Array(0);

const headlessFallbackParticleState: ParticlePipelineState = {
	width: FALLBACK_CAMERA.width,
	height: FALLBACK_CAMERA.height,
	viewProj: FALLBACK_CAMERA.viewProj,
	camRight: FALLBACK_CAMERA.camRight,
	camUp: FALLBACK_CAMERA.camUp,
};

const validatedAtlasByKey = new Set<string>();
const spriteMetaCache = new Map<string, ResolvedSpriteMeta>();
const validatedMesh = new WeakMap<Mesh, boolean>();
const MAX_MORPH_TARGETS = 8;
const MAX_JOINTS = 32;
const HEADLESS_VERBOSE_DIFF = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.BMSX_HEADLESS_VERBOSE === '1';

function drainOverlayFrameForHeadless(): EditorOverlayFrame {
	const frame = consumeOverlayFrame();
	if (!frame) {
		return null;
	}
	const commands = frame.commands;
	for (let i = 0; i < commands.length; i += 1) {
		$.view.renderer.submit.typed(commands[i]);
	}
	return frame;
}

function ensureAtlasResource(atlasId: number, slotBytes: number, label: string): void {
	const key = `${atlasId}:${slotBytes}`;
	if (validatedAtlasByKey.has(key)) {
		return;
	}
	let found = false;
	for (const asset of Object.values($.assets.img)) {
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

function resolveSpriteMeta(imgid: string): ResolvedSpriteMeta {
	const cached = spriteMetaCache.get(imgid);
	if (cached) {
		return cached;
	}
	const asset = $.assets.img[tokenKeyFromId(imgid)];
	if (!asset) {
		throw new Error(`[HeadlessSprites] Image '${imgid}' not found.`);
	}
	const meta = asset.imgmeta;
	if (!meta) {
		throw new Error(`[HeadlessSprites] Image '${imgid}' missing metadata.`);
	}
	if (!meta.atlassed) {
		throw new Error(`[HeadlessSprites] Image '${imgid}' must be atlassed.`);
	}
	if (meta.atlasid === undefined || meta.atlasid === null) {
		throw new Error(`[HeadlessSprites] Image '${imgid}' missing atlas id.`);
	}
	if (meta.width <= 0 || meta.height <= 0) {
		throw new Error(`[HeadlessSprites] Image '${imgid}' has invalid dimensions (${meta.width}x${meta.height}).`);
	}
	if (!meta.texcoords || !meta.texcoords_fliph || !meta.texcoords_flipv || !meta.texcoords_fliphv) {
		throw new Error(`[HeadlessSprites] Image '${imgid}' missing UV metadata.`);
	}
	if (meta.texcoords.length < 12 || meta.texcoords_fliph.length < 12 || meta.texcoords_flipv.length < 12 || meta.texcoords_fliphv.length < 12) {
		throw new Error(`[HeadlessSprites] Image '${imgid}' has incomplete UV metadata.`);
	}
	const resolved: ResolvedSpriteMeta = {
		atlasId: meta.atlasid,
		width: meta.width,
		height: meta.height,
		texcoords: meta.texcoords,
		texcoords_fliph: meta.texcoords_fliph,
		texcoords_flipv: meta.texcoords_flipv,
		texcoords_fliphv: meta.texcoords_fliphv,
	};
	spriteMetaCache.set(imgid, resolved);
	return resolved;
}

function resolveExpectedSpriteAtlasBinding(atlasId: number, primaryAtlasId: number | null, secondaryAtlasId: number | null): number {
	if (atlasId === ENGINE_ATLAS_INDEX) {
		return ENGINE_ATLAS_INDEX;
	}
	if (primaryAtlasId !== null && atlasId === primaryAtlasId) {
		return 0;
	}
	if (secondaryAtlasId !== null && atlasId === secondaryAtlasId) {
		return 1;
	}
	throw new Error(`[HeadlessSprites] Atlas ${atlasId} not bound to primary/secondary slots.`);
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

function formatScale(scale: { x: number; y: number }): string {
	return `(${formatNumber(scale?.x ?? 1)}, ${formatNumber(scale?.y ?? 1)})`;
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

function makeSpriteState(): SpritesPipelineState {
	const gv = $.view;
	return {
		width: gv.offscreenCanvasSize.x,
		height: gv.offscreenCanvasSize.y,
		baseWidth: gv.viewportSize.x,
		baseHeight: gv.viewportSize.y,
		atlasPrimaryTex: null,
		atlasSecondaryTex: null,
		atlasEngineTex: null,
		ambientEnabledDefault: gv.spriteAmbientEnabledDefault,
		ambientFactorDefault: gv.spriteAmbientFactorDefault,
		ambientColor: [0, 0, 0], // Ambient sprites disabled; update when a new path is implemented.
		ambientIntensity: 0,
		viewportTypeIde: gv.viewportTypeIde,
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
			const overlayFrame = drainOverlayFrameForHeadless();
			if (overlayFrame) {
				let glyphCount = 0;
				const samples: string[] = [];
				for (let i = 0; i < overlayFrame.commands.length; i += 1) {
					const cmd = overlayFrame.commands[i];
					if (cmd.type !== 'glyphs') {
						continue;
					}
					glyphCount += 1;
					if (samples.length < 6) {
						const text = typeof cmd.glyphs === 'string' ? cmd.glyphs : cmd.glyphs.join('\n');
						samples.push(text);
					}
				}
				const overlaySnapshot: Snapshot = [
					`commands=${overlayFrame.commands.length} glyphs=${glyphCount} size=${overlayFrame.width}x${overlayFrame.height}`,
				];
				for (let i = 0; i < samples.length; i += 1) {
					overlaySnapshot.push(`[glyph] ${samples[i]}`);
				}
				previousOverlaySnapshot = emitDiff('overlay', previousOverlaySnapshot, overlaySnapshot);
			}
			const count = beginSpriteQueue();
			const snapshot: Snapshot = [
				`draws=${count} viewport=${spriteState.width}x${spriteState.height} base=${spriteState.baseWidth}x${spriteState.baseHeight}`,
			];
			const primaryAtlasId = $.view.primaryAtlasIdInSlot;
			const secondaryAtlasId = $.view.secondaryAtlasIdInSlot;
				let needsPrimaryAtlas = false;
				let needsSecondaryAtlas = false;
				let needsEngineAtlas = false;
				if (count > 0) {
					let index = 0;
					forEachSprite((submission: SpriteQueueItem) => {
						const { options, atlasId, entry } = submission;
						if (options.imgid === 'none') {
							throw new Error('[HeadlessSprites] Sprite submission has imgid="none".');
						}
					if (!Number.isFinite(options.scale.x) || !Number.isFinite(options.scale.y)) {
						throw new Error(`[HeadlessSprites] Sprite '${options.imgid}' has invalid scale.`);
					}
					if (!Number.isFinite(options.pos.x) || !Number.isFinite(options.pos.y) || !Number.isFinite(options.pos.z ?? 0)) {
						throw new Error(`[HeadlessSprites] Sprite '${options.imgid}' has invalid position.`);
					}
						const meta = resolveSpriteMeta(options.imgid);
						if (entry.regionW !== meta.width || entry.regionH !== meta.height) {
							throw new Error(`[HeadlessSprites] Sprite '${options.imgid}' size ${entry.regionW}x${entry.regionH} does not match metadata ${meta.width}x${meta.height}.`);
						}
						const flipH = !!options.flip?.flip_h;
						const flipV = !!options.flip?.flip_v;
						const texcoords = flipH
							? (flipV ? meta.texcoords_fliphv : meta.texcoords_fliph)
							: (flipV ? meta.texcoords_flipv : meta.texcoords);
						const u0 = texcoords[0];
						const v0 = texcoords[1];
						const u1 = texcoords[10];
						const v1 = texcoords[11];
						if (!Number.isFinite(u0) || !Number.isFinite(v0) || !Number.isFinite(u1) || !Number.isFinite(v1)) {
							throw new Error(`[HeadlessSprites] Sprite '${options.imgid}' has non-finite UVs.`);
						}
						const uMin = u0 < u1 ? u0 : u1;
						const uMax = u0 > u1 ? u0 : u1;
						const vMin = v0 < v1 ? v0 : v1;
						const vMax = v0 > v1 ? v0 : v1;
						if (uMin < 0 || vMin < 0 || uMax > 1 || vMax > 1) {
							throw new Error(`[HeadlessSprites] Sprite '${options.imgid}' UVs out of range (${u0}, ${v0})..(${u1}, ${v1}).`);
						}
					const expectedBinding = resolveExpectedSpriteAtlasBinding(atlasId, primaryAtlasId, secondaryAtlasId);
					if (expectedBinding === 0) needsPrimaryAtlas = true;
					else if (expectedBinding === 1) needsSecondaryAtlas = true;
					else needsEngineAtlas = true;
						const layer = options.layer ?? 'world';
						const pos = formatVec3({ x: options.pos.x, y: options.pos.y, z: options.pos.z ?? 0 });
						const scale = formatScale(options.scale);
						const flipHLabel = flipH ? 'H' : '-';
						const flipVLabel = flipV ? 'V' : '-';
						const atlas = expectedBinding;
						// Ambient sprites are disabled in the runtime; logging follows suit until a new approach is added.
						snapshot.push(`[sprite#${index}] id=${options.imgid} layer=${layer} pos=${pos} scale=${scale} flip=${flipHLabel}${flipVLabel} atlas=${atlas}`);
						index += 1;
					});
				}
			if (needsPrimaryAtlas) {
				if (primaryAtlasId === null || primaryAtlasId === undefined) {
					throw new Error('[HeadlessSprites] Primary atlas slot is not set.');
				}
				ensureAtlasResource(primaryAtlasId, VRAM_ATLAS_SLOT_SIZE, 'HeadlessSprites');
			}
			if (needsSecondaryAtlas) {
				if (secondaryAtlasId === null || secondaryAtlasId === undefined) {
					throw new Error('[HeadlessSprites] Secondary atlas slot is not set.');
				}
				ensureAtlasResource(secondaryAtlasId, VRAM_ATLAS_SLOT_SIZE, 'HeadlessSprites');
			}
			if (needsEngineAtlas) {
				ensureAtlasResource(ENGINE_ATLAS_INDEX, VRAM_SYSTEM_ATLAS_SLOT_SIZE, 'HeadlessSprites');
			}
			previousSpriteSnapshot = emitDiff('sprites', previousSpriteSnapshot, snapshot);
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
				const asset = $.assets.img[tokenKeyFromId(id)];
				if (!asset) {
					throw new Error(`[HeadlessSkybox] Skybox image '${id}' not found.`);
				}
				const meta = asset.imgmeta;
				if (!meta) {
					throw new Error(`[HeadlessSkybox] Skybox image '${id}' missing metadata.`);
				}
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
			const primaryAtlasId = $.view.primaryAtlasIdInSlot;
			const secondaryAtlasId = $.view.secondaryAtlasIdInSlot;
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
