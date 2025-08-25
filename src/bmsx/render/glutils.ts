import { $ } from '../core/game';
import { Size } from '../rompack/rompack';
import { GLView, TEXTURE_UNIT_SHADOW_MAP, TEXTURE_UNIT_UPLOAD } from './glview';
import { MAX_SPRITES, VERTEXCOORDS_SIZE } from './glview.constants';
import { checkWebGLError } from './glview.helpers';
import { TextureParams } from './gpu_types';

/**
 * Gets the texture coordinates for the vertices of the rectangles.
 * The texture coordinates are used both for the game shader (sprites) and the CRT shader (full-screen quad).
 * @returns {Float32Array} The texture coordinates for the vertices of the rectangles.
 * The coordinates are in the order of top-left, bottom-left, top-right, top-right, bottom-left, bottom-right.
 * This ordering is important to avoid a vertical flip when rendering sprites.
 */
export function buildQuadTexCoords(): Float32Array {
    const textureCoordinates = new Float32Array(VERTEXCOORDS_SIZE * MAX_SPRITES);
    for (let i = 0; i < VERTEXCOORDS_SIZE * MAX_SPRITES - VERTEXCOORDS_SIZE; i += VERTEXCOORDS_SIZE) {
        // The vertex ordering for quads starts at the top-left corner.
        // Provide texture coordinates in the same order so sprites are
        // rendered without a vertical flip.
        textureCoordinates.set([
            0.0, 1.0, // top-left
            0.0, 0.0, // bottom-left
            1.0, 1.0, // top-right
            1.0, 1.0, // top-right
            0.0, 0.0, // bottom-left
            1.0, 0.0, // bottom-right
        ], i);
    }
    return textureCoordinates;
}

// @ts-ignore
function generateByteLengthString(data?: ArrayBufferView): string {
    if (data) {
        return `data length: ${data.byteLength} bytes`;
    }
    return `data was 'undefined' and thus has a length of 0 bytes`;
}

export function glCreateBuffer(gl: WebGL2RenderingContext, data?: Float32Array | Uint8Array): WebGLBuffer {
    const buffer = gl.createBuffer()!;
    if (!data) return buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    return buffer;
}

export function glCreateElementBuffer(gl: WebGL2RenderingContext, data?: Uint8Array | Uint16Array | Uint32Array): WebGLBuffer {
    const buffer = gl.createBuffer()!;
    if (!data) return buffer;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    return buffer;
}

export function glSetupAttributeFloat(gl: WebGL2RenderingContext, buffer: WebGLBuffer, location: number, size: number): void {
    if (location < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}

export function glSetupAttributeInt(gl: WebGL2RenderingContext, buffer: WebGLBuffer, location: number, size: number, type: GLenum = gl.UNSIGNED_BYTE): void {
    if (location < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribIPointer(location, size, type, 0, 0);
}

/**
 * Updates a WebGL buffer with new data.
 * @param gl The WebGL rendering context.
 * @param buffer The buffer to update.
 * @param target The target buffer object.
 * @param offset The offset into the buffer to start updating.
 * @param data The new data to write into the buffer.
 */
export function glUpdateBuffer(gl: WebGL2RenderingContext, buffer: WebGLBuffer, target: GLenum, offset: number, data: ArrayBufferView): void {
    gl.bindBuffer(target, buffer);
    // Orphan the old storage to avoid GPU/CPU sync
    gl.bufferData(target, data.byteLength, gl.STREAM_DRAW);
    gl.bufferSubData(target, offset, data);
}

export function glLoadShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw Error(`Error compiling shader: ${gl.getShaderInfoLog(shader)} `);
    }
    return shader;
}

export function glCreateTexture(gl: WebGL2RenderingContext, img?: ImageBitmap, size?: Size, unit = null): WebGLTexture {
    $.viewAs<GLView>().activeTexUnit = unit ?? TEXTURE_UNIT_UPLOAD;
    checkWebGLError('After setActiveTextureUnit');
    const tex = gl.createTexture()!;
    $.viewAs<GLView>().bind2DTex(tex);
    checkWebGLError('After createTexture');
    if (img) gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    else if (size) gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, size.x, size.y, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    checkWebGLError('After texImage2D');
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    checkWebGLError('After setTextureParameters');
    return tex;
}

export function glCreateShadowMapTextureAndFramebuffer(gl: WebGL2RenderingContext, desc: TextureParams, unit = TEXTURE_UNIT_SHADOW_MAP) {
    $.viewAs<GLView>().activeTexUnit = unit ?? TEXTURE_UNIT_UPLOAD;
    const tex = gl.createTexture()!;
    $.viewAs<GLView>().bind2DTex(tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT16, desc.size.x, desc.size.y, 0,
        gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);

    // IMPORTANT for depth‑only FBOs on iOS:
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`Shadow FBO incomplete: 0x${status.toString(16)}`);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture: tex, framebuffer: fbo };
}

export function glCreateTextureFromImage(gl: WebGL2RenderingContext, img: ImageBitmap, desc: TextureParams, unit = null): WebGLTexture {
    $.viewAs<GLView>().activeTexUnit = unit ?? TEXTURE_UNIT_UPLOAD;
    const tex = gl.createTexture()!;
    if (!img) throw new Error('Image is not defined');
    if (img.width === 0 || img.height === 0) throw new Error(`Image has invalid dimensions: ${img.width}x${img.height}`);

    // Apply Y‑flip ONLY for this upload. This does not retroactively change existing textures.
    // If you toggle desc.flipY later you must re-upload the texture.
    $.viewAs<GLView>().bind2DTex(tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, desc.wrapS ?? gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, desc.wrapT ?? gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, desc.minFilter ?? gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, desc.magFilter ?? gl.NEAREST);

    return tex;
}

export function glCreateDepthTexture(gl: WebGL2RenderingContext, width: number, height: number, unit = TEXTURE_UNIT_UPLOAD): WebGLTexture {
    $.viewAs<GLView>().activeTexUnit = unit;
    const tex = gl.createTexture()!;
    $.viewAs<GLView>().bind2DTex(tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT16, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
}

export function glSwitchProgram(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    gl.useProgram(program);
}
