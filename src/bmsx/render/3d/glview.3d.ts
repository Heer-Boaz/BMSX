import type { Size, vec3, vec3arr } from '../../rompack/rompack';
import { createBuffer as glCreateBuffer, loadShader as glLoadShader, setupAttributeFloat as glSetupAttributeFloat, setupAttributeInt as glSetupAttributeInt, switchProgram as glSwitchProgram } from '../glutils';
import { GLView } from '../glview';
import { MAX_DIR_LIGHTS, MAX_POINT_LIGHTS } from '../glview.constants';
import { BaseView, Color } from '../view';
import { Camera3D } from './camera3d';
import type { DirectionalLight, PointLight } from './light';
import { Material } from './material';
import { bmat } from './math3d';
import gameShader3DCode from './shaders/3d.frag.glsl';
import vertexShader3DCode from './shaders/3d.vert.glsl';
import skyboxFragCode from './shaders/skybox.frag.glsl';
import skyboxVertCode from './shaders/skybox.vert.glsl';
import { ShadowMap } from './shadowmap';

let glctx: WebGL2RenderingContext;
let parentView: GLView;

export const camera = new Camera3D();
export let meshesToDraw: { positions: Float32Array; texcoords: Float32Array; normals?: Float32Array; matrix: Float32Array; color: Color; atlasId: number; material?: Material; shadow?: { map: ShadowMap; matrix: Float32Array; strength: number } }[] = [];

const directionalLights: Map<string, DirectionalLight> = new Map();
const pointLights: Map<string, PointLight> = new Map();

let gameShaderProgram3D: WebGLProgram;
let vertexLocation3D: number;
let texcoordLocation3D: number;
let color_overrideLocation3D: number;
let atlas_idLocation3D: number;
let normalLocation3D: number;
let mvpLocation3D: WebGLUniformLocation;
let modelLocation3D: WebGLUniformLocation;
let normalMatrixLocation3D: WebGLUniformLocation;
let ditherLocation3D: WebGLUniformLocation;
let ambientColorLocation3D: WebGLUniformLocation;
let ambientIntensityLocation3D: WebGLUniformLocation;
let dirLightDirectionLocation3D: WebGLUniformLocation;
let dirLightColorLocation3D: WebGLUniformLocation;
let numDirLightsLocation3D: WebGLUniformLocation;
let pointLightPositionLocation3D: WebGLUniformLocation;
let pointLightColorLocation3D: WebGLUniformLocation;
let pointLightRangeLocation3D: WebGLUniformLocation;
let numPointLightsLocation3D: WebGLUniformLocation;
let materialColorLocation3D: WebGLUniformLocation;
let shadowMapLocation3D: WebGLUniformLocation;
let lightMatrixLocation3D: WebGLUniformLocation;
let shadowStrengthLocation3D: WebGLUniformLocation;
let vertexBuffer3D: WebGLBuffer;
let texcoordBuffer3D: WebGLBuffer;
let color_overrideBuffer3D: WebGLBuffer;
let atlas_idBuffer3D: WebGLBuffer;
let normalBuffer3D: WebGLBuffer;

// Skybox fields
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

export function init(gl: WebGL2RenderingContext, view: GLView, offscreenCanvasSize: Size): void {
    glctx = gl;
    parentView = view;
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

export function setAmbientLight(color: vec3arr, intensity: number): void {
    glctx.useProgram(gameShaderProgram3D);
    glctx.uniform3fv(ambientColorLocation3D, new Float32Array(color));
    glctx.uniform1f(ambientIntensityLocation3D, intensity);
}

export function uploadDirectionalLights(): void {
    const gl = glctx;
    const lights = Array.from(directionalLights.values());
    const count = Math.min(lights.length, MAX_DIR_LIGHTS);
    const dirs = new Float32Array(MAX_DIR_LIGHTS * 3);
    const cols = new Float32Array(MAX_DIR_LIGHTS * 3);
    for (let i = 0; i < count; i++) {
        dirs.set(lights[i].direction, i * 3);
        cols.set(lights[i].color, i * 3);
    }
    gl.useProgram(gameShaderProgram3D);
    gl.uniform1i(numDirLightsLocation3D, count);
    gl.uniform3fv(dirLightDirectionLocation3D, dirs);
    gl.uniform3fv(dirLightColorLocation3D, cols);
}

export function uploadPointLights(): void {
    const gl = glctx;
    const lights = Array.from(pointLights.values());
    const count = Math.min(lights.length, MAX_POINT_LIGHTS);
    const pos = new Float32Array(MAX_POINT_LIGHTS * 3);
    const col = new Float32Array(MAX_POINT_LIGHTS * 3);
    const range = new Float32Array(MAX_POINT_LIGHTS);
    for (let i = 0; i < count; i++) {
        pos.set(lights[i].position, i * 3);
        col.set(lights[i].color, i * 3);
        range[i] = lights[i].range;
    }
    gl.useProgram(gameShaderProgram3D);
    gl.uniform1i(numPointLightsLocation3D, count);
    gl.uniform3fv(pointLightPositionLocation3D, pos);
    gl.uniform3fv(pointLightColorLocation3D, col);
    gl.uniform1fv(pointLightRangeLocation3D, range);
}

export function addDirectionalLight(id: string, direction: vec3arr, color: vec3arr): void {
    directionalLights.set(id, { id, type: 'directional', color, intensity: 1, direction });
    uploadDirectionalLights();
}

export function removeDirectionalLight(id: string): void {
    if (directionalLights.delete(id)) uploadDirectionalLights();
}

export function getDirectionalLight(id: string): DirectionalLight | undefined {
    return directionalLights.get(id);
}

export function addPointLight(id: string, position: vec3arr, color: vec3arr, range: number): void {
    pointLights.set(id, { id, type: 'point', color, intensity: 1, position, range });
    uploadPointLights();
}

export function removePointLight(id: string): void {
    if (pointLights.delete(id)) uploadPointLights();
}

export function getPointLight(id: string): PointLight | undefined {
    return pointLights.get(id);
}

export function clearLights(): void {
    directionalLights.clear();
    pointLights.clear();
    uploadDirectionalLights();
    uploadPointLights();
}

export function setDefaultUniformValues(): void {
    const gl = glctx;
    gl.useProgram(gameShaderProgram3D);
    gl.uniform1f(ditherLocation3D, 0.3);
    gl.uniform3fv(ambientColorLocation3D, new Float32Array([1.0, 1.0, 1.0]));
    gl.uniform1f(ambientIntensityLocation3D, 0.2);
    addDirectionalLight('default_dir', [0.0, -1.0, 0.0], [1.0, 1.0, 1.0]);
    addPointLight('default_point', [0.0, 5.0, 5.0], [1.0, 1.0, 1.0], 10.0);
}

export function setupBuffers3D(): void {
    const gl = glctx;
    vertexBuffer3D = glCreateBuffer(gl);
    texcoordBuffer3D = glCreateBuffer(gl);
    normalBuffer3D = glCreateBuffer(gl);
    color_overrideBuffer3D = glCreateBuffer(gl);
    atlas_idBuffer3D = glCreateBuffer(gl);
}

export function createSkyboxBuffer(): void {
    const gl = glctx;
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

export function drawSkybox(): void {
    const gl = glctx;
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
    gl.depthFunc(gl.GREATER);
}

export function setupGameShader3DLocations(): void {
    const gl = glctx;
    glSwitchProgram(gl, gameShaderProgram3D);
    glSetupAttributeFloat(gl, vertexBuffer3D, vertexLocation3D, 3);
    glSetupAttributeFloat(gl, texcoordBuffer3D, texcoordLocation3D, 2);
    glSetupAttributeFloat(gl, normalBuffer3D, normalLocation3D, 3);
    glSetupAttributeFloat(gl, color_overrideBuffer3D, color_overrideLocation3D, 4);
    glSetupAttributeInt(gl, atlas_idBuffer3D, atlas_idLocation3D, 1);
}

export function setSkyboxImages(ids: { posX: string; negX: string; posY: string; negY: string; posZ: string; negZ: string }): void {
    const gl = glctx;
    if (!skyboxTexture) {
        skyboxTexture = gl.createTexture()!;
    }
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, skyboxTexture);
    function generateAtlasName(atlasIndex: number): string {
        const idxStr = atlasIndex.toString().padStart(2, '0');
        return atlasIndex === 0 ? '_atlas' : `_atlas_${idxStr}`;
    }
    const targets = [
        [gl.TEXTURE_CUBE_MAP_POSITIVE_X, ids.posX],
        [gl.TEXTURE_CUBE_MAP_NEGATIVE_X, ids.negX],
        [gl.TEXTURE_CUBE_MAP_POSITIVE_Y, ids.posY],
        [gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, ids.negY],
        [gl.TEXTURE_CUBE_MAP_POSITIVE_Z, ids.posZ],
        [gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, ids.negZ],
    ] as const;
    let width = 0, height = 0;
    const sources: CanvasImageSource[] = [];

    for (const [, id] of targets) {
        const asset = BaseView.imgassets[id];
        if (!asset) throw Error(`Skybox image '${id}' not found`);
        let source: CanvasImageSource;
        if (asset.imgbin) {
            source = asset.imgbin;
        } else if (asset.imgmeta?.atlassed) {
            const idx = asset.imgmeta.atlasid ?? 0;
            const atlasName = generateAtlasName(idx);
            const atlas = BaseView.imgassets[atlasName]?.imgbin;
            if (!atlas) throw Error(`Atlas image '${atlasName}' not found`);
            const [left, top, right, , , bottom] = asset.imgmeta.texcoords!;
            const aw = atlas.width, ah = atlas.height;
            const sx = left * aw;
            const sy = top * ah;
            const sw = (right - left) * aw;
            const sh = (bottom - top) * ah;
            const canvas = document.createElement('canvas');
            canvas.width = sw;
            canvas.height = sh;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(atlas, sx, sy, sw, sh, 0, 0, sw, sh);
            source = canvas;
        } else {
            throw Error(`Skybox image '${id}' not found`);
        }
        if (width === 0) {
            const s = source as HTMLImageElement | HTMLCanvasElement;
            width = s.width;
            height = s.height;
        }
        sources.push(source);
    }

    for (const [target] of targets) {
        gl.texImage2D(target, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }

    for (let i = 0; i < targets.length; i++) {
        const [target] = targets[i];
        const source = sources[i] as TexImageSource;
        gl.texSubImage2D(target, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

export function createGameShaderPrograms3D(): void {
    const gl = glctx;
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

export function createSkyboxProgram(): void {
    const gl = glctx;
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

export function setupVertexShaderLocations3D(): void {
    const gl = glctx;
    vertexLocation3D = gl.getAttribLocation(gameShaderProgram3D, 'a_position');
    texcoordLocation3D = gl.getAttribLocation(gameShaderProgram3D, 'a_texcoord');
    normalLocation3D = gl.getAttribLocation(gameShaderProgram3D, 'a_normal');
    color_overrideLocation3D = gl.getAttribLocation(gameShaderProgram3D, 'a_color_override');
    atlas_idLocation3D = gl.getAttribLocation(gameShaderProgram3D, 'a_atlas_id');
    mvpLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_mvp')!;
    modelLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_model')!;
    normalMatrixLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_normalMatrix')!;
    ditherLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_ditherIntensity')!;
    ambientColorLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_ambientColor')!;
    ambientIntensityLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_ambientIntensity')!;
    dirLightDirectionLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_dirLightDirection[0]')!;
    dirLightColorLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_dirLightColor[0]')!;
    numDirLightsLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_numDirLights')!;
    pointLightPositionLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_pointLightPosition[0]')!;
    pointLightColorLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_pointLightColor[0]')!;
    pointLightRangeLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_pointLightRange[0]')!;
    numPointLightsLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_numPointLights')!;
    materialColorLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_materialColor')!;
    shadowMapLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_shadowMap')!;
    lightMatrixLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_lightMatrix')!;
    shadowStrengthLocation3D = gl.getUniformLocation(gameShaderProgram3D, 'u_shadowStrength')!;
}

export function setupSkyboxLocations(): void {
    const gl = glctx;
    skyboxPositionLocation = gl.getAttribLocation(skyboxProgram, 'a_position');
    skyboxViewLocation = gl.getUniformLocation(skyboxProgram, 'u_view')!;
    skyboxProjectionLocation = gl.getUniformLocation(skyboxProgram, 'u_projection')!;
    skyboxTextureLocation = gl.getUniformLocation(skyboxProgram, 'u_skybox')!;
}

export function renderMeshBatch(): void {
    if (meshesToDraw.length === 0) return;
    const gl = glctx;
    glSwitchProgram(gl, gameShaderProgram3D);

    uploadDirectionalLights();
    uploadPointLights();

    gl.bindFramebuffer(gl.FRAMEBUFFER, parentView.framebuffer);
    gl.viewport(0, 0, parentView.offscreenCanvasSize.x, parentView.offscreenCanvasSize.y);

    if (skyboxTexture) {
        drawSkybox();
        glSwitchProgram(gl, gameShaderProgram3D);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer3D);
    gl.vertexAttribPointer(vertexLocation3D, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vertexLocation3D);

    gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer3D);
    gl.vertexAttribPointer(texcoordLocation3D, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(texcoordLocation3D);

    gl.bindBuffer(gl.ARRAY_BUFFER, color_overrideBuffer3D);
    gl.vertexAttribPointer(color_overrideLocation3D, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(color_overrideLocation3D);

    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer3D);
    gl.vertexAttribPointer(normalLocation3D, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(normalLocation3D);

    gl.bindBuffer(gl.ARRAY_BUFFER, atlas_idBuffer3D);
    gl.vertexAttribIPointer(atlas_idLocation3D, 1, gl.UNSIGNED_BYTE, 0, 0);
    gl.enableVertexAttribArray(atlas_idLocation3D);

    for (const mesh of meshesToDraw) {
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer3D);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer3D);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.texcoords, gl.DYNAMIC_DRAW);
        if (mesh.normals) {
            gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer3D);
            gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.DYNAMIC_DRAW);
        }

        const vertexCount = mesh.positions.length / 3;

        const colorData = new Float32Array(vertexCount * 4);
        for (let i = 0; i < vertexCount; i++) {
            colorData.set([mesh.color.r, mesh.color.g, mesh.color.b, mesh.color.a], i * 4);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, color_overrideBuffer3D);
        gl.bufferData(gl.ARRAY_BUFFER, colorData, gl.DYNAMIC_DRAW);

        const atlasData = new Uint8Array(vertexCount);
        atlasData.fill(mesh.atlasId);
        gl.bindBuffer(gl.ARRAY_BUFFER, atlas_idBuffer3D);
        gl.bufferData(gl.ARRAY_BUFFER, atlasData, gl.DYNAMIC_DRAW);

        const matColor = mesh.material?.color ?? [1, 1, 1];
        gl.uniform3fv(materialColorLocation3D, new Float32Array(matColor));

        if (mesh.shadow) {
            gl.activeTexture(gl.TEXTURE8);
            gl.bindTexture(gl.TEXTURE_2D, mesh.shadow.map.texture);
            gl.uniform1i(shadowMapLocation3D, 8);
            gl.uniformMatrix4fv(lightMatrixLocation3D, false, mesh.shadow.matrix);
            gl.uniform1f(shadowStrengthLocation3D, mesh.shadow.strength);
        } else {
            gl.uniform1f(shadowStrengthLocation3D, 1.0);
        }

        const mvp = bmat.multiply(camera.viewProjectionMatrix, mesh.matrix);
        gl.uniformMatrix4fv(mvpLocation3D, false, mvp);
        gl.uniformMatrix4fv(modelLocation3D, false, mesh.matrix);
        const normalMat = bmat.normalMatrix(mesh.matrix);
        gl.uniformMatrix3fv(normalMatrixLocation3D, false, normalMat);

        gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
    }

    meshesToDraw = [];
}
