import { getWebGLErrorString } from './glview.helpers';

function checkError(gl: WebGL2RenderingContext, fn: string): void {
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
        console.error(`WebGL error in function '${fn}': '${getWebGLErrorString(gl, error)}' ('${error}').`);
    }
}

export function createBuffer(gl: WebGL2RenderingContext, data?: Float32Array | Uint8Array): WebGLBuffer {
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    checkError(gl, 'createBuffer');
    return buffer;
}

export function setupAttributeFloat(gl: WebGL2RenderingContext, buffer: WebGLBuffer, location: number, size: number): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    checkError(gl, 'setupAttributeFloat');
}

export function setupAttributeInt(gl: WebGL2RenderingContext, buffer: WebGLBuffer, location: number, size: number): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribIPointer(location, size, gl.UNSIGNED_BYTE, 0, 0);
    checkError(gl, 'setupAttributeInt');
}

export function updateBuffer(gl: WebGL2RenderingContext, buffer: WebGLBuffer, target: GLenum, offset: number, data: ArrayBufferView): void {
    gl.bindBuffer(target, buffer);
    gl.bufferSubData(target, offset, data);
    checkError(gl, 'updateBuffer');
}

export function loadShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw Error(`Error compiling shader: ${gl.getShaderInfoLog(shader)} `);
    }
    checkError(gl, 'loadShader');
    return shader;
}

export function createTexture(gl: WebGL2RenderingContext, img?: HTMLImageElement, size?: { width: number; height: number }, glTextureToBind?: number): WebGLTexture {
    const result = gl.createTexture()!;
    gl.activeTexture(glTextureToBind || gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, result);
    if (img) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    } else if (size) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size.width, size.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    checkError(gl, 'createTexture');
    return result;
}

export function switchProgram(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    gl.useProgram(program);
    checkError(gl, 'switchProgram');
}
