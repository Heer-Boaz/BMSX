// Mesh pipeline (formerly glview.3d) inlined from legacy module.
// Handles 3D mesh rendering, instancing, morph targets, skinning, fog, and lighting UBO management.
import { makePipelineBuildDesc, PassEncoder, shaderModule } from '../..';
import { $ } from '../../core/game';
import type { Mesh } from './mesh';
import { Float32ArrayPool } from 'bmsx/utils/pool';
import type { vec3arr } from '../../rompack/rompack';
import { Identifier } from '../../rompack/rompack';
import meshFS from '../3d/shaders/3d.frag.glsl';
import meshVS from '../3d/shaders/3d.vert.glsl';
import { FeatureQueue } from '../../utils/feature_queue';
import * as GLR from '../backend/webgl/gl_resources';
import { MeshBatchPipelineState, RenderPassLibrary } from '../backend/renderpasslib';
import { MAX_DIR_LIGHTS, MAX_POINT_LIGHTS, TEXTURE_UNIT_ALBEDO, TEXTURE_UNIT_METALLIC_ROUGHNESS, TEXTURE_UNIT_MORPH_NORM, TEXTURE_UNIT_MORPH_POS, TEXTURE_UNIT_NORMAL, TEXTURE_UNIT_SHADOW_MAP } from '../backend/webgl/webgl.constants';
import { checkWebGLError } from '../backend/webgl/webgl.helpers';
import { WebGLBackend } from '../backend/webgl/webgl_backend';
import { MeshRenderSubmission } from '../gameview';
import type { DirectionalLight, PointLight } from './light';
import { M4 } from './math3d';

const BYTES_PER_FLOAT = 4;
const COLUMN_BYTES = 4 * BYTES_PER_FLOAT; // 4 floats per kolom = 16 bytes
const MAX_INSTANCES = 64;
// Instance payload: 4x4 matrix (16 floats = 64 bytes) + packed color RGBA (UNORM8x4 = 4 bytes)
const INSTANCE_COLOR_OFFSET_BYTES = 16 * BYTES_PER_FLOAT; // 64
const INSTANCE_STRIDE_BYTES = INSTANCE_COLOR_OFFSET_BYTES + 4; // 68 bytes
const INSTANCE_STRIDE_FLOATS = INSTANCE_STRIDE_BYTES / 4;
const INSTANCE_STRIDE_NORMAL9 = 9;
const MAT4_FLOATS = 16;
// unified in webgl.constants
function getRenderContext() {
	return $.view;
}

// Legacy direct submission array removed. Use submitMesh() with feature queue.
const meshQueue = new FeatureQueue<MeshRenderSubmission>(256);
export function getQueuedMeshCount(): number { return meshQueue.sizeBack(); }
let lightsDirty: boolean = true; // set to true on any light mutation; consumed by LightingSystem

interface MeshBuffers {
	vertex: WebGLBuffer;
	texcoord?: WebGLBuffer;
	normal?: WebGLBuffer;
	tangent?: WebGLBuffer;
	index?: WebGLBuffer;
	joint?: WebGLBuffer;
	weight?: WebGLBuffer;
	// Morph positions are now sourced from a texture
	morphPosTex?: WebGLTexture;
	morphPosTexSize?: { w: number; h: number };
	morphCount?: number;
	// Morph normals also use a texture
	morphNormTex?: WebGLTexture;
	morphNormTexSize?: { w: number; h: number };
	morphNormCount?: number;

	// VAO caches
	vao?: WebGLVertexArrayObject;            // non-instanced + morph
	vaoNoMorph?: WebGLVertexArrayObject;     // non-instanced zonder morph
	vaoInstanced?: WebGLVertexArrayObject;   // instanced + morph
	vaoInstancedNoMorph?: WebGLVertexArrayObject; // instanced zonder morph
	vaoSig?: string;
	vaoNoMorphSig?: string;
	vaoInstancedSig?: string;
	vaoInstancedNoMorphSig?: string;
	indexType?: GLenum;
	indexCount?: number;
	indexByteLength?: number;
}

const meshBufferCache = new WeakMap<Mesh, MeshBuffers>();

// instancing upload helpers (shared backing buffer for matrices + packed color)
const instanceScratchBuffer = new ArrayBuffer(MAX_INSTANCES * INSTANCE_STRIDE_BYTES);
const instanceScratchF32 = new Float32Array(instanceScratchBuffer);
const instanceScratchU8 = new Uint8Array(instanceScratchBuffer);
const normal9Pool = new Float32ArrayPool(INSTANCE_STRIDE_NORMAL9);
// Instance data uses a single dynamic buffer (ring buffer removed)

// simpele texture/material state cache
const stateCache = {
	albedo: null as WebGLTexture | null,
	normal: null as WebGLTexture | null,
	mr: null as WebGLTexture | null,
	useAlbedo: -1,
	useNormal: -1,
	useMR: -1,
};

let lastCullDoubleSided = false;

// Debug counters: per-frame usage of morph textures
let _morphUsage = { pos: 0, norm: 0 };
export function getMorphTextureUsage(): { pos: number; norm: number } { return { pos: _morphUsage.pos, norm: _morphUsage.norm }; }

const directionalLights: Map<string, DirectionalLight> = new Map();
const pointLights: Map<string, PointLight> = new Map();

// Accessors for lighting system (decouple from internal maps / buffers)
export function getDirectionalLightCount(): number { return directionalLights.size; }
export function getPointLightCount(): number { return pointLights.size; }
export function getDirectionalLightBuffer(): WebGLBuffer | undefined { return dirLightBuffer; }
export function getPointLightBuffer(): WebGLBuffer | undefined { return pointLightBuffer; }

let gameShaderProgram3D: WebGLProgram;
let vertexPositionLocation3D: number;
let texcoordLocation3D: number;
let normalLocation3D: number;
let tangentLocation3D: number;
let modelLocation3D: WebGLUniformLocation;
let normalMatrixLocation3D: WebGLUniformLocation;
let ditherLocation3D: WebGLUniformLocation;
let materialColorLocation3D: WebGLUniformLocation;
let shadowMapLocation3D: WebGLUniformLocation;
let useShadowMapLocation3D: WebGLUniformLocation;
let lightMatrixLocation3D: WebGLUniformLocation;
let shadowStrengthLocation3D: WebGLUniformLocation;
let vertShaderScaleLocation3D: WebGLUniformLocation;
let albedoTextureLocation3D: WebGLUniformLocation;
// Removed 'useXxx' toggles in shader; always sample with default fallbacks
let normalTextureLocation3D: WebGLUniformLocation;
let metallicRoughnessTextureLocation3D: WebGLUniformLocation;
let metallicFactorLocation3D: WebGLUniformLocation;
let roughnessFactorLocation3D: WebGLUniformLocation;
let alphaCutoffLocation3D: WebGLUniformLocation;
let surfaceLocation3D: WebGLUniformLocation;
let morphPosTexLocation3D: WebGLUniformLocation;
let morphTexSizeLocation3D: WebGLUniformLocation;
let morphCountLocation3D: WebGLUniformLocation;
let morphNormTexLocation3D: WebGLUniformLocation;
let morphNormTexSizeLocation3D: WebGLUniformLocation;
let morphNormCountLocation3D: WebGLUniformLocation;
let morphIndicesLocation3D: WebGLUniformLocation;

// uniform buffers voor lights
const DIR_LIGHT_BINDING = 0;
const POINT_LIGHT_BINDING = 1;
let dirLightBuffer: WebGLBuffer;
let pointLightBuffer: WebGLBuffer;
let dirLightData: Float32Array;
let dirLightCount: Int32Array;
let pointLightData: Float32Array;
let pointLightCount: Int32Array;

// offsets binnen de UBO's (std140 layout)
const DIR_LIGHT_HEADER = 4; // int + vec3 pad
const DIR_LIGHT_STRIDE = MAX_DIR_LIGHTS * 4; // per vec4 array
const DIR_LIGHT_DIRECTION_OFFSET = DIR_LIGHT_HEADER;
const DIR_LIGHT_COLOR_OFFSET = DIR_LIGHT_DIRECTION_OFFSET + DIR_LIGHT_STRIDE;
const DIR_LIGHT_INTENSITY_OFFSET = DIR_LIGHT_COLOR_OFFSET + DIR_LIGHT_STRIDE;

const POINT_LIGHT_HEADER = 4;
const POINT_LIGHT_STRIDE = MAX_POINT_LIGHTS * 4;
const POINT_LIGHT_POSITION_OFFSET = POINT_LIGHT_HEADER;
const POINT_LIGHT_COLOR_OFFSET = POINT_LIGHT_POSITION_OFFSET + POINT_LIGHT_STRIDE;
const POINT_LIGHT_PARAM_OFFSET = POINT_LIGHT_COLOR_OFFSET + POINT_LIGHT_STRIDE;

// No morph attribute bindings remain (all morph deltas via textures)
let morphWeightLocation3D: WebGLUniformLocation;
let jointLocation3D: number;
let weightLocation3D: number;
let jointMatrixLocation3D: WebGLUniformLocation;
let instanceMatrixBuffer3D: WebGLBuffer;
let instanceMatrixLocations3D: number[];
let instanceColorLocation3D: number;
let viewProjectionLocation3D: WebGLUniformLocation;
let useInstancingLocation3D: WebGLUniformLocation;
// (Fog removed) — no fog uniforms
const MAX_MORPH_TARGETS = 8;
const MAX_JOINTS = 32;

const jointMatrixArray = new Float32Array(MAX_JOINTS * MAT4_FLOATS);

const identityMatrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

let lastSkinningEnabled = false;
const lastJointMatrixArray = new Float32Array(MAX_JOINTS * MAT4_FLOATS);

const zeroMorphWeights = new Float32Array(MAX_MORPH_TARGETS);
let lastMorphEnabled = false;
const lastMorphWeightArray = new Float32Array(MAX_MORPH_TARGETS);

let lastUseInstancing = -1;

function arraysEqual(a: Float32Array, b: Float32Array): boolean { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
// Float32 to Float16 bit-level conversion (IEEE 754 half-precision pack)
function float32ToFloat16(val: number): number {
	const floatView = new Float32Array(1);
	const int32View = new Int32Array(floatView.buffer);
	floatView[0] = val;
	const x = int32View[0];
	const sign = (x >> 16) & 0x8000;
	const mant = x & 0x007fffff;
	let exp = (x >> 23) & 0xff;
	if (exp === 0xff) { // NaN or Inf
		if (mant !== 0) return sign | 0x7e00; // NaN
		return sign | 0x7c00; // Inf
	}
	exp = exp - 127 + 15;
	if (exp <= 0) {
		if (exp < -10) return sign; // underflow
		// subnormal
		const m = (mant | 0x00800000) >> (1 - exp);
		return sign | (m + 0x00000fff + ((m >> 13) & 1)) >> 13;
	} else if (exp >= 0x1f) {
		return sign | 0x7c00; // overflow -> Inf
	}
	const half = sign | (exp << 10) | ((mant + 0x00000fff + ((mant >> 13) & 1)) >> 13);
	return half;
}
function setUseInstancing(gl: WebGL2RenderingContext, enabled: boolean): void { const val = enabled ? 1 : 0; if (lastUseInstancing !== val) { gl.uniform1i(useInstancingLocation3D, val); lastUseInstancing = val; } }
function uploadJointPalette(gl: WebGL2RenderingContext, joints: Float32Array[] | undefined, hasSkinning: boolean): void {
	if (hasSkinning && joints) {
		jointMatrixArray.fill(0); jointMatrixArray.set(identityMatrix, 0);
		for (let i = 0; i < joints.length && i < MAX_JOINTS; i++) jointMatrixArray.set(joints[i], i * MAT4_FLOATS);
		if (!lastSkinningEnabled || !arraysEqual(jointMatrixArray, lastJointMatrixArray)) { gl.uniformMatrix4fv(jointMatrixLocation3D, false, jointMatrixArray); lastSkinningEnabled = true; lastJointMatrixArray.set(jointMatrixArray); }
	} else if (lastSkinningEnabled) {
		jointMatrixArray.fill(0); jointMatrixArray.set(identityMatrix, 0); gl.uniformMatrix4fv(jointMatrixLocation3D, false, jointMatrixArray); lastSkinningEnabled = false; lastJointMatrixArray.set(jointMatrixArray);
	}
}
function uploadMorphWeights(gl: WebGL2RenderingContext, weights: Float32Array | null): void {
	if (weights) { if (!lastMorphEnabled || !arraysEqual(weights, lastMorphWeightArray)) { gl.uniform1fv(morphWeightLocation3D, weights); lastMorphEnabled = true; lastMorphWeightArray.set(weights); } }
	else if (lastMorphEnabled) { gl.uniform1fv(morphWeightLocation3D, zeroMorphWeights); lastMorphEnabled = false; lastMorphWeightArray.set(zeroMorphWeights); }
}
function getVAOSignature(m: Mesh, instanced: boolean, morph: boolean): string {
	const tangentSize = m.tangents ? (m.tangents.length === m.vertexCount * 4 ? 4 : 3) : 0;
	return [m.hasTexcoords ? 1 : 0, m.hasNormals ? 1 : 0, tangentSize, m.hasSkinning ? 1 : 0, morph ? 1 : 0, instanced ? 1 : 0].join(',');
}

// --- Pipeline helpers -------------------------------------------------------
function isTransparent(m: Mesh): boolean { return m.material?.surface === 'transparent'; }
// function isMasked(m: Mesh): boolean { return m.material?.surface === 'masked'; }
function isOpaque(m: Mesh): boolean { const s = m.material?.surface; return s === undefined || s === 'opaque' || s === 'masked'; }
function getMeshColor(m: Mesh): [number, number, number, number] { const c = m.material?.color; return [c?.[0] ?? 1, c?.[1] ?? 1, c?.[2] ?? 1, c?.[3] ?? 1]; }
function isMatrixMirrored(mat: Float32Array): boolean {
	// Column-major 4x4; take upper-left 3x3
	const m00 = mat[0], m01 = mat[1], m02 = mat[2];
	const m10 = mat[4], m11 = mat[5], m12 = mat[6];
	const m20 = mat[8], m21 = mat[9], m22 = mat[10];
	const det = m00 * (m11 * m22 - m12 * m21)
		- m01 * (m10 * m22 - m12 * m20)
		+ m02 * (m10 * m21 - m11 * m20);
	return det < 0;
}
function getMeshBuffers(gl: WebGL2RenderingContext, m: Mesh): MeshBuffers {
	let buffers = meshBufferCache.get(m); if (buffers) return buffers;
	buffers = { vertex: GLR.glCreateBuffer(gl) };
	const backend = getRenderContext().backend as WebGLBackend;
	gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vertex); gl.bufferData(gl.ARRAY_BUFFER, m.positions, gl.STATIC_DRAW); backend.accountUpload('vertex', m.positions.byteLength);
	if (m.hasTexcoords) { buffers.texcoord = GLR.glCreateBuffer(gl); gl.bindBuffer(gl.ARRAY_BUFFER, buffers.texcoord); gl.bufferData(gl.ARRAY_BUFFER, m.texcoords, gl.STATIC_DRAW); backend.accountUpload('vertex', m.texcoords!.byteLength); }
	if (m.hasNormals) { buffers.normal = GLR.glCreateBuffer(gl); gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal); gl.bufferData(gl.ARRAY_BUFFER, m.normals!, gl.STATIC_DRAW); backend.accountUpload('vertex', m.normals!.byteLength); }
	if (m.hasTangents) { buffers.tangent = GLR.glCreateBuffer(gl); gl.bindBuffer(gl.ARRAY_BUFFER, buffers.tangent); gl.bufferData(gl.ARRAY_BUFFER, m.tangents!, gl.STATIC_DRAW); backend.accountUpload('vertex', m.tangents!.byteLength); }
	if (m.indices) { buffers.index = GLR.glCreateElementBuffer(gl); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW); buffers.indexCount = m.indices.length; buffers.indexType = (m.indices instanceof Uint32Array) ? gl.UNSIGNED_INT : (m.indices instanceof Uint8Array) ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT; buffers.indexByteLength = (m.indices as ArrayBufferView).byteLength; backend.accountUpload('index', buffers.indexByteLength); }
	if (m.hasSkinning) { buffers.joint = GLR.glCreateBuffer(gl); gl.bindBuffer(gl.ARRAY_BUFFER, buffers.joint); gl.bufferData(gl.ARRAY_BUFFER, m.jointIndices!, gl.STATIC_DRAW); backend.accountUpload('vertex', m.jointIndices!.byteLength); buffers.weight = GLR.glCreateBuffer(gl); gl.bindBuffer(gl.ARRAY_BUFFER, buffers.weight); gl.bufferData(gl.ARRAY_BUFFER, m.jointWeights!, gl.STATIC_DRAW); backend.accountUpload('vertex', m.jointWeights!.byteLength); }
	if (m.hasMorphTargets) {
		// Build morph position texture (up to 4 targets), layout: width=vertexCount, height=targetCount, RGBA32F xyz delta + pad
		const targetCount = Math.min(m.morphPositions?.length ?? 0, MAX_MORPH_TARGETS);
		if (targetCount > 0) {
			const width = m.vertexCount;
			const height = targetCount;
			// Per-target scale stored in alpha channel per texel (constant across row)
			const texels = new Uint16Array(width * height * 4);
			for (let ti = 0; ti < targetCount; ti++) {
				const rowOffset = ti * width * 4;
				const src = m.morphPositions![ti];
				// Compute per-target scalar scale: max abs component
				let s = 1e-6;
				for (let v = 0; v < width; v++) {
					const si = v * 3;
					s = Math.max(s, Math.abs(src[si + 0]), Math.abs(src[si + 1]), Math.abs(src[si + 2]));
				}
				for (let v = 0; v < width; v++) {
					const si = v * 3; const di = rowOffset + v * 4;
					const nx = src[si + 0] / s;
					const ny = src[si + 1] / s;
					const nz = src[si + 2] / s;
					texels[di + 0] = float32ToFloat16(nx);
					texels[di + 1] = float32ToFloat16(ny);
					texels[di + 2] = float32ToFloat16(nz);
					texels[di + 3] = float32ToFloat16(s);
				}
			}
			const tex = gl.createTexture()!;
			gl.bindTexture(gl.TEXTURE_2D, tex);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			// WebGL2: RGBA16F for positions + per-target scale in A
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, texels);
			gl.bindTexture(gl.TEXTURE_2D, null);
			backend.accountUpload('texture', texels.byteLength);
			buffers.morphPosTex = tex;
			buffers.morphPosTexSize = { w: width, h: height };
			buffers.morphCount = targetCount;
		}
		// Build morph normal texture (up to 4 targets) if normals present
		const nCount = Math.min(m.morphNormals?.length ?? 0, MAX_MORPH_TARGETS);
		if (nCount > 0) {
			const width = m.vertexCount;
			const height = nCount;
			// Encode absolute normals per target using octahedral encoding into RG16F
			const texels = new Uint16Array(width * height * 2);
			for (let ti = 0; ti < nCount; ti++) {
				const rowOffset = ti * width * 2;
				const src = m.morphNormals![ti]!; // normal deltas
				for (let v = 0; v < width; v++) {
					const si = v * 3; const di = rowOffset + v * 2;
					// base + delta -> absolute target normal
					const bx = m.normals ? m.normals[si + 0] : 0;
					const by = m.normals ? m.normals[si + 1] : 0;
					const bz = m.normals ? m.normals[si + 2] : 1;
					let nx = bx + src[si + 0];
					let ny = by + src[si + 1];
					let nz = bz + src[si + 2];
					const invLen = 1.0 / Math.max(1e-8, Math.hypot(nx, ny, nz));
					nx *= invLen; ny *= invLen; nz *= invLen;
					// oct encode
					const denom = Math.abs(nx) + Math.abs(ny) + Math.abs(nz) || 1;
					let ox = nx / denom;
					let oy = ny / denom;
					if (nz < 0) {
						const sx = ox >= 0 ? 1 : -1;
						const sy = oy >= 0 ? 1 : -1;
						const tx = 1 - Math.abs(oy);
						const ty = 1 - Math.abs(ox);
						ox = tx * sx; oy = ty * sy;
					}
					// pack to float16
					texels[di + 0] = float32ToFloat16(ox);
					texels[di + 1] = float32ToFloat16(oy);
				}
			}
			const tex = gl.createTexture()!;
			gl.bindTexture(gl.TEXTURE_2D, tex);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, width, height, 0, gl.RG, gl.HALF_FLOAT, texels);
			gl.bindTexture(gl.TEXTURE_2D, null);
			backend.accountUpload('texture', texels.byteLength);
			buffers.morphNormTex = tex;
			buffers.morphNormTexSize = { w: width, h: height };
			buffers.morphNormCount = nCount;
		}
	}
	meshBufferCache.set(m, buffers); return buffers;
}
// Ambient lighting is supplied via FrameUniforms (u_ambient_frame) — no direct uniform updates here.
export function uploadDirectionalLights(): void {
	ensureLightBuffersInitialized();
	const lights = Array.from(directionalLights.values());
	const count = Math.min(lights.length, MAX_DIR_LIGHTS);
	// Guard for non-WebGL backends or uninitialized buffers during WebGPU migration
	const backendAny = getRenderContext().backend;
	if (!dirLightData || !backendAny.updateUniformBuffer || !dirLightBuffer) { lightsDirty = true; return; }
	dirLightData.fill(0);
	dirLightCount[0] = count;
	for (let i = 0; i < count; i++) {
		let base = DIR_LIGHT_DIRECTION_OFFSET + i * 4;
		dirLightData.set(lights[i].orientation, base);
		dirLightData[base + 3] = 0;
		base = DIR_LIGHT_COLOR_OFFSET + i * 4;
		dirLightData.set(lights[i].color, base);
		dirLightData[base + 3] = 0;
		base = DIR_LIGHT_INTENSITY_OFFSET + i * 4;
		dirLightData[base] = lights[i].intensity;
	}
	(backendAny as WebGLBackend).updateUniformBuffer(dirLightBuffer, dirLightData);
	lightsDirty = true;
}
export function uploadPointLights(): void {
	ensureLightBuffersInitialized();
	const lights = Array.from(pointLights.values());
	const count = Math.min(lights.length, MAX_POINT_LIGHTS);
	const backendAny = getRenderContext().backend;
	if (!pointLightData || !backendAny.updateUniformBuffer || !pointLightBuffer) { lightsDirty = true; return; }
	pointLightData.fill(0);
	pointLightCount[0] = count;
	for (let i = 0; i < count; i++) {
		let base = POINT_LIGHT_POSITION_OFFSET + i * 4;
		pointLightData.set(lights[i].pos!, base);
		pointLightData[base + 3] = 1;
		base = POINT_LIGHT_COLOR_OFFSET + i * 4;
		pointLightData.set(lights[i].color!, base);
		pointLightData[base + 3] = 0;
		base = POINT_LIGHT_PARAM_OFFSET + i * 4;
		pointLightData[base] = lights[i].range!;
		pointLightData[base + 1] = lights[i].intensity;
	}
	(backendAny as WebGLBackend).updateUniformBuffer(pointLightBuffer, pointLightData);
	lightsDirty = true;
}
export function addDirectionalLight(id: Identifier, light: DirectionalLight): void { directionalLights.set(id, { type: 'directional', color: light.color, intensity: light.intensity, orientation: light.orientation }); uploadDirectionalLights(); }
export function removeDirectionalLight(id: string): void { if (directionalLights.delete(id)) uploadDirectionalLights(); }
export function addPointLight(id: Identifier, light: PointLight): void { if (!light.pos) throw new Error('Point light must have a position'); if (!light.color) throw new Error('Point light must have a color'); if (light.range === undefined) throw new Error('Point light must have a range'); pointLights.set(id, { ...light, type: 'point' }); uploadPointLights(); }
export function removePointLight(id: string): void { if (pointLights.delete(id)) uploadPointLights(); }
export function getPointLight(id: string): PointLight | undefined { return pointLights.get(id); }
export function getDirectionalLights(): ReadonlyArray<DirectionalLight> { return Array.from(directionalLights.values()); }
export function getPointLightsAll(): ReadonlyArray<PointLight> { return Array.from(pointLights.values()); }
export function clearLights(): void { ensureLightBuffersInitialized(); directionalLights.clear(); pointLights.clear(); uploadDirectionalLights(); uploadPointLights(); }
export function consumeLightsDirty(): boolean { const d = lightsDirty; lightsDirty = false; return d; }
export function peekLightsDirty(): boolean { return lightsDirty; }
export const DIR_LIGHT_UNIFORM_BINDING = DIR_LIGHT_BINDING; export const POINT_LIGHT_UNIFORM_BINDING = POINT_LIGHT_BINDING;
export function setDefaultUniformValues(gl: WebGL2RenderingContext, defaultScale: number): void {
	gl.useProgram(gameShaderProgram3D);
	gl.uniform1f(ditherLocation3D, 0.3);
	gl.uniform1f(vertShaderScaleLocation3D, defaultScale);
	// PBR defaults: non-metal (0), rough (1)
	gl.uniform1f(metallicFactorLocation3D, 0.0);
	gl.uniform1f(roughnessFactorLocation3D, 1.0);
	gl.uniform1i(useShadowMapLocation3D, 0);
	gl.uniform1f(shadowStrengthLocation3D, 0.5);
	// Default surface: opaque, default alpha cutoff for masked
	if (typeof surfaceLocation3D !== 'undefined') gl.uniform1i(surfaceLocation3D, 0);
	if (typeof alphaCutoffLocation3D !== 'undefined') gl.uniform1f(alphaCutoffLocation3D, 0.5);
	// Bind all sampler uniforms to known texture units
	gl.uniform1i(albedoTextureLocation3D, TEXTURE_UNIT_ALBEDO);
	gl.uniform1i(normalTextureLocation3D, TEXTURE_UNIT_NORMAL);
	gl.uniform1i(metallicRoughnessTextureLocation3D, TEXTURE_UNIT_METALLIC_ROUGHNESS);
	gl.uniform1i(shadowMapLocation3D, TEXTURE_UNIT_SHADOW_MAP);
	// Morph pos texture defaults
	gl.uniform1i(morphPosTexLocation3D, TEXTURE_UNIT_MORPH_POS);
	gl.uniform2f(morphTexSizeLocation3D, 1.0, 1.0);
	gl.uniform1i(morphCountLocation3D, 0);
	// Morph normal texture defaults
	gl.uniform1i(morphNormTexLocation3D, TEXTURE_UNIT_MORPH_NORM);
	gl.uniform2f(morphNormTexSizeLocation3D, 1.0, 1.0);
	gl.uniform1i(morphNormCountLocation3D, 0);
	// Morph indices default
	gl.uniform1iv(morphIndicesLocation3D, new Int32Array(8));
	gl.uniform1i(morphNormTexLocation3D, TEXTURE_UNIT_MORPH_NORM);
	gl.uniform2f(morphNormTexSizeLocation3D, 1.0, 1.0);
	gl.uniform1i(morphNormCountLocation3D, 0);
	gl.uniformMatrix4fv(viewProjectionLocation3D, false, identityMatrix);
	setUseInstancing(gl, false);
	jointMatrixArray.fill(0);
	jointMatrixArray.set(identityMatrix, 0);
	gl.uniformMatrix4fv(jointMatrixLocation3D, false, jointMatrixArray);
	lastJointMatrixArray.set(jointMatrixArray);
	lastSkinningEnabled = false;
	gl.uniform1fv(morphWeightLocation3D, zeroMorphWeights);
	lastMorphWeightArray.set(zeroMorphWeights);
	lastMorphEnabled = false;
}
export function setupBuffers3D(gl: WebGL2RenderingContext): void {
	instanceMatrixBuffer3D = GLR.glCreateBuffer(gl);
	gl.bindBuffer(gl.ARRAY_BUFFER, instanceMatrixBuffer3D);
	gl.bufferData(gl.ARRAY_BUFFER, MAX_INSTANCES * INSTANCE_STRIDE_BYTES, gl.DYNAMIC_DRAW);

	// No morph attribute buffers are allocated; morph deltas are provided via textures
	// Ensure light UBOs exist even before any pass execution
	ensureLightBuffersInitialized();
	gl.bindBuffer(gl.ARRAY_BUFFER, instanceMatrixBuffer3D);
	gl.bufferData(gl.ARRAY_BUFFER, MAX_INSTANCES * INSTANCE_STRIDE_BYTES, gl.DYNAMIC_DRAW);
}

function ensureLightBuffersInitialized(): void {
	// Allocate UBOs using actual std140 block sizes from the linked program
	const backend = getRenderContext().backend as WebGLBackend;
	const gl = backend.gl;
	if (!gameShaderProgram3D) return;
	if (!dirLightBuffer || !dirLightData) {
		const dirBlockIndex = gl.getUniformBlockIndex(gameShaderProgram3D, 'DirLightBlock');
		if (dirBlockIndex !== gl.INVALID_INDEX) {
			const dirSize = gl.getActiveUniformBlockParameter(gameShaderProgram3D, dirBlockIndex, gl.UNIFORM_BLOCK_DATA_SIZE) as number;
			dirLightData = new Float32Array(Math.ceil(dirSize / 4));
			dirLightCount = new Int32Array(dirLightData.buffer, 0, 1);
			dirLightBuffer = backend.createUniformBuffer(dirSize, 'dynamic') as WebGLBuffer;
			backend.bindUniformBufferBase(DIR_LIGHT_BINDING, dirLightBuffer);
		}
	}
	if (!pointLightBuffer || !pointLightData) {
		const ptBlockIndex = gl.getUniformBlockIndex(gameShaderProgram3D, 'PointLightBlock');
		if (ptBlockIndex !== gl.INVALID_INDEX) {
			const ptSize = gl.getActiveUniformBlockParameter(gameShaderProgram3D, ptBlockIndex, gl.UNIFORM_BLOCK_DATA_SIZE) as number;
			pointLightData = new Float32Array(Math.ceil(ptSize / 4));
			pointLightCount = new Int32Array(pointLightData.buffer, 0, 1);
			pointLightBuffer = backend.createUniformBuffer(ptSize, 'dynamic') as WebGLBuffer;
			backend.bindUniformBufferBase(POINT_LIGHT_BINDING, pointLightBuffer);
		}
	}
}

export function createGameShaderPrograms3D(gl: WebGL2RenderingContext): void {
	const b = getRenderContext().backend as WebGLBackend;
	const program = b.buildProgram(meshVS, meshFS, 'meshbatch');
	if (!program) throw Error('Failed to build 3D mesh shader program');
	gameShaderProgram3D = program;
	gl.validateProgram(program);
	if (!gl.getProgramParameter(program, gl.VALIDATE_STATUS)) throw Error(`Invalid 3D GLSL program: ${gl.getProgramInfoLog(program)}`);
}
export function setupVertexShaderLocations3D(gl: WebGL2RenderingContext): void {
	// If program not explicitly created yet, pick up the program bound by the PipelineManager
	if (!gameShaderProgram3D) {
		const current = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
		if (!current) throw new Error('Mesh shader program not bound during bootstrap');
		gameShaderProgram3D = current;
	}
	gl.useProgram(gameShaderProgram3D);
	vertexPositionLocation3D = gl.getAttribLocation(gameShaderProgram3D, 'a_position');
	texcoordLocation3D = gl.getAttribLocation(gameShaderProgram3D, 'a_texcoord');
	normalLocation3D = gl.getAttribLocation(gameShaderProgram3D, 'a_normal');
	tangentLocation3D = gl.getAttribLocation(gameShaderProgram3D, 'a_tangent');
	// No morph attribute locations (texture-based morphing)
	// No morph tangent attributes (handled via base tangent only)
	jointLocation3D = gl.getAttribLocation(gameShaderProgram3D, 'a_joints');
	weightLocation3D = gl.getAttribLocation(gameShaderProgram3D, 'a_weights');
	modelLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_model')!;
	normalMatrixLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_normalMatrix')!;
	ditherLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_ditherIntensity')!;
	const dirBlock = gl.getUniformBlockIndex(gameShaderProgram3D, 'DirLightBlock');
	const pointBlock = gl.getUniformBlockIndex(gameShaderProgram3D, 'PointLightBlock');
	gl.uniformBlockBinding(gameShaderProgram3D, dirBlock, DIR_LIGHT_BINDING);
	gl.uniformBlockBinding(gameShaderProgram3D, pointBlock, POINT_LIGHT_BINDING);
	materialColorLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_materialColor')!;
	shadowMapLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_shadowMap')!;
	useShadowMapLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_useShadowMap')!;
	lightMatrixLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_lightMatrix')!;
	shadowStrengthLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_shadowStrength')!;
	vertShaderScaleLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_scale')!;
	albedoTextureLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_albedoTexture')!;
	normalTextureLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_normalTexture')!;
	metallicRoughnessTextureLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_metallicRoughnessTexture')!;
	metallicFactorLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_metallicFactor')!;
	roughnessFactorLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_roughnessFactor')!;
	jointMatrixLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_jointMatrices[0]')!;
	morphWeightLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_morphWeights[0]')!;
	// Camera position is provided via FrameUniforms (u_cameraPos_frame); no legacy uniform lookup.
	viewProjectionLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_viewProjection')!;
	useInstancingLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_useInstancing')!;
	alphaCutoffLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_alphaCutoff')!;
	surfaceLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_surface')!;
	morphPosTexLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_morphPosTex')!;
	morphTexSizeLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_morphTexSize')!;
	morphCountLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_morphCount')!;
	morphNormTexLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_morphNormTex')!;
	morphNormTexSizeLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_morphNormTexSize')!;
	morphNormCountLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_morphNormCount')!;
	morphIndicesLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_morphIndices[0]')!;
	instanceMatrixLocations3D = [
		gl.getAttribLocation(gameShaderProgram3D, 'a_i0'),
		gl.getAttribLocation(gameShaderProgram3D, 'a_i1'),
		gl.getAttribLocation(gameShaderProgram3D, 'a_i2'),
		gl.getAttribLocation(gameShaderProgram3D, 'a_i3'),
	];
	instanceColorLocation3D = gl.getAttribLocation(gameShaderProgram3D, 'a_iColor');
}
function buildVAOForMesh(gl: WebGL2RenderingContext, m: Mesh, buffers: MeshBuffers, instanced: boolean, _morph: boolean): WebGLVertexArrayObject {
	const b = getRenderContext().backend as WebGLBackend;
	const vao = b.createVertexArray() as WebGLVertexArrayObject;
	b.bindVertexArray(vao);
	if (buffers.vertex && vertexPositionLocation3D >= 0) { b.bindArrayBuffer(buffers.vertex); b.vertexAttribPointer(vertexPositionLocation3D, 3, gl.FLOAT, false, 0, 0); b.enableVertexAttrib(vertexPositionLocation3D); }
	if (buffers.texcoord && texcoordLocation3D >= 0) { b.bindArrayBuffer(buffers.texcoord); b.vertexAttribPointer(texcoordLocation3D, 2, gl.FLOAT, false, 0, 0); b.enableVertexAttrib(texcoordLocation3D); }
	else if (texcoordLocation3D >= 0) { b.disableVertexAttrib(texcoordLocation3D); }
	if (buffers.normal && normalLocation3D >= 0) { b.bindArrayBuffer(buffers.normal); b.vertexAttribPointer(normalLocation3D, 3, gl.FLOAT, false, 0, 0); b.enableVertexAttrib(normalLocation3D); }
	else if (normalLocation3D >= 0) { b.disableVertexAttrib(normalLocation3D); }
	if (buffers.tangent && tangentLocation3D >= 0) { b.bindArrayBuffer(buffers.tangent); const hasVec4 = m.tangents && m.tangents.length === m.vertexCount * 4; const size = hasVec4 ? 4 : 3; b.vertexAttribPointer(tangentLocation3D, size, gl.FLOAT, false, 0, 0); b.enableVertexAttrib(tangentLocation3D); }
	else if (tangentLocation3D >= 0) { b.disableVertexAttrib(tangentLocation3D); }
	if (m.hasSkinning && buffers.joint && buffers.weight) {
		if (jointLocation3D >= 0) { b.bindArrayBuffer(buffers.joint); b.vertexAttribIPointer(jointLocation3D, 4, gl.UNSIGNED_SHORT, 0, 0); b.enableVertexAttrib(jointLocation3D); }
		if (weightLocation3D >= 0) { b.bindArrayBuffer(buffers.weight); b.vertexAttribPointer(weightLocation3D, 4, gl.FLOAT, false, 0, 0); b.enableVertexAttrib(weightLocation3D); }
	} else {
		if (jointLocation3D >= 0) { b.disableVertexAttrib(jointLocation3D); b.vertexAttribI4ui(jointLocation3D, 0, 0, 0, 0); }
		if (weightLocation3D >= 0) { b.disableVertexAttrib(weightLocation3D); }
	}
	// No morph normal attributes are used (texture-based morphing)
	if (buffers.index) { b.bindElementArrayBuffer(buffers.index); }
	if (instanced) {
		const locs = instanceMatrixLocations3D; b.bindArrayBuffer(instanceMatrixBuffer3D);
		for (let i = 0; i < 4; i++) { const loc = locs[i]; if (loc >= 0) { b.enableVertexAttrib(loc); b.vertexAttribPointer(loc, 4, gl.FLOAT, false, INSTANCE_STRIDE_BYTES, i * COLUMN_BYTES); b.vertexAttribDivisor(loc, 1); } }
		if (instanceColorLocation3D >= 0) {
			b.enableVertexAttrib(instanceColorLocation3D);
			b.vertexAttribPointer(instanceColorLocation3D, 4, gl.UNSIGNED_BYTE, true, INSTANCE_STRIDE_BYTES, INSTANCE_COLOR_OFFSET_BYTES);
			b.vertexAttribDivisor(instanceColorLocation3D, 1);
		}
	}
	b.bindVertexArray(null);
	return vao;
}
function cullAndSortMeshes(list: Iterable<MeshRenderSubmission>): { instancedGroups: Map<string, { mesh: Mesh; instances: { matrix: Float32Array; color: [number, number, number, number] }[] }>; singles: MeshRenderSubmission[] } {
	// Gather into a transient array for filtering + sorting
	const temp: MeshRenderSubmission[] = [];
	for (const it of list) temp.push(it);
	if (temp.length === 0) return { instancedGroups: new Map(), singles: [] };
	const activeCamera = $.world.activeCamera3D; activeCamera.viewProjection;
	const filtered = temp.filter(({ mesh: m, matrix }) => {
		if (m.boundingRadius === 0) return true;
		const cx = matrix[12] + m.boundingCenter[0] * matrix[0] + m.boundingCenter[1] * matrix[4] + m.boundingCenter[2] * matrix[8];
		const cy = matrix[13] + m.boundingCenter[0] * matrix[1] + m.boundingCenter[1] * matrix[5] + m.boundingCenter[2] * matrix[9];
		const cz = matrix[14] + m.boundingCenter[0] * matrix[2] + m.boundingCenter[1] * matrix[6] + m.boundingCenter[2] * matrix[10];
		const radius = m.boundingRadius * M4.maxScale(matrix);
		return activeCamera.sphereInFrustum([cx, cy, cz] as vec3arr, radius);
	});
	const camPos = activeCamera.position;
	const dist = (mat: Float32Array) => { const dx = mat[12] - camPos.x; const dy = mat[13] - camPos.y; const dz = mat[14] - camPos.z; return dx * dx + dy * dy + dz * dz; };
	filtered.sort((a, b) => { const sa = a.mesh.materialSignature; const sb = b.mesh.materialSignature; if (sa !== sb) return sa < sb ? -1 : 1; return dist(a.matrix) - dist(b.matrix); });
	const instancedGroups = new Map<string, { mesh: Mesh; instances: { matrix: Float32Array; color: [number, number, number, number] }[] }>();
	const singles: MeshRenderSubmission[] = [];
	for (const entry of filtered) {
		const m = entry.mesh;
		if (!m.hasSkinning && !m.hasMorphTargets && isOpaque(m)) {
			const key = `G:${m.name}|${m.materialSignature}`;
			let group = instancedGroups.get(key);
			if (!group) { group = { mesh: m, instances: [] }; instancedGroups.set(key, group); }
			group.instances.push({ matrix: entry.matrix, color: getMeshColor(m) });
		} else singles.push(entry);
	}
	return { instancedGroups, singles };
}
function setupViewport(_gl: WebGL2RenderingContext, canvasWidth: number, canvasHeight: number): void { (getRenderContext().backend as WebGLBackend).setViewport({ x: 0, y: 0, w: canvasWidth, h: canvasHeight }); }
function setupRenderingState(gl: WebGL2RenderingContext, _state?: any): void {
	// Ensure the correct program is bound before setting uniforms
	if (gameShaderProgram3D) gl.useProgram(gameShaderProgram3D);
	// Reset common fixed-function state for mesh pass
	gl.enable(gl.DEPTH_TEST);
	(getRenderContext().backend as WebGLBackend).setDepthTestEnabled(true);
	(getRenderContext().backend as WebGLBackend).setDepthFunc(gl.LESS);
	gl.depthMask(true);
	// Ensure back-face culling enabled for solid geometry (skybox pass disables it)
	(getRenderContext().backend as WebGLBackend).setCullEnabled(true);
	gl.cullFace(gl.BACK);
	lastCullDoubleSided = false;
	// Ambient is applied via FrameUniforms (u_ambient_frame)
	// Camera + view/proj are now provided via the FrameUniforms UBO;
	setUseInstancing(gl, false);
	// Fog removed — no fog uniforms to upload
}
function applyCullState(gl: WebGL2RenderingContext, doubleSided: boolean): void {
	if (lastCullDoubleSided === doubleSided) return;
	const backend = getRenderContext().backend as WebGLBackend;
	if (doubleSided) {
		backend.setCullEnabled(false);
	} else {
		backend.setCullEnabled(true);
		gl.cullFace(gl.BACK);
	}
	lastCullDoubleSided = doubleSided;
}
function setMeshTextures(gl: WebGL2RenderingContext, m: Mesh, buffers: MeshBuffers): void {
	// Albedo: prefer mesh texture; otherwise use 1x1 white (no shared atlas fallback)
	const vctx = getRenderContext();
	let tex = m.gpuTextureAlbedo
		? $.texmanager.getTexture(m.gpuTextureAlbedo)
		: (vctx.textures['_default_albedo'] as WebGLTexture | null);
	const v = getRenderContext();
	if (tex !== stateCache.albedo) {
		v.activeTexUnit = TEXTURE_UNIT_ALBEDO;
		v.bind2DTex(tex);
		gl.uniform1i(albedoTextureLocation3D, TEXTURE_UNIT_ALBEDO);
		stateCache.albedo = tex;
	}
	stateCache.useAlbedo = tex !== null ? 1 : 0;

	tex = m.gpuTextureNormal ? $.texmanager.getTexture(m.gpuTextureNormal) : (vctx.textures['_default_normal'] as WebGLTexture | null);
	if (tex !== stateCache.normal) {
		v.activeTexUnit = TEXTURE_UNIT_NORMAL;
		v.bind2DTex(tex);
		gl.uniform1i(normalTextureLocation3D, TEXTURE_UNIT_NORMAL);
		stateCache.normal = tex;
	}
	stateCache.useNormal = tex !== null ? 1 : 0;

	tex = m.gpuTextureMetallicRoughness ? $.texmanager.getTexture(m.gpuTextureMetallicRoughness) : (vctx.textures['_default_mr'] as WebGLTexture | null);
	if (tex !== stateCache.mr) {
		v.activeTexUnit = TEXTURE_UNIT_METALLIC_ROUGHNESS;
		v.bind2DTex(tex);
		gl.uniform1i(metallicRoughnessTextureLocation3D, TEXTURE_UNIT_METALLIC_ROUGHNESS);
		stateCache.mr = tex;
	}
	stateCache.useMR = tex !== null ? 1 : 0;

	// Morph position texture bind (optional)
	if (buffers.morphPosTex && buffers.morphPosTexSize) {
		const v = getRenderContext();
		v.activeTexUnit = TEXTURE_UNIT_MORPH_POS;
		v.bind2DTex(buffers.morphPosTex);
		gl.uniform1i(morphPosTexLocation3D, TEXTURE_UNIT_MORPH_POS);
		gl.uniform2f(morphTexSizeLocation3D, buffers.morphPosTexSize.w, buffers.morphPosTexSize.h);
		gl.uniform1i(morphCountLocation3D, buffers.morphCount ?? 0);
		// Indices: sequential [0..count-1]
		const cnt = buffers.morphCount ?? 0;
		const idx = new Int32Array(8);
		for (let i = 0; i < Math.min(cnt, 8); i++) idx[i] = i;
		gl.uniform1iv(morphIndicesLocation3D, idx);
		_morphUsage.pos++;
	} else {
		gl.uniform1i(morphCountLocation3D, 0);
		gl.uniform1iv(morphIndicesLocation3D, new Int32Array(8));
	}
	// Morph normal texture bind (optional)
	if (buffers.morphNormTex && buffers.morphNormTexSize) {
		const v = getRenderContext();
		v.activeTexUnit = TEXTURE_UNIT_MORPH_NORM;
		v.bind2DTex(buffers.morphNormTex);
		gl.uniform1i(morphNormTexLocation3D, TEXTURE_UNIT_MORPH_NORM);
		gl.uniform2f(morphNormTexSizeLocation3D, buffers.morphNormTexSize.w, buffers.morphNormTexSize.h);
		gl.uniform1i(morphNormCountLocation3D, buffers.morphNormCount ?? 0);
		_morphUsage.norm++;
	} else {
		gl.uniform1i(morphNormCountLocation3D, 0);
	}

	if (m.shadow) {
		const v = getRenderContext();
		v.activeTexUnit = TEXTURE_UNIT_SHADOW_MAP;
		v.bind2DTex(m.shadow.map.texture);
		gl.uniform1i(shadowMapLocation3D, TEXTURE_UNIT_SHADOW_MAP);
		gl.uniformMatrix4fv(lightMatrixLocation3D, false, m.shadow.matrix);
		gl.uniform1f(shadowStrengthLocation3D, m.shadow.strength);
		gl.uniform1i(useShadowMapLocation3D, 1);
	} else {
		gl.uniform1i(useShadowMapLocation3D, 0);
	}
}
function renderInstancedMeshes(gl: WebGL2RenderingContext, instancedGroups: Map<string, { mesh: Mesh; instances: { matrix: Float32Array; color: [number, number, number, number] }[] }>): void {
	if (instancedGroups.size === 0) return;
	checkWebGLError('mesh.instanced: before setUseInstancing');
	setUseInstancing(gl, true);
	checkWebGLError('mesh.instanced: after setUseInstancing');
	uploadJointPalette(gl, undefined, false);
	checkWebGLError('mesh.instanced: after uploadJointPalette');
	for (const { mesh: m, instances } of instancedGroups.values()) {
		const buffers = getMeshBuffers(gl, m);
		const hasMorph = m.hasMorphTargets && (m.morphWeights?.some(w => w !== 0));
		const sig = getVAOSignature(m, true, hasMorph);
		checkWebGLError('mesh.instanced: before getVAOSignature');
		let vao: WebGLVertexArrayObject;
		if (hasMorph) {
			if (buffers.vaoInstancedSig !== sig) { if (buffers.vaoInstanced) gl.deleteVertexArray(buffers.vaoInstanced); buffers.vaoInstanced = buildVAOForMesh(gl, m, buffers, true, true); buffers.vaoInstancedSig = sig; }
			vao = buffers.vaoInstanced!;
			checkWebGLError('mesh.instanced: after getVAOSignature');
		} else {
			if (buffers.vaoInstancedNoMorphSig !== sig) { if (buffers.vaoInstancedNoMorph) gl.deleteVertexArray(buffers.vaoInstancedNoMorph); buffers.vaoInstancedNoMorph = buildVAOForMesh(gl, m, buffers, true, false); buffers.vaoInstancedNoMorphSig = sig; }
			vao = buffers.vaoInstancedNoMorph!;
			checkWebGLError('mesh.instanced: after getVAOSignature');
		}
		const indexed = !!buffers.index;
		const indexType = buffers.indexType!;
		const indexCount = buffers.indexCount ?? m.indices?.length ?? 0;
		applyCullState(gl, !!m.material?.doubleSided);
		setMeshMaterial(gl, m);
		checkWebGLError('mesh.instanced: after setMeshMaterial');
		setMeshTextures(gl, m, buffers);
		checkWebGLError('mesh.instanced: after setMeshTextures');
		if (hasMorph) { const w = new Float32Array(MAX_MORPH_TARGETS); const src = m.morphWeights ?? []; for (let i = 0; i < Math.min(MAX_MORPH_TARGETS, src.length); i++) w[i] = src[i] ?? 0; uploadMorphWeights(gl, w); } else uploadMorphWeights(gl, null);
		checkWebGLError('mesh.instanced: after uploadMorphWeights');
		const __b = getRenderContext().backend as WebGLBackend; __b.bindVertexArray(vao);
		checkWebGLError('mesh.instanced: after bindVertexArray');
		// Partition by transform reflection to maintain correct front-face under culling
		const cw: typeof instances = []; // mirrored → CW
		const ccw: typeof instances = []; // normal → CCW
		for (const inst of instances) {
			(isMatrixMirrored(inst.matrix) ? cw : ccw).push(inst);
		}
		const drawBatches = (src: typeof instances, frontFace: number) => {
			if (src.length === 0) return;
			gl.frontFace(frontFace);
			for (let offset = 0; offset < src.length; offset += MAX_INSTANCES) {
				const batchCount = Math.min(MAX_INSTANCES, src.length - offset);
				// fill matrices + colors
				for (let i = 0; i < batchCount; i++) {
					const inst = src[offset + i];
					// matrices
					instanceScratchF32.set(inst.matrix, i * INSTANCE_STRIDE_FLOATS);
					// colors (pack UNORM8)
					const base = i * INSTANCE_STRIDE_BYTES + INSTANCE_COLOR_OFFSET_BYTES;
					instanceScratchU8[base + 0] = Math.min(255, Math.max(0, Math.round(inst.color[0] * 255)));
					instanceScratchU8[base + 1] = Math.min(255, Math.max(0, Math.round(inst.color[1] * 255)));
					instanceScratchU8[base + 2] = Math.min(255, Math.max(0, Math.round(inst.color[2] * 255)));
					instanceScratchU8[base + 3] = Math.min(255, Math.max(0, Math.round(inst.color[3] * 255)));
				}
				// Orphan then upload
				gl.bindBuffer(gl.ARRAY_BUFFER, instanceMatrixBuffer3D);
				gl.bufferData(gl.ARRAY_BUFFER, MAX_INSTANCES * INSTANCE_STRIDE_BYTES, gl.DYNAMIC_DRAW);
				const bytes = batchCount * INSTANCE_STRIDE_BYTES;
				const u8slice = instanceScratchU8.subarray(0, bytes);
				gl.bufferSubData(gl.ARRAY_BUFFER, 0, u8slice);
				(getRenderContext().backend as WebGLBackend).accountUpload('vertex', u8slice.byteLength);
				checkWebGLError('mesh.instanced: after bufferSubData');
				const _b = getRenderContext().backend as WebGLBackend;
				const _pass: PassEncoder = { fbo: null, desc: { label: 'meshbatch' } };
				if (indexed) _b.drawIndexedInstanced(_pass, indexCount, batchCount, 0, 0, 0, indexType);
				else _b.drawInstanced(_pass, m.vertexCount, batchCount, 0, 0);
			}
		};
		// Draw mirrored (CW) then normal (CCW); restore CCW at end for safety
		drawBatches(cw, gl.CW);
		drawBatches(ccw, gl.CCW);
		gl.frontFace(gl.CCW);
		__b.bindVertexArray(null);
		checkWebGLError('mesh.instanced: after bindVertexArray');
	}
	setUseInstancing(gl, false);
	applyCullState(gl, false);
	checkWebGLError('mesh.instanced: after setUseInstancing');
}
// Uniform change caching for materials
let lastMaterialSig: string | null = null;
let lastMaterialColor = new Float32Array([1, 1, 1, 1]);
let lastMetallic = 1.0;
let lastRoughness = 1.0;
function setMeshMaterial(gl: WebGL2RenderingContext, m: Mesh): void {
	const mat = m.material;
	const sig = m.materialSignature;
	const color = mat?.color;
	const r = color ? color[0] : 1;
	const g = color ? color[1] : 1;
	const b = color ? color[2] : 1;
	const a = color ? color[3] : 1;
	const metallic = mat?.metallicFactor ?? 0.0;
	const roughness = mat?.roughnessFactor ?? 1.0;
	if (r !== lastMaterialColor[0] || g !== lastMaterialColor[1] || b !== lastMaterialColor[2] || a !== lastMaterialColor[3] || lastMaterialSig !== sig) {
		gl.uniform4f(materialColorLocation3D, r, g, b, a);
		lastMaterialColor[0] = r;
		lastMaterialColor[1] = g;
		lastMaterialColor[2] = b;
		lastMaterialColor[3] = a;
	}
	if (lastMetallic !== metallic || lastMaterialSig !== sig) { gl.uniform1f(metallicFactorLocation3D, metallic); lastMetallic = metallic; }
	if (lastRoughness !== roughness || lastMaterialSig !== sig) { gl.uniform1f(roughnessFactorLocation3D, roughness); lastRoughness = roughness; }
	// Surface classification uniforms
	const surf = mat?.surface === 'transparent' ? 2 : (mat?.surface === 'masked' ? 1 : 0);
	gl.uniform1i(surfaceLocation3D, surf);
	gl.uniform1f(alphaCutoffLocation3D, mat?.alphaCutoff ?? 0.5);
	lastMaterialSig = sig;
}
function renderSingleMeshes(gl: WebGL2RenderingContext, singles: MeshRenderSubmission[], framebuffer: WebGLFramebuffer): void {
	setUseInstancing(gl, false);
	for (const { mesh: m, matrix, jointMatrices, morphWeights } of singles) {
		const buffers = getMeshBuffers(gl, m);
		const srcWeights = morphWeights ?? m.morphWeights ?? [];
		const hasMorph = m.hasMorphTargets && srcWeights.some(w => w !== 0);
		const sig = getVAOSignature(m, false, hasMorph);
		let vao: WebGLVertexArrayObject;
		if (hasMorph) {
			if (buffers.vaoSig !== sig) { if (buffers.vao) gl.deleteVertexArray(buffers.vao); buffers.vao = buildVAOForMesh(gl, m, buffers, false, true); buffers.vaoSig = sig; }
			vao = buffers.vao!;
		} else {
			if (buffers.vaoNoMorphSig !== sig) { if (buffers.vaoNoMorph) gl.deleteVertexArray(buffers.vaoNoMorph); buffers.vaoNoMorph = buildVAOForMesh(gl, m, buffers, false, false); buffers.vaoNoMorphSig = sig; }
			vao = buffers.vaoNoMorph!;
		}
		uploadJointPalette(gl, jointMatrices, m.hasSkinning);
		if (hasMorph) {
			const w = new Float32Array(MAX_MORPH_TARGETS);
			for (let i = 0; i < Math.min(MAX_MORPH_TARGETS, srcWeights.length); i++) w[i] = srcWeights[i] ?? 0;
			uploadMorphWeights(gl, w);
		} else uploadMorphWeights(gl, null);
		applyCullState(gl, !!m.material?.doubleSided);
		setMeshMaterial(gl, m);
		setMeshTextures(gl, m, buffers);
		gl.uniformMatrix4fv(modelLocation3D, false, matrix);
		const normal9 = normal9Pool.ensure(); M4.normal3Into(normal9, matrix); gl.uniformMatrix3fv(normalMatrixLocation3D, false, normal9);
		const __b2 = getRenderContext().backend as WebGLBackend; __b2.bindVertexArray(vao);
		const _b2 = getRenderContext().backend as WebGLBackend; const _p2 = { fbo: framebuffer, desc: { label: 'meshbatch' } };
		// EBO is captured in VAO; avoid redundant bind per draw
		checkWebGLError('mesh.single: before draw');
		// Handle mirrored transforms by flipping front face for this draw
		const mirrored = isMatrixMirrored(matrix);
		if (mirrored) gl.frontFace(gl.CW);
		if (buffers.index) _b2.drawIndexed(_p2, buffers.indexCount ?? m.indices!.length, 0, buffers.indexType); else _b2.draw(_p2, 0, m.vertexCount);
		if (mirrored) gl.frontFace(gl.CCW);
		checkWebGLError('mesh.single: after draw');
		__b2.bindVertexArray(null);
	}
	normal9Pool.reset();
	applyCullState(gl, false);
}
export function renderMeshBatch(gl: WebGL2RenderingContext, framebuffer: WebGLFramebuffer, canvasWidth: number, canvasHeight: number, state?: any): void {
	// Swap to make submissions visible (no legacy fallbacks)
	meshQueue.swap();
	if (meshQueue.sizeFront() === 0) return;
	_morphUsage.pos = 0; _morphUsage.norm = 0;
	// Single dynamic buffer; no ring state
	// Adapt to FeatureQueue API without exposing storage
	const collected: MeshRenderSubmission[] = [];
	meshQueue.forEachFront((it) => { collected.push(it); });
	const { instancedGroups, singles } = cullAndSortMeshes(collected);
	setupViewport(gl, canvasWidth, canvasHeight);
	setupRenderingState(gl, state);
	// Split singles by surface type
	const opaqueSingles: MeshRenderSubmission[] = [];
	const transparentSingles: MeshRenderSubmission[] = [];
	for (const s of singles) { (isTransparent(s.mesh) ? transparentSingles : opaqueSingles).push(s); }
	// Filter instanced groups to only opaque/masked
	const opaqueInstanced = new Map<string, { mesh: Mesh; instances: { matrix: Float32Array; color: [number, number, number, number] }[] }>();
	for (const [k, g] of instancedGroups) { if (isOpaque(g.mesh)) opaqueInstanced.set(k, g); }
	// Opaque phase: blending off, depth write on
	gl.disable(gl.BLEND);
	gl.depthMask(true);
	renderInstancedMeshes(gl, opaqueInstanced);
	renderSingleMeshes(gl, opaqueSingles, framebuffer);
	// Transparent phase: blending on, depth write off; sort far-to-near
	if (transparentSingles.length) {
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.depthMask(false);
		const cam = $.world.activeCamera3D; const camPos = cam?.position;
		if (camPos) {
			transparentSingles.sort((a, b) => {
				const da = (a.matrix[12] - camPos.x) ** 2 + (a.matrix[13] - camPos.y) ** 2 + (a.matrix[14] - camPos.z) ** 2;
				const db = (b.matrix[12] - camPos.x) ** 2 + (b.matrix[13] - camPos.y) ** 2 + (b.matrix[14] - camPos.z) ** 2;
				return db - da; // far-to-near
			});
		}
		renderSingleMeshes(gl, transparentSingles, framebuffer);
		gl.depthMask(true);
	}
	// FeatureQueue back buffer cleared on swap; nothing else to do
}

export function submitMesh(o: MeshRenderSubmission): void { meshQueue.submit({ ...o }); }
export function reset(_gl: WebGL2RenderingContext): void { normal9Pool.reset(); clearLights(); }
export function getMeshQueueDebug(): { front: number; back: number } { return { front: meshQueue.sizeFront(), back: meshQueue.sizeBack() }; }

export function registerMeshBatchPass_WebGL(registry: RenderPassLibrary) {
	registry.register({
		id: 'meshbatch',
		label: 'meshbatch',
		name: 'Meshes',
		...(() => {
			const vs = shaderModule(meshVS, { uniforms: ['FrameUniforms', 'DirLightBlock', 'PointLightBlock'] }, 'mesh-vs');
			const fs = shaderModule(
				meshFS,
				{
					uniforms: ['FrameUniforms', 'DirLightBlock', 'PointLightBlock'],
					textures: [
						{ name: 'u_albedoTexture' },
						{ name: 'u_normalTexture' },
						{ name: 'u_metallicRoughnessTexture' },
					],
					buffers: [
						{ name: 'DirLightBlock', size: 0, usage: 'uniform' },
						{ name: 'PointLightBlock', size: 0, usage: 'uniform' },
					],
				},
				'mesh-fs'
			);
			const build = makePipelineBuildDesc('Meshes', vs, fs);
			return { vsCode: build.vsCode, fsCode: build.fsCode, bindingLayout: build.bindingLayout };
		})(),
		bootstrap: (backend) => {
			const gl = (backend as WebGLBackend).gl as WebGL2RenderingContext;
			setupVertexShaderLocations3D(gl);
			setupBuffers3D(gl);
			// Set a sane default; dynamic values will be updated during prepare/exec
			setDefaultUniformValues(gl, 1.0);
			// Default textures are managed by TextureManager and GameView.initializeDefaultTextures
		},
		writesDepth: true,
		shouldExecute: () => !!(getQueuedMeshCount()),
		exec: (backend, fbo, s) => {
			const gl = (backend as WebGLBackend).gl as WebGL2RenderingContext;
			const state = s as MeshBatchPipelineState;
			renderMeshBatch(gl, fbo as WebGLFramebuffer, state.width, state.height, state);
		},
		prepare: (backend, _state) => {
			const gv = getRenderContext();
			const width = gv.offscreenCanvasSize.x; const height = gv.offscreenCanvasSize.y;
			const cam = $.world.activeCamera3D;
			if (!cam) {
				console.warn('[Draw Meshes] No active 3D camera found, skipping mesh draw');
				return;
			}
			const frameShared = registry.getState('frame_shared');
			const mats = cam.getMatrices();
			const meshState: MeshBatchPipelineState = {
				width,
				height,
				camPos: cam.position,
				viewProj: mats.vp,
				lighting: frameShared ? frameShared.lighting : undefined,
			};
			registry.setState('meshbatch', meshState);
			registry.validatePassResources('meshbatch', backend);
		},
	});
}
