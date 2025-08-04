import type { Size, vec3, vec3arr } from '../../rompack/rompack';
import { Identifier } from '../../rompack/rompack';
import { glCreateBuffer, glCreateElementBuffer, glLoadShader, glSetupAttributeFloat, glSetupAttributeInt, glSwitchProgram } from '../glutils';
import { MAX_DIR_LIGHTS, MAX_POINT_LIGHTS } from '../glview.constants';
import { checkWebGLError } from '../glview.helpers';
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
let vertexLocation3D: number;
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
const MAX_JOINTS = 32;
const jointMatrixArray = new Float32Array(MAX_JOINTS * 16);
const identityMatrix = new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);

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

export function init(offscreenCanvasSize: Size): void {
    camera.setAspect(offscreenCanvasSize.x / offscreenCanvasSize.y);
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
    gl.uniform1f(ditherLocation3D, 0.3);
    gl.uniform3fv(ambientColorLocation3D, new Float32Array([1.0, 1.0, 1.0]));
    gl.uniform1f(ambientIntensityLocation3D, 0);
    gl.uniform1f(vertShaderScaleLocation3D, defaultScale);
    gl.uniform1i(albedoTextureLocation3D, 2);
    gl.uniform1i(useAlbedoTextureLocation3D, 0);
    gl.uniform1i(normalTextureLocation3D, 3);
    gl.uniform1i(useNormalTextureLocation3D, 0);
    gl.uniform1i(metallicRoughnessTextureLocation3D, 4);
    gl.uniform1i(useMetallicRoughnessTextureLocation3D, 0);
    gl.uniform1f(metallicFactorLocation3D, 1.0);
    gl.uniform1f(roughnessFactorLocation3D, 1.0);
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
    gl.depthFunc(gl.LEQUAL);
    gl.bindBuffer(gl.ARRAY_BUFFER, skyboxBuffer);
    gl.vertexAttribPointer(skyboxPositionLocation, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(skyboxPositionLocation);

    const view = camera.viewMatrix.slice() as Float32Array;
    view[12] = 0; view[13] = 0; view[14] = 0;
    gl.uniformMatrix4fv(skyboxViewLocation, false, view);
    gl.uniformMatrix4fv(skyboxProjectionLocation, false, camera.projectionMatrix);

    gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, skyboxTexture);
    gl.uniform1i(skyboxTextureLocation, 9);

    gl.drawArrays(gl.TRIANGLES, 0, 36);
    gl.depthFunc(gl.LEQUAL);
}

export function setupGameShader3DLocations(gl: WebGL2RenderingContext): void {
    glSwitchProgram(gl, gameShaderProgram3D);
    glSetupAttributeFloat(gl, vertexBuffer3D, vertexLocation3D, 3);
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
    vertexLocation3D = gl.getAttribLocation(gameShaderProgram3D, 'a_position');
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
    checkWebGLError("After binding framebuffer and setting viewport");

    if (skyboxTexture) {
        drawSkybox(gl);
        glSwitchProgram(gl, gameShaderProgram3D);
    }

    checkWebGLError("Before setting vertex attributes");
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer3D);
    gl.vertexAttribPointer(vertexLocation3D, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vertexLocation3D);

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
            gl.vertexAttrib2f(texcoordLocation3D, 0.0, 0.0); // Default [0,0]
        }

        // Handle normals: Disable and set constant if missing/undersized
        if (m.hasNormals) {
            gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer3D);
            gl.bufferData(gl.ARRAY_BUFFER, m.normals!, gl.DYNAMIC_DRAW);
            gl.vertexAttribPointer(normalLocation3D, 3, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(normalLocation3D);
        } else {
            gl.disableVertexAttribArray(normalLocation3D);
            gl.vertexAttrib3f(normalLocation3D, 0.0, 0.0, 1.0); // Default up-normal
        }
        // Handle tangents: Disable and set constant if missing
        if (m.hasTangents) {
            gl.bindBuffer(gl.ARRAY_BUFFER, tangentBuffer3D);
            gl.bufferData(gl.ARRAY_BUFFER, m.tangents!, gl.DYNAMIC_DRAW);
            gl.vertexAttribPointer(tangentLocation3D, 4, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(tangentLocation3D);
        } else {
            gl.disableVertexAttribArray(tangentLocation3D);
            gl.vertexAttrib4f(tangentLocation3D, 1.0, 0.0, 0.0, 1.0); // Default tangent
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
            gl.disableVertexAttribArray(jointLocation3D);
            gl.disableVertexAttribArray(weightLocation3D);
            gl.vertexAttrib4f(weightLocation3D, 1, 0, 0, 0);
            gl.vertexAttrib4f(jointLocation3D, 0, 0, 0, 0);
            jointMatrixArray.fill(0);
            jointMatrixArray.set(identityMatrix, 0);
            gl.uniformMatrix4fv(jointMatrixLocation3D, false, jointMatrixArray);
        }

        // Handle morph targets
        if (m.morphPositions && m.morphPositions.length) {
            if (m.morphPositions.length > MAX_MORPH_TARGETS) {
                console.warn(`Only first ${MAX_MORPH_TARGETS} morph targets supported`);
            }
            const weights = new Float32Array(MAX_MORPH_TARGETS);
            for (let i = 0; i < MAX_MORPH_TARGETS; i++) {
                const pos = m.morphPositions[i];
                const norm = m.morphNormals?.[i];
                const tan = m.morphTangents?.[i];
                if (pos && morphPositionLocations3D[i] >= 0) {
                    gl.bindBuffer(gl.ARRAY_BUFFER, morphPositionBuffers3D[i]);
                    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
                    gl.vertexAttribPointer(morphPositionLocations3D[i], 3, gl.FLOAT, false, 0, 0);
                    gl.enableVertexAttribArray(morphPositionLocations3D[i]);
                    weights[i] = m.morphWeights[i] ?? 0;
                } else if (morphPositionLocations3D[i] >= 0) {
                    gl.disableVertexAttribArray(morphPositionLocations3D[i]);
                }
                if (norm && morphNormalLocations3D[i] >= 0) {
                    gl.bindBuffer(gl.ARRAY_BUFFER, morphNormalBuffers3D[i]);
                    gl.bufferData(gl.ARRAY_BUFFER, norm, gl.DYNAMIC_DRAW);
                    gl.vertexAttribPointer(morphNormalLocations3D[i], 3, gl.FLOAT, false, 0, 0);
                    gl.enableVertexAttribArray(morphNormalLocations3D[i]);
                } else if (morphNormalLocations3D[i] >= 0) {
                    gl.disableVertexAttribArray(morphNormalLocations3D[i]);
                }
                if (tan && morphTangentLocations3D[i] >= 0) {
                    gl.bindBuffer(gl.ARRAY_BUFFER, morphTangentBuffers3D[i]);
                    gl.bufferData(gl.ARRAY_BUFFER, tan, gl.DYNAMIC_DRAW);
                    gl.vertexAttribPointer(morphTangentLocations3D[i], 3, gl.FLOAT, false, 0, 0);
                    gl.enableVertexAttribArray(morphTangentLocations3D[i]);
                } else if (morphTangentLocations3D[i] >= 0) {
                    gl.disableVertexAttribArray(morphTangentLocations3D[i]);
                }
            }
            gl.uniform1fv(morphWeightLocation3D, weights);
        } else {
            gl.uniform1fv(morphWeightLocation3D, new Float32Array(MAX_MORPH_TARGETS));
            for (let i = 0; i < MAX_MORPH_TARGETS; i++) {
                if (morphPositionLocations3D[i] >= 0) gl.disableVertexAttribArray(morphPositionLocations3D[i]);
                if (morphNormalLocations3D[i] >= 0) gl.disableVertexAttribArray(morphNormalLocations3D[i]);
                if (morphTangentLocations3D[i] >= 0) gl.disableVertexAttribArray(morphTangentLocations3D[i]);
            }
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
                gl.activeTexture(gl.TEXTURE2);
                gl.bindTexture(gl.TEXTURE_2D, texHandle);
                gl.uniform1i(albedoTextureLocation3D, 2);
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
                gl.activeTexture(gl.TEXTURE3);
                gl.bindTexture(gl.TEXTURE_2D, texHandle);
                gl.uniform1i(normalTextureLocation3D, 3);
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
                gl.activeTexture(gl.TEXTURE4);
                gl.bindTexture(gl.TEXTURE_2D, texHandle);
                gl.uniform1i(metallicRoughnessTextureLocation3D, 4);
                gl.uniform1i(useMetallicRoughnessTextureLocation3D, 1);
            } else {
                gl.uniform1i(useMetallicRoughnessTextureLocation3D, 0);
            }
        } else {
            gl.uniform1i(useMetallicRoughnessTextureLocation3D, 0);
        }

        // Shadow: Bind and set unit only if present (requires shader update below)
        if (m.shadow) {
            gl.activeTexture(gl.TEXTURE8);
            gl.bindTexture(gl.TEXTURE_2D, m.shadow.map.texture);
            gl.uniform1i(shadowMapLocation3D, 8);
            gl.uniformMatrix4fv(lightMatrixLocation3D, false, m.shadow.matrix);
            gl.uniform1f(shadowStrengthLocation3D, m.shadow.strength);
            gl.uniform1i(useShadowMapLocation3D, 1); // New uniform
        } else {
            gl.uniform1f(shadowStrengthLocation3D, 1.0);
            gl.uniform1i(useShadowMapLocation3D, 0); // New uniform
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
            const type = m.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
            gl.drawElements(gl.TRIANGLES, m.indices.length, type, 0);
            if (checkWebGLError(`After drawing elements (count = ${m.indices.length})`)) {
                // Your existing logging...
            }
        } else {
            checkWebGLError("Before drawing arrays");
            gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
            if (checkWebGLError(`After drawing arrays (count = ${vertexCount})`)) {
                // Handle error
            }
        }
        checkWebGLError(`After calculating MVP and drawing mesh: ${JSON.stringify(m)}`);
    }

    meshesToDraw = [];
}