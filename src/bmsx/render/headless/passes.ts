import { consoleCore } from '../../core/console';
import { RenderPassLibrary } from '../backend/pass/library';
import { Framebuffer2DPipelineState, MeshBatchPipelineState, ParticlePipelineState, type RenderPassDef } from '../backend/backend';
import { M4 } from '../3d/math';
import {
	beginMeshQueue,
	forEachMeshQueue,
	beginParticleQueue,
	forEachParticleQueue,
	meshQueueBackSize,
	type Host2DSubmission,
} from '../shared/queues';
import type { MeshRenderSubmission, ParticleRenderSubmission } from '../shared/submissions';
import { SKYBOX_FACE_KEYS } from '../../machine/devices/vdp/contracts';
import type { VdpHostOutput, VdpResolvedBlitterSample } from '../../machine/devices/vdp/vdp';
import { VDP_SLOT_PRIMARY, VDP_SLOT_SECONDARY, VDP_SLOT_SYSTEM } from '../../machine/bus/io';
import {
	VDP_RD_SURFACE_PRIMARY,
	VDP_RD_SURFACE_SECONDARY,
	VDP_RD_SURFACE_SYSTEM,
} from '../../machine/devices/vdp/contracts';
import type { Mesh } from '../3d/mesh';
import { readVdpDisplayFrameBufferPixels, vdpDisplayFrameBufferTexture } from '../vdp/framebuffer';
import { resolveVdpSurfacePixels } from '../vdp/source_pixels';
import type { HeadlessPresentHost } from './view';
import { hostOverlayMenu } from '../../core/host_overlay_menu';
import { renderHeadlessHost2DEntry, renderHeadlessSubmissions } from './host_2d';
import { blendPixel } from './pixel_ops';

export function registerHeadlessPasses(registry: RenderPassLibrary): void {
	registerFramePasses(registry);
	registerSkyboxPass(registry);
	registerMeshPass(registry);
	registerParticlePass(registry);
	registerFrameBuffer2DPass(registry);
}

export function registerHeadlessPresentPass(registry: RenderPassLibrary): void {
	registry.register({
		id: 'headless_present',
		name: 'HeadlessPresent',
		stateOnly: true,
		graph: { reads: ['frame_color'] },
		exec: () => {
			presentHeadlessFrame();
		},
	});
}

function registerFramePasses(registry: RenderPassLibrary): void {
	registry.register({
		id: 'frame_resolve',
		name: 'HeadlessFrameResolve',
		stateOnly: true,
		graph: { skip: true },
		exec: () => {
			const output = consoleCore.runtime.machine.vdp.readHostOutput();
			beginHeadlessScene(output.frameBufferWidth, output.frameBufferHeight);
		},
	});
	registry.register({ id: 'frame_shared', name: 'HeadlessFrameShared', stateOnly: true, graph: { skip: true }, exec: () => { /* noop */ } });
}

type Snapshot = string[];

let previousMeshSnapshot: Snapshot = [];
let previousParticleSnapshot: Snapshot = [];
let previousSkyboxSnapshot: Snapshot = [];
let previousFrameBufferSnapshot: Snapshot = [];

let diffMatrix = new Uint32Array(0);
let headlessFrameBufferReadbackPixels = new Uint8Array(0);
let headlessScenePixels = new Uint8Array(0);
let headlessCompositePixels = new Uint8Array(0);
let headlessSceneWidth = 0;
let headlessSceneHeight = 0;
let headlessFrameWidth = 0;
let headlessFrameHeight = 0;
let headlessPresentWidth = 0;
let headlessPresentHeight = 0;
let headlessFrameReady = false;
let headlessSceneActive = false;
const headlessSkyboxSamples = new Array<VdpResolvedBlitterSample>(SKYBOX_FACE_KEYS.length);
const headlessSkyboxTextures = new Array<SlotTexturePixels>(SKYBOX_FACE_KEYS.length);
const headlessSkyboxFaceUv = new Float32Array(2);

const validatedMesh = new WeakMap<Mesh, boolean>();
const MAX_MORPH_TARGETS = 8;
const MAX_JOINTS = 32;
const HEADLESS_VERBOSE_DIFF = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.BMSX_HEADLESS_VERBOSE === '1';

function validateMeshRecord(mesh: Mesh): void {
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
	const handle = consoleCore.texmanager.getTexture(key);
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
				const headline = current[0];
				if (headline === previous[0]) {
					return current;
				}
				console.log(`[headless:${label}] ${headline} (${diff.length} changes)`);
		}
	}
	return current;
}

function resizeHeadlessScene(width: number, height: number): void {
	const byteLength = width * height * 4;
	if (headlessScenePixels.byteLength !== byteLength) {
		headlessFrameBufferReadbackPixels = new Uint8Array(byteLength);
		headlessScenePixels = new Uint8Array(byteLength);
		headlessCompositePixels = new Uint8Array(byteLength);
		headlessSceneWidth = width;
		headlessSceneHeight = height;
	}
}

function beginHeadlessScene(width: number, height: number): void {
	resizeHeadlessScene(width, height);
	headlessScenePixels.fill(0);
	headlessSceneActive = false;
	headlessFrameReady = false;
}

function slotSurfaceId(slot: number): number {
	if (slot === VDP_SLOT_PRIMARY) {
		return VDP_RD_SURFACE_PRIMARY;
	}
	if (slot === VDP_SLOT_SECONDARY) {
		return VDP_RD_SURFACE_SECONDARY;
	}
	return VDP_RD_SURFACE_SYSTEM;
}

type SlotTexturePixels = {
	pixels: Uint8Array;
	width: number;
	height: number;
	stride: number;
};

function readSlotTexturePixels(output: VdpHostOutput, slot: number): SlotTexturePixels {
	return resolveVdpSurfacePixels(output, slotSurfaceId(slot));
}

function resolveSkyboxFaceInto(dirX: number, dirY: number, dirZ: number): number {
	const absX = dirX < 0 ? -dirX : dirX;
	const absY = dirY < 0 ? -dirY : dirY;
	const absZ = dirZ < 0 ? -dirZ : dirZ;
	if (absX >= absY && absX >= absZ) {
		if (dirX >= 0) {
			headlessSkyboxFaceUv[0] = (-dirZ / absX) * 0.5 + 0.5;
			headlessSkyboxFaceUv[1] = (-dirY / absX) * 0.5 + 0.5;
			return 0;
		}
		headlessSkyboxFaceUv[0] = (dirZ / absX) * 0.5 + 0.5;
		headlessSkyboxFaceUv[1] = (-dirY / absX) * 0.5 + 0.5;
		return 1;
	}
	if (absY >= absZ) {
		if (dirY >= 0) {
			headlessSkyboxFaceUv[0] = (dirX / absY) * 0.5 + 0.5;
			headlessSkyboxFaceUv[1] = (dirZ / absY) * 0.5 + 0.5;
			return 2;
		}
		headlessSkyboxFaceUv[0] = (dirX / absY) * 0.5 + 0.5;
		headlessSkyboxFaceUv[1] = (-dirZ / absY) * 0.5 + 0.5;
		return 3;
	}
	if (dirZ >= 0) {
		headlessSkyboxFaceUv[0] = (dirX / absZ) * 0.5 + 0.5;
		headlessSkyboxFaceUv[1] = (-dirY / absZ) * 0.5 + 0.5;
		return 4;
	}
	headlessSkyboxFaceUv[0] = (-dirX / absZ) * 0.5 + 0.5;
	headlessSkyboxFaceUv[1] = (-dirY / absZ) * 0.5 + 0.5;
	return 5;
}

function compositeFrameBufferOverScene(frameBufferPixels: Uint8Array, width: number, height: number): Uint8Array {
	if (!headlessSceneActive || headlessSceneWidth !== width || headlessSceneHeight !== height) {
		headlessCompositePixels.set(frameBufferPixels);
		return headlessCompositePixels;
	}
	headlessCompositePixels.set(headlessScenePixels);
	for (let offset = 0; offset < frameBufferPixels.byteLength; offset += 4) {
		blendPixel(
			headlessCompositePixels,
			offset,
			frameBufferPixels[offset + 0],
			frameBufferPixels[offset + 1],
			frameBufferPixels[offset + 2],
			frameBufferPixels[offset + 3],
		);
	}
	return headlessCompositePixels;
}

function writeHeadlessFrame(frameBufferPixels: Uint8Array, frameBufferWidth: number, frameBufferHeight: number, presentWidth: number, presentHeight: number): Uint8Array {
	const pixels = compositeFrameBufferOverScene(frameBufferPixels, frameBufferWidth, frameBufferHeight);
	headlessFrameWidth = frameBufferWidth;
	headlessFrameHeight = frameBufferHeight;
	headlessPresentWidth = presentWidth;
	headlessPresentHeight = presentHeight;
	headlessFrameReady = true;
	return pixels;
}

export function drawHeadlessHostMenuLayer(): void {
	if (!headlessFrameReady) {
		throw new Error('[HeadlessPresent] Host menu pass ran before framebuffer pass.');
	}
	const count = hostOverlayMenu.queuedCommandCount();
	for (let index = 0; index < count; index += 1) {
		renderHeadlessHost2DEntry(headlessCompositePixels, headlessFrameWidth, headlessFrameHeight, hostOverlayMenu.commandKind(index), hostOverlayMenu.commandRef(index));
	}
}

export function drawHeadlessHostOverlayFrame(commands: readonly Host2DSubmission[]): void {
	if (!headlessFrameReady) {
		throw new Error('[HeadlessPresent] Host overlay pass ran before framebuffer pass.');
	}
	renderHeadlessSubmissions(headlessCompositePixels, headlessFrameWidth, headlessFrameHeight, commands);
}

function presentHeadlessFrame(): void {
	if (!headlessFrameReady) {
		throw new Error('[HeadlessPresent] Present pass ran before framebuffer pass.');
	}
	const host = consoleCore.view.host as unknown as HeadlessPresentHost;
	host.presentFrameBuffer({
		pixels: headlessCompositePixels,
		srcWidth: headlessFrameWidth,
		srcHeight: headlessFrameHeight,
		dstWidth: headlessPresentWidth,
		dstHeight: headlessPresentHeight,
	});
}

function rasterizeSkyboxBackground(width: number, height: number): void {
	const vdp = consoleCore.runtime.machine.vdp;
	const output = vdp.readHostOutput();
	const skyboxSamples = output.skyboxSamples;
	for (let index = 0; index < SKYBOX_FACE_KEYS.length; index += 1) {
		const sample = skyboxSamples[index]!;
		headlessSkyboxSamples[index] = sample;
		headlessSkyboxTextures[index] = readSlotTexturePixels(output, sample.slot);
	}
	const view = consoleCore.view.vdpCamera.skyboxView;
	for (let y = 0; y < height; y += 1) {
		const rayY = 1 - (((y * 2) + 1) / height);
		for (let x = 0; x < width; x += 1) {
			const rayX = (((x * 2) + 1) / width) - 1;
			const dirX = view[0] * rayX + view[4] * rayY + view[8];
			const dirY = view[1] * rayX + view[5] * rayY + view[9];
			const dirZ = view[2] * rayX + view[6] * rayY + view[10];
			const faceIndex = resolveSkyboxFaceInto(dirX, dirY, dirZ);
			const sample = headlessSkyboxSamples[faceIndex]!;
			const source = sample.source;
			const texture = headlessSkyboxTextures[faceIndex]!;
			let faceX = (headlessSkyboxFaceUv[0] * source.width) | 0;
			let faceY = (headlessSkyboxFaceUv[1] * source.height) | 0;
			if (faceX >= source.width) {
				faceX = source.width - 1;
			}
			if (faceY >= source.height) {
				faceY = source.height - 1;
			}
			const srcX = source.srcX + faceX;
			const srcY = source.srcY + faceY;
			const srcOffset = srcY * texture.stride + srcX * 4;
			const dstOffset = (y * width + x) * 4;
			headlessScenePixels[dstOffset + 0] = texture.pixels[srcOffset + 0];
			headlessScenePixels[dstOffset + 1] = texture.pixels[srcOffset + 1];
			headlessScenePixels[dstOffset + 2] = texture.pixels[srcOffset + 2];
			headlessScenePixels[dstOffset + 3] = texture.pixels[srcOffset + 3];
		}
	}
	headlessSceneActive = true;
}

function rasterizeHeadlessParticle(output: VdpHostOutput, submission: ParticleRenderSubmission, state: ParticlePipelineState): void {
	const slot = submission.slot;
	const texture = readSlotTexturePixels(output, slot);
	const uv0 = submission.uv0;
	const uv1 = submission.uv1;
	const position = submission.position;
	rasterizeHeadlessParticleSample(
		texture,
		(uv0[0] * texture.width) | 0,
		(uv0[1] * texture.height) | 0,
		((uv1[0] - uv0[0]) * texture.width) | 0,
		((uv1[1] - uv0[1]) * texture.height) | 0,
		position[0],
		position[1],
		position[2],
		submission.size,
		submission.color,
		state,
	);
}

function rasterizeHeadlessParticleSample(texture: SlotTexturePixels,
	sourceX: number,
	sourceY: number,
	sourceW: number,
	sourceH: number,
	positionX: number,
	positionY: number,
	positionZ: number,
	size: number,
	colorValue: number,
	state: ParticlePipelineState): void {
	const viewProj = state.viewProj;
	const clipX = viewProj[0] * positionX + viewProj[4] * positionY + viewProj[8] * positionZ + viewProj[12];
	const clipY = viewProj[1] * positionX + viewProj[5] * positionY + viewProj[9] * positionZ + viewProj[13];
	const clipW = viewProj[3] * positionX + viewProj[7] * positionY + viewProj[11] * positionZ + viewProj[15];
	if (clipW <= 0) {
		return;
	}
	const ndcX = clipX / clipW;
	const ndcY = clipY / clipW;
	const centerX = ((ndcX * 0.5 + 0.5) * state.width) | 0;
	const centerY = ((0.5 - ndcY * 0.5) * state.height) | 0;
	const halfWorld = size * 0.5;
	const edgePositionX = positionX + state.camRight[0] * halfWorld;
	const edgePositionY = positionY + state.camRight[1] * halfWorld;
	const edgePositionZ = positionZ + state.camRight[2] * halfWorld;
	const edgeClipX = viewProj[0] * edgePositionX + viewProj[4] * edgePositionY + viewProj[8] * edgePositionZ + viewProj[12];
	const edgeClipY = viewProj[1] * edgePositionX + viewProj[5] * edgePositionY + viewProj[9] * edgePositionZ + viewProj[13];
	const edgeClipW = viewProj[3] * edgePositionX + viewProj[7] * edgePositionY + viewProj[11] * edgePositionZ + viewProj[15];
	if (edgeClipW <= 0) {
		return;
	}
	const edgeNdcX = edgeClipX / edgeClipW;
	const edgeNdcY = edgeClipY / edgeClipW;
	const edgeScreenX = ((edgeNdcX * 0.5 + 0.5) * state.width) | 0;
	const edgeScreenY = ((0.5 - edgeNdcY * 0.5) * state.height) | 0;
	let halfX = edgeScreenX - centerX;
	let halfY = edgeScreenY - centerY;
	if (halfX < 0) halfX = -halfX;
	if (halfY < 0) halfY = -halfY;
	let half = halfX > halfY ? halfX : halfY;
	if (half < 1) half = 1;
	const colorR = (colorValue >>> 16) & 0xff, colorG = (colorValue >>> 8) & 0xff, colorB = colorValue & 0xff, colorA = (colorValue >>> 24) & 0xff;
	const startX = centerX - half < 0 ? 0 : centerX - half;
	const startY = centerY - half < 0 ? 0 : centerY - half;
	const endX = centerX + half > state.width ? state.width : centerX + half;
	const endY = centerY + half > state.height ? state.height : centerY + half;
	for (let y = startY; y < endY; y += 1) {
		const srcY = sourceY + (((y - startY) * sourceH) / (endY - startY) | 0);
		for (let x = startX; x < endX; x += 1) {
			const srcX = sourceX + (((x - startX) * sourceW) / (endX - startX) | 0);
			const srcOffset = srcY * texture.stride + srcX * 4;
			const sourceAlpha = (texture.pixels[srcOffset + 3] * colorA + 127) / 255;
			const dstOffset = (y * state.width + x) * 4;
			blendPixel(
				headlessScenePixels,
				dstOffset,
				(texture.pixels[srcOffset + 0] * colorR + 127) / 255,
				(texture.pixels[srcOffset + 1] * colorG + 127) / 255,
				(texture.pixels[srcOffset + 2] * colorB + 127) / 255,
				sourceAlpha,
			);
		}
	}
	headlessSceneActive = true;
}

function rasterizeHeadlessVdpBillboard(output: VdpHostOutput, index: number, state: ParticlePipelineState): void {
	const view = consoleCore.view;
	const sourceBase = index * 4;
	const positionSize = view.vdpBillboardPositionSize;
	const uvRect = view.vdpBillboardUvRect;
	const color = view.vdpBillboardColor;
	const slot = view.vdpBillboardSlot[index];
	const texture = readSlotTexturePixels(output, slot);
	rasterizeHeadlessParticleSample(
		texture,
		(uvRect[sourceBase + 0] * texture.width) | 0,
		(uvRect[sourceBase + 1] * texture.height) | 0,
		((uvRect[sourceBase + 2] - uvRect[sourceBase + 0]) * texture.width) | 0,
		((uvRect[sourceBase + 3] - uvRect[sourceBase + 1]) * texture.height) | 0,
		positionSize[sourceBase + 0],
		positionSize[sourceBase + 1],
		positionSize[sourceBase + 2],
		positionSize[sourceBase + 3],
		color[index],
		state,
	);
}

function registerFrameBuffer2DPass(registry: RenderPassLibrary): void {
	const pass: RenderPassDef<Framebuffer2DPipelineState> = {
		id: 'framebuffer_2d',
		name: 'HeadlessFramebuffer2D',
		stateOnly: true,
		graph: { writes: ['frame_color'] },
		prepare: () => {
			registry.setState('framebuffer_2d', {
				width: consoleCore.view.canvasSize.x,
				height: consoleCore.view.canvasSize.y,
				baseWidth: consoleCore.view.viewportSize.x,
				baseHeight: consoleCore.view.viewportSize.y,
				colorTex: vdpDisplayFrameBufferTexture(),
			} as Framebuffer2DPipelineState);
		},
		exec: (_backend, _fbo, state: Framebuffer2DPipelineState) => {
			const output = consoleCore.runtime.machine.vdp.readHostOutput();
			const frameBufferWidth = output.frameBufferWidth;
			const frameBufferHeight = output.frameBufferHeight;
			resizeHeadlessScene(frameBufferWidth, frameBufferHeight);
			if (frameBufferWidth <= 0 || frameBufferHeight <= 0) {
				throw new Error(`[HeadlessFramebuffer2D] Invalid framebuffer dimensions ${frameBufferWidth}x${frameBufferHeight}.`);
			}
			readVdpDisplayFrameBufferPixels(0, 0, frameBufferWidth, frameBufferHeight, headlessFrameBufferReadbackPixels);
			const pixels = headlessFrameBufferReadbackPixels;
			const expectedByteLength = frameBufferWidth * frameBufferHeight * 4;
			if (pixels.byteLength !== expectedByteLength) {
				throw new Error(`[HeadlessFramebuffer2D] Framebuffer byte length mismatch (${pixels.byteLength} != ${expectedByteLength}).`);
			}
			const presentedPixels = writeHeadlessFrame(pixels, frameBufferWidth, frameBufferHeight, state.width, state.height);
			let active = 0;
			for (let index = 3; index < presentedPixels.length; index += 4) {
				if (presentedPixels[index] !== 0) {
					active += 1;
				}
			}
			const snapshot: Snapshot = [
				`pixels=${pixels.length >> 2} active=${active} framebuffer=${frameBufferWidth}x${frameBufferHeight} present=${state.width}x${state.height} logical=${state.baseWidth}x${state.baseHeight}`,
			];
			previousFrameBufferSnapshot = emitDiff('framebuffer', previousFrameBufferSnapshot, snapshot);
		},
	};
	registry.register(pass);
}

function registerSkyboxPass(registry: RenderPassLibrary): void {
	const pass: RenderPassDef<unknown> = {
		id: 'skybox',
		name: 'HeadlessSkybox',
		stateOnly: true,
		graph: { writes: ['frame_color'] },
		shouldExecute: () => !!consoleCore.view.skyboxFaceUvRects,
		exec: () => {
			const uvRects = consoleCore.view.skyboxFaceUvRects;
			const sizes = consoleCore.view.skyboxFaceSizes;
			const bindings = consoleCore.view.skyboxFaceTextpageBindings;
			if (!uvRects || !sizes || !bindings) {
				return;
			}
			const output = consoleCore.runtime.machine.vdp.readHostOutput();
			rasterizeSkyboxBackground(output.frameBufferWidth, output.frameBufferHeight);
			const snapshot: Snapshot = [`faces=${SKYBOX_FACE_KEYS.map((_, index) => {
				const uvBase = index * 4;
				return `${bindings[index]}:${uvRects[uvBase]},${uvRects[uvBase + 1]},${uvRects[uvBase + 2]},${uvRects[uvBase + 3]}`;
			}).join(',')}`];
			for (let index = 0; index < SKYBOX_FACE_KEYS.length; index += 1) {
				const key = SKYBOX_FACE_KEYS[index];
				const uvBase = index * 4;
				const sizeBase = index * 2;
				const slot = bindings[index] === 0 ? 'primary' : 'secondary';
				snapshot.push(`[skybox:${key}] uv=${uvRects[uvBase]},${uvRects[uvBase + 1]},${uvRects[uvBase + 2]},${uvRects[uvBase + 3]} size=${sizes[sizeBase]}x${sizes[sizeBase + 1]} slot=${slot}`);
			}
			previousSkyboxSnapshot = emitDiff('skybox', previousSkyboxSnapshot, snapshot);
		},
	};
	registry.register(pass);
}

function makeMeshState(registry: RenderPassLibrary): MeshBatchPipelineState {
	const gv = consoleCore.view;
	const camera = gv.vdpCamera;
	return {
		width: gv.offscreenCanvasSize.x,
		height: gv.offscreenCanvasSize.y,
		camPos: camera.eye,
		viewProj: camera.viewProj,
		cameraFrustum: camera.frustumPlanes,
		lighting: registry.getState('frame_shared')?.lighting,
	};
}

function registerMeshPass(registry: RenderPassLibrary): void {
	const pass: RenderPassDef<MeshBatchPipelineState> = {
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
					validateMeshRecord(mesh);
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
						const shadow = submission.receive_shadow ? 'yes' : 'no';
					const morphCount = submission.morph_weights.length;
					snapshot.push(`[mesh#${index}] mesh=${submission.mesh.name} translate=${translation} shadow=${shadow} morphs=${morphCount}`);
					index += 1;
				});
			}
			previousMeshSnapshot = emitDiff('mesh', previousMeshSnapshot, snapshot);
		},
	};
	registry.register(pass);
}

function makeParticleState(): ParticlePipelineState {
	const gv = consoleCore.view;
	const camera = gv.vdpCamera;
	const width = gv.offscreenCanvasSize.x;
	const height = gv.offscreenCanvasSize.y;
	const camRight = new Float32Array(3);
	const camUp = new Float32Array(3);
	M4.viewRightUpInto(camera.view, camRight, camUp);
	return {
		width,
		height,
		viewProj: camera.viewProj,
		camRight,
		camUp,
	};
}

function registerParticlePass(registry: RenderPassLibrary): void {
	const pass: RenderPassDef<ParticlePipelineState> = {
		id: 'particles',
		name: 'HeadlessParticles',
		stateOnly: true,
		graph: { writes: ['frame_color'] },
		shouldExecute: () => beginParticleQueue() > 0 || consoleCore.view.vdpBillboardCount > 0,
		prepare: () => {
			registry.setState('particles', makeParticleState());
		},
		exec: (_backend, _fbo, state: unknown) => {
			const particleState = state as ParticlePipelineState;
			const count = beginParticleQueue() + consoleCore.view.vdpBillboardCount;
			if (count <= 0) {
				return;
			}
			const snapshot: Snapshot = [`draws=${count} viewport=${particleState.width}x${particleState.height}`];
			const output = consoleCore.runtime.machine.vdp.readHostOutput();
			if (beginParticleQueue() > 0) {
				let index = 0;
				forEachParticleQueue((submission: ParticleRenderSubmission) => {
					const uv0 = submission.uv0;
					const uv1 = submission.uv1;
					const slot = submission.slot;
					if (slot !== VDP_SLOT_PRIMARY && slot !== VDP_SLOT_SECONDARY && slot !== VDP_SLOT_SYSTEM) {
						throw new Error(`[HeadlessParticles] Particle has invalid slot binding (${slot}).`);
					}
					if (!Number.isFinite(uv0[0]) || !Number.isFinite(uv0[1]) || !Number.isFinite(uv1[0]) || !Number.isFinite(uv1[1])) {
						throw new Error('[HeadlessParticles] Particle UVs must be finite numbers.');
					}
					if (uv0[0] < 0 || uv0[1] < 0 || uv1[0] > 1 || uv1[1] > 1 || uv0[0] > uv1[0] || uv0[1] > uv1[1]) {
						throw new Error(`[HeadlessParticles] Particle UVs out of range (${uv0[0]}, ${uv0[1]})..(${uv1[0]}, ${uv1[1]}).`);
					}
					rasterizeHeadlessParticle(output, submission, particleState);
					snapshot.push(`[particle#${index}] pos=${formatVec3(submission.position)} size=${formatNumber(submission.size)} slot=${slot}`);
					index += 1;
				});
			}
			const vdpBillboardCount = consoleCore.view.vdpBillboardCount;
			const positionSize = consoleCore.view.vdpBillboardPositionSize;
			for (let index = 0; index < vdpBillboardCount; index += 1) {
				rasterizeHeadlessVdpBillboard(output, index, particleState);
				const base = index * 4;
				snapshot.push(`[vdp-particle#${index}] pos=(${formatNumber(positionSize[base + 0])}, ${formatNumber(positionSize[base + 1])}, ${formatNumber(positionSize[base + 2])}) size=${formatNumber(positionSize[base + 3])} slot=${consoleCore.view.vdpBillboardSlot[index]}`);
			}
			previousParticleSnapshot = emitDiff('particles', previousParticleSnapshot, snapshot);
		},
	};
	registry.register(pass);
}
