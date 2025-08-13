import { glLoadShader, glSwitchProgram } from '../glutils';
import { BaseView } from '../view';
import skyboxFragCode from './shaders/skybox.frag.glsl';
import skyboxVertCode from './shaders/skybox.vert.glsl';

const TEXTURE_UNIT_SKYBOX = 7;
let vaoSkybox: WebGLVertexArrayObject | null = null;

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

// export function createSkyboxBuffer(gl: WebGL2RenderingContext): void {
//     // Inward-facing cube (CW vanaf buiten gezien, dus CCW vanaf binnen)
//     const p = new Float32Array([
//         // +Z (front)
//         -1, -1, 1, 1, 1, 1, 1, -1, 1,
//         -1, -1, 1, -1, 1, 1, 1, 1, 1,

//         // -Z (back)
//         -1, -1, -1, 1, 1, -1, -1, 1, -1,
//         -1, -1, -1, 1, -1, -1, 1, 1, -1,

//         // -X (left)
//         -1, -1, -1, -1, 1, 1, -1, -1, 1,
//         -1, -1, -1, -1, 1, -1, -1, 1, 1,

//         // +X (right)
//         1, -1, -1, 1, 1, 1, 1, 1, -1,
//         1, -1, -1, 1, -1, 1, 1, 1, 1,

//         // +Y (top)
//         -1, 1, -1, 1, 1, 1, -1, 1, 1,
//         -1, 1, -1, 1, 1, -1, 1, 1, 1,

//         // -Y (bottom)
//         -1, -1, -1, 1, -1, 1, 1, -1, -1,
//         -1, -1, -1, -1, -1, 1, 1, -1, 1,
//     ]);

//     skyboxBuffer = gl.createBuffer()!;
//     gl.bindBuffer(gl.ARRAY_BUFFER, skyboxBuffer);
//     gl.bufferData(gl.ARRAY_BUFFER, p, gl.STATIC_DRAW);
// }

export function createSkyboxBuffer(gl: WebGL2RenderingContext): void {
    // CCW vanuit het centrum van de cube gezien (dus vertices in "normale" volgorde om naar binnen te kijken)
    const p = new Float32Array([
        // +Z (front)
        -1, -1, 1,
        1, -1, 1,
        1, 1, 1,
        -1, -1, 1,
        1, 1, 1,
        -1, 1, 1,

        // -Z (back)
        1, -1, -1,
        -1, -1, -1,
        -1, 1, -1,
        1, -1, -1,
        -1, 1, -1,
        1, 1, -1,

        // -X (left)
        -1, -1, -1,
        -1, -1, 1,
        -1, 1, 1,
        -1, -1, -1,
        -1, 1, 1,
        -1, 1, -1,

        // +X (right)
        1, -1, 1,
        1, -1, -1,
        1, 1, -1,
        1, -1, 1,
        1, 1, -1,
        1, 1, 1,

        // +Y (top)
        -1, 1, 1,
        1, 1, 1,
        1, 1, -1,
        -1, 1, 1,
        1, 1, -1,
        -1, 1, -1,

        // -Y (bottom)
        -1, -1, -1,
        1, -1, -1,
        1, -1, 1,
        -1, -1, -1,
        1, -1, 1,
        -1, -1, 1,
    ]);

    skyboxBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, skyboxBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, p, gl.STATIC_DRAW);
}

export function setSkyboxImages(gl: WebGL2RenderingContext, ids: { posX: string; negX: string; posY: string; negY: string; posZ: string; negZ: string }): void {
    // Create or update the cube map texture
    gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_SKYBOX);
    skyboxTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, skyboxTexture);

    const faces = [
        { target: gl.TEXTURE_CUBE_MAP_POSITIVE_X, id: ids.posX },
        { target: gl.TEXTURE_CUBE_MAP_NEGATIVE_X, id: ids.negX },
        { target: gl.TEXTURE_CUBE_MAP_POSITIVE_Y, id: ids.posY },
        { target: gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, id: ids.negY },
        { target: gl.TEXTURE_CUBE_MAP_POSITIVE_Z, id: ids.posZ },
        { target: gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, id: ids.negZ },
    ];

    const atlas = BaseView.imgassets['_atlas']?.imgbin;

    for (const face of faces) {
        const asset = BaseView.imgassets[face.id];
        if (!asset) throw new Error(`Skybox image '${face.id}' not found`);

        let source: HTMLImageElement | HTMLCanvasElement | undefined = asset.imgbin;

        // If the image was packed into an atlas, extract its region
        if (!source && asset.imgmeta?.atlassed) {
            if (!atlas) throw new Error('Texture atlas image not found');
            const coords = asset.imgmeta.texcoords;
            if (!coords) throw new Error(`No texture coordinates for atlassed image '${face.id}'`);

            const xs = [coords[0], coords[2], coords[4], coords[6], coords[8], coords[10]];
            const ys = [coords[1], coords[3], coords[5], coords[7], coords[9], coords[11]];
            const minU = Math.min(...xs), maxU = Math.max(...xs);
            const minV = Math.min(...ys), maxV = Math.max(...ys);

            const sx = minU * atlas.width;
            const sy = minV * atlas.height;
            let sw = (maxU - minU) * atlas.width;
            let sh = (maxV - minV) * atlas.height;

            // Ensure that sw === sh
            if (sw !== sh) {
                // Ensure that we remain within the atlas bounds and that the texture is square
                const size = Math.min(sw, sh, atlas.width, atlas.height);
                sw = size;
                sh = size;
            }

            const canvas = document.createElement('canvas');
            canvas.width = sw;
            canvas.height = sh;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(atlas, sx, sy, sw, sh, 0, 0, sw, sh);
            source = canvas;
        }

        if (!source) throw new Error(`Skybox image '${face.id}' has no image data`);
        gl.texImage2D(face.target, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }

    // gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    // gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    // Geen mipmaps gebruiken
    // (als je ooit generateMipmap hebt geroepen: base/max-level vastzetten)
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_BASE_LEVEL, 0);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, 0);

    // Harde pixels
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    // Naadbehandeling aan randen
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
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

    // koppel sampler -> texture unit
    gl.uniform1i(skyboxTextureLocation, TEXTURE_UNIT_SKYBOX);
}

export function drawSkybox(gl: WebGL2RenderingContext, framebuffer: WebGLFramebuffer, canvasWidth: number, canvasHeight: number): void {
    if (!skyboxTexture) {
        return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    gl.disable(gl.CULL_FACE);
    glSwitchProgram(gl, skyboxProgram);
    gl.bindVertexArray(vaoSkybox);

    gl.bindBuffer(gl.ARRAY_BUFFER, skyboxBuffer);
    gl.vertexAttribPointer(skyboxPositionLocation, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(skyboxPositionLocation);

    const activeCamera = $.model.activeCamera3D;
    gl.uniformMatrix4fv(skyboxViewLocation, false, activeCamera.skyboxView());
    gl.uniformMatrix4fv(skyboxProjectionLocation, false, activeCamera.projection);

    gl.drawArrays(gl.TRIANGLES, 0, 36);
    gl.enable(gl.CULL_FACE);
}
