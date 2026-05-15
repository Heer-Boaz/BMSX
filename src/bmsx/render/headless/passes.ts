import { consoleCore } from '../../core/console';
import { RenderPassLibrary } from '../backend/pass/library';
import { Framebuffer2DPipelineState, ParticlePipelineState, type RenderPassDef } from '../backend/backend';
import { M4 } from '../3d/math';
import { MESH_NORMAL_OFFSET, MESH_POSITION_OFFSET, MESH_VERTEX_FLOATS, MeshVertexStreamBuilder } from '../3d/mesh/vertex_stream';
import { resolveMeshRomDrawSource } from '../3d/mesh/rom_source';
import type { Host2DSubmission } from '../shared/submissions';
import { SKYBOX_FACE_KEYS } from '../../machine/devices/vdp/contracts';
import type { VdpSlotTexturePixels } from '../vdp/slot_textures';
import { DEFAULT_TEXTURE_PARAMS } from '../backend/texture_params';
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
				beginHeadlessScene(consoleCore.view.vdpFrameBufferTextures.width(), consoleCore.view.vdpFrameBufferTextures.height());
			},
		});
	registry.register({ id: 'frame_shared', name: 'HeadlessFrameShared', stateOnly: true, graph: { skip: true }, exec: () => { /* noop */ } });
}

type Snapshot = string[];

let previousParticleSnapshot: Snapshot = [];
let previousSkyboxSnapshot: Snapshot = [];
let previousFrameBufferSnapshot: Snapshot = [];
let previousMeshSnapshot: Snapshot = [];
let previousParticleHeadline = '';
let previousSkyboxHeadline = '';
let previousFrameBufferHeadline = '';
let previousMeshHeadline = '';

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
const headlessSkyboxTextures = new Array<VdpSlotTexturePixels>(SKYBOX_FACE_KEYS.length);
const headlessSkyboxSourceRects = new Int32Array(SKYBOX_FACE_KEYS.length * 4);
const headlessSkyboxFaceUv = new Float32Array(2);
const headlessMeshVertexStream = new MeshVertexStreamBuilder();

const HEADLESS_VERBOSE_DIFF = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.BMSX_HEADLESS_VERBOSE === '1';

function formatNumber(value: number): string {
	return Number.isFinite(value) ? value.toFixed(2) : 'NaN';
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

function emitHeadlessHeadline(label: string, previous: string, current: string): string {
	if (previous !== current) {
		console.log(`[headless:${label}] ${current} (1 changes)`);
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
	const gv = consoleCore.view;
	const faceSurfaceIds = gv.skyboxFaceSurfaceIds;
	const faceUvRects = gv.skyboxFaceUvRects;
	const faceSizes = gv.skyboxFaceSizes;
	for (let index = 0; index < SKYBOX_FACE_KEYS.length; index += 1) {
		const texture = gv.vdpSlotTextures.readSurfaceTexturePixels(faceSurfaceIds[index]);
		const uvBase = index * 4;
		const rectBase = index * 4;
		const sizeBase = index * 2;
		headlessSkyboxTextures[index] = texture;
		headlessSkyboxSourceRects[rectBase + 0] = (faceUvRects[uvBase + 0] * texture.width) | 0;
		headlessSkyboxSourceRects[rectBase + 1] = (faceUvRects[uvBase + 1] * texture.height) | 0;
		headlessSkyboxSourceRects[rectBase + 2] = faceSizes[sizeBase + 0];
		headlessSkyboxSourceRects[rectBase + 3] = faceSizes[sizeBase + 1];
	}
	const view = gv.vdpTransform.skyboxView;
	for (let y = 0; y < height; y += 1) {
		const rayY = 1 - (((y * 2) + 1) / height);
		for (let x = 0; x < width; x += 1) {
			const rayX = (((x * 2) + 1) / width) - 1;
			const dirX = view[0] * rayX + view[4] * rayY + view[8];
			const dirY = view[1] * rayX + view[5] * rayY + view[9];
			const dirZ = view[2] * rayX + view[6] * rayY + view[10];
			const faceIndex = resolveSkyboxFaceInto(dirX, dirY, dirZ);
			const texture = headlessSkyboxTextures[faceIndex]!;
			const rectBase = faceIndex * 4;
			const sourceX = headlessSkyboxSourceRects[rectBase + 0];
			const sourceY = headlessSkyboxSourceRects[rectBase + 1];
			const sourceWidth = headlessSkyboxSourceRects[rectBase + 2];
			const sourceHeight = headlessSkyboxSourceRects[rectBase + 3];
			let faceX = (headlessSkyboxFaceUv[0] * sourceWidth) | 0;
			let faceY = (headlessSkyboxFaceUv[1] * sourceHeight) | 0;
			if (faceX >= sourceWidth) {
				faceX = sourceWidth - 1;
			}
			if (faceY >= sourceHeight) {
				faceY = sourceHeight - 1;
			}
			const srcX = sourceX + faceX;
			const srcY = sourceY + faceY;
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

function rasterizeHeadlessParticleSample(texture: VdpSlotTexturePixels,
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

function rasterizeHeadlessVdpBillboard(index: number, state: ParticlePipelineState): void {
	const view = consoleCore.view;
	const sourceBase = index * 4;
	const positionSize = view.vdpBillboardPositionSize;
	const uvRect = view.vdpBillboardUvRect;
	const color = view.vdpBillboardColor;
	const texture = view.vdpSlotTextures.readSurfaceTexturePixels(view.vdpBillboardSurfaceId[index]);
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
				colorTex: consoleCore.view.vdpFrameBufferTextures.displayTexture(),
			} as Framebuffer2DPipelineState);
		},
			exec: (backend, _fbo, state: Framebuffer2DPipelineState) => {
				const frameBufferWidth = consoleCore.view.vdpFrameBufferTextures.width();
				const frameBufferHeight = consoleCore.view.vdpFrameBufferTextures.height();
				resizeHeadlessScene(frameBufferWidth, frameBufferHeight);
				if (frameBufferWidth <= 0 || frameBufferHeight <= 0) {
					throw new Error(`[HeadlessFramebuffer2D] Invalid framebuffer dimensions ${frameBufferWidth}x${frameBufferHeight}.`);
				}
				backend.readTextureRegion(state.colorTex, headlessFrameBufferReadbackPixels, frameBufferWidth, frameBufferHeight, 0, 0, DEFAULT_TEXTURE_PARAMS);
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
				const headline = `pixels=${pixels.length >> 2} active=${active} framebuffer=${frameBufferWidth}x${frameBufferHeight} present=${state.width}x${state.height} logical=${state.baseWidth}x${state.baseHeight}`;
				if (HEADLESS_VERBOSE_DIFF) {
					previousFrameBufferSnapshot = emitDiff('framebuffer', previousFrameBufferSnapshot, [headline]);
				} else {
					previousFrameBufferHeadline = emitHeadlessHeadline('framebuffer', previousFrameBufferHeadline, headline);
				}
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
		shouldExecute: () => consoleCore.view.skyboxRenderReady,
		exec: () => {
			const uvRects = consoleCore.view.skyboxFaceUvRects;
				const sizes = consoleCore.view.skyboxFaceSizes;
				const bindings = consoleCore.view.skyboxFaceTextpageBindings;
				rasterizeSkyboxBackground(headlessSceneWidth, headlessSceneHeight);
				let headline = 'faces=';
				for (let index = 0; index < SKYBOX_FACE_KEYS.length; index += 1) {
					const uvBase = index * 4;
					headline += `${index === 0 ? '' : ','}${bindings[index]}:${uvRects[uvBase]},${uvRects[uvBase + 1]},${uvRects[uvBase + 2]},${uvRects[uvBase + 3]}`;
				}
				if (HEADLESS_VERBOSE_DIFF) {
					const snapshot: Snapshot = [headline];
					for (let index = 0; index < SKYBOX_FACE_KEYS.length; index += 1) {
						const key = SKYBOX_FACE_KEYS[index];
						const uvBase = index * 4;
						const sizeBase = index * 2;
						const slot = bindings[index] === 0 ? 'primary' : 'secondary';
						snapshot.push(`[skybox:${key}] uv=${uvRects[uvBase]},${uvRects[uvBase + 1]},${uvRects[uvBase + 2]},${uvRects[uvBase + 3]} size=${sizes[sizeBase]}x${sizes[sizeBase + 1]} slot=${slot}`);
					}
					previousSkyboxSnapshot = emitDiff('skybox', previousSkyboxSnapshot, snapshot);
				} else {
					previousSkyboxHeadline = emitHeadlessHeadline('skybox', previousSkyboxHeadline, headline);
				}
			},
		};
	registry.register(pass);
}

const headlessParticleState: ParticlePipelineState = {
	width: 1,
	height: 1,
	viewProj: new Float32Array(16),
	camRight: new Float32Array(3),
	camUp: new Float32Array(3),
};

function updateHeadlessParticleState(): ParticlePipelineState {
	const gv = consoleCore.view;
	const transform = gv.vdpTransform;
	headlessParticleState.width = gv.offscreenCanvasSize.x;
	headlessParticleState.height = gv.offscreenCanvasSize.y;
	headlessParticleState.viewProj = transform.viewProj;
	M4.viewRightUpInto(transform.view, headlessParticleState.camRight, headlessParticleState.camUp);
	return headlessParticleState;
}


function renderHeadlessMeshPoint(screenX: number, screenY: number, colorR: number, colorG: number, colorB: number, colorA: number): void {
	const startX = screenX - 1 < 0 ? 0 : screenX - 1;
	const startY = screenY - 1 < 0 ? 0 : screenY - 1;
	const endX = screenX + 2 > headlessSceneWidth ? headlessSceneWidth : screenX + 2;
	const endY = screenY + 2 > headlessSceneHeight ? headlessSceneHeight : screenY + 2;
	for (let y = startY; y < endY; y += 1) {
		for (let x = startX; x < endX; x += 1) {
			blendPixel(headlessScenePixels, (y * headlessSceneWidth + x) * 4, colorR, colorG, colorB, colorA);
		}
	}
}

function rasterizeHeadlessMesh(entryIndex: number): number {
	const gv = consoleCore.view;
	const source = resolveMeshRomDrawSource(consoleCore.runtime, gv, entryIndex);
	headlessMeshVertexStream.build(gv, source.model, source.mesh, entryIndex);
	const vertices = headlessMeshVertexStream.vertices;
	const model = headlessMeshVertexStream.modelMatrix;
	const viewProj = gv.vdpTransform.viewProj;
	let plotted = 0;
	const ambient = gv.vdpAmbientLightColorIntensity;
	let lightEnergy = ambient[3];
	for (let index = 0; index < gv.vdpDirectionalLightCount; index += 1) {
		lightEnergy = lightEnergy + gv.vdpDirectionalLightIntensities[index];
	}
	for (let index = 0; index < gv.vdpPointLightCount; index += 1) {
		lightEnergy = lightEnergy + gv.vdpPointLightParams[index * 2 + 1];
	}
	if (lightEnergy < 0.25) {
		lightEnergy = 0.25;
	}
	if (lightEnergy > 1.85) {
		lightEnergy = 1.85;
	}
	const baseColor = gv.vdpMeshColor[entryIndex];
	const baseR = (baseColor >>> 16) & 0xff;
	const baseG = (baseColor >>> 8) & 0xff;
	const baseB = baseColor & 0xff;
	let vertexBase = 0;
	while (vertexBase < headlessMeshVertexStream.vertexCount * MESH_VERTEX_FLOATS) {
		const x = vertices[vertexBase + MESH_POSITION_OFFSET + 0];
		const y = vertices[vertexBase + MESH_POSITION_OFFSET + 1];
		const z = vertices[vertexBase + MESH_POSITION_OFFSET + 2];
		const wx = model[0] * x + model[4] * y + model[8] * z + model[12];
		const wy = model[1] * x + model[5] * y + model[9] * z + model[13];
		const wz = model[2] * x + model[6] * y + model[10] * z + model[14];
		const clipX = viewProj[0] * wx + viewProj[4] * wy + viewProj[8] * wz + viewProj[12];
		const clipY = viewProj[1] * wx + viewProj[5] * wy + viewProj[9] * wz + viewProj[13];
		const clipW = viewProj[3] * wx + viewProj[7] * wy + viewProj[11] * wz + viewProj[15];
		if (clipW > 0) {
			const ndcX = clipX / clipW;
			const ndcY = clipY / clipW;
			if (ndcX >= -1.1 && ndcX <= 1.1 && ndcY >= -1.1 && ndcY <= 1.1) {
				const nx = vertices[vertexBase + MESH_NORMAL_OFFSET + 0];
				const ny = vertices[vertexBase + MESH_NORMAL_OFFSET + 1];
				const nz = vertices[vertexBase + MESH_NORMAL_OFFSET + 2];
				let directional = ambient[3];
				if (gv.vdpDirectionalLightCount > 0) {
					const dot = -(nx * gv.vdpDirectionalLightDirections[0] + ny * gv.vdpDirectionalLightDirections[1] + nz * gv.vdpDirectionalLightDirections[2]);
					if (dot > 0) {
						directional = directional + dot * gv.vdpDirectionalLightIntensities[0];
					}
				}
				let shade = directional * 0.7 + lightEnergy * 0.25;
				if (shade < 0.18) {
					shade = 0.18;
				}
				if (shade > 1.4) {
					shade = 1.4;
				}
				const screenX = ((ndcX * 0.5 + 0.5) * headlessSceneWidth) | 0;
				const screenY = ((0.5 - ndcY * 0.5) * headlessSceneHeight) | 0;
				renderHeadlessMeshPoint(screenX, screenY, baseR * shade, baseG * shade, baseB * shade, 224);
				plotted = plotted + 1;
			}
		}
		vertexBase = vertexBase + MESH_VERTEX_FLOATS;
	}
	if (plotted > 0) {
		headlessSceneActive = true;
	}
	return plotted;
}

function registerMeshPass(registry: RenderPassLibrary): void {
	const pass: RenderPassDef<unknown> = {
		id: 'mesh',
		name: 'HeadlessMesh',
		stateOnly: true,
		graph: { writes: ['frame_color'] },
		shouldExecute: () => consoleCore.view.vdpMeshCount > 0,
		exec: () => {
			const gv = consoleCore.view;
			let plotted = 0;
			for (let index = 0; index < gv.vdpMeshCount; index += 1) {
				plotted = plotted + rasterizeHeadlessMesh(index);
			}
			const headline = `draws=${gv.vdpMeshCount} plotted=${plotted} morph=${gv.vdpMeshMorphCount[0]} lights=${gv.vdpDirectionalLightCount}/${gv.vdpPointLightCount}`;
			if (HEADLESS_VERBOSE_DIFF) {
				const snapshot: Snapshot = [headline];
				for (let index = 0; index < gv.vdpMeshCount; index += 1) {
					snapshot.push(`[vdp-mesh#${index}] mesh=${gv.vdpMeshIndex[index]} morphBase=${gv.vdpMeshMorphBase[index]} morphCount=${gv.vdpMeshMorphCount[index]} weights=${formatNumber(gv.vdpMorphWeightWords[gv.vdpMeshMorphBase[index]] / 65536)},${formatNumber(gv.vdpMorphWeightWords[gv.vdpMeshMorphBase[index] + 1] / 65536)} ambient=${formatNumber(gv.vdpAmbientLightColorIntensity[3])} dir=${gv.vdpDirectionalLightCount} point=${gv.vdpPointLightCount}`);
				}
				previousMeshSnapshot = emitDiff('mesh', previousMeshSnapshot, snapshot);
			} else {
				previousMeshHeadline = emitHeadlessHeadline('mesh', previousMeshHeadline, headline);
			}
		},
	};
	registry.register(pass);
}

function registerParticlePass(registry: RenderPassLibrary): void {
	const pass: RenderPassDef<ParticlePipelineState> = {
		id: 'particles',
		name: 'HeadlessParticles',
		stateOnly: true,
		graph: { writes: ['frame_color'] },
		shouldExecute: () => consoleCore.view.vdpBillboardCount > 0,
		prepare: () => {
			registry.setState('particles', updateHeadlessParticleState());
		},
		exec: (_backend, _fbo, state: unknown) => {
			const particleState = state as ParticlePipelineState;
			const count = consoleCore.view.vdpBillboardCount;
			if (count <= 0) {
				return;
			}
				const headline = `draws=${count} viewport=${particleState.width}x${particleState.height}`;
				const snapshot: Snapshot | null = HEADLESS_VERBOSE_DIFF ? [headline] : null;
				const vdpBillboardCount = consoleCore.view.vdpBillboardCount;
				const positionSize = consoleCore.view.vdpBillboardPositionSize;
				for (let index = 0; index < vdpBillboardCount; index += 1) {
					rasterizeHeadlessVdpBillboard(index, particleState);
					if (snapshot !== null) {
						const base = index * 4;
						snapshot.push(`[vdp-particle#${index}] pos=(${formatNumber(positionSize[base + 0])}, ${formatNumber(positionSize[base + 1])}, ${formatNumber(positionSize[base + 2])}) size=${formatNumber(positionSize[base + 3])} slot=${consoleCore.view.vdpBillboardSlot[index]}`);
					}
				}
				if (snapshot !== null) {
					previousParticleSnapshot = emitDiff('particles', previousParticleSnapshot, snapshot);
				} else {
					previousParticleHeadline = emitHeadlessHeadline('particles', previousParticleHeadline, headline);
				}
			},
		};
	registry.register(pass);
}
