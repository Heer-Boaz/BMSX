import { Size } from '../bmsx';
import { MAX_SPRITES, VERTEXCOORDS_SIZE } from './glview.constants';
import { getWebGLErrorString } from './glview.helpers';

function glCheckError(gl: WebGL2RenderingContext, fn: string): void {
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
        console.error(`WebGL error in function '${fn}': '${getWebGLErrorString(gl, error)}' ('${error}').`);
    }
}

/**
 * Gets the texture coordinates for the vertices of the rectangles.
 * The texture coordinates are used both for the game shader (sprites) and the CRT shader (full-screen quad).
 * @returns
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
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    glCheckError(gl, 'createBuffer');
    return buffer;
}

export function glCreateElementBuffer(gl: WebGL2RenderingContext, data?: Uint16Array | Uint32Array): WebGLBuffer {
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
    if (data) gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    else gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);
    glCheckError(gl, 'createElementBuffer');
    return buffer;
}

export function glSetupAttributeFloat(gl: WebGL2RenderingContext, buffer: WebGLBuffer, location: number, size: number): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    glCheckError(gl, 'setupAttributeFloat');
}

export function glSetupAttributeInt(gl: WebGL2RenderingContext, buffer: WebGLBuffer, location: number, size: number): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribIPointer(location, size, gl.UNSIGNED_BYTE, 0, 0);
    glCheckError(gl, 'setupAttributeInt');
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
    glCheckError(gl, 'updateBuffer');
}

export function glLoadShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw Error(`Error compiling shader: ${gl.getShaderInfoLog(shader)} `);
    }
    glCheckError(gl, 'loadShader');
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
    glCheckError(gl, 'createTexture');
    return result;
}

export function glSwitchProgram(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    gl.useProgram(program);
    glCheckError(gl, 'switchProgram');
}
