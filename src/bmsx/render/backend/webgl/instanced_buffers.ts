import type { WebGLBackend } from './backend';
import {
	TEXTURE_UNIT_TEXTPAGE_ENGINE,
	TEXTURE_UNIT_TEXTPAGE_PRIMARY,
	TEXTURE_UNIT_TEXTPAGE_SECONDARY,
} from './constants';
import type { PassEncoder } from '../backend';

export type WebGLInstancedBufferRuntime = {
	instanceFloatBuffer: WebGLBuffer;
	instanceTextpageBuffer: WebGLBuffer;
	floatData: Float32Array;
	textpageData: Uint8Array;
	capacity: number;
};

export type WebGLInstancedFloatAttribute = readonly [name: string, size: number, offset: number];

export type WebGLSpriteQuadUniforms = {
	scale: WebGLUniformLocation;
	texture0: WebGLUniformLocation;
	texture1: WebGLUniformLocation;
	texture2: WebGLUniformLocation;
};

export type WebGLInstancedQuadRuntime = WebGLInstancedBufferRuntime & {
	cornerBuffer: WebGLBuffer;
	uniforms: WebGLSpriteQuadUniforms;
};

const UNIT_QUAD_CORNERS = new Float32Array([
	0, 0,
	0, 1,
	1, 0,
	1, 0,
	0, 1,
	1, 1,
]);

export function createWebGLInstanceBuffers(backend: WebGLBackend, capacity: number, instanceFloats: number): WebGLInstancedBufferRuntime {
	return {
		instanceFloatBuffer: backend.createVertexBuffer(new Float32Array(capacity * instanceFloats), 'dynamic') as WebGLBuffer,
		instanceTextpageBuffer: backend.createVertexBuffer(new Uint8Array(capacity), 'dynamic') as WebGLBuffer,
		floatData: new Float32Array(capacity * instanceFloats),
		textpageData: new Uint8Array(capacity),
		capacity,
	};
}

export function getWebGLSpriteQuadUniforms(gl: WebGL2RenderingContext, program: WebGLProgram): WebGLSpriteQuadUniforms {
	return {
		scale: gl.getUniformLocation(program, 'u_scale')!,
		texture0: gl.getUniformLocation(program, 'u_texture0')!,
		texture1: gl.getUniformLocation(program, 'u_texture1')!,
		texture2: gl.getUniformLocation(program, 'u_texture2')!,
	};
}

export function bindWebGLSpriteQuadTextureUnits(gl: WebGL2RenderingContext, uniforms: WebGLSpriteQuadUniforms): void {
	gl.uniform1f(uniforms.scale, 1);
	gl.uniform1i(uniforms.texture0, TEXTURE_UNIT_TEXTPAGE_PRIMARY);
	gl.uniform1i(uniforms.texture1, TEXTURE_UNIT_TEXTPAGE_SECONDARY);
	gl.uniform1i(uniforms.texture2, TEXTURE_UNIT_TEXTPAGE_ENGINE);
}

export function bindWebGLUnitQuadCornerAttribute(backend: WebGLBackend, program: WebGLProgram, cornerBuffer: WebGLBuffer): void {
	const gl = backend.gl as WebGL2RenderingContext;
	backend.bindArrayBuffer(cornerBuffer);
	const location = gl.getAttribLocation(program, 'a_corner');
	gl.enableVertexAttribArray(location);
	gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
}

export function bindWebGLInstancedFloatAttributes(backend: WebGLBackend, program: WebGLProgram, strideBytes: number, attributes: readonly WebGLInstancedFloatAttribute[]): void {
	const gl = backend.gl as WebGL2RenderingContext;
	for (let index = 0; index < attributes.length; index += 1) {
		const [name, size, offset] = attributes[index];
		const location = gl.getAttribLocation(program, name);
		gl.enableVertexAttribArray(location);
		gl.vertexAttribPointer(location, size, gl.FLOAT, false, strideBytes, offset);
		gl.vertexAttribDivisor(location, 1);
	}
}

export function bindWebGLTextpageIdAttribute(backend: WebGLBackend, program: WebGLProgram, textpageBuffer: WebGLBuffer): void {
	const gl = backend.gl as WebGL2RenderingContext;
	backend.bindArrayBuffer(textpageBuffer);
	const location = gl.getAttribLocation(program, 'i_textpage_id');
	gl.enableVertexAttribArray(location);
	gl.vertexAttribIPointer(location, 1, gl.UNSIGNED_BYTE, 1, 0);
	gl.vertexAttribDivisor(location, 1);
}

export function createWebGLInstancedQuadRuntime(backend: WebGLBackend, gl: WebGL2RenderingContext, program: WebGLProgram, capacity: number, instanceFloats: number): WebGLInstancedQuadRuntime {
	const uniforms = getWebGLSpriteQuadUniforms(gl, program);
	bindWebGLSpriteQuadTextureUnits(gl, uniforms);
	return {
		cornerBuffer: backend.createVertexBuffer(UNIT_QUAD_CORNERS, 'static') as WebGLBuffer,
		uniforms,
		...createWebGLInstanceBuffers(backend, capacity, instanceFloats),
	};
}

export function bindWebGLInstancedQuadVertexArray(
	backend: WebGLBackend,
	vao: WebGLVertexArrayObject,
	program: WebGLProgram,
	quad: WebGLInstancedQuadRuntime,
	strideBytes: number,
	attributes: readonly WebGLInstancedFloatAttribute[],
): void {
	backend.bindVertexArray(vao);
	bindWebGLUnitQuadCornerAttribute(backend, program, quad.cornerBuffer);
	backend.bindArrayBuffer(quad.instanceFloatBuffer);
	bindWebGLInstancedFloatAttributes(backend, program, strideBytes, attributes);
	bindWebGLTextpageIdAttribute(backend, program, quad.instanceTextpageBuffer);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(null);
}

export function ensureWebGLInstanceBufferCapacity(backend: WebGLBackend, state: WebGLInstancedBufferRuntime, count: number, instanceFloats: number): void {
	if (count <= state.capacity) {
		return;
	}
	let capacity = state.capacity;
	while (capacity < count) {
		capacity <<= 1;
	}
	state.capacity = capacity;
	state.floatData = new Float32Array(capacity * instanceFloats);
	state.textpageData = new Uint8Array(capacity);
	backend.bindArrayBuffer(state.instanceFloatBuffer);
	backend.updateVertexBuffer(state.instanceFloatBuffer, state.floatData, 0);
	backend.bindArrayBuffer(state.instanceTextpageBuffer);
	backend.updateVertexBuffer(state.instanceTextpageBuffer, state.textpageData, 0);
	backend.bindArrayBuffer(null);
}

export function flushWebGLInstanceBatch(backend: WebGLBackend, pass: PassEncoder, state: WebGLInstancedBufferRuntime, count: number, instanceFloats: number): void {
	backend.bindArrayBuffer(state.instanceFloatBuffer);
	backend.updateVertexBuffer(state.instanceFloatBuffer, state.floatData, 0, 0, count * instanceFloats);
	backend.bindArrayBuffer(state.instanceTextpageBuffer);
	backend.updateVertexBuffer(state.instanceTextpageBuffer, state.textpageData, 0, 0, count);
	backend.drawInstanced(pass, 6, count, 0, 0);
}
