import { Size } from '../rompack/rompack';
import { MAX_SPRITES, VERTEXCOORDS_SIZE } from './glview.constants';
import { checkWebGLError } from './glview.helpers';
import { TextureParams } from './texturemanager';

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

export function glCreateBuffer(gl: WebGL2RenderingContext, data?: Float32Array | Uint8Array): WebGLBuffer {
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, (data as any) ?? 0, gl.DYNAMIC_DRAW);
    checkWebGLError('createBuffer');
    return buffer;
}

export function glCreateElementBuffer(gl: WebGL2RenderingContext, data?: Uint16Array | Uint32Array): WebGLBuffer {
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, (data as any) ?? 0, gl.DYNAMIC_DRAW);
    checkWebGLError('createElementBuffer');
    return buffer;
}

export function glSetupAttributeFloat(gl: WebGL2RenderingContext, buffer: WebGLBuffer, location: number, size: number): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    checkWebGLError('setupAttributeFloat');
}

export function glSetupAttributeInt(gl: WebGL2RenderingContext, buffer: WebGLBuffer, location: number, size: number): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribIPointer(location, size, gl.UNSIGNED_BYTE, 0, 0);
    checkWebGLError('setupAttributeInt');
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
    gl.bufferSubData(target, offset, data);
    checkWebGLError('updateBuffer');
}

export function glLoadShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw Error(`Error compiling shader: ${gl.getShaderInfoLog(shader)} `);
    }
    checkWebGLError('loadShader');
    return shader;
}

export function glCreateTexture(gl: WebGL2RenderingContext, img?: HTMLImageElement, size?: Size, glTextureToBind?: number): WebGLTexture {
    const result = gl.createTexture()!;
    gl.activeTexture(glTextureToBind || gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, result);
    if (img) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    } else if (size) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size.x, size.y, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    checkWebGLError('createTexture');
    return result;
}

export function glCreateShadowMapTextureAndFramebuffer(gl: WebGL2RenderingContext, desc: TextureParams) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT16, desc.size.x, desc.size.y, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    checkWebGLError('createShadowMapTextureAndFramebuffer');
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('Framebuffer is not complete');
    }
    return { texture, framebuffer };
}

export function glCreateTextureFromImage(gl: WebGL2RenderingContext, img: ImageBitmap, glTextureToBind: number, desc: TextureParams): WebGLTexture {
    const prevActive = gl.getParameter(gl.ACTIVE_TEXTURE);
    gl.activeTexture(glTextureToBind);
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);

    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, desc.wrapS ?? gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, desc.wrapT ?? gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, desc.minFilter ?? gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, desc.magFilter ?? gl.NEAREST);

    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    gl.activeTexture(prevActive);
    if (checkWebGLError('createTextureFromImage')) {
        throw new Error('Error creating texture from image');
    }
    return tex;
}

export function glSwitchProgram(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    gl.useProgram(program);
    checkWebGLError('switchProgram');
}
