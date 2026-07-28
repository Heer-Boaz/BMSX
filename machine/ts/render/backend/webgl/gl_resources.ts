import type { TextureParams } from '../texture_params';

export function glSetupAttributeFloat(
	gl: WebGL2RenderingContext,
	buffer: WebGLBuffer,
	location: number,
	size: number,
): void {
	if (location < 0) return;
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.enableVertexAttribArray(location);
	gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}

export function glSetupAttributeInt(
	gl: WebGL2RenderingContext,
	buffer: WebGLBuffer,
	location: number,
	size: number,
	type: GLenum = WebGL2RenderingContext.UNSIGNED_BYTE,
): void {
	if (location < 0) return;
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.enableVertexAttribArray(location);
	gl.vertexAttribIPointer(location, size, type, 0, 0);
}

export function glUpdateBuffer(
	gl: WebGL2RenderingContext,
	buffer: WebGLBuffer,
	target: GLenum,
	offset: number,
	data: ArrayBufferView,
): void {
	gl.bindBuffer(target, buffer);
	gl.bufferData(target, data.byteLength, gl.STREAM_DRAW);
	gl.bufferSubData(target, offset, data);
}

export function glLoadShader(
	gl: WebGL2RenderingContext,
	type: number,
	source: string,
): WebGLShader {
	const shader = gl.createShader(type)!;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		throw Error(`Error compiling shader: ${gl.getShaderInfoLog(shader)} `);
	}
	return shader;
}

export function glSetTexture2DParams(gl: WebGL2RenderingContext, desc: TextureParams): void {
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, desc.wrapS);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, desc.wrapT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, desc.minFilter);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, desc.magFilter);
}

export function glSetTextureCubeParams(gl: WebGL2RenderingContext, desc: TextureParams): void {
	gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_BASE_LEVEL, 0);
	gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, 0);
	gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, desc.minFilter);
	gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, desc.magFilter);
	gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, desc.wrapS);
	gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, desc.wrapT);
	gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
}
