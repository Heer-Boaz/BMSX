import { glLoadShader, glSwitchProgram } from '../glutils';
import { checkWebGLError } from '../glview.helpers';
import { BaseView } from '../view';
import skyboxFragCode from './shaders/skybox.frag.glsl';
import skyboxVertCode from './shaders/skybox.vert.glsl';

export interface SkyboxFace {
    id: string;
    atlassed: boolean;
    atlasId?: number;
    texcoords?: number[];
}


let vaoSkybox: WebGLVertexArrayObject | null = null;
const TEXTURE_UNIT_SKYBOX = 7;

let skyboxProgram: WebGLProgram;
let skyboxPositionLocation: number;
let skyboxViewLocation: WebGLUniformLocation;
let skyboxProjectionLocation: WebGLUniformLocation;
let skyboxTextureLocation: WebGLUniformLocation;
export let skyboxBuffer: WebGLBuffer;
export let skyboxTexture: WebGLTexture | null = null;

export function init(gl: WebGL2RenderingContext) {
    vaoSkybox = gl.createVertexArray()!;
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
export function createSkyboxProgram(gl: WebGL2RenderingContext): void {
    const program = gl.createProgram();
    if (!program) throw Error('Failed to create skybox GLSL program');
    skyboxProgram = program;
    const vertShader = glLoadShader(gl, gl.VERTEX_SHADER, skyboxVertCode);
    const fragShader = glLoadShader(gl, gl.FRAGMENT_SHADER, skyboxFragCode);
    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw Error(`Unable to initialize the skybox shader program: ${gl.getProgramInfoLog(program)} `);
    }
}

export function setupSkyboxLocations(gl: WebGL2RenderingContext): void {
    gl.useProgram(skyboxProgram);
    skyboxPositionLocation = gl.getAttribLocation(skyboxProgram, 'a_position');
    skyboxViewLocation = gl.getUniformLocation(skyboxProgram, 'u_view')!;
    skyboxProjectionLocation = gl.getUniformLocation(skyboxProgram, 'u_projection')!;
    skyboxTextureLocation = gl.getUniformLocation(skyboxProgram, 'u_skybox')!;
}

export function drawSkybox(gl: WebGL2RenderingContext): void {
    glSwitchProgram(gl, skyboxProgram);
    gl.bindVertexArray(vaoSkybox);

    gl.bindBuffer(gl.ARRAY_BUFFER, skyboxBuffer);
    gl.vertexAttribPointer(skyboxPositionLocation, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(skyboxPositionLocation);

    const activeCamera = $.model.activeCamera3D;
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
