// Centralized low-level WebGL helper & resource creation utilities.
// Moved out of backend.ts to keep backend focused on orchestration.
import { $ } from '../../../core/engine';
import { formatNumberAsHex } from '../../../common/byte_hex_string';
import { TextureParams } from '../interfaces';
import { TEXTURE_UNIT_SHADOW_MAP, TEXTURE_UNIT_UPLOAD } from './constants';

function getRenderContext() {
	return $.view;
}

export function glCreateBuffer(
	gl: WebGL2RenderingContext,
	data?: ArrayBufferView,
): WebGLBuffer {
	const buffer = gl.createBuffer()!;
	if (!data) return buffer;
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
	const backend = getRenderContext().backend;
	backend.accountUpload('vertex', data.byteLength);
	return buffer;
}

export function glCreateElementBuffer(
	gl: WebGL2RenderingContext,
	data?: Uint8Array | Uint16Array | Uint32Array,
): WebGLBuffer {
	const buffer = gl.createBuffer()!;
	if (!data) return buffer;
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
	const backend = getRenderContext().backend;
	backend.accountUpload('index', data.byteLength);
	return buffer;
}

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

export function glCreateTexture(
	gl: WebGL2RenderingContext,
	img?: ImageBitmap,
	size?: { x: number; y: number },
	unit: number = null,
): WebGLTexture {
	const tex = gl.createTexture()!;
	if (unit != null) gl.activeTexture(gl.TEXTURE0 + unit);
	gl.bindTexture(gl.TEXTURE_2D, tex);

	if (img) {
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
		const backend = getRenderContext().backend;
		backend.accountUpload('texture', img.width * img.height * 4);
	} else if (size) {
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, size.x, size.y, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		const backend = getRenderContext().backend;
		backend.accountUpload('texture', size.x * size.y * 4);
	}

	glSetTexture2DParams(gl);
	return tex;
}

export function glSetTexture2DParams(gl: WebGL2RenderingContext, desc?: TextureParams): void {
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, desc?.wrapS ?? gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, desc?.wrapT ?? gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, desc?.minFilter ?? gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, desc?.magFilter ?? gl.NEAREST);
}

export function glSetTextureCubeParams(gl: WebGL2RenderingContext, desc: TextureParams): void {
	gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_BASE_LEVEL, 0);
	gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, 0);
	gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, desc.minFilter ?? gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, desc.magFilter ?? gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, desc.wrapS ?? gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, desc.wrapT ?? gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
}

export function glCreateShadowMapTextureAndFramebuffer(
	gl: WebGL2RenderingContext,
	desc: TextureParams,
	unit = TEXTURE_UNIT_SHADOW_MAP,
) {
	const tex = gl.createTexture()!;
	gl.activeTexture(gl.TEXTURE0 + unit);
	gl.bindTexture(gl.TEXTURE_2D, tex);
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.DEPTH_COMPONENT16,
		desc.size.x,
		desc.size.y,
		0,
		gl.DEPTH_COMPONENT,
		gl.UNSIGNED_SHORT,
		null,
	);
	const backendShadow = getRenderContext().backend;
	backendShadow.accountUpload('texture', desc.size.x * desc.size.y * 2);

	glSetTexture2DParams(gl);

	const fbo = gl.createFramebuffer()!;
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
	gl.drawBuffers([gl.NONE]);
	gl.readBuffer(gl.NONE);

	const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
	if (status !== gl.FRAMEBUFFER_COMPLETE) {
		throw new Error(`Shadow FBO incomplete: ${formatNumberAsHex(status)}`);
	}

	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	return { texture: tex, framebuffer: fbo };
}

export function glCreateTextureFromImage(
	gl: WebGL2RenderingContext,
	img: ImageBitmap,
	desc: TextureParams,
	unit: number = null,
): WebGLTexture {
	const tex = gl.createTexture()!;
	if (!img) throw new Error('Image is not defined');
	if (img.width === 0 || img.height === 0) throw new Error(`Image has invalid dimensions: ${img.width}x${img.height}`);
	if (unit != null) gl.activeTexture(gl.TEXTURE0 + unit);
	gl.bindTexture(gl.TEXTURE_2D, tex);
	gl.texImage2D(gl.TEXTURE_2D, 0, desc.srgb === false ? gl.RGBA8 : gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
	glSetTexture2DParams(gl, desc);
	return tex;
}

export function glCreateDepthTexture(
	gl: WebGL2RenderingContext,
	width: number,
	height: number,
	unit = TEXTURE_UNIT_UPLOAD,
): WebGLTexture {
	const tex = gl.createTexture()!;
	gl.activeTexture(gl.TEXTURE0 + unit);
	gl.bindTexture(gl.TEXTURE_2D, tex);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT16, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
	const backendDepth = getRenderContext().backend;
	backendDepth.accountUpload('texture', width * height * 2);
	glSetTexture2DParams(gl);
	return tex;
}

export function glSwitchProgram(gl: WebGL2RenderingContext, program: WebGLProgram): void {
	gl.useProgram(program);
}
