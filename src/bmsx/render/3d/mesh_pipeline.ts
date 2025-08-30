// Mesh pipeline (formerly glview.3d) inlined from legacy module.
// Handles 3D mesh rendering, instancing, morph targets, skinning, fog, and lighting UBO management.
import { makePipelineBuildDesc, shaderModule } from '../..';
import { $ } from '../../core/game';
import type { Mesh } from '../../core/mesh';
import { Float32ArrayPool } from '../../core/utils';
import type { vec3arr } from '../../rompack/rompack';
import { Identifier } from '../../rompack/rompack';
import meshFS from '../3d/shaders/3d.frag.glsl';
import meshVS from '../3d/shaders/3d.vert.glsl';
import { FeatureQueue } from '../backend/feature_queue';
import * as GLR from '../backend/gl_resources';
import { GraphicsPipelineManager } from '../backend/pipeline_manager';
import { FogUniforms, getRenderContext, MeshBatchPipelineState, PipelineRegistry } from '../backend/pipeline_registry';
import { MAX_DIR_LIGHTS, MAX_POINT_LIGHTS, TEXTURE_UNIT_ALBEDO, TEXTURE_UNIT_METALLIC_ROUGHNESS, TEXTURE_UNIT_NORMAL, TEXTURE_UNIT_SHADOW_MAP } from '../backend/webgl.constants';
import { CATCH_WEBGL_ERROR, checkWebGLError } from '../backend/webgl.helpers';
import { WebGLBackend } from '../backend/webgl_backend';
import { DrawMeshOptions } from '../view';
import { Atmosphere, registerAtmosphereHotkeys } from './atmosphere';
import type { AmbientLight, DirectionalLight, PointLight } from './light';
import { M4 } from './math3d';

const BYTES_PER_FLOAT = 4;
const COLUMN_BYTES = 4 * BYTES_PER_FLOAT; // 4 floats per kolom = 16 bytes
const MAX_INSTANCES = 64;
const INSTANCE_STRIDE_BYTES = 64; // 4 vec4
const INSTANCE_STRIDE_FLOATS = INSTANCE_STRIDE_BYTES / 4;
const INSTANCE_STRIDE_NORMAL9 = 9;
const MAT4_FLOATS = 16;
// unified in webgl.constants

// Legacy direct submission array removed. Use submitMesh() with feature queue.
const meshQueue = new FeatureQueue<DrawMeshOptions>(256);
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
    morphPositions?: (WebGLBuffer | undefined)[];
    morphNormals?: (WebGLBuffer | undefined)[];
    morphTangents?: (WebGLBuffer | undefined)[];

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

// instancing upload helpers
const instanceScratch = new Float32Array(MAX_INSTANCES * INSTANCE_STRIDE_FLOATS);
const normal9Pool = new Float32ArrayPool(INSTANCE_STRIDE_NORMAL9);

// simpele texture/material state cache
const stateCache = {
    albedo: null as WebGLTexture | null,
    normal: null as WebGLTexture | null,
    mr: null as WebGLTexture | null,
    useAlbedo: -1,
    useNormal: -1,
    useMR: -1,
};

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
let ambientColorLocation3D: WebGLUniformLocation;
let ambientIntensityLocation3D: WebGLUniformLocation;
let materialColorLocation3D: WebGLUniformLocation;
let shadowMapLocation3D: WebGLUniformLocation;
let useShadowMapLocation3D: WebGLUniformLocation;
let lightMatrixLocation3D: WebGLUniformLocation;
let shadowStrengthLocation3D: WebGLUniformLocation;
let vertShaderScaleLocation3D: WebGLUniformLocation;
let albedoTextureLocation3D: WebGLUniformLocation;
let useAlbedoTextureLocation3D: WebGLUniformLocation;
let normalTextureLocation3D: WebGLUniformLocation;
let useNormalTextureLocation3D: WebGLUniformLocation;
let metallicRoughnessTextureLocation3D: WebGLUniformLocation;
let useMetallicRoughnessTextureLocation3D: WebGLUniformLocation;
let metallicFactorLocation3D: WebGLUniformLocation;
let roughnessFactorLocation3D: WebGLUniformLocation;
let cameraPositionLocation3D: WebGLUniformLocation;

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

let morphPositionBuffers3D: WebGLBuffer[];
let morphNormalBuffers3D: WebGLBuffer[];
let morphTangentBuffers3D: WebGLBuffer[];
let morphPositionLocations3D: number[];
let morphNormalLocations3D: number[];
let morphTangentLocations3D: number[];
let morphWeightLocation3D: WebGLUniformLocation;
let jointLocation3D: number;
let weightLocation3D: number;
let jointMatrixLocation3D: WebGLUniformLocation;
let instanceMatrixBuffer3D: WebGLBuffer;
let instanceMatrixLocations3D: number[];
let viewProjectionLocation3D: WebGLUniformLocation;
let useInstancingLocation3D: WebGLUniformLocation;
// Fog / atmosphere & height gradient uniform locations
let fogColorLocation3D: WebGLUniformLocation;
let fogDensityLocation3D: WebGLUniformLocation;
let fogEnableLocation3D: WebGLUniformLocation;
let fogModeLocation3D: WebGLUniformLocation;
let heightFogEnableLocation3D: WebGLUniformLocation;
let heightFogStartLocation3D: WebGLUniformLocation;
let heightFogEndLocation3D: WebGLUniformLocation;
let heightGradLowLocation3D: WebGLUniformLocation;
let heightGradHighLocation3D: WebGLUniformLocation;
let heightMinLocation3D: WebGLUniformLocation;
let heightMaxLocation3D: WebGLUniformLocation;
let heightGradEnableLocation3D: WebGLUniformLocation;
const MAX_MORPH_TARGETS = 2;
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
    if (m.hasMorphTargets) { buffers.morphPositions = []; buffers.morphNormals = []; buffers.morphTangents = []; for (let i = 0; i < Math.min(m.morphPositions!.length, MAX_MORPH_TARGETS); i++) { const pos = m.morphPositions![i]; const posBuf = GLR.glCreateBuffer(gl); gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW); backend.accountUpload('vertex', pos.byteLength); buffers.morphPositions.push(posBuf); if (m.morphNormals && m.morphNormals[i]) { const normBuf = GLR.glCreateBuffer(gl); gl.bindBuffer(gl.ARRAY_BUFFER, normBuf); gl.bufferData(gl.ARRAY_BUFFER, m.morphNormals[i]!, gl.STATIC_DRAW); backend.accountUpload('vertex', m.morphNormals[i]!.byteLength); buffers.morphNormals.push(normBuf); } else buffers.morphNormals.push(undefined); if (m.morphTangents && m.morphTangents[i]) { const tanBuf = GLR.glCreateBuffer(gl); gl.bindBuffer(gl.ARRAY_BUFFER, tanBuf); gl.bufferData(gl.ARRAY_BUFFER, m.morphTangents[i]!, gl.STATIC_DRAW); backend.accountUpload('vertex', m.morphTangents[i]!.byteLength); buffers.morphTangents.push(tanBuf); } else buffers.morphTangents.push(undefined); } }
    meshBufferCache.set(m, buffers); return buffers;
}
export function setAmbientLight(gl: WebGL2RenderingContext, light: AmbientLight): void { if (!light) return; gl.useProgram(gameShaderProgram3D); gl.uniform3fv(ambientColorLocation3D, new Float32Array(light.color)); gl.uniform1f(ambientIntensityLocation3D, light.intensity); }
export function uploadDirectionalLights(): void {
    ensureLightBuffersInitialized();
    const lights = Array.from(directionalLights.values());
    const count = Math.min(lights.length, MAX_DIR_LIGHTS);
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
    const backend = getRenderContext().backend as WebGLBackend;
    backend.updateUniformBuffer(dirLightBuffer, dirLightData);
    lightsDirty = true;
}
export function uploadPointLights(): void {
    ensureLightBuffersInitialized();
    const lights = Array.from(pointLights.values());
    const count = Math.min(lights.length, MAX_POINT_LIGHTS);
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
    const backend = getRenderContext().backend as WebGLBackend;
    backend.updateUniformBuffer(pointLightBuffer, pointLightData);
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
    gl.uniform3fv(ambientColorLocation3D, new Float32Array([1.0, 1.0, 1.0]));
    gl.uniform1f(ambientIntensityLocation3D, 0);
    gl.uniform1f(vertShaderScaleLocation3D, defaultScale);
    gl.uniform1i(useAlbedoTextureLocation3D, 0);
    gl.uniform1i(useNormalTextureLocation3D, 0);
    gl.uniform1i(useMetallicRoughnessTextureLocation3D, 0);
    gl.uniform1f(metallicFactorLocation3D, 1.0);
    gl.uniform1f(roughnessFactorLocation3D, 1.0);
    gl.uniform1i(useShadowMapLocation3D, 0);
    gl.uniform1f(shadowStrengthLocation3D, 0.5);
    // Bind all sampler uniforms to known texture units
    gl.uniform1i(albedoTextureLocation3D, TEXTURE_UNIT_ALBEDO);
    gl.uniform1i(normalTextureLocation3D, TEXTURE_UNIT_NORMAL);
    gl.uniform1i(metallicRoughnessTextureLocation3D, TEXTURE_UNIT_METALLIC_ROUGHNESS);
    gl.uniform1i(shadowMapLocation3D, TEXTURE_UNIT_SHADOW_MAP);
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

    morphPositionBuffers3D = [GLR.glCreateBuffer(gl), GLR.glCreateBuffer(gl)];
    morphNormalBuffers3D = [GLR.glCreateBuffer(gl), GLR.glCreateBuffer(gl)];
    morphTangentBuffers3D = [GLR.glCreateBuffer(gl), GLR.glCreateBuffer(gl)];
    const dummyMorphData = new Float32Array(24);
    for (let i = 0; i < MAX_MORPH_TARGETS; i++) {
        gl.bindBuffer(gl.ARRAY_BUFFER, morphPositionBuffers3D[i]);
        gl.bufferData(gl.ARRAY_BUFFER, dummyMorphData, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, morphNormalBuffers3D[i]);
        gl.bufferData(gl.ARRAY_BUFFER, dummyMorphData, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, morphTangentBuffers3D[i]);
        gl.bufferData(gl.ARRAY_BUFFER, dummyMorphData, gl.STATIC_DRAW);
    }
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
    morphPositionLocations3D = [
        gl.getAttribLocation(gameShaderProgram3D, 'a_morphPos0'),
        gl.getAttribLocation(gameShaderProgram3D, 'a_morphPos1'),
    ];
    morphNormalLocations3D = [
        gl.getAttribLocation(gameShaderProgram3D, 'a_morphNorm0'),
        gl.getAttribLocation(gameShaderProgram3D, 'a_morphNorm1'),
    ];
    morphTangentLocations3D = [
        gl.getAttribLocation(gameShaderProgram3D, 'a_morphTan0'),
        gl.getAttribLocation(gameShaderProgram3D, 'a_morphTan1'),
    ];
    jointLocation3D = gl.getAttribLocation(gameShaderProgram3D, 'a_joints');
    weightLocation3D = gl.getAttribLocation(gameShaderProgram3D, 'a_weights');
    modelLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_model')!;
    normalMatrixLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_normalMatrix')!;
    ditherLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_ditherIntensity')!;
    ambientColorLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_ambientColor')!;
    ambientIntensityLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_ambientIntensity')!;
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
    useAlbedoTextureLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_useAlbedoTexture')!;
    normalTextureLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_normalTexture')!;
    useNormalTextureLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_useNormalTexture')!;
    metallicRoughnessTextureLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_metallicRoughnessTexture')!;
    useMetallicRoughnessTextureLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_useMetallicRoughnessTexture')!;
    metallicFactorLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_metallicFactor')!;
    roughnessFactorLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_roughnessFactor')!;
    jointMatrixLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_jointMatrices[0]')!;
    morphWeightLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_morphWeights[0]')!;
    cameraPositionLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_cameraPos')!;
    viewProjectionLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_viewProjection')!;
    useInstancingLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_useInstancing')!;
    instanceMatrixLocations3D = [
        gl.getAttribLocation(gameShaderProgram3D, 'a_i0'),
        gl.getAttribLocation(gameShaderProgram3D, 'a_i1'),
        gl.getAttribLocation(gameShaderProgram3D, 'a_i2'),
        gl.getAttribLocation(gameShaderProgram3D, 'a_i3'),
    ];
    fogColorLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_fogColor')!;
    fogDensityLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_fogDensity')!;
    fogEnableLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_enableFog')!;
    fogModeLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_fogMode')!;
    heightFogEnableLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_enableHeightFog')!;
    heightFogStartLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_heightFogStart')!;
    heightFogEndLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_heightFogEnd')!;
    heightGradLowLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_heightGradientLow')!;
    heightGradHighLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_heightGradientHigh')!;
    heightMinLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_heightMin')!;
    heightMaxLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_heightMax')!;
    heightGradEnableLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_enableHeightGradient')!;
}
function buildVAOForMesh(gl: WebGL2RenderingContext, m: Mesh, buffers: MeshBuffers, instanced: boolean, morph: boolean): WebGLVertexArrayObject {
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
    if (morph && m.hasMorphTargets && buffers.morphPositions) {
        for (let i = 0; i < Math.min(MAX_MORPH_TARGETS, buffers.morphPositions.length); i++) {
            const pLoc = morphPositionLocations3D[i]; const nLoc = morphNormalLocations3D[i]; const tLoc = morphTangentLocations3D[i];
            const pBuf = buffers.morphPositions[i]; const nBuf = buffers.morphNormals?.[i]; const tBuf = buffers.morphTangents?.[i];
            if (pBuf && pLoc >= 0) { b.bindArrayBuffer(pBuf); b.vertexAttribPointer(pLoc, 3, gl.FLOAT, false, 0, 0); b.enableVertexAttrib(pLoc); }
            if (nBuf && nLoc >= 0) { b.bindArrayBuffer(nBuf); b.vertexAttribPointer(nLoc, 3, gl.FLOAT, false, 0, 0); b.enableVertexAttrib(nLoc); }
            if (tBuf && tLoc >= 0) { b.bindArrayBuffer(tBuf); b.vertexAttribPointer(tLoc, 3, gl.FLOAT, false, 0, 0); b.enableVertexAttrib(tLoc); }
        }
    } else {
        for (let i = 0; i < MAX_MORPH_TARGETS; i++) {
            const pLoc = morphPositionLocations3D[i]; const nLoc = morphNormalLocations3D[i]; const tLoc = morphTangentLocations3D[i];
            if (pLoc >= 0) { b.disableVertexAttrib(pLoc); }
            if (nLoc >= 0) { b.disableVertexAttrib(nLoc); }
            if (tLoc >= 0) { b.disableVertexAttrib(tLoc); }
        }
    }
    if (buffers.index) { b.bindElementArrayBuffer(buffers.index); }
    if (instanced) {
        const locs = instanceMatrixLocations3D; b.bindArrayBuffer(instanceMatrixBuffer3D);
        for (let i = 0; i < 4; i++) { const loc = locs[i]; if (loc >= 0) { b.enableVertexAttrib(loc); b.vertexAttribPointer(loc, 4, gl.FLOAT, false, INSTANCE_STRIDE_BYTES, i * COLUMN_BYTES); b.vertexAttribDivisor(loc, 1); } }
    }
    b.bindVertexArray(null);
    return vao;
}
function cullAndSortMeshes(list: Iterable<DrawMeshOptions>): { instancedGroups: Map<string, { mesh: Mesh; matrices: Float32Array[] }>; singles: DrawMeshOptions[] } {
    // Gather into a transient array for filtering + sorting
    const temp: DrawMeshOptions[] = [];
    for (const it of list) temp.push(it);
    if (temp.length === 0) return { instancedGroups: new Map(), singles: [] };
    const activeCamera = $.model.activeCamera3D; activeCamera.viewProjection;
    const filtered = temp.filter(({ mesh: m, matrix }) => {
        if (m.boundingRadius === 0) return true;
        const cx = matrix[12] + m.boundingCenter[0] * matrix[0] + m.boundingCenter[1] * matrix[4] + m.boundingCenter[2] * matrix[8];
        const cy = matrix[13] + m.boundingCenter[0] * matrix[1] + m.boundingCenter[1] * matrix[5] + m.boundingCenter[2] * matrix[9];
        const cz = matrix[14] + m.boundingCenter[0] * matrix[2] + m.boundingCenter[1] * matrix[6] + m.boundingCenter[2] * matrix[10];
        const scaleX = Math.hypot(matrix[0], matrix[1], matrix[2]);
        const scaleY = Math.hypot(matrix[4], matrix[5], matrix[6]);
        const scaleZ = Math.hypot(matrix[8], matrix[9], matrix[10]);
        const radius = m.boundingRadius * Math.max(scaleX, scaleY, scaleZ);
        return activeCamera.sphereInFrustum([cx, cy, cz] as vec3arr, radius);
    });
    const camPos = activeCamera.position;
    const dist = (mat: Float32Array) => { const dx = mat[12] - camPos.x; const dy = mat[13] - camPos.y; const dz = mat[14] - camPos.z; return dx * dx + dy * dy + dz * dz; };
    filtered.sort((a, b) => { const sa = a.mesh.materialSignature; const sb = b.mesh.materialSignature; if (sa !== sb) return sa < sb ? -1 : 1; return dist(a.matrix) - dist(b.matrix); });
    const instancedGroups = new Map<string, { mesh: Mesh; matrices: Float32Array[] }>();
    const singles: DrawMeshOptions[] = [];
    for (const entry of filtered) {
        const m = entry.mesh;
        if (!m.hasSkinning && !m.hasMorphTargets) {
            const key = `G:${m.name}|${m.materialSignature}`;
            let group = instancedGroups.get(key);
            if (!group) { group = { mesh: m, matrices: [] }; instancedGroups.set(key, group); }
            group.matrices.push(entry.matrix);
        } else singles.push(entry);
    }
    return { instancedGroups, singles };
}
function setupViewport(gl: WebGL2RenderingContext, canvasWidth: number, canvasHeight: number): void { (getRenderContext().backend as WebGLBackend).setViewport({ x: 0, y: 0, w: canvasWidth, h: canvasHeight }); }
function setupRenderingState(gl: WebGL2RenderingContext, state?: any): void {
    // Ensure the correct program is bound before setting uniforms
    if (gameShaderProgram3D) gl.useProgram(gameShaderProgram3D);
    // Reset common fixed-function state for mesh pass
    gl.enable(gl.DEPTH_TEST);
    (getRenderContext().backend as WebGLBackend).setDepthTestEnabled(true);
    (getRenderContext().backend as WebGLBackend).setDepthFunc(gl.LESS);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    // Camera + view/proj are now provided via the FrameUniforms UBO;
    // keep legacy uniforms unset to avoid redundant state.
    setUseInstancing(gl, false);
    registerAtmosphereHotkeys();
    const fogSrc: any | undefined = state?.fog;
    const fog: any = fogSrc ?? {
        fogColor: Atmosphere.fogColor as [number, number, number],
        fogDensity: (() => { const p = Atmosphere.progressFactor; const anim = Atmosphere.enableAutoAnimation ? (0.5 - 0.5 * Math.cos(p * 6.28318530718)) : 0.0; return Atmosphere.baseFogDensity + Atmosphere.dynamicFogDensity * anim; })(),
        enableFog: Atmosphere.enableFog,
        fogMode: Atmosphere.fogMode,
        enableHeightFog: Atmosphere.enableHeightFog,
        heightFogStart: Atmosphere.heightFogStart,
        heightFogEnd: Atmosphere.heightFogEnd,
        heightLowColor: Atmosphere.heightLowColor as [number, number, number],
        heightHighColor: Atmosphere.heightHighColor as [number, number, number],
        heightMin: Atmosphere.heightMin,
        heightMax: Atmosphere.heightMax,
        enableHeightGradient: Atmosphere.enableHeightGradient,
    };
    gl.uniform3fv(fogColorLocation3D, new Float32Array(fog.fogColor));
    gl.uniform1f(fogDensityLocation3D, fog.fogDensity);
    gl.uniform1i(fogEnableLocation3D, fog.enableFog ? 1 : 0);
    gl.uniform1i(fogModeLocation3D, fog.fogMode);
    gl.uniform1i(heightFogEnableLocation3D, fog.enableHeightFog ? 1 : 0);
    gl.uniform1f(heightFogStartLocation3D, fog.heightFogStart);
    gl.uniform1f(heightFogEndLocation3D, fog.heightFogEnd);
    gl.uniform3fv(heightGradLowLocation3D, new Float32Array(fog.heightLowColor));
    gl.uniform3fv(heightGradHighLocation3D, new Float32Array(fog.heightHighColor));
    gl.uniform1f(heightMinLocation3D, fog.heightMin);
    gl.uniform1f(heightMaxLocation3D, fog.heightMax);
    gl.uniform1i(heightGradEnableLocation3D, fog.enableHeightGradient ? 1 : 0);
}
function setMeshTextures(gl: WebGL2RenderingContext, m: Mesh): void {
    let tex = m.gpuTextureAlbedo ? $.texmanager.getTexture(m.gpuTextureAlbedo) : null;
    const v = getRenderContext();
    if (tex !== stateCache.albedo) {
        v.activeTexUnit = TEXTURE_UNIT_ALBEDO;
        v.bind2DTex(tex);
        gl.uniform1i(albedoTextureLocation3D, TEXTURE_UNIT_ALBEDO);
        stateCache.albedo = tex;
    }
    const useAlbedo = tex !== null ? 1 : 0;
    if (useAlbedo !== stateCache.useAlbedo) {
        gl.uniform1i(useAlbedoTextureLocation3D, useAlbedo);
        stateCache.useAlbedo = useAlbedo;
    }

    tex = m.gpuTextureNormal ? $.texmanager.getTexture(m.gpuTextureNormal) : null;
    if (tex !== stateCache.normal) {
        v.activeTexUnit = TEXTURE_UNIT_NORMAL;
        v.bind2DTex(tex);
        gl.uniform1i(normalTextureLocation3D, TEXTURE_UNIT_NORMAL);
        stateCache.normal = tex;
    }
    const useNormal = tex !== null ? 1 : 0;
    if (useNormal !== stateCache.useNormal) {
        gl.uniform1i(useNormalTextureLocation3D, useNormal);
        stateCache.useNormal = useNormal;
    }

    tex = m.gpuTextureMetallicRoughness ? $.texmanager.getTexture(m.gpuTextureMetallicRoughness) : null;
    if (tex !== stateCache.mr) {
        v.activeTexUnit = TEXTURE_UNIT_METALLIC_ROUGHNESS;
        v.bind2DTex(tex);
        gl.uniform1i(metallicRoughnessTextureLocation3D, TEXTURE_UNIT_METALLIC_ROUGHNESS);
        stateCache.mr = tex;
    }
    const useMR = tex !== null ? 1 : 0;
    if (useMR !== stateCache.useMR) {
        gl.uniform1i(useMetallicRoughnessTextureLocation3D, useMR);
        stateCache.useMR = useMR;
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
function renderInstancedMeshes(gl: WebGL2RenderingContext, instancedGroups: Map<string, { mesh: Mesh; matrices: Float32Array[] }>): void {
    if (instancedGroups.size === 0) return;
    checkWebGLError('mesh.instanced: before setUseInstancing');
    setUseInstancing(gl, true);
    checkWebGLError('mesh.instanced: after setUseInstancing');
    uploadJointPalette(gl, undefined, false);
    checkWebGLError('mesh.instanced: after uploadJointPalette');
    for (const { mesh: m, matrices } of instancedGroups.values()) {
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
        setMeshMaterial(gl, m);
        checkWebGLError('mesh.instanced: after setMeshMaterial');
        setMeshTextures(gl, m);
        checkWebGLError('mesh.instanced: after setMeshTextures');
        if (hasMorph) { const w = new Float32Array(MAX_MORPH_TARGETS); const src = m.morphWeights ?? []; for (let i = 0; i < Math.min(MAX_MORPH_TARGETS, src.length); i++) w[i] = src[i] ?? 0; uploadMorphWeights(gl, w); } else uploadMorphWeights(gl, null);
        checkWebGLError('mesh.instanced: after uploadMorphWeights');
        const __b = getRenderContext().backend as WebGLBackend; __b.bindVertexArray(vao);
        checkWebGLError('mesh.instanced: after bindVertexArray');
        for (let offset = 0; offset < matrices.length; offset += MAX_INSTANCES) {
            const batchCount = Math.min(MAX_INSTANCES, matrices.length - offset);
            for (let i = 0; i < batchCount; i++) instanceScratch.set(matrices[offset + i], i * INSTANCE_STRIDE_FLOATS);
            gl.bindBuffer(gl.ARRAY_BUFFER, instanceMatrixBuffer3D);
            // Buffer was pre-allocated in setupBuffers3D; update contents in place for perf
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceScratch.subarray(0, batchCount * INSTANCE_STRIDE_FLOATS));
            checkWebGLError('mesh.instanced: after bufferSubData');
            // EBO is captured in VAO; no need to rebind per draw when VAO is bound
            const _b = getRenderContext().backend as WebGLBackend; const _pass = { fbo: null, desc: { label: 'meshbatch' } } as any;
            if (CATCH_WEBGL_ERROR) {
                const ebo = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
                if (indexed && !ebo) console.error('Mesh instanced draw: ELEMENT_ARRAY_BUFFER is null while indexed draw expected.');
                if (vertexPositionLocation3D >= 0) {
                    const enabled = gl.getVertexAttrib(vertexPositionLocation3D, gl.VERTEX_ATTRIB_ARRAY_ENABLED) as boolean;
                    if (!enabled) console.error('Mesh instanced draw: position attribute disabled');
                }
                for (const loc of instanceMatrixLocations3D) {
                    if (loc >= 0) {
                        const enabled = gl.getVertexAttrib(loc, gl.VERTEX_ATTRIB_ARRAY_ENABLED) as boolean;
                        const divisor = gl.getVertexAttrib(loc, gl.VERTEX_ATTRIB_ARRAY_DIVISOR) as number;
                        if (!enabled || divisor !== 1) console.error(`Mesh instanced draw: instance attrib ${loc} enabled=${enabled} divisor=${divisor}`);
                    }
                }
                if (indexed) {
                    const bytesPerIndex = (indexType === gl.UNSIGNED_INT) ? 4 : (indexType === gl.UNSIGNED_BYTE ? 1 : 2);
                    const need = indexCount * bytesPerIndex;
                    const have = buffers.indexByteLength ?? 0;
                    if (need > have) console.error(`Mesh instanced draw: index range OOB need=${need} have=${have} type=${indexType}`);
                }
            }
            checkWebGLError('mesh.instanced: before draw');
            if (indexed) _b.drawIndexedInstanced(_pass, indexCount, batchCount, 0, 0, 0, indexType);
            else _b.drawInstanced(_pass, m.vertexCount, batchCount, 0, 0);
            checkWebGLError('mesh.instanced: after draw');
        }
        __b.bindVertexArray(null);
        checkWebGLError('mesh.instanced: after bindVertexArray');
    }
    setUseInstancing(gl, false);
    checkWebGLError('mesh.instanced: after setUseInstancing');
}
function setMeshMaterial(gl: WebGL2RenderingContext, m: Mesh): void { const mat = m.material; gl.uniform4fv(materialColorLocation3D, new Float32Array(mat?.color ?? [1, 1, 1, 1])); gl.uniform1f(metallicFactorLocation3D, mat?.metallicFactor ?? 0.0); gl.uniform1f(roughnessFactorLocation3D, mat?.roughnessFactor ?? 0.0); }
function renderSingleMeshes(gl: WebGL2RenderingContext, singles: DrawMeshOptions[], framebuffer: WebGLFramebuffer): void {
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
        setMeshMaterial(gl, m);
        setMeshTextures(gl, m);
        gl.uniformMatrix4fv(modelLocation3D, false, matrix);
        const normal9 = normal9Pool.ensure(); M4.normal3Into(normal9, matrix); gl.uniformMatrix3fv(normalMatrixLocation3D, false, normal9);
        const __b2 = getRenderContext().backend as WebGLBackend; __b2.bindVertexArray(vao);
        const _b2 = getRenderContext().backend as WebGLBackend; const _p2 = { fbo: framebuffer, desc: { label: 'meshbatch' } } as any;
        // EBO is captured in VAO; avoid redundant bind per draw
        checkWebGLError('mesh.single: before draw');
        if (buffers.index) _b2.drawIndexed(_p2 as any, buffers.indexCount ?? m.indices!.length, 0, buffers.indexType); else _b2.draw(_p2 as any, 0, m.vertexCount);
        checkWebGLError('mesh.single: after draw');
        __b2.bindVertexArray(null);
    }
    normal9Pool.reset();
}
export function renderMeshBatch(gl: WebGL2RenderingContext, framebuffer: WebGLFramebuffer, canvasWidth: number, canvasHeight: number, state?: any): void {
    // Swap to make submissions visible (no legacy fallbacks)
    meshQueue.swap();
    if (meshQueue.sizeFront() === 0) return;
    // Adapt to FeatureQueue API without exposing storage
    const collected: DrawMeshOptions[] = [];
    meshQueue.forEachFront((it) => { collected.push(it); });
    const { instancedGroups, singles } = cullAndSortMeshes(collected);
    setupViewport(gl, canvasWidth, canvasHeight);
    setupRenderingState(gl, state);
    renderInstancedMeshes(gl, instancedGroups);
    renderSingleMeshes(gl, singles, framebuffer);
    // FeatureQueue back buffer cleared on swap; nothing else to do
}

export function submitMesh(o: DrawMeshOptions): void { meshQueue.submit({ ...o }); }
export function reset(_gl: WebGL2RenderingContext): void { normal9Pool.reset(); clearLights(); }
export function getMeshQueueDebug(): { front: number; back: number } { return { front: meshQueue.sizeFront(), back: meshQueue.sizeBack() }; }

export function registerMeshBatchPass_WebGL(registry: PipelineRegistry, pm: GraphicsPipelineManager<any>) {
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
            const cam = $.model.activeCamera3D;
            if (!cam) return;
            const frameShared = pm.getState('frame_shared');
            const fogStateHolder = pm.getState('fog');
            let fog = fogStateHolder?.fog as FogUniforms | undefined;
            if (!fog) {
                const density = (() => {
                    const p = Atmosphere.progressFactor;
                    const anim = Atmosphere.enableAutoAnimation ? (0.5 - 0.5 * Math.cos(p * 6.28318530718)) : 0.0;
                    return Atmosphere.baseFogDensity + Atmosphere.dynamicFogDensity * anim;
                })();
                fog = {
                    fogColor: Atmosphere.fogColor,
                    fogDensity: density,
                    enableFog: Atmosphere.enableFog,
                    fogMode: Atmosphere.fogMode,
                    enableHeightFog: Atmosphere.enableHeightFog,
                    heightFogStart: Atmosphere.heightFogStart,
                    heightFogEnd: Atmosphere.heightFogEnd,
                    heightLowColor: Atmosphere.heightLowColor,
                    heightHighColor: Atmosphere.heightHighColor,
                    heightMin: Atmosphere.heightMin,
                    heightMax: Atmosphere.heightMax,
                    enableHeightGradient: Atmosphere.enableHeightGradient,
                };
            }
            const meshState: MeshBatchPipelineState = {
                width,
                height,
                camPos: cam.position,
                viewProj: cam.viewProjection,
                fog,
                lighting: frameShared ? frameShared.lighting : undefined,
            };
            registry.setState('meshbatch', meshState);
            registry.validatePassResources('meshbatch', backend);
        },
    });
}
