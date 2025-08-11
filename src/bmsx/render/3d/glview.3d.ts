import type { Mesh } from '../../core/mesh';
import type { Size, vec3arr } from '../../rompack/rompack';
import { Identifier } from '../../rompack/rompack';
import { glCreateBuffer, glCreateElementBuffer, glLoadShader, glSwitchProgram } from '../glutils';
import { MAX_DIR_LIGHTS, MAX_POINT_LIGHTS } from '../glview.constants';
import { checkWebGLError, getFramebufferStatusString } from '../glview.helpers';
import { DrawMeshOptions } from '../view';
import type { AmbientLight, DirectionalLight, PointLight } from './light';
import { bmat } from './math3d';
import fragShader3DCode from './shaders/3d.frag.glsl';
import vertexShader3DCode from './shaders/3d.vert.glsl';

export let meshesToDraw: DrawMeshOptions[] = [];
let lightsDirty: boolean = true;

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
	vao?: WebGLVertexArrayObject;            // non-instanced
	vaoInstanced?: WebGLVertexArrayObject;   // instanced
	vaoSig?: string;
	vaoInstancedSig?: string;
	indexType?: GLenum;
	indexCount?: number;
}

const meshBufferCache = new WeakMap<Mesh, MeshBuffers>();

// instancing upload helpers
const MAX_INSTANCES = 64;
const INSTANCE_STRIDE_BYTES = 64; // 4 vec4
let instanceScratch = new Float32Array(MAX_INSTANCES * 16);

// per-frame caches
let normalMatCache = new WeakMap<Float32Array, Float32Array>();

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
let dirLightDirectionLocation3D: WebGLUniformLocation;
let dirLightColorLocation3D: WebGLUniformLocation;
let dirLightIntensityLocation3D: WebGLUniformLocation;
let numDirLightsLocation3D: WebGLUniformLocation;
let pointLightPositionLocation3D: WebGLUniformLocation;
let pointLightColorLocation3D: WebGLUniformLocation;
let pointLightRangeLocation3D: WebGLUniformLocation;
let pointLightIntensityLocation3D: WebGLUniformLocation;
let numPointLightsLocation3D: WebGLUniformLocation;
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
const MAX_MORPH_TARGETS = 2;
const MAX_JOINTS = 32;
const jointMatrixArray = new Float32Array(MAX_JOINTS * 16);
const identityMatrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

let lastSkinningEnabled = false;
const lastJointMatrixArray = new Float32Array(MAX_JOINTS * 16);

const zeroMorphWeights = new Float32Array(MAX_MORPH_TARGETS);
let lastMorphEnabled = false;
const lastMorphWeightArray = new Float32Array(MAX_MORPH_TARGETS);

let lastUseInstancing = -1;

function arraysEqual(a: Float32Array, b: Float32Array): boolean {
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

function setUseInstancing(gl: WebGL2RenderingContext, enabled: boolean): void {
	const val = enabled ? 1 : 0;
	if (lastUseInstancing !== val) {
		gl.uniform1i(useInstancingLocation3D, val);
		lastUseInstancing = val;
	}
}

function uploadJointPalette(gl: WebGL2RenderingContext, joints: Float32Array[] | undefined, hasSkinning: boolean): void {
	if (hasSkinning && joints) {
		jointMatrixArray.fill(0);
		jointMatrixArray.set(identityMatrix, 0);
		for (let i = 0; i < joints.length && i < MAX_JOINTS; i++) jointMatrixArray.set(joints[i], i * 16);
		if (!lastSkinningEnabled || !arraysEqual(jointMatrixArray, lastJointMatrixArray)) {
			gl.uniformMatrix4fv(jointMatrixLocation3D, false, jointMatrixArray);
			lastSkinningEnabled = true;
			lastJointMatrixArray.set(jointMatrixArray);
		}
	} else if (lastSkinningEnabled) {
		jointMatrixArray.fill(0);
		jointMatrixArray.set(identityMatrix, 0);
		gl.uniformMatrix4fv(jointMatrixLocation3D, false, jointMatrixArray);
		lastSkinningEnabled = false;
		lastJointMatrixArray.set(jointMatrixArray);
	}
}

function uploadMorphWeights(gl: WebGL2RenderingContext, weights: Float32Array | null): void {
	if (weights) {
		if (!lastMorphEnabled || !arraysEqual(weights, lastMorphWeightArray)) {
			gl.uniform1fv(morphWeightLocation3D, weights);
			lastMorphEnabled = true;
			lastMorphWeightArray.set(weights);
		}
	} else if (lastMorphEnabled) {
		gl.uniform1fv(morphWeightLocation3D, zeroMorphWeights);
		lastMorphEnabled = false;
		lastMorphWeightArray.set(zeroMorphWeights);
	}
}

function getVAOSignature(m: Mesh, instanced: boolean): string {
	const tangentSize = m.tangents ? (m.tangents.length === m.vertexCount * 4 ? 4 : 3) : 0;
	return [
		m.hasTexcoords ? 1 : 0,
		m.hasNormals ? 1 : 0,
		tangentSize,
		m.hasSkinning ? 1 : 0,
		m.hasMorphTargets ? 1 : 0,
		instanced ? 1 : 0,
	].join(',');
}
const TEXTURE_UNIT_ALBEDO = 3;
const TEXTURE_UNIT_NORMAL = 4;
const TEXTURE_UNIT_METALLIC_ROUGHNESS = 5;
export const TEXTURE_UNIT_SHADOW_MAP = 6;

function getMeshBuffers(gl: WebGL2RenderingContext, m: Mesh): MeshBuffers {
	let buffers = meshBufferCache.get(m);
	if (buffers) return buffers;

	buffers = { vertex: glCreateBuffer(gl) };

	// Vertex positions
	gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vertex);
	gl.bufferData(gl.ARRAY_BUFFER, m.positions, gl.STATIC_DRAW);

	// Optional attributes
	if (m.hasTexcoords) {
		buffers.texcoord = glCreateBuffer(gl);
		gl.bindBuffer(gl.ARRAY_BUFFER, buffers.texcoord);
		gl.bufferData(gl.ARRAY_BUFFER, m.texcoords, gl.STATIC_DRAW);
	}

	if (m.hasNormals) {
		buffers.normal = glCreateBuffer(gl);
		gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal);
		gl.bufferData(gl.ARRAY_BUFFER, m.normals!, gl.STATIC_DRAW);
	}

	if (m.hasTangents) {
		buffers.tangent = glCreateBuffer(gl);
		gl.bindBuffer(gl.ARRAY_BUFFER, buffers.tangent);
		gl.bufferData(gl.ARRAY_BUFFER, m.tangents!, gl.STATIC_DRAW);
	}

	if (m.indices) {
		buffers.index = glCreateElementBuffer(gl);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
		buffers.indexCount = m.indices.length;
		buffers.indexType = (m.indices instanceof Uint32Array) ? gl.UNSIGNED_INT :
			(m.indices instanceof Uint8Array) ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT;
	}

	if (m.hasSkinning) {
		buffers.joint = glCreateBuffer(gl);
		gl.bindBuffer(gl.ARRAY_BUFFER, buffers.joint);
		gl.bufferData(gl.ARRAY_BUFFER, m.jointIndices!, gl.STATIC_DRAW);

		buffers.weight = glCreateBuffer(gl);
		gl.bindBuffer(gl.ARRAY_BUFFER, buffers.weight);
		gl.bufferData(gl.ARRAY_BUFFER, m.jointWeights!, gl.STATIC_DRAW);
	}

	if (m.hasMorphTargets) {
		buffers.morphPositions = [];
		buffers.morphNormals = [];
		buffers.morphTangents = [];
		for (let i = 0; i < Math.min(m.morphPositions!.length, MAX_MORPH_TARGETS); i++) {
			const pos = m.morphPositions![i];
			const posBuf = glCreateBuffer(gl);
			gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
			gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
			buffers.morphPositions.push(posBuf);

			if (m.morphNormals && m.morphNormals[i]) {
				const normBuf = glCreateBuffer(gl);
				gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
				gl.bufferData(gl.ARRAY_BUFFER, m.morphNormals[i]!, gl.STATIC_DRAW);
				buffers.morphNormals.push(normBuf);
			} else {
				buffers.morphNormals.push(undefined);
			}

			if (m.morphTangents && m.morphTangents[i]) {
				const tanBuf = glCreateBuffer(gl);
				gl.bindBuffer(gl.ARRAY_BUFFER, tanBuf);
				gl.bufferData(gl.ARRAY_BUFFER, m.morphTangents[i]!, gl.STATIC_DRAW);
				buffers.morphTangents.push(tanBuf);
			} else {
				buffers.morphTangents.push(undefined);
			}
		}
	}

	meshBufferCache.set(m, buffers);
	return buffers;
}

export function init(gl: WebGL2RenderingContext, offscreenCanvasSize: Size): void {
}

export function handleResize(gl: WebGL2RenderingContext, width: number, height: number): void {
	gl.viewport(0, 0, width, height);
	// Update aspect ratio of all cameras
	if ($.model.cameras) {
		$.model.cameras.forEach(cameraObject => cameraObject.camera.setAspect(width / height));
	}
}

export function setAmbientLight(gl: WebGL2RenderingContext, light: AmbientLight): void {
	gl.useProgram(gameShaderProgram3D);
	gl.uniform3fv(ambientColorLocation3D, new Float32Array(light.color));
	gl.uniform1f(ambientIntensityLocation3D, light.intensity);
}

export function uploadDirectionalLights(gl: WebGL2RenderingContext): void {
	const lights = Array.from(directionalLights.values());
	const count = Math.min(lights.length, MAX_DIR_LIGHTS);
	const dirs = new Float32Array(MAX_DIR_LIGHTS * 3);
	const cols = new Float32Array(MAX_DIR_LIGHTS * 3);
	const intens = new Float32Array(MAX_DIR_LIGHTS);
	for (let i = 0; i < count; i++) {
		dirs.set(lights[i].orientation, i * 3);
		cols.set(lights[i].color, i * 3);
		intens[i] = lights[i].intensity;
	}
	gl.useProgram(gameShaderProgram3D);
	gl.uniform1i(numDirLightsLocation3D, count);
	gl.uniform3fv(dirLightDirectionLocation3D, dirs);
	gl.uniform3fv(dirLightColorLocation3D, cols);
	gl.uniform1fv(dirLightIntensityLocation3D, intens);
}

export function uploadPointLights(gl: WebGL2RenderingContext): void {
	const lights = Array.from(pointLights.values());
	const count = Math.min(lights.length, MAX_POINT_LIGHTS);
	const pos = new Float32Array(MAX_POINT_LIGHTS * 3);
	const col = new Float32Array(MAX_POINT_LIGHTS * 3);
	const range = new Float32Array(MAX_POINT_LIGHTS);
	const intens = new Float32Array(MAX_POINT_LIGHTS);
	for (let i = 0; i < count; i++) {
		pos.set(lights[i].pos, i * 3);
		col.set(lights[i].color, i * 3);
		range[i] = lights[i].range;
		intens[i] = lights[i].intensity;
	}
	gl.useProgram(gameShaderProgram3D);
	gl.uniform1i(numPointLightsLocation3D, count);
	gl.uniform3fv(pointLightPositionLocation3D, pos);
	gl.uniform3fv(pointLightColorLocation3D, col);
	gl.uniform1fv(pointLightRangeLocation3D, range);
	gl.uniform1fv(pointLightIntensityLocation3D, intens);
	lightsDirty = true;
}

export function addDirectionalLight(gl: WebGL2RenderingContext, id: Identifier, light: DirectionalLight): void {
	directionalLights.set(id, { type: 'directional', color: light.color, intensity: light.intensity, orientation: light.orientation });
	uploadDirectionalLights(gl);
}

export function removeDirectionalLight(gl: WebGL2RenderingContext, id: string): void {
	if (directionalLights.delete(id)) uploadDirectionalLights(gl);
}

export function addPointLight(gl: WebGL2RenderingContext, id: Identifier, light: PointLight): void {
	if (!light.pos) throw new Error('Point light must have a position');
	if (!light.color) throw new Error('Point light must have a color');
	if (light.range === undefined) throw new Error('Point light must have a range');

	pointLights.set(id, { ...light, type: 'point' });
	uploadPointLights(gl);
}

export function removePointLight(gl: WebGL2RenderingContext, id: string): void {
	if (pointLights.delete(id)) uploadPointLights(gl);
}

export function getPointLight(id: string): PointLight | undefined {
	return pointLights.get(id);
}

export function clearLights(gl: WebGL2RenderingContext): void {
	directionalLights.clear();
	pointLights.clear();
	uploadDirectionalLights(gl);
	uploadPointLights(gl);
}

export function setDefaultUniformValues(gl: WebGL2RenderingContext, defaultScale: number): void {
	gl.useProgram(gameShaderProgram3D);
	checkWebGLError('after useProgram');

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
	checkWebGLError('after shadow uniforms');
	gl.uniform1i(albedoTextureLocation3D, TEXTURE_UNIT_ALBEDO);
	gl.uniform1i(normalTextureLocation3D, TEXTURE_UNIT_NORMAL);
	gl.uniform1i(metallicRoughnessTextureLocation3D, TEXTURE_UNIT_METALLIC_ROUGHNESS);
	gl.uniform1i(shadowMapLocation3D, TEXTURE_UNIT_SHADOW_MAP);
	checkWebGLError('after texture uniforms');
	gl.uniformMatrix4fv(viewProjectionLocation3D, false, identityMatrix);
	setUseInstancing(gl, false);
	jointMatrixArray.fill(0); jointMatrixArray.set(identityMatrix, 0);
	gl.uniformMatrix4fv(jointMatrixLocation3D, false, jointMatrixArray);
	lastJointMatrixArray.set(jointMatrixArray); lastSkinningEnabled = false;
	gl.uniform1fv(morphWeightLocation3D, zeroMorphWeights);
	lastMorphWeightArray.set(zeroMorphWeights); lastMorphEnabled = false;
	checkWebGLError('after other uniform values');
}

export function setupBuffers3D(gl: WebGL2RenderingContext): void {
	instanceMatrixBuffer3D = glCreateBuffer(gl);
	// éénmalig, max capaciteit
	gl.bindBuffer(gl.ARRAY_BUFFER, instanceMatrixBuffer3D);
	gl.bufferData(gl.ARRAY_BUFFER, MAX_INSTANCES * INSTANCE_STRIDE_BYTES, gl.DYNAMIC_DRAW);

	morphPositionBuffers3D = [
		glCreateBuffer(gl), glCreateBuffer(gl)
	];
	morphNormalBuffers3D = [
		glCreateBuffer(gl), glCreateBuffer(gl)
	];
	morphTangentBuffers3D = [
		glCreateBuffer(gl), glCreateBuffer(gl)
	];
	// When creating initial buffers in setupBuffers3D
	const dummyMorphData = new Float32Array(24); // 8 vertices * 3 componentsR
	// Repeat for all morph buffers
	for (let i = 0; i < MAX_MORPH_TARGETS; i++) {
		gl.bindBuffer(gl.ARRAY_BUFFER, morphPositionBuffers3D[i]);
		gl.bufferData(gl.ARRAY_BUFFER, dummyMorphData, gl.STATIC_DRAW);
		gl.bindBuffer(gl.ARRAY_BUFFER, morphNormalBuffers3D[i]);
		gl.bufferData(gl.ARRAY_BUFFER, dummyMorphData, gl.STATIC_DRAW);
		gl.bindBuffer(gl.ARRAY_BUFFER, morphTangentBuffers3D[i]);
		gl.bufferData(gl.ARRAY_BUFFER, dummyMorphData, gl.STATIC_DRAW);
	}

	// Alleen allocatie, geen attrib pointer/divisor hier!
	gl.bindBuffer(gl.ARRAY_BUFFER, instanceMatrixBuffer3D);
	gl.bufferData(gl.ARRAY_BUFFER, MAX_INSTANCES * 16 * 4, gl.DYNAMIC_DRAW);
}

export function createGameShaderPrograms3D(gl: WebGL2RenderingContext): void {
	const program = gl.createProgram();
	if (!program) throw Error('Failed to create 3D GLSL program');
	gameShaderProgram3D = program;
	const vertShader = glLoadShader(gl, gl.VERTEX_SHADER, vertexShader3DCode);
	const fragShader = glLoadShader(gl, gl.FRAGMENT_SHADER, fragShader3DCode);
	gl.attachShader(program, vertShader);
	gl.attachShader(program, fragShader);

	gl.linkProgram(program);
	gl.validateProgram(program);
	if (!gl.getProgramParameter(program, gl.VALIDATE_STATUS)) {
		throw Error(`Invalid 3D GLSL program: ${gl.getProgramInfoLog(program)}`);
	}
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		throw Error(`Unable to initialize the 3D shader program: ${gl.getProgramInfoLog(program)} `);
	}
}

export function setupVertexShaderLocations3D(gl: WebGL2RenderingContext): void {
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
	dirLightDirectionLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_dirLightDirection[0]')!;
	dirLightColorLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_dirLightColor[0]')!;
	dirLightIntensityLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_dirLightIntensity[0]')!;
	numDirLightsLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_numDirLights')!;
	pointLightPositionLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_pointLightPosition[0]')!;
	pointLightColorLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_pointLightColor[0]')!;
	pointLightRangeLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_pointLightRange[0]')!;
	pointLightIntensityLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_pointLightIntensity[0]')!;
	numPointLightsLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_numPointLights')!;
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
}

function buildVAOForMesh(gl: WebGL2RenderingContext, m: Mesh, buffers: MeshBuffers, instanced: boolean): WebGLVertexArrayObject {
	const vao = gl.createVertexArray()!;
	gl.bindVertexArray(vao);

	// basis attributen
	if (buffers.vertex && vertexPositionLocation3D >= 0) {
		gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vertex);
		gl.vertexAttribPointer(vertexPositionLocation3D, 3, gl.FLOAT, false, 0, 0);
		gl.enableVertexAttribArray(vertexPositionLocation3D);
	}

	if (buffers.texcoord && texcoordLocation3D >= 0) {
		gl.bindBuffer(gl.ARRAY_BUFFER, buffers.texcoord);
		gl.vertexAttribPointer(texcoordLocation3D, 2, gl.FLOAT, false, 0, 0);
		gl.enableVertexAttribArray(texcoordLocation3D);
	}
	else {
		gl.disableVertexAttribArray(texcoordLocation3D);
		gl.vertexAttrib2f(texcoordLocation3D, 0, 0);
	}

	if (buffers.normal && normalLocation3D >= 0) {
		gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal);
		gl.vertexAttribPointer(normalLocation3D, 3, gl.FLOAT, false, 0, 0);
		gl.enableVertexAttribArray(normalLocation3D);
	} else {
		gl.disableVertexAttribArray(normalLocation3D);
		gl.vertexAttrib3f(normalLocation3D, 0, 0, 1);   // <-- cruciaal
	}

	if (buffers.tangent && tangentLocation3D >= 0) {
		gl.bindBuffer(gl.ARRAY_BUFFER, buffers.tangent);
		const hasVec4 =
			m.tangents && m.tangents.length === m.vertexCount * 4;
		const size = hasVec4 ? 4 : 3;           // <-- verschil
		gl.vertexAttribPointer(tangentLocation3D, size, gl.FLOAT, false, 0, 0);
		gl.enableVertexAttribArray(tangentLocation3D);
	} else {
		gl.disableVertexAttribArray(tangentLocation3D);
		gl.vertexAttrib4f(tangentLocation3D, 1, 0, 0, 1); // arbitraire tangent + handedness
	}

	// skinning
	if (m.hasSkinning && buffers.joint && buffers.weight) {
		if (jointLocation3D >= 0) {
			gl.bindBuffer(gl.ARRAY_BUFFER, buffers.joint);
			gl.vertexAttribIPointer(jointLocation3D, 4, gl.UNSIGNED_SHORT, 0, 0);
			gl.enableVertexAttribArray(jointLocation3D);
		}
		if (weightLocation3D >= 0) {
			gl.bindBuffer(gl.ARRAY_BUFFER, buffers.weight);
			gl.vertexAttribPointer(weightLocation3D, 4, gl.FLOAT, false, 0, 0);
			gl.enableVertexAttribArray(weightLocation3D);
		}
	}
	else {
		if (jointLocation3D >= 0) { gl.disableVertexAttribArray(jointLocation3D); gl.vertexAttribI4ui(jointLocation3D, 0, 0, 0, 0); }
		if (weightLocation3D >= 0) { gl.disableVertexAttribArray(weightLocation3D); gl.vertexAttrib4f(weightLocation3D, 1, 0, 0, 0); }
	}

	// morph targets (alleen pointers; weights zijn uniform)
	if (m.hasMorphTargets && buffers.morphPositions) {
		for (let i = 0; i < Math.min(MAX_MORPH_TARGETS, buffers.morphPositions.length); i++) {
			const pLoc = morphPositionLocations3D[i]; const nLoc = morphNormalLocations3D[i]; const tLoc = morphTangentLocations3D[i];
			const pBuf = buffers.morphPositions[i]; const nBuf = buffers.morphNormals?.[i]; const tBuf = buffers.morphTangents?.[i];
			if (pBuf && pLoc >= 0) { gl.bindBuffer(gl.ARRAY_BUFFER, pBuf); gl.vertexAttribPointer(pLoc, 3, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(pLoc); }
			if (nBuf && nLoc >= 0) { gl.bindBuffer(gl.ARRAY_BUFFER, nBuf); gl.vertexAttribPointer(nLoc, 3, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(nLoc); }
			if (tBuf && tLoc >= 0) { gl.bindBuffer(gl.ARRAY_BUFFER, tBuf); gl.vertexAttribPointer(tLoc, 3, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(tLoc); }
		}
	}

	// index
	if (buffers.index) {
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
	}

	// instancing attribs
	if (instanced) {
		const locs = instanceMatrixLocations3D;
		gl.bindBuffer(gl.ARRAY_BUFFER, instanceMatrixBuffer3D);
		for (let i = 0; i < 4; i++) {
			const loc = locs[i];
			if (loc >= 0) {
				gl.enableVertexAttribArray(loc);
				gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, INSTANCE_STRIDE_BYTES, i * 16);
				gl.vertexAttribDivisor(loc, 1);
			}
		}
	}

	// idem voor morph pos/norm/tan -> set to 0
	gl.bindVertexArray(null);
	return vao;
}

function cullAndSortMeshes(): { instancedGroups: Map<string, { mesh: Mesh; matrices: Float32Array[] }>; singles: DrawMeshOptions[] } {
	if (meshesToDraw.length === 0) return { instancedGroups: new Map(), singles: [] };

	const activeCamera = $.model.activeCamera3D;
	activeCamera.viewProjectionMatrix; // ensure frustum planes are up to date

	// Frustum culling
	meshesToDraw = meshesToDraw.filter(({ mesh: m, matrix }) => {
		if (m.boundingRadius === 0) return true;
		const cx = matrix[12] + m.boundingCenter[0] * matrix[0] + m.boundingCenter[1] * matrix[4] + m.boundingCenter[2] * matrix[8];
		const cy = matrix[13] + m.boundingCenter[0] * matrix[1] + m.boundingCenter[1] * matrix[5] + m.boundingCenter[2] * matrix[9];
		const cz = matrix[14] + m.boundingCenter[0] * matrix[2] + m.boundingCenter[1] * matrix[6] + m.boundingCenter[2] * matrix[10];
		const scaleX = Math.hypot(matrix[0], matrix[1], matrix[2]);
		const scaleY = Math.hypot(matrix[4], matrix[5], matrix[6]);
		const scaleZ = Math.hypot(matrix[8], matrix[9], matrix[10]);
		const radius = m.boundingRadius * Math.max(scaleX, scaleY, scaleZ);
		return activeCamera.isSphereInFrustum([cx, cy, cz] as vec3arr, radius);
	});

	// Sort by material signature and distance
	const camPos = activeCamera.position;
	const dist = (mat: Float32Array) => {
		const dx = mat[12] - camPos.x;
		const dy = mat[13] - camPos.y;
		const dz = mat[14] - camPos.z;
		return dx * dx + dy * dy + dz * dz;
	};
	meshesToDraw.sort((a, b) => {
		const sa = a.mesh.materialSignature;
		const sb = b.mesh.materialSignature;
		if (sa !== sb) return sa < sb ? -1 : 1;
		return dist(a.matrix) - dist(b.matrix);
	});

	// Separate static meshes for instancing
	const instancedGroups = new Map<string, { mesh: Mesh; matrices: Float32Array[] }>();
	const singles: DrawMeshOptions[] = [];
	for (const entry of meshesToDraw) {
		const m = entry.mesh;
		if (!m.hasSkinning && !m.hasMorphTargets) {
			const key = `G:${m.name}|${m.materialSignature}`;

			let group = instancedGroups.get(key);
			if (!group) {
				group = { mesh: m, matrices: [] };
				instancedGroups.set(key, group);
			}
			group.matrices.push(entry.matrix);
		} else {
			singles.push(entry);
		}
	}

	return { instancedGroups, singles };
}

function setupFramebufferAndViewport(gl: WebGL2RenderingContext, framebuffer: WebGLFramebuffer, canvasWidth: number, canvasHeight: number): void {
	checkWebGLError("Before binding framebuffer and setting viewport");
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.viewport(0, 0, canvasWidth, canvasHeight);
	const fbStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
	if (fbStatus !== gl.FRAMEBUFFER_COMPLETE) {
		console.warn(`renderMeshBatch: framebuffer incomplete - ${getFramebufferStatusString(gl, fbStatus)}`);
	}
	checkWebGLError("After binding framebuffer and setting viewport");
}

function setupRenderingState(gl: WebGL2RenderingContext): void {
	glSwitchProgram(gl, gameShaderProgram3D);

	// Alleen camera / viewProjection per frame
	const activeCamera = $.model.activeCamera3D;
	gl.uniform3fv(cameraPositionLocation3D, new Float32Array([activeCamera.position.x, activeCamera.position.y, activeCamera.position.z]));
	gl.uniformMatrix4fv(viewProjectionLocation3D, false, activeCamera.viewProjectionMatrix);
	setUseInstancing(gl, false);

	if (lightsDirty) {
		setAmbientLight(gl, $.model.ambientLight.light as AmbientLight);
		uploadDirectionalLights(gl);
		uploadPointLights(gl);
		lightsDirty = false;
	}
	// GEEN: uploadDirectionalLights/uploadPointLights hier (alleen bij wijziging aanroepen)
	// GEEN: disable alle attribs; VAO regelt dit.
}

function setMeshTextures(gl: WebGL2RenderingContext, m: Mesh): void {
	// Albedo
	let tex = m.gpuTextureAlbedo ? $.texmanager.getTexture(m.gpuTextureAlbedo) : null;
	if (tex !== stateCache.albedo) {
		gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_ALBEDO);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.uniform1i(albedoTextureLocation3D, TEXTURE_UNIT_ALBEDO);
		stateCache.albedo = tex;
	}
	const useAlbedo = tex !== null ? 1 : 0;
	if (useAlbedo !== stateCache.useAlbedo) {
		gl.uniform1i(useAlbedoTextureLocation3D, useAlbedo);
		stateCache.useAlbedo = useAlbedo;
	}

	// Normal
	tex = m.gpuTextureNormal ? $.texmanager.getTexture(m.gpuTextureNormal) : null;
	if (tex !== stateCache.normal) {
		gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_NORMAL);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.uniform1i(normalTextureLocation3D, TEXTURE_UNIT_NORMAL);
		stateCache.normal = tex;
	}
	const useNormal = tex !== null ? 1 : 0;
	if (useNormal !== stateCache.useNormal) {
		gl.uniform1i(useNormalTextureLocation3D, useNormal);
		stateCache.useNormal = useNormal;
	}

	// MetallicRoughness
	tex = m.gpuTextureMetallicRoughness ? $.texmanager.getTexture(m.gpuTextureMetallicRoughness) : null;
	if (tex !== stateCache.mr) {
		gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_METALLIC_ROUGHNESS);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.uniform1i(metallicRoughnessTextureLocation3D, TEXTURE_UNIT_METALLIC_ROUGHNESS);
		stateCache.mr = tex;
	}
	const useMR = tex !== null ? 1 : 0;
	if (useMR !== stateCache.useMR) {
		gl.uniform1i(useMetallicRoughnessTextureLocation3D, useMR);
		stateCache.useMR = useMR;
	}

	// Shadow (geen cache; vaak mesh-specifiek)
	if (m.shadow) {
		gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_SHADOW_MAP);
		gl.bindTexture(gl.TEXTURE_2D, m.shadow.map.texture);
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
	setUseInstancing(gl, true);
	uploadJointPalette(gl, undefined, false);

	for (const { mesh: m, matrices } of instancedGroups.values()) {
		const buffers = getMeshBuffers(gl, m);
		const sig = getVAOSignature(m, true);
		if (buffers.vaoInstancedSig !== sig) {
			if (buffers.vaoInstanced) gl.deleteVertexArray(buffers.vaoInstanced);
			buffers.vaoInstanced = buildVAOForMesh(gl, m, buffers, true);
			buffers.vaoInstancedSig = sig;
		}

		// index info (cached)
		const indexed = !!buffers.index;
		const indexType = buffers.indexType!;
		const indexCount = buffers.indexCount ?? m.indices?.length ?? 0;

		// materiaal / textures
		setMeshMaterial(gl, m);
		setMeshTextures(gl, m);

		// morph defaults
		if (m.hasMorphTargets) {
			const w = new Float32Array(MAX_MORPH_TARGETS);
			const src = m.morphWeights ?? [];
			for (let i = 0; i < Math.min(MAX_MORPH_TARGETS, src.length); i++) w[i] = src[i] ?? 0;
			uploadMorphWeights(gl, w);
		} else {
			uploadMorphWeights(gl, null);
		}

		gl.bindVertexArray(buffers.vaoInstanced!);
		for (let offset = 0; offset < matrices.length; offset += MAX_INSTANCES) {
			const batchCount = Math.min(MAX_INSTANCES, matrices.length - offset);
			// schrijf alleen de benodigde floats aan het begin van het al-gealloceerde buffer
			for (let i = 0; i < batchCount; i++) instanceScratch.set(matrices[offset + i], i * 16);
			gl.bindBuffer(gl.ARRAY_BUFFER, instanceMatrixBuffer3D);
			gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceScratch.subarray(0, batchCount * 16));
			if (indexed) gl.drawElementsInstanced(gl.TRIANGLES, indexCount, indexType, 0, batchCount);
			else gl.drawArraysInstanced(gl.TRIANGLES, 0, m.vertexCount, batchCount);
		}
		gl.bindVertexArray(null);
	}
	setUseInstancing(gl, false);
}


function setMeshMaterial(gl: WebGL2RenderingContext, m: Mesh): void {
	const mat = m.material;
	gl.uniform4fv(materialColorLocation3D, new Float32Array(mat?.color ?? [1, 1, 1, 1]));
	gl.uniform1f(metallicFactorLocation3D, mat?.metallicFactor ?? 0.0);
	gl.uniform1f(roughnessFactorLocation3D, mat?.roughnessFactor ?? 0.0);
}

function renderSingleMeshes(gl: WebGL2RenderingContext, singles: DrawMeshOptions[], framebuffer: WebGLFramebuffer): void {
	setUseInstancing(gl, false);
	for (const { mesh: m, matrix, jointMatrices, morphWeights } of singles) {
		const buffers = getMeshBuffers(gl, m);

		const sig = getVAOSignature(m, false);
		if (buffers.vaoSig !== sig) {
			if (buffers.vao) gl.deleteVertexArray(buffers.vao);
			buffers.vao = buildVAOForMesh(gl, m, buffers, false);
			buffers.vaoSig = sig;
		}

		// skinning uniform
		uploadJointPalette(gl, jointMatrices, m.hasSkinning);

		// morph weights
		if (m.hasMorphTargets) {
			const w = new Float32Array(MAX_MORPH_TARGETS);
			const src = morphWeights ?? m.morphWeights ?? [];
			for (let i = 0; i < Math.min(MAX_MORPH_TARGETS, src.length); i++) w[i] = src[i] ?? 0;
			uploadMorphWeights(gl, w);
		} else {
			uploadMorphWeights(gl, null);
		}

		// materiaal & textures
		setMeshMaterial(gl, m);
		setMeshTextures(gl, m);

		// transforms (normal-matrix cache per-frame op matrix-object)
		let nrm = normalMatCache.get(matrix);
		if (!nrm) { nrm = bmat.normalMatrix(matrix); normalMatCache.set(matrix, nrm); }
		gl.uniformMatrix4fv(modelLocation3D, false, matrix);
		gl.uniformMatrix3fv(normalMatrixLocation3D, false, nrm);

		// draw
		gl.bindVertexArray(buffers.vao!);
		if (buffers.index) {
			gl.drawElements(gl.TRIANGLES, buffers.indexCount ?? m.indices!.length, buffers.indexType!, 0);
		} else {
			gl.drawArrays(gl.TRIANGLES, 0, m.vertexCount);
		}
		gl.bindVertexArray(null);
	}
}

export function renderMeshBatch(gl: WebGL2RenderingContext, framebuffer: WebGLFramebuffer, canvasWidth: number, canvasHeight: number): void {
	normalMatCache = new WeakMap();
	const { instancedGroups, singles } = cullAndSortMeshes();
	if (instancedGroups.size === 0 && singles.length === 0) return;

	setupFramebufferAndViewport(gl, framebuffer, canvasWidth, canvasHeight);
	setupRenderingState(gl);
	checkWebGLError(`After rendering state setup`);

	renderInstancedMeshes(gl, instancedGroups);
	renderSingleMeshes(gl, singles, framebuffer);

	meshesToDraw = [];
}
