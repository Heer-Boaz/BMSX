import type { Size, vec3, vec3arr } from '../../rompack/rompack';
import { Identifier } from '../../rompack/rompack';
import { glCreateBuffer, glCreateElementBuffer, glLoadShader, glSetupAttributeFloat, glSetupAttributeInt, glSwitchProgram } from '../glutils';
import { MAX_DIR_LIGHTS, MAX_POINT_LIGHTS } from '../glview.constants';
import { checkWebGLError, getFramebufferStatusString, getWebGLErrorString } from '../glview.helpers';
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

const directionalLights: Map<string, DirectionalLight> = new Map();
const pointLights: Map<string, PointLight> = new Map();

let gameShaderProgram3D: WebGLProgram;
let vertexPositionLocation3D: number;
let texcoordLocation3D: number;
let color_overrideLocation3D: number;
let atlas_idLocation3D: number;
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
let vertexBuffer3D: WebGLBuffer;
let texcoordBuffer3D: WebGLBuffer;
let texture0_location: WebGLUniformLocation;
let texture1_location: WebGLUniformLocation;
let color_overrideBuffer3D: WebGLBuffer;
let atlas_idBuffer3D: WebGLBuffer;
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
let vao3D: WebGLVertexArrayObject | null = null;
let vaoSkybox: WebGLVertexArrayObject | null = null;
const MAX_JOINTS = 32;
const jointMatrixArray = new Float32Array(MAX_JOINTS * 16);
const identityMatrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
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

export function init(gl: WebGL2RenderingContext, offscreenCanvasSize: Size): void {
    camera.setAspect(offscreenCanvasSize.x / offscreenCanvasSize.y);
    vao3D = gl.createVertexArray()!;
    vaoSkybox = gl.createVertexArray()!;
}

// Camera helpers
export function setCameraPosition(pos: vec3 | vec3arr): void {
    camera.setPosition(pos);
    camera.viewMatrix;
}

export function pointCameraAt(target: vec3 | vec3arr): void {
    camera.lookAt(target);
    camera.viewMatrix;
}

export function setCameraViewDepth(near: number, far: number): void {
    camera.setViewDepth(near, far);
}

export function setCameraFov(fov: number): void {
    camera.fov = fov;
}

export function usePerspectiveCamera(fov?: number): void {
    camera.usePerspective(fov);
}

export function useOrthographicCamera(width: number, height: number): void {
    camera.useOrthographic(width, height);
}

export function getCamera(): Camera3D {
    return camera;
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
    gl.uniform1i(texture0_location, 0);
    gl.uniform1i(texture1_location, 1);
    checkWebGLError('after texture uniforms');
    // gl.uniformMatrix4fv(lightMatrixLocation3D, false, identityMatrix);
    // gl.uniformMatrix4fv(mvpLocation3D, false, identityMatrix);
    // gl.uniformMatrix4fv(modelLocation3D, false, identityMatrix);
    // gl.uniformMatrix4fv(normalMatrixLocation3D, false, identityMatrix);
    // gl.uniformMatrix4fv(jointMatrixLocation3D, false, identityMatrix);
    // gl.uniform3fv(materialColorLocation3D, new Float32Array([1.0, 1.0, 1.0]));
    checkWebGLError('after other uniform values');
}

export function setupBuffers3D(gl: WebGL2RenderingContext): void {
    vertexBuffer3D = glCreateBuffer(gl);
    texcoordBuffer3D = glCreateBuffer(gl);
    normalBuffer3D = glCreateBuffer(gl);
    tangentBuffer3D = glCreateBuffer(gl);
    color_overrideBuffer3D = glCreateBuffer(gl);
    atlas_idBuffer3D = glCreateBuffer(gl);
    indexBuffer3D = glCreateElementBuffer(gl);
    jointBuffer3D = glCreateBuffer(gl);
    weightBuffer3D = glCreateBuffer(gl);
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
    gl.bindVertexArray(vaoSkybox);  // ★ eigen VAO

    gl.bindBuffer(gl.ARRAY_BUFFER, skyboxBuffer);
    gl.vertexAttribPointer(skyboxPositionLocation, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(skyboxPositionLocation);

    const view = camera.viewMatrix.slice() as Float32Array;
    view[12] = 0; view[13] = 0; view[14] = 0;
    gl.uniformMatrix4fv(skyboxViewLocation, false, view);
    gl.uniformMatrix4fv(skyboxProjectionLocation, false, camera.projectionMatrix);

    gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_SKYBOX);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, skyboxTexture);
    gl.uniform1i(skyboxTextureLocation, TEXTURE_UNIT_SKYBOX);
    checkWebGLError('before drawSkybox');

    gl.drawArrays(gl.TRIANGLES, 0, 36);
    if (checkWebGLError('after drawSkybox')) {
        // Handle the error
    }
}

export function setupGameShader3DLocations(gl: WebGL2RenderingContext): void {
    glSwitchProgram(gl, gameShaderProgram3D);
    glSetupAttributeFloat(gl, vertexBuffer3D, vertexPositionLocation3D, 3);
    glSetupAttributeFloat(gl, texcoordBuffer3D, texcoordLocation3D, 2);
    glSetupAttributeFloat(gl, normalBuffer3D, normalLocation3D, 3);
    glSetupAttributeFloat(gl, tangentBuffer3D, tangentLocation3D, 4);
    glSetupAttributeFloat(gl, color_overrideBuffer3D, color_overrideLocation3D, 4);
    glSetupAttributeInt(gl, atlas_idBuffer3D, atlas_idLocation3D, 1);
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
    vertexPositionLocation3D = gl.getAttribLocation(gameShaderProgram3D, 'a_position');
    texcoordLocation3D = gl.getAttribLocation(gameShaderProgram3D, 'a_texcoord');
    normalLocation3D = gl.getAttribLocation(gameShaderProgram3D, 'a_normal');
    tangentLocation3D = gl.getAttribLocation(gameShaderProgram3D, 'a_tangent');
    color_overrideLocation3D = gl.getAttribLocation(gameShaderProgram3D, 'a_color_override');
    atlas_idLocation3D = gl.getAttribLocation(gameShaderProgram3D, 'a_atlas_id');
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
    jointMatrixLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_jointMatrices')!;
    morphWeightLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_morphWeights')!;
}

export function setupSkyboxLocations(gl: WebGL2RenderingContext): void {
    skyboxPositionLocation = gl.getAttribLocation(skyboxProgram, 'a_position');
    skyboxViewLocation = gl.getUniformLocation(skyboxProgram, 'u_view')!;
    skyboxProjectionLocation = gl.getUniformLocation(skyboxProgram, 'u_projection')!;
    skyboxTextureLocation = gl.getUniformLocation(skyboxProgram, 'u_skybox')!;
}

export function renderMeshBatch(gl: WebGL2RenderingContext, framebuffer: WebGLFramebuffer, canvasWidth: number, canvasHeight: number): void {
    if (meshesToDraw.length === 0) return;
    checkWebGLError("Before switching program");
    glSwitchProgram(gl, gameShaderProgram3D);
    checkWebGLError("After switching program");

    checkWebGLError("Before setting camera uniforms");
    uploadDirectionalLights(gl);
    uploadPointLights(gl);
    checkWebGLError("After setting camera uniforms");

    checkWebGLError("Before setting uniform values");
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    const fbStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (fbStatus !== gl.FRAMEBUFFER_COMPLETE) {
        console.warn(`renderMeshBatch: framebuffer incomplete - ${getFramebufferStatusString(gl, fbStatus)}`);
    }
    checkWebGLError("After binding framebuffer and setting viewport");

    if (skyboxTexture) {
        drawSkybox(gl);
        glSwitchProgram(gl, gameShaderProgram3D);
    }


    gl.bindVertexArray(vao3D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, canvasWidth, canvasHeight);

    gl.bindVertexArray(vao3D);

    // 1) Harde reset van alle attrib-arrays in dit VAO
    const maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number;
    for (let i = 0; i < maxAttribs; i++) gl.disableVertexAttribArray(i);

    // 2) Veilige defaults voor alle optionele attributen (float én integer)
    // Tangent (vec4)
    if (tangentLocation3D >= 0) gl.vertexAttrib4f(tangentLocation3D, 1, 0, 0, 1);

    // Morphs (vec3)
    for (let i = 0; i < 2; i++) {
        if (morphPositionLocations3D[i] >= 0) gl.vertexAttrib3f(morphPositionLocations3D[i], 0, 0, 0);
        if (morphNormalLocations3D[i] >= 0) gl.vertexAttrib3f(morphNormalLocations3D[i], 0, 0, 0);
        if (morphTangentLocations3D[i] >= 0) gl.vertexAttrib3f(morphTangentLocations3D[i], 0, 0, 0);
    }

    // Skinning (uvec4 + vec4) — LET OP: integer-variant voor joints
    if (jointLocation3D >= 0) gl.vertexAttribI4i(jointLocation3D, 0, 0, 0, 0);
    if (weightLocation3D >= 0) gl.vertexAttrib4f(weightLocation3D, 1, 0, 0, 0);

    // Atlas-id (uint) — integer-constant voor het geval je per-mesh geen buffer wilt zetten
    if (atlas_idLocation3D >= 0) gl.vertexAttribI4i(atlas_idLocation3D, 0, 0, 0, 0); // we gebruiken straks toch size=1

    checkWebGLError("Before setting vertex attributes");
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer3D);
    gl.vertexAttribPointer(vertexPositionLocation3D, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vertexPositionLocation3D);

    gl.bindBuffer(gl.ARRAY_BUFFER, color_overrideBuffer3D);
    gl.vertexAttribPointer(color_overrideLocation3D, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(color_overrideLocation3D);

    gl.bindBuffer(gl.ARRAY_BUFFER, atlas_idBuffer3D);
    gl.vertexAttribIPointer(atlas_idLocation3D, 1, gl.UNSIGNED_BYTE, 0, 0);
    gl.enableVertexAttribArray(atlas_idLocation3D);
    checkWebGLError("After setting vertex attributes");

    for (const { mesh: m, matrix, jointMatrices } of meshesToDraw) {
        checkWebGLError("Before processing mesh");
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer3D);
        gl.bufferData(gl.ARRAY_BUFFER, m.positions, gl.DYNAMIC_DRAW);

        const vertexCount = m.vertexCount;

        // Handle texcoords: Disable and set constant if missing/undersized
        if (m.hasTexcoords) {
            gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer3D);
            gl.bufferData(gl.ARRAY_BUFFER, m.texcoords, gl.DYNAMIC_DRAW);
            gl.vertexAttribPointer(texcoordLocation3D, 2, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(texcoordLocation3D);
        } else {
            gl.disableVertexAttribArray(texcoordLocation3D);
            // gl.vertexAttrib2f(texcoordLocation3D, 0.0, 0.0); // Default [0,0]
        }

        // Handle normals: Disable and set constant if missing/undersized
        if (m.hasNormals) {
            gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer3D);
            gl.bufferData(gl.ARRAY_BUFFER, m.normals!, gl.DYNAMIC_DRAW);
            gl.vertexAttribPointer(normalLocation3D, 3, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(normalLocation3D);
        } else {
            gl.disableVertexAttribArray(normalLocation3D);
            // gl.vertexAttrib3f(normalLocation3D, 0.0, 0.0, 1.0); // Default up-normal
        }
        // Handle tangents: Disable and set constant if missing
        if (m.hasTangents) {
            gl.bindBuffer(gl.ARRAY_BUFFER, tangentBuffer3D);
            gl.bufferData(gl.ARRAY_BUFFER, m.tangents!, gl.DYNAMIC_DRAW);
            gl.vertexAttribPointer(tangentLocation3D, 4, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(tangentLocation3D);
        } else {
            gl.disableVertexAttribArray(tangentLocation3D);
            gl.vertexAttrib4f(tangentLocation3D, 1, 0, 0, 1);
        }
        // Handle joints / skinning
        if (m.hasSkinning && jointMatrices) {
            gl.bindBuffer(gl.ARRAY_BUFFER, jointBuffer3D);
            gl.bufferData(gl.ARRAY_BUFFER, m.jointIndices!, gl.DYNAMIC_DRAW);
            gl.vertexAttribIPointer(jointLocation3D, 4, gl.UNSIGNED_SHORT, 0, 0);
            gl.enableVertexAttribArray(jointLocation3D);

            gl.bindBuffer(gl.ARRAY_BUFFER, weightBuffer3D);
            gl.bufferData(gl.ARRAY_BUFFER, m.jointWeights!, gl.DYNAMIC_DRAW);
            gl.vertexAttribPointer(weightLocation3D, 4, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(weightLocation3D);

            jointMatrixArray.fill(0);
            jointMatrixArray.set(identityMatrix, 0);
            for (let i = 0; i < jointMatrices.length && i < MAX_JOINTS; i++) {
                jointMatrixArray.set(jointMatrices[i], i * 16);
            }
            gl.uniformMatrix4fv(jointMatrixLocation3D, false, jointMatrixArray);
        } else {
            // When skinning data is not provided, ensure the joint and weight attributes
            // are disabled and have safe default values. The joints attribute is an
            // integer attribute (`uvec4` in the shader), so we need to use the integer
            // version of `vertexAttrib` to specify its constant value. Using the float
            // variant here triggers `GL_INVALID_OPERATION` on some drivers during the
            // draw call (particularly on WebGL2) because the type does not match.
            gl.disableVertexAttribArray(jointLocation3D);
            gl.disableVertexAttribArray(weightLocation3D);

            // ★ Use unsigned variant for uvec4 a_joints
            gl.vertexAttribI4ui(jointLocation3D, 0, 0, 0, 0);

            // Float constant for a_weights (unchanged)
            gl.vertexAttrib4f(weightLocation3D, 1, 0, 0, 0);

            // Identity for u_jointMatrices[0] (unchanged)
            jointMatrixArray.fill(0);
            jointMatrixArray.set(identityMatrix, 0);
            gl.uniformMatrix4fv(jointMatrixLocation3D, false, jointMatrixArray);
        }

        // Handle morph targets
        if (m.hasMorphTargets) {
            if (m.morphPositions.length > MAX_MORPH_TARGETS) {
                console.warn(`Only first ${MAX_MORPH_TARGETS} morph targets supported`);
            }
            const weights = new Float32Array(MAX_MORPH_TARGETS);
            for (let i = 0; i < MAX_MORPH_TARGETS; i++) {
                const pos = m.morphPositions[i];
                const norm = m.morphNormals?.[i];
                const tan = m.morphTangents?.[i];
                if (pos) {
                    gl.bindBuffer(gl.ARRAY_BUFFER, morphPositionBuffers3D[i]);
                    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
                    gl.vertexAttribPointer(morphPositionLocations3D[i], 3, gl.FLOAT, false, 0, 0);
                    gl.enableVertexAttribArray(morphPositionLocations3D[i]);
                    weights[i] = m.morphWeights[i] ?? 0;
                } else {
                    gl.disableVertexAttribArray(morphPositionLocations3D[i]);
                    gl.vertexAttrib3f(morphPositionLocations3D[i], 0, 0, 0);
                }
                if (norm) {
                    gl.bindBuffer(gl.ARRAY_BUFFER, morphNormalBuffers3D[i]);
                    gl.bufferData(gl.ARRAY_BUFFER, norm, gl.DYNAMIC_DRAW);
                    gl.vertexAttribPointer(morphNormalLocations3D[i], 3, gl.FLOAT, false, 0, 0);
                    gl.enableVertexAttribArray(morphNormalLocations3D[i]);
                } else {
                    gl.disableVertexAttribArray(morphNormalLocations3D[i]);
                    gl.vertexAttrib3f(morphNormalLocations3D[i], 0, 0, 0);
                }
                if (tan) {
                    gl.bindBuffer(gl.ARRAY_BUFFER, morphTangentBuffers3D[i]);
                    gl.bufferData(gl.ARRAY_BUFFER, tan, gl.DYNAMIC_DRAW);
                    gl.vertexAttribPointer(morphTangentLocations3D[i], 3, gl.FLOAT, false, 0, 0);
                    gl.enableVertexAttribArray(morphTangentLocations3D[i]);
                } else {
                    gl.disableVertexAttribArray(morphTangentLocations3D[i]);
                    gl.vertexAttrib3f(morphTangentLocations3D[i], 0, 0, 0);
                }
            }
            gl.uniform1fv(morphWeightLocation3D, weights);
        } else {
            for (let i = 0; i < MAX_MORPH_TARGETS; i++) {
                gl.disableVertexAttribArray(morphPositionLocations3D[i]);
                gl.vertexAttrib3f(morphPositionLocations3D[i], 0, 0, 0);
                gl.disableVertexAttribArray(morphNormalLocations3D[i]);
                gl.vertexAttrib3f(morphNormalLocations3D[i], 0, 0, 0);
                gl.disableVertexAttribArray(morphTangentLocations3D[i]);
                gl.vertexAttrib3f(morphTangentLocations3D[i], 0, 0, 0);
            }
            gl.uniform1fv(morphWeightLocation3D, new Float32Array(MAX_MORPH_TARGETS));

        }
        checkWebGLError("After processing mesh");

        checkWebGLError("Before setting color and atlas buffers");
        const colorData = new Float32Array(vertexCount * 4);
        for (let i = 0; i < vertexCount; i++) {
            colorData.set([m.color.r, m.color.g, m.color.b, m.color.a], i * 4);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, color_overrideBuffer3D);
        gl.bufferData(gl.ARRAY_BUFFER, colorData, gl.DYNAMIC_DRAW);

        const atlasData = new Uint8Array(vertexCount);
        atlasData.fill(m.atlasId);
        gl.bindBuffer(gl.ARRAY_BUFFER, atlas_idBuffer3D);
        gl.bufferData(gl.ARRAY_BUFFER, atlasData, gl.DYNAMIC_DRAW);
        checkWebGLError("After setting color and atlas buffers");

        checkWebGLError("Before setting index buffer");
        if (m.indices) {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer3D);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.DYNAMIC_DRAW);

            // Validate indices not out-of-bounds
            const maxIndex = Math.max(...m.indices);
            if (maxIndex >= vertexCount) {
                console.warn(`Indices out of bounds: max ${maxIndex} >= vertexCount ${vertexCount}`);
                continue;
            }
        }
        checkWebGLError("After setting index buffer");

        checkWebGLError("Before setting uniform values");
        const matColor = m.material?.color ?? [1, 1, 1, 1];
        gl.uniform4fv(materialColorLocation3D, new Float32Array(matColor));
        gl.uniform1f(metallicFactorLocation3D, m.material?.metallicFactor ?? 0.0);
        gl.uniform1f(roughnessFactorLocation3D, m.material?.roughnessFactor ?? 0.0);
        checkWebGLError("After setting uniform values");

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

        checkWebGLError("Before calculating MVP and setting uniforms");
        const mvp = bmat.multiply(camera.viewProjectionMatrix, matrix);
        gl.uniformMatrix4fv(mvpLocation3D, false, mvp);
        gl.uniformMatrix4fv(modelLocation3D, false, matrix);
        const normalMat = bmat.normalMatrix(matrix);
        gl.uniformMatrix3fv(normalMatrixLocation3D, false, normalMat);
        checkWebGLError("After calculating MVP and setting uniforms");

        if (m.indices) {
            checkWebGLError("Before drawing elements");
            const type = m.indices instanceof Uint32Array ? gl.UNSIGNED_INT :
                m.indices instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT;

            gl.drawElements(gl.TRIANGLES, m.indices.length, type, 0);
            const drawError = checkWebGLError(`After drawing elements (count = ${m.indices.length})`);
            if (drawError) {
                const typeToByteSize = {
                    [gl.UNSIGNED_BYTE]: Uint8Array.BYTES_PER_ELEMENT,
                    [gl.UNSIGNED_SHORT]: Uint16Array.BYTES_PER_ELEMENT,
                    [gl.UNSIGNED_INT]: Uint32Array.BYTES_PER_ELEMENT,
                }
                const vertexType2String = (t: GLenum): string => {
                    switch (t) {
                        case gl.UNSIGNED_BYTE: return "UNSIGNED_BYTE";
                        case gl.UNSIGNED_SHORT: return "UNSIGNED_SHORT";
                        case gl.UNSIGNED_INT: return "UNSIGNED_INT";
                        default: return "UNKNOWN";
                    }
                };
                const getBufferData = (buffer: WebGLBuffer, t: GLenum, size: number): any => {
                    const result: Uint8Array | Uint16Array | Float32Array = new (t === gl.FLOAT ? Float32Array : t === gl.UNSIGNED_BYTE ? Uint8Array : Uint16Array)(size);
                    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                    gl.getBufferSubData(gl.ARRAY_BUFFER, 0, result);
                    return result;
                };

                const getGlBufferSize = (buffer: WebGLBuffer, target: GLenum = gl.ARRAY_BUFFER): number => {
                    gl.bindBuffer(target, buffer);
                    return gl.getBufferParameter(target, gl.BUFFER_SIZE);
                };

                // Additional state checks for common INVALID_OPERATION causes
                const currentVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
                const vaoBound = !!currentVAO;
                const currentElementBuffer = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
                const elementBufferBound = !!currentElementBuffer;
                const maxIndex = Math.max(...m.indices); // For clearer out-of-bounds diagnostics

                // Read the data from the buffers for debugging
                const colorData = getBufferData(color_overrideBuffer3D, gl.FLOAT, vertexCount * 4);
                const atlasData = getBufferData(atlas_idBuffer3D, gl.UNSIGNED_BYTE, vertexCount);
                const jointData = getBufferData(jointBuffer3D, gl.UNSIGNED_SHORT, vertexCount * 4);
                const weightData = getBufferData(weightBuffer3D, gl.FLOAT, vertexCount * 4);
                const morphPositionData = morphPositionBuffers3D.map(b => b ? getBufferData(b, gl.FLOAT, vertexCount * 3) : null);
                const morphNormalData = morphNormalBuffers3D.map(b => b ? getBufferData(b, gl.FLOAT, vertexCount * 3) : null);
                const morphTangentData = morphTangentBuffers3D.map(b => b ? getBufferData(b, gl.FLOAT, vertexCount * 3) : null);
                const jointMatrices = jointMatrixArray.length > 0 ? Array.from({ length: jointMatrixArray.length / 16 }, (_, i) => jointMatrixArray.slice(i * 16, (i + 1) * 16)) : null;
                const positions = getBufferData(vertexBuffer3D, gl.FLOAT, vertexCount * 3);
                const texcoords = m.hasTexcoords ? getBufferData(texcoordBuffer3D, gl.FLOAT, vertexCount * 2) : null;
                const normals = m.hasNormals ? getBufferData(normalBuffer3D, gl.FLOAT, vertexCount * 3) : null;
                const tangents = m.hasTangents ? getBufferData(tangentBuffer3D, gl.FLOAT, vertexCount * 4) : null;
                const vertexData = {
                    colorData: colorData,
                    atlasData: atlasData,
                    jointData: jointData,
                    weightData: weightData,
                    morphPositions: morphPositionData,
                    morphNormals: morphNormalData,
                    morphTangents: morphTangentData,
                    positions: positions,
                    texcoords: texcoords,
                    normals: normals,
                    tangents: tangents,
                };

                const bufferSize = {
                    vertexBuffer3D: getGlBufferSize(vertexBuffer3D),
                    indexBuffer3D: indexBuffer3D ? getGlBufferSize(indexBuffer3D, gl.ELEMENT_ARRAY_BUFFER) : 0,
                    texcoordBuffer3D: m.hasTexcoords ? getGlBufferSize(texcoordBuffer3D) : 0,
                    normalBuffer3D: m.hasNormals ? getGlBufferSize(normalBuffer3D) : 0,
                    tangentBuffer3D: m.hasTangents ? getGlBufferSize(tangentBuffer3D) : 0,
                    color_overrideBuffer3D: getGlBufferSize(color_overrideBuffer3D),
                    atlas_idBuffer3D: getGlBufferSize(atlas_idBuffer3D),
                    jointBuffer3D: m.hasSkinning ? getGlBufferSize(jointBuffer3D) : 0,
                    weightBuffer3D: m.hasSkinning ? getGlBufferSize(weightBuffer3D) : 0,
                    morphPositionBuffers3D: morphPositionBuffers3D.map(b => b ? getGlBufferSize(b) : 0),
                    morphNormalBuffers3D: morphNormalBuffers3D.map(b => b ? getGlBufferSize(b) : 0),
                    morphTangentBuffers3D: morphTangentBuffers3D.map(b => b ? getGlBufferSize(b) : 0),
                };

                const bufferSizeCorrectness = {
                    vertexBuffer3D: bufferSize.vertexBuffer3D === vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT,
                    indexBuffer3D: indexBuffer3D ? bufferSize.indexBuffer3D === m.indices.length * typeToByteSize[type] : false,
                    texcoordBuffer3D: m.hasTexcoords ? bufferSize.texcoordBuffer3D === vertexCount * 2 * Float32Array.BYTES_PER_ELEMENT : true,
                    normalBuffer3D: m.hasNormals ? bufferSize.normalBuffer3D === vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT : true,
                    tangentBuffer3D: m.hasTangents ? bufferSize.tangentBuffer3D === vertexCount * 4 * Float32Array.BYTES_PER_ELEMENT : true,
                    color_overrideBuffer3D: bufferSize.color_overrideBuffer3D === vertexCount * 4 * Float32Array.BYTES_PER_ELEMENT,
                    atlas_idBuffer3D: bufferSize.atlas_idBuffer3D === vertexCount * Uint8Array.BYTES_PER_ELEMENT,
                    jointBuffer3D: m.hasSkinning ? bufferSize.jointBuffer3D === vertexCount * 4 * Uint16Array.BYTES_PER_ELEMENT : true,
                    weightBuffer3D: m.hasSkinning ? bufferSize.weightBuffer3D === vertexCount * 4 * Float32Array.BYTES_PER_ELEMENT : true,
                    morphPositionBuffers3D: morphPositionBuffers3D.map((b, i) => b ? bufferSize.morphPositionBuffers3D[i] === vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT : true),
                    morphNormalBuffers3D: morphNormalBuffers3D.map((b, i) => b ? bufferSize.morphNormalBuffers3D[i] === vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT : true),
                    morphTangentBuffers3D: morphTangentBuffers3D.map((b, i) => b ? bufferSize.morphTangentBuffers3D[i] === vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT : true),
                };

                const bufferSizeCorrectnessReasons = {
                    vertexBuffer3D: bufferSizeCorrectness.vertexBuffer3D ? 'yes' : `no, because ${bufferSize.vertexBuffer3D - vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT} bytes are missing`,
                    indexBuffer3D: indexBuffer3D ? (bufferSizeCorrectness.indexBuffer3D ? 'yes' : `no, because ${bufferSize.indexBuffer3D - m.indices.length * typeToByteSize[type]} bytes are missing`) : 'Unbound!',
                    texcoordBuffer3D: m.hasTexcoords ? (bufferSizeCorrectness.texcoordBuffer3D ? 'yes' : `no, because ${bufferSize.texcoordBuffer3D - vertexCount * 2 * Float32Array.BYTES_PER_ELEMENT} bytes are missing`) : 'Unbound!',
                    normalBuffer3D: m.hasNormals ? (bufferSizeCorrectness.normalBuffer3D ? 'yes' : `no, because ${bufferSize.normalBuffer3D - vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT} bytes are missing`) : 'Unbound!',
                    tangentBuffer3D: m.hasTangents ? (bufferSizeCorrectness.tangentBuffer3D ? 'yes' : `no, because ${bufferSize.tangentBuffer3D - vertexCount * 4 * Float32Array.BYTES_PER_ELEMENT} bytes are missing`) : 'Unbound!',
                    color_overrideBuffer3D: bufferSizeCorrectness.color_overrideBuffer3D ? 'yes' : `no, because ${bufferSize.color_overrideBuffer3D - vertexCount * 4 * Float32Array.BYTES_PER_ELEMENT} bytes are missing`,
                    atlas_idBuffer3D: bufferSizeCorrectness.atlas_idBuffer3D ? 'yes' : `no, because ${bufferSize.atlas_idBuffer3D - vertexCount * Uint8Array.BYTES_PER_ELEMENT} bytes are missing`,
                    jointBuffer3D: m.hasSkinning ? (bufferSizeCorrectness.jointBuffer3D ? 'yes' : `no, because ${bufferSize.jointBuffer3D - vertexCount * 4 * Uint16Array.BYTES_PER_ELEMENT} bytes are missing`) : 'Unbound!',
                    weightBuffer3D: m.hasSkinning ? (bufferSizeCorrectness.weightBuffer3D ? 'yes' : `no, because ${bufferSize.weightBuffer3D - vertexCount * 4 * Float32Array.BYTES_PER_ELEMENT} bytes are missing`) : 'Unbound!',
                    morphPositionBuffers3D: '[' + morphPositionBuffers3D.map((b, i) => b ? (bufferSizeCorrectness.morphPositionBuffers3D[i] ? 'yes' : `no, because ${bufferSize.morphPositionBuffers3D[i] - vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT} bytes are missing`) : 'Unbound!').join(', ') + ']',
                    morphNormalBuffers3D: '[' + morphNormalBuffers3D.map((b, i) => b ? (bufferSizeCorrectness.morphNormalBuffers3D[i] ? 'yes' : `no, because ${bufferSize.morphNormalBuffers3D[i] - vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT} bytes are missing`) : 'Unbound!').join(', ') + ']',
                    morphTangentBuffers3D: '[' + morphTangentBuffers3D.map((b, i) => b ? (bufferSizeCorrectness.morphTangentBuffers3D[i] ? 'yes' : `no, because ${bufferSize.morphTangentBuffers3D[i] - vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT} bytes are missing`) : 'Unbound!').join(', ') + ']',
                };


                console.error(`Mesh ${m.name} has indices but drawElements failed. Vertex count: ${vertexCount}, Indices length: ${m.indices.length}
        Max index: ${maxIndex} (must be < ${vertexCount})

        Indices-type: ${vertexType2String(type)} (${typeToByteSize[type]} bytes per index)
        Vertex Buffer Size: ${bufferSize.vertexBuffer3D} bytes (${vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT} expected)
        Index Buffer Size: ${bufferSize.indexBuffer3D} bytes (${m.indices.length * typeToByteSize[type]} expected)
        Valid indices: ${m.indices.every(i => i >= 0 && i < vertexCount)}
        Buffer size correctness checks:
${Object.entries(bufferSizeCorrectnessReasons).map(([buffer, result]) => `\t\t${buffer}: ${result}`).join('\n')}

        _________________________________________________________________
        Draw Error: ${drawError}
        WebGL error: ${getWebGLErrorString(gl, drawError)}
        Framebuffer Created: ${framebuffer ? 'yes' : 'no'}
        Framebuffer Bound: ${gl.getParameter(gl.FRAMEBUFFER_BINDING) === framebuffer ? 'yes' : 'no'}
        Framebuffer status: ${getFramebufferStatusString(gl, gl.checkFramebufferStatus(gl.FRAMEBUFFER))}
        VAO bound: ${vaoBound ? 'yes' : 'no'}
        Element Array Buffer bound: ${elementBufferBound ? 'yes' : 'no'}
        glTextureIndexes units reserved vs bound for Albedo: TEXTURE${TEXTURE_UNIT_ALBEDO}:TEXTURE${gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), albedoTextureLocation3D)}, Normal: TEXTURE${TEXTURE_UNIT_NORMAL}:TEXTURE${gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), normalTextureLocation3D)}, MetallicRoughness: TEXTURE${TEXTURE_UNIT_METALLIC_ROUGHNESS}:TEXTURE${gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), metallicRoughnessTextureLocation3D)}, Shadow Map: TEXTURE${TEXTURE_UNIT_SHADOW_MAP}:TEXTURE${gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), shadowMapLocation3D)}
        glTextureIndex units correctly mapped: ${TEXTURE_UNIT_ALBEDO === gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), albedoTextureLocation3D) &&
                    TEXTURE_UNIT_NORMAL === gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), normalTextureLocation3D) &&
                    TEXTURE_UNIT_METALLIC_ROUGHNESS === gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), metallicRoughnessTextureLocation3D) &&
                    TEXTURE_UNIT_SHADOW_MAP === gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), shadowMapLocation3D)}
        glTextureUniforms set correctly (thus: value correctly maps to texture unit):
        _________________________________________________________________
        Material Color: ${JSON.stringify(matColor)}, Metallic Factor: ${m.material?.metallicFactor}, Roughness Factor: ${m.material?.roughnessFactor}
        Texture Albedo: ${m.gpuTextureAlbedo ? `'${m.gpuTextureAlbedo}'` : 'none'}
        Texture Normal: ${m.gpuTextureNormal ? `'${m.gpuTextureNormal}'` : 'none'}
        Texture MetallicRoughness: ${m.gpuTextureMetallicRoughness ? `'${m.gpuTextureMetallicRoughness}'` : 'none'}
        _________________________________________________________________
        Colordata: ${JSON.stringify(colorData)}
        Atlasdata: ${JSON.stringify(atlasData)}
        Atlas ID: ${m.atlasId}
        Has normals: ${m.hasNormals}
        Has tangents: ${m.hasTangents}
        Has texcoords: ${m.hasTexcoords}
        Has skinning: ${m.hasSkinning}
        _________________________________________________________________
        Shadow: ${m.shadow ? 'yes' : 'no'}, Shadow Map: ${m.shadow?.map.texture ?? 'none'}, Shadow Strength: ${m.shadow?.strength ?? 'none'}
        Shadow Matrix: ${m.shadow?.matrix ?? 'none'}
        Joint Matrices: ${jointMatrices ? jointMatrices.map(j => JSON.stringify(j)).join(', ') : 'none'}
        Morph Targets: ${m.hasMorphTargets ? m.morphPositions.length : 'none'}
        Morph Weights: ${m.hasMorphTargets ? m.morphWeights.join(', ') : 'none'}
        _________________________________________________________________
        MVP: ${JSON.stringify(mvp)}
        Model Matrix: ${JSON.stringify(matrix)}
        Normal Matrix: ${JSON.stringify(normalMat)}
        _________________________________________________________________
        Bound Vertex Buffer ID: ${vertexBuffer3D ? 'yes' : 'no'}
        Bound Texcoord Buffer ID: ${texcoordBuffer3D ? 'yes' : 'no'}
        Bound Normal Buffer ID: ${normalBuffer3D ? 'yes' : 'no'}
        Bound Tangent Buffer ID: ${tangentBuffer3D ? 'yes' : 'no'}
        Bound Color Override Buffer ID: ${color_overrideBuffer3D ? 'yes' : 'no'}
        Bound Atlas ID Buffer ID: ${atlas_idBuffer3D ? 'yes' : 'no'}
        Bound Index Buffer ID: ${indexBuffer3D ? 'yes' : 'no'}
        Bound Joint Buffer ID: ${jointBuffer3D ? 'yes' : 'no'}
        Bound Weight Buffer ID: ${weightBuffer3D ? 'yes' : 'no'}
        Bound Morph Position Buffers: ${morphPositionBuffers3D.map((b, i) => `${i}: ${b ? 'yes' : 'no'}`).join(', ')}
        Bound Morph Normal Buffers: ${morphNormalBuffers3D.map((b, i) => `${i}: ${b ? 'yes' : 'no'}`).join(', ')}
        Bound Morph Tangent Buffers: ${morphTangentBuffers3D.map((b, i) => `${i}: ${b ? 'yes' : 'no'}`).join(', ')}
        _________________________________________________________________
        Has Albedo Texture: ${m.gpuTextureAlbedo ? 'yes' : 'no'}
        Use Albedo Texture uniform: ${gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), useAlbedoTextureLocation3D)}
        Has Normal Texture: ${m.gpuTextureNormal ? 'yes' : 'no'}
        Use Normal Texture uniform: ${gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), useNormalTextureLocation3D)}
        Has Metallic Roughness Texture: ${m.gpuTextureMetallicRoughness ? 'yes' : 'no'}
        Use Metallic Roughness Texture uniform: ${gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), useMetallicRoughnessTextureLocation3D)}
        Has Shadow Map: ${m.shadow ? 'yes' : 'no'}
        Use Shadow Map uniform: ${gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), useShadowMapLocation3D)}
        Has Morph Targets: ${m.hasMorphTargets ? 'yes' : 'no'}
        Morph Weights uniform: ${gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), morphWeightLocation3D)}
        Has Joint Matrices: ${m.hasSkinning && jointMatrices ? 'yes' : 'no'}
        Joint Matrices uniform: ${gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), jointMatrixLocation3D)}
        Has Joint Matrix Array: ${jointMatrixArray?.length > 0 ? 'yes' : 'no'}
            Joint Matrix Array length: ${jointMatrixArray?.length / 16}
            Joint Matrix Array data: ${JSON.stringify(jointData)}  // Reusing jointData
        Joint Matrix Array: ${JSON.stringify(jointMatrixArray)}
        _________________________________________________________________
        Vertex Data: ${JSON.stringify(vertexData)}
`);
            }
        } else {
            checkWebGLError("Before drawing arrays");
            gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
            if (checkWebGLError(`After drawing arrays(count = ${vertexCount})`)) {
                throw new Error(`Mesh ${m.name} has no indices and drawArrays failed.Vertex count: ${vertexCount} `);
            }
        }
        checkWebGLError(`After calculating MVP and drawing mesh: ${JSON.stringify(m)} `);
    }

    meshesToDraw = [];
}