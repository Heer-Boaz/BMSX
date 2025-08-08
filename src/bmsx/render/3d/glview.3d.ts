import type { Mesh } from '../../core/mesh';
import type { Size, vec3, vec3arr } from '../../rompack/rompack';
import { Identifier } from '../../rompack/rompack';
import { glCreateBuffer, glCreateElementBuffer, glLoadShader, glSetupAttributeFloat, glSetupAttributeInt, glSwitchProgram } from '../glutils';
import { MAX_DIR_LIGHTS, MAX_POINT_LIGHTS } from '../glview.constants';
import { checkWebGLError, generateDetailedDrawError, getFramebufferStatusString } from '../glview.helpers';
import { BaseView, DrawMeshOptions } from '../view';
import { Camera3D } from './camera3d';
import type { AmbientLight, DirectionalLight, PointLight } from './light';
import { bmat } from './math3d';
import gameShader3DCode from './shaders/3d.frag.glsl';
import vertexShader3DCode from './shaders/3d.vert.glsl';
import skyboxFragCode from './shaders/skybox.frag.glsl';
import skyboxVertCode from './shaders/skybox.vert.glsl';

export const camera = new Camera3D();
export let meshesToDraw: DrawMeshOptions[] = [];

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
}

const meshBufferCache = new WeakMap<Mesh, MeshBuffers>();

const directionalLights: Map<string, DirectionalLight> = new Map();
const pointLights: Map<string, PointLight> = new Map();

let gameShaderProgram3D: WebGLProgram;
let vertexPositionLocation3D: number;
let texcoordLocation3D: number;
let normalLocation3D: number;
let tangentLocation3D: number;
let mvpLocation3D: WebGLUniformLocation;
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
let gl3D: WebGL2RenderingContext | null = null;
let vertexBuffer3D: WebGLBuffer;
let texcoordBuffer3D: WebGLBuffer;
let normalBuffer3D: WebGLBuffer;
let tangentBuffer3D: WebGLBuffer;
let indexBuffer3D: WebGLBuffer;
let morphPositionBuffers3D: WebGLBuffer[];
let morphNormalBuffers3D: WebGLBuffer[];
let morphTangentBuffers3D: WebGLBuffer[];
let morphPositionLocations3D: number[];
let morphNormalLocations3D: number[];
let morphTangentLocations3D: number[];
let morphWeightLocation3D: WebGLUniformLocation;
const MAX_MORPH_TARGETS = 2;
let jointBuffer3D: WebGLBuffer;
let weightBuffer3D: WebGLBuffer;
let jointLocation3D: number;
let weightLocation3D: number;
let jointMatrixLocation3D: WebGLUniformLocation;
let instanceMatrixBuffer3D: WebGLBuffer;
let instanceMatrixLocations3D: number[];
let viewProjectionLocation3D: WebGLUniformLocation;
let useInstancingLocation3D: WebGLUniformLocation;
let vao3D: WebGLVertexArrayObject | null = null;
let vaoSkybox: WebGLVertexArrayObject | null = null;
const MAX_JOINTS = 32;
const jointMatrixArray = new Float32Array(MAX_JOINTS * 16);
const identityMatrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const MAX_INSTANCES = 64;
const TEXTURE_UNIT_ALBEDO = 3;
const TEXTURE_UNIT_NORMAL = 4;
const TEXTURE_UNIT_METALLIC_ROUGHNESS = 5;
export const TEXTURE_UNIT_SHADOW_MAP = 6;
const TEXTURE_UNIT_SKYBOX = 7;
// const TEXTURE_LOCATION_AMBIENT_OCCLUSION = 7;

let skyboxProgram: WebGLProgram;
let skyboxPositionLocation: number;
let skyboxViewLocation: WebGLUniformLocation;
let skyboxProjectionLocation: WebGLUniformLocation;
let skyboxTextureLocation: WebGLUniformLocation;
export let skyboxBuffer: WebGLBuffer;
export let skyboxTexture: WebGLTexture | null = null;

export const vertexShader3DCodeStr: string = vertexShader3DCode;
export const fragmentShader3DCodeStr: string = gameShader3DCode;
export const skyboxVertShaderCodeStr: string = skyboxVertCode;
export const skyboxFragShaderCodeStr: string = skyboxFragCode;

type AttribType = 'float' | 'int' | 'uint';

function setAttribConstant(gl: WebGL2RenderingContext, loc: number, type: AttribType, values: number[]): void {
    if (loc < 0) return;
    switch (type) {
        case 'float':
            gl.vertexAttrib4f(loc, values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0);
            break;
        case 'int':
            gl.vertexAttribI4i(loc, values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0);
            break;
        case 'uint':
            gl.vertexAttribI4ui(loc, values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0);
            break;
    }
}

function disableAttribWithConstant(gl: WebGL2RenderingContext, loc: number, type: AttribType, values: number[]): void {
    if (loc < 0) return;
    gl.disableVertexAttribArray(loc);
    setAttribConstant(gl, loc, type, values);
}

function bindOrDefault(
    gl: WebGL2RenderingContext,
    buffer: WebGLBuffer | undefined,
    loc: number,
    type: AttribType,
    size: number,
    componentType: GLenum,
    normalize = false,
    stride = 0,
    offset = 0,
    defaultValues: number[] = []
): void {
    if (loc < 0) return;
    if (buffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        if (type === 'float') {
            gl.vertexAttribPointer(loc, size, componentType, normalize, stride, offset);
        } else {
            gl.vertexAttribIPointer(loc, size, componentType, stride, offset);
        }
        gl.enableVertexAttribArray(loc);
    } else {
        disableAttribWithConstant(gl, loc, type, defaultValues);
    }
}

function getMeshBuffers(gl: WebGL2RenderingContext, m: Mesh): MeshBuffers {
    let buffers = meshBufferCache.get(m);
    if (buffers) return buffers;

    buffers = {
        vertex: glCreateBuffer(gl)
    };

    // Vertex positions
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vertex);
    gl.bufferData(gl.ARRAY_BUFFER, m.positions, gl.STATIC_DRAW);

    const vertexCount = m.vertexCount;

    // Per-vertex color override and atlas removed

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
        const maxIndex = Math.max(...m.indices);
        if (maxIndex < vertexCount) {
            buffers.index = glCreateElementBuffer(gl);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
        } else {
            console.warn(`Indices out of bounds: max ${maxIndex} >= vertexCount ${vertexCount}`);
        }
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
    gl3D = gl;
    camera.setAspect(offscreenCanvasSize.x / offscreenCanvasSize.y);
    vao3D = gl.createVertexArray()!;
    vaoSkybox = gl.createVertexArray()!;
}

// Camera helpers
export function setCameraPosition(pos: vec3 | vec3arr): void {
    const activeCamera = getActiveCamera();
    activeCamera.setPosition(pos);
}

export function pointCameraAt(target: vec3 | vec3arr): void {
    const activeCamera = getActiveCamera();
    activeCamera.lookAt(target);
}

export function setCameraViewDepth(near: number, far: number): void {
    const activeCamera = getActiveCamera();
    activeCamera.setViewDepth(near, far);
}

export function setCameraFov(fov: number): void {
    const activeCamera = getActiveCamera();
    activeCamera.setFov(fov);
}

export function usePerspectiveCamera(fov?: number): void {
    const activeCamera = getActiveCamera();
    activeCamera.usePerspective(fov);
}

export function useOrthographicCamera(width: number, height: number): void {
    const activeCamera = getActiveCamera();
    activeCamera.useOrthographic(width, height);
}

export function uploadCameraPosition(gl: WebGL2RenderingContext): void {
    const activeCamera = getActiveCamera();
    gl.uniform3fv(
        cameraPositionLocation3D,
        new Float32Array([activeCamera.position.x, activeCamera.position.y, activeCamera.position.z])
    );
}

export function getActiveCamera(): Camera3D {
    const activeCamera = $.model.getActiveCamera();
    return activeCamera ? activeCamera.camera : camera;
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
}

export function addDirectionalLight(gl: WebGL2RenderingContext, id: Identifier, light: DirectionalLight): void {
    directionalLights.set(id, { type: 'directional', color: light.color, intensity: light.intensity, orientation: light.orientation });
    uploadDirectionalLights(gl);
}

export function removeDirectionalLight(gl: WebGL2RenderingContext, id: string): void {
    if (directionalLights.delete(id)) uploadDirectionalLights(gl);
}

export function getDirectionalLight(id: string): DirectionalLight | undefined {
    return directionalLights.get(id);
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
    // gl.uniformMatrix4fv(lightMatrixLocation3D, false, identityMatrix);
    // gl.uniformMatrix4fv(mvpLocation3D, false, identityMatrix);
    // gl.uniformMatrix4fv(modelLocation3D, false, identityMatrix);
    // gl.uniformMatrix4fv(normalMatrixLocation3D, false, identityMatrix);
    // gl.uniformMatrix4fv(jointMatrixLocation3D, false, identityMatrix);
    // gl.uniform3fv(materialColorLocation3D, new Float32Array([1.0, 1.0, 1.0]));
    gl.uniformMatrix4fv(viewProjectionLocation3D, false, identityMatrix);
    gl.uniform1i(useInstancingLocation3D, 0);
    checkWebGLError('after other uniform values');
}

export function setupBuffers3D(gl: WebGL2RenderingContext): void {
    vertexBuffer3D = glCreateBuffer(gl);
    texcoordBuffer3D = glCreateBuffer(gl);
    normalBuffer3D = glCreateBuffer(gl);
    tangentBuffer3D = glCreateBuffer(gl);
    indexBuffer3D = glCreateElementBuffer(gl);
    jointBuffer3D = glCreateBuffer(gl);
    weightBuffer3D = glCreateBuffer(gl);
    instanceMatrixBuffer3D = glCreateBuffer(gl);
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

    gl.bindBuffer(gl.ARRAY_BUFFER, instanceMatrixBuffer3D);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_INSTANCES * 16 * 4, gl.DYNAMIC_DRAW);
}

export function createSkyboxBuffer(gl: WebGL2RenderingContext): void {
    const positions = new Float32Array([
        -1, -1, 1, 1, -1, 1, -1, 1, 1,
        -1, 1, 1, 1, -1, 1, 1, 1, 1,
        1, -1, -1, -1, -1, -1, 1, 1, -1,
        -1, -1, -1, -1, 1, -1, 1, 1, -1,
        -1, -1, -1, -1, -1, 1, -1, 1, -1,
        -1, -1, 1, -1, 1, 1, -1, 1, -1,
        1, -1, 1, 1, -1, -1, 1, 1, 1,
        1, -1, -1, 1, 1, -1, 1, 1, 1,
        -1, 1, 1, 1, 1, 1, -1, 1, -1,
        -1, 1, -1, 1, 1, 1, 1, 1, -1,
        -1, -1, -1, 1, -1, -1, -1, -1, 1,
        -1, -1, 1, 1, -1, -1, 1, -1, 1,
    ]);
    skyboxBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, skyboxBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
}

export function drawSkybox(gl: WebGL2RenderingContext): void {
    glSwitchProgram(gl, skyboxProgram);
    gl.bindVertexArray(vaoSkybox);

    gl.bindBuffer(gl.ARRAY_BUFFER, skyboxBuffer);
    gl.vertexAttribPointer(skyboxPositionLocation, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(skyboxPositionLocation);

    const activeCamera = getActiveCamera();
    const view = activeCamera.viewMatrix.slice() as Float32Array;
    view[12] = 0; view[13] = 0; view[14] = 0;
    gl.uniformMatrix4fv(skyboxViewLocation, false, view);
    gl.uniformMatrix4fv(skyboxProjectionLocation, false, activeCamera.projectionMatrix);

    gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_SKYBOX);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, skyboxTexture);
    gl.uniform1i(skyboxTextureLocation, TEXTURE_UNIT_SKYBOX);
    checkWebGLError('before drawSkybox');

    gl.drawArrays(gl.TRIANGLES, 0, 36);
    if (checkWebGLError('after drawSkybox')) {
        throw new Error('Failed to draw skybox');
    }
}

export function setupGameShader3DLocations(gl: WebGL2RenderingContext): void {
    glSwitchProgram(gl, gameShaderProgram3D);
    glSetupAttributeFloat(gl, vertexBuffer3D, vertexPositionLocation3D, 3);
    glSetupAttributeFloat(gl, texcoordBuffer3D, texcoordLocation3D, 2);
    glSetupAttributeFloat(gl, normalBuffer3D, normalLocation3D, 3);
    glSetupAttributeFloat(gl, tangentBuffer3D, tangentLocation3D, 4);
    glSetupAttributeInt(gl, jointBuffer3D, jointLocation3D, 4, gl.UNSIGNED_SHORT);
    glSetupAttributeFloat(gl, weightBuffer3D, weightLocation3D, 4);

    for (let i = 0; i < MAX_MORPH_TARGETS; i++) {
        glSetupAttributeFloat(gl, morphPositionBuffers3D[i], morphPositionLocations3D[i], 3);
        glSetupAttributeFloat(gl, morphNormalBuffers3D[i], morphNormalLocations3D[i], 3);
        glSetupAttributeFloat(gl, morphTangentBuffers3D[i], morphTangentLocations3D[i], 3);
    }
}

export interface SkyboxFace {
    id: string;
    atlassed: boolean;
    atlasId?: number;
    texcoords?: number[];
}

export function setSkyboxImages(gl: WebGL2RenderingContext, ids: { posX: string; negX: string; posY: string; negY: string; posZ: string; negZ: string }): void {
    // Instead of uploading images, store face info for shader sampling
    const faces: Record<string, SkyboxFace> = {
        posX: getSkyboxFace(ids.posX),
        negX: getSkyboxFace(ids.negX),
        posY: getSkyboxFace(ids.posY),
        negY: getSkyboxFace(ids.negY),
        posZ: getSkyboxFace(ids.posZ),
        negZ: getSkyboxFace(ids.negZ),
    };
    (gl as any)._skyboxFaces = faces; // Store for use in drawSkybox or shader uniform upload
}

function getSkyboxFace(id: string): SkyboxFace {
    const asset = BaseView.imgassets[id];
    if (!asset) throw new Error(`Skybox image '${id}' not found`);
    return {
        id,
        atlassed: !!asset.imgmeta.atlassed,
        atlasId: asset.imgmeta.atlasid,
        texcoords: asset.imgmeta.texcoords,
    };
}

export function createGameShaderPrograms3D(gl: WebGL2RenderingContext): void {
    const program = gl.createProgram();
    if (!program) throw Error('Failed to create 3D GLSL program');
    gameShaderProgram3D = program;
    const vertShader = glLoadShader(gl, gl.VERTEX_SHADER, vertexShader3DCodeStr);
    const fragShader = glLoadShader(gl, gl.FRAGMENT_SHADER, fragmentShader3DCodeStr);
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

export function createSkyboxProgram(gl: WebGL2RenderingContext): void {
    const program = gl.createProgram();
    if (!program) throw Error('Failed to create skybox GLSL program');
    skyboxProgram = program;
    const vertShader = glLoadShader(gl, gl.VERTEX_SHADER, skyboxVertShaderCodeStr);
    const fragShader = glLoadShader(gl, gl.FRAGMENT_SHADER, skyboxFragShaderCodeStr);
    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw Error(`Unable to initialize the skybox shader program: ${gl.getProgramInfoLog(program)} `);
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
    mvpLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_mvp')!;
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
    uploadCameraPosition(gl);
}

export function setupSkyboxLocations(gl: WebGL2RenderingContext): void {
    gl.useProgram(skyboxProgram);
    skyboxPositionLocation = gl.getAttribLocation(skyboxProgram, 'a_position');
    skyboxViewLocation = gl.getUniformLocation(skyboxProgram, 'u_view')!;
    skyboxProjectionLocation = gl.getUniformLocation(skyboxProgram, 'u_projection')!;
    skyboxTextureLocation = gl.getUniformLocation(skyboxProgram, 'u_skybox')!;
}

function cullAndSortMeshes(): { instancedGroups: Map<string, { mesh: Mesh; matrices: Float32Array[] }>; singles: DrawMeshOptions[] } {
    if (meshesToDraw.length === 0) return { instancedGroups: new Map(), singles: [] };

    const activeCamera = getActiveCamera();
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
            const key = `${m.materialSignature}_${m.positions.length}_${m.indices?.length ?? 0}`;
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
    checkWebGLError("Before switching program");
    glSwitchProgram(gl, gameShaderProgram3D);
    checkWebGLError("After switching program");

    uploadCameraPosition(gl);
    uploadDirectionalLights(gl);
    uploadPointLights(gl);
    checkWebGLError("After setting camera uniforms");

    gl.bindVertexArray(vao3D);
    checkWebGLError('After binding VAO');

    // Reset defaults for all attributes
    const maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number;
    for (let i = 0; i < maxAttribs; i++) gl.disableVertexAttribArray(i);
    checkWebGLError('after disabling vertex attrib arrays');

    // Set safe defaults for all optional attributes (float and integer)
    disableAttribWithConstant(gl, tangentLocation3D, 'float', [1, 0, 0, 1]);
    checkWebGLError('after setting tangents');
    for (let i = 0; i < MAX_MORPH_TARGETS; i++) {
        disableAttribWithConstant(gl, morphPositionLocations3D[i], 'float', [0, 0, 0]);
        disableAttribWithConstant(gl, morphNormalLocations3D[i], 'float', [0, 0, 0]);
        disableAttribWithConstant(gl, morphTangentLocations3D[i], 'float', [0, 0, 0]);
    }
    checkWebGLError('after setting morphTangents');
    disableAttribWithConstant(gl, jointLocation3D, 'uint', [0, 0, 0, 0]);
    disableAttribWithConstant(gl, weightLocation3D, 'float', [1, 0, 0, 0]);
    checkWebGLError('after setting weight');
}

function setMeshTextures(gl: WebGL2RenderingContext, m: Mesh): void {
    if (m.gpuTextureAlbedo) {
        const key = m.gpuTextureAlbedo;
        const tex = $.texmanager.getTexture(key);
        if (tex instanceof WebGLTexture && gl.isTexture(tex)) {
            gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_ALBEDO);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.uniform1i(albedoTextureLocation3D, TEXTURE_UNIT_ALBEDO);
            gl.uniform1i(useAlbedoTextureLocation3D, 1);
        } else {
            gl.uniform1i(useAlbedoTextureLocation3D, 0);
        }
    } else {
        gl.uniform1i(useAlbedoTextureLocation3D, 0);
    }

    if (m.gpuTextureNormal) {
        const key = m.gpuTextureNormal;
        const tex = $.texmanager.getTexture(key);
        if (tex instanceof WebGLTexture && gl.isTexture(tex)) {
            gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_NORMAL);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.uniform1i(normalTextureLocation3D, TEXTURE_UNIT_NORMAL);
            gl.uniform1i(useNormalTextureLocation3D, 1);
        } else {
            gl.uniform1i(useNormalTextureLocation3D, 0);
        }
    } else {
        gl.uniform1i(useNormalTextureLocation3D, 0);
    }

    if (m.gpuTextureMetallicRoughness) {
        const key = m.gpuTextureMetallicRoughness;
        const tex = $.texmanager.getTexture(key);
        if (tex instanceof WebGLTexture && gl.isTexture(tex)) {
            gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_METALLIC_ROUGHNESS);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.uniform1i(metallicRoughnessTextureLocation3D, TEXTURE_UNIT_METALLIC_ROUGHNESS);
            gl.uniform1i(useMetallicRoughnessTextureLocation3D, 1);
        } else {
            gl.uniform1i(useMetallicRoughnessTextureLocation3D, 0);
        }
    } else {
        gl.uniform1i(useMetallicRoughnessTextureLocation3D, 0);
    }

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

    checkWebGLError('before setting useInstancing');
    gl.uniform1i(useInstancingLocation3D, 1);
    checkWebGLError('after setting useInstancing');

    const activeCamera = getActiveCamera();
    gl.uniformMatrix4fv(viewProjectionLocation3D, false, activeCamera.viewProjectionMatrix);
    checkWebGLError('after setting viewProjectionMatrix');

    gl.bindBuffer(gl.ARRAY_BUFFER, instanceMatrixBuffer3D);
    for (let i = 0; i < 4; i++) {
        const loc = instanceMatrixLocations3D[i];
        if (loc >= 0) {
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 64, i * 16);
            gl.vertexAttribDivisor(loc, 1);
        }
    }
    checkWebGLError('after setting instance attributes');

    for (const { mesh: m, matrices } of instancedGroups.values()) {
        const buffers = getMeshBuffers(gl, m);

        // Use bindOrDefault for cleaner vertex attribute binding
        bindOrDefault(gl, buffers.vertex, vertexPositionLocation3D, 'float', 3, gl.FLOAT, false, 0, 0, [0, 0, 0]);
        checkWebGLError('after setting vertexPosition');

        bindOrDefault(gl, buffers.texcoord, texcoordLocation3D, 'float', 2, gl.FLOAT, false, 0, 0, [0, 0]);
        checkWebGLError('after setting texcoord');

        bindOrDefault(gl, buffers.normal, normalLocation3D, 'float', 3, gl.FLOAT, false, 0, 0, [0, 0, 1]);
        checkWebGLError('after setting normal');

        bindOrDefault(gl, buffers.tangent, tangentLocation3D, 'float', 4, gl.FLOAT, false, 0, 0, [1, 0, 0, 1]);
        checkWebGLError('after setting tangent');

        // Disable skinning and morph attributes for instanced meshes
        disableAttribWithConstant(gl, jointLocation3D, 'uint', [0, 0, 0, 0]);
        disableAttribWithConstant(gl, weightLocation3D, 'float', [1, 0, 0, 0]);
        checkWebGLError('after disabling skinning and morph attributes');
        for (let i = 0; i < MAX_MORPH_TARGETS; i++) {
            disableAttribWithConstant(gl, morphPositionLocations3D[i], 'float', [0, 0, 0]);
            disableAttribWithConstant(gl, morphNormalLocations3D[i], 'float', [0, 0, 0]);
            disableAttribWithConstant(gl, morphTangentLocations3D[i], 'float', [0, 0, 0]);
            checkWebGLError('after disabling morph attributes');
        }
        gl.uniform1fv(morphWeightLocation3D, new Float32Array(MAX_MORPH_TARGETS));
        jointMatrixArray.fill(0);
        jointMatrixArray.set(identityMatrix, 0);
        gl.uniformMatrix4fv(jointMatrixLocation3D, false, jointMatrixArray);
        checkWebGLError('after setting jointMatrix');

        const matColor = m.material?.color ?? [1, 1, 1, 1];
        gl.uniform4fv(materialColorLocation3D, new Float32Array(matColor));
        gl.uniform1f(metallicFactorLocation3D, m.material?.metallicFactor ?? 0.0);
        gl.uniform1f(roughnessFactorLocation3D, m.material?.roughnessFactor ?? 0.0);
        checkWebGLError('after setting metallic and roughness factors');

        setMeshTextures(gl, m);
        checkWebGLError('after setting textures');

        for (let offset = 0; offset < matrices.length; offset += MAX_INSTANCES) {
            const batchCount = Math.min(MAX_INSTANCES, matrices.length - offset);
            const instanceData = new Float32Array(batchCount * 16);
            for (let i = 0; i < batchCount; i++) instanceData.set(matrices[offset + i], i * 16);
            gl.bindBuffer(gl.ARRAY_BUFFER, instanceMatrixBuffer3D);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData);
            checkWebGLError('after uploading instance matrices');
            if (m.indices) {
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index!);
                const type = m.indices instanceof Uint32Array ? gl.UNSIGNED_INT :
                    m.indices instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT;
                gl.drawElementsInstanced(gl.TRIANGLES, m.indices.length, type, 0, batchCount);
                checkWebGLError('after drawing indexed instances');
            } else {
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
                gl.drawArraysInstanced(gl.TRIANGLES, 0, m.vertexCount, batchCount);
                checkWebGLError('after drawing non-indexed instances');
            }
        }
    }
    for (const loc of instanceMatrixLocations3D) {
        if (loc >= 0) gl.disableVertexAttribArray(loc);
    }
    gl.uniform1i(useInstancingLocation3D, 0);
    checkWebGLError('after disabling instancing');
}

function setupMeshVertexAttributes(gl: WebGL2RenderingContext, m: Mesh, buffers: MeshBuffers): void {
    // Use bindOrDefault for cleaner vertex attribute binding
    bindOrDefault(gl, buffers.vertex, vertexPositionLocation3D, 'float', 3, gl.FLOAT, false, 0, 0, [0, 0, 0]);
    bindOrDefault(gl, buffers.texcoord, texcoordLocation3D, 'float', 2, gl.FLOAT, false, 0, 0, [0, 0]);
    bindOrDefault(gl, buffers.normal, normalLocation3D, 'float', 3, gl.FLOAT, false, 0, 0, [0, 0, 1]);
    bindOrDefault(gl, buffers.tangent, tangentLocation3D, 'float', 4, gl.FLOAT, false, 0, 0, [1, 0, 0, 1]);
}

function setupMeshSkinning(gl: WebGL2RenderingContext, m: Mesh, buffers: MeshBuffers, jointMatrices?: Float32Array[]): void {
    // Joints / skinning
    if (buffers.joint && buffers.weight && m.hasSkinning && jointMatrices) {
        bindOrDefault(gl, buffers.joint, jointLocation3D, 'uint', 4, gl.UNSIGNED_SHORT, false, 0, 0, [0, 0, 0, 0]);
        bindOrDefault(gl, buffers.weight, weightLocation3D, 'float', 4, gl.FLOAT, false, 0, 0, [1, 0, 0, 0]);

        jointMatrixArray.fill(0);
        jointMatrixArray.set(identityMatrix, 0);
        for (let i = 0; i < jointMatrices.length && i < MAX_JOINTS; i++) {
            jointMatrixArray.set(jointMatrices[i], i * 16);
        }
        gl.uniformMatrix4fv(jointMatrixLocation3D, false, jointMatrixArray);
    } else {
        disableAttribWithConstant(gl, jointLocation3D, 'uint', [0, 0, 0, 0]);
        disableAttribWithConstant(gl, weightLocation3D, 'float', [1, 0, 0, 0]);
        jointMatrixArray.fill(0);
        jointMatrixArray.set(identityMatrix, 0);
        gl.uniformMatrix4fv(jointMatrixLocation3D, false, jointMatrixArray);
    }
}

function setupMeshMorphTargets(gl: WebGL2RenderingContext, m: Mesh, buffers: MeshBuffers, morphWeights?: number[]): void {
    // Morph targets
    if (m.hasMorphTargets && buffers.morphPositions) {
        if (m.morphPositions!.length > MAX_MORPH_TARGETS) {
            console.warn(`Only first ${MAX_MORPH_TARGETS} morph targets supported`);
        }
        const weights = new Float32Array(MAX_MORPH_TARGETS);
        const weightSource = morphWeights ?? m.morphWeights;
        for (let i = 0; i < MAX_MORPH_TARGETS; i++) {
            bindOrDefault(gl, buffers.morphPositions[i], morphPositionLocations3D[i], 'float', 3, gl.FLOAT, false, 0, 0, [0, 0, 0]);
            bindOrDefault(gl, buffers.morphNormals?.[i], morphNormalLocations3D[i], 'float', 3, gl.FLOAT, false, 0, 0, [0, 0, 0]);
            bindOrDefault(gl, buffers.morphTangents?.[i], morphTangentLocations3D[i], 'float', 3, gl.FLOAT, false, 0, 0, [0, 0, 0]);
            weights[i] = weightSource[i] ?? 0;
        }
        gl.uniform1fv(morphWeightLocation3D, weights);
    } else {
        for (let i = 0; i < MAX_MORPH_TARGETS; i++) {
            disableAttribWithConstant(gl, morphPositionLocations3D[i], 'float', [0, 0, 0]);
            disableAttribWithConstant(gl, morphNormalLocations3D[i], 'float', [0, 0, 0]);
            disableAttribWithConstant(gl, morphTangentLocations3D[i], 'float', [0, 0, 0]);
        }
        gl.uniform1fv(morphWeightLocation3D, new Float32Array(MAX_MORPH_TARGETS));
    }
}

function setMeshMaterial(gl: WebGL2RenderingContext, m: Mesh): void {
    checkWebGLError("Before setting uniform values");
    const matColor = m.material?.color ?? [1, 1, 1, 1];
    gl.uniform4fv(materialColorLocation3D, new Float32Array(matColor));
    gl.uniform1f(metallicFactorLocation3D, m.material?.metallicFactor ?? 0.0);
    gl.uniform1f(roughnessFactorLocation3D, m.material?.roughnessFactor ?? 0.0);
    checkWebGLError("After setting uniform values");
}

function setMeshTexturesForSingle(gl: WebGL2RenderingContext, m: Mesh): void {
    checkWebGLError("Before setting texture uniforms");

    // Albedo: Bind and set unit only if valid texture present
    if (m.gpuTextureAlbedo) {
        const key = m.gpuTextureAlbedo;
        const texHandle = $.texmanager.getTexture(key);
        if (texHandle instanceof WebGLTexture && gl.isTexture(texHandle)) {
            gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_ALBEDO);
            gl.bindTexture(gl.TEXTURE_2D, texHandle);
            gl.uniform1i(albedoTextureLocation3D, TEXTURE_UNIT_ALBEDO);
            gl.uniform1i(useAlbedoTextureLocation3D, 1);
        } else {
            console.warn(`Invalid albedo texture: ${key}`);
            gl.uniform1i(useAlbedoTextureLocation3D, 0);
        }
    } else {
        gl.uniform1i(useAlbedoTextureLocation3D, 0);
    }

    // Normal: Similar
    if (m.gpuTextureNormal) {
        const key = m.gpuTextureNormal;
        const texHandle = $.texmanager.getTexture(key);
        if (texHandle instanceof WebGLTexture && gl.isTexture(texHandle)) {
            gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_NORMAL);
            gl.bindTexture(gl.TEXTURE_2D, texHandle);
            gl.uniform1i(normalTextureLocation3D, TEXTURE_UNIT_NORMAL);
            gl.uniform1i(useNormalTextureLocation3D, 1);
        } else {
            gl.uniform1i(useNormalTextureLocation3D, 0);
        }
    } else {
        gl.uniform1i(useNormalTextureLocation3D, 0);
    }

    // MetallicRoughness: Similar
    if (m.gpuTextureMetallicRoughness) {
        const key = m.gpuTextureMetallicRoughness;
        const texHandle = $.texmanager.getTexture(key);
        if (texHandle instanceof WebGLTexture && gl.isTexture(texHandle)) {
            gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_METALLIC_ROUGHNESS);
            gl.bindTexture(gl.TEXTURE_2D, texHandle);
            gl.uniform1i(metallicRoughnessTextureLocation3D, TEXTURE_UNIT_METALLIC_ROUGHNESS);
            gl.uniform1i(useMetallicRoughnessTextureLocation3D, 1);
        } else {
            gl.uniform1i(useMetallicRoughnessTextureLocation3D, 0);
        }
    } else {
        gl.uniform1i(useMetallicRoughnessTextureLocation3D, 0);
    }

    // Shadow: Bind and set unit only if present (requires shader update below)
    if (m.shadow) {
        gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_SHADOW_MAP);
        gl.bindTexture(gl.TEXTURE_2D, m.shadow.map.texture);
        gl.uniform1i(shadowMapLocation3D, TEXTURE_UNIT_SHADOW_MAP);
        gl.uniformMatrix4fv(lightMatrixLocation3D, false, m.shadow.matrix);
        gl.uniform1f(shadowStrengthLocation3D, m.shadow.strength);
        gl.uniform1i(useShadowMapLocation3D, 1);
    } else {
        // gl.uniform1f(shadowStrengthLocation3D, 1.0);
        gl.uniform1i(useShadowMapLocation3D, 0);
    }
    checkWebGLError("After setting texture uniforms");
}

function setMeshTransforms(gl: WebGL2RenderingContext, matrix: Float32Array): void {
    checkWebGLError("Before calculating MVP and setting uniforms");
    const activeCamera = getActiveCamera();
    const mvp = bmat.multiply(activeCamera.viewProjectionMatrix, matrix);
    gl.uniformMatrix4fv(mvpLocation3D, false, mvp);
    gl.uniformMatrix4fv(modelLocation3D, false, matrix);
    const normalMat = bmat.normalMatrix(matrix);
    gl.uniformMatrix3fv(normalMatrixLocation3D, false, normalMat);
    checkWebGLError("After calculating MVP and setting uniforms");
}

function drawMesh(gl: WebGL2RenderingContext, m: Mesh, buffers: MeshBuffers, vertexCount: number, framebuffer: WebGLFramebuffer): void {
    if (m.indices) {
        checkWebGLError("Before drawing elements");
        const type = m.indices instanceof Uint32Array ? gl.UNSIGNED_INT :
            m.indices instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT;

        gl.drawElements(gl.TRIANGLES, m.indices.length, type, 0);
        const drawError = checkWebGLError(`After drawing elements (count = ${m.indices.length})`);
        if (drawError) {
            console.error(generateDetailedDrawError(
                gl, m, framebuffer, vertexCount, drawError,
                jointBuffer3D, weightBuffer3D,
                morphPositionBuffers3D, morphNormalBuffers3D, morphTangentBuffers3D,
                vertexBuffer3D, texcoordBuffer3D, normalBuffer3D, tangentBuffer3D, indexBuffer3D,
                albedoTextureLocation3D, normalTextureLocation3D, metallicRoughnessTextureLocation3D, shadowMapLocation3D,
                useAlbedoTextureLocation3D, useNormalTextureLocation3D, useMetallicRoughnessTextureLocation3D, useShadowMapLocation3D,
                morphWeightLocation3D, jointMatrixLocation3D,
                TEXTURE_UNIT_ALBEDO, TEXTURE_UNIT_NORMAL, TEXTURE_UNIT_METALLIC_ROUGHNESS, TEXTURE_UNIT_SHADOW_MAP,
                jointMatrixArray, identityMatrix, getActiveCamera(), bmat
            ));
        }
    } else {
        checkWebGLError("Before drawing arrays");
        gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
        if (checkWebGLError(`After drawing arrays(count = ${vertexCount})`)) {
            throw new Error(`Mesh ${m.name} has no indices and drawArrays failed.Vertex count: ${vertexCount} `);
        }
    }
}

function renderSingleMeshes(gl: WebGL2RenderingContext, singles: DrawMeshOptions[], framebuffer: WebGLFramebuffer): void {
    for (const { mesh: m, matrix, jointMatrices, morphWeights } of singles) {
        checkWebGLError("Before processing mesh");
        const buffers = getMeshBuffers(gl, m);
        const vertexCount = m.vertexCount;

        setupMeshVertexAttributes(gl, m, buffers);
        setupMeshSkinning(gl, m, buffers, jointMatrices);
        setupMeshMorphTargets(gl, m, buffers, morphWeights);

        // Index buffer
        if (buffers.index) {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
        } else {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
        }
        checkWebGLError("After processing mesh");

        setMeshMaterial(gl, m);
        setMeshTexturesForSingle(gl, m);
        setMeshTransforms(gl, matrix);

        drawMesh(gl, m, buffers, vertexCount, framebuffer);
        checkWebGLError(`After calculating MVP and drawing mesh: ${JSON.stringify(m)} `);
    }
}

export function renderMeshBatch(gl: WebGL2RenderingContext, framebuffer: WebGLFramebuffer, canvasWidth: number, canvasHeight: number): void {
    const { instancedGroups, singles } = cullAndSortMeshes();
    if (instancedGroups.size === 0 && singles.length === 0) return;

    setupFramebufferAndViewport(gl, framebuffer, canvasWidth, canvasHeight);
    setupRenderingState(gl);

    renderInstancedMeshes(gl, instancedGroups);
    renderSingleMeshes(gl, singles, framebuffer);

    meshesToDraw = [];
}

export function onResize(newSize: Size): void {
    camera.setAspect(newSize.x / newSize.y);
}