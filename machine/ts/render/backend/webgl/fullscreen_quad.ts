import type { WebGLBackend } from './backend';

export interface FullscreenQuad {
	backend: WebGLBackend;
	positionBuffer: WebGLBuffer | null;
	texcoordBuffer: WebGLBuffer | null;
	positionAttrib: number;
	texcoordAttrib: number;
	width: number;
	height: number;
	texcoords: Float32Array;
	positions: Float32Array;
	label: string;
}

export const POST_PROCESS_TEXCOORDS = new Float32Array(12);
POST_PROCESS_TEXCOORDS[0] = 0.0;
POST_PROCESS_TEXCOORDS[1] = 1.0;
POST_PROCESS_TEXCOORDS[2] = 0.0;
POST_PROCESS_TEXCOORDS[3] = 0.0;
POST_PROCESS_TEXCOORDS[4] = 1.0;
POST_PROCESS_TEXCOORDS[5] = 1.0;
POST_PROCESS_TEXCOORDS[6] = 1.0;
POST_PROCESS_TEXCOORDS[7] = 1.0;
POST_PROCESS_TEXCOORDS[8] = 0.0;
POST_PROCESS_TEXCOORDS[9] = 0.0;
POST_PROCESS_TEXCOORDS[10] = 1.0;
POST_PROCESS_TEXCOORDS[11] = 0.0;

export function createFullscreenQuad(quad: FullscreenQuad): void {
	const gl = quad.backend.gl;
	const vsProg = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
	const positionBuffer = gl.createBuffer();
	if (!positionBuffer) {
		throw new Error(`[${quad.label}] Failed to create position buffer.`);
	}
	const texcoordBuffer = gl.createBuffer();
	if (!texcoordBuffer) {
		throw new Error(`[${quad.label}] Failed to create texcoord buffer.`);
	}
	quad.positionBuffer = positionBuffer;
	quad.texcoordBuffer = texcoordBuffer;
	quad.positionAttrib = vsProg ? gl.getAttribLocation(vsProg, 'a_position') : -1;
	quad.texcoordAttrib = vsProg ? gl.getAttribLocation(vsProg, 'a_texcoord') : -1;
	gl.bindBuffer(gl.ARRAY_BUFFER, quad.texcoordBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, quad.texcoords, gl.STATIC_DRAW);
}

export function destroyFullscreenQuad(quad: FullscreenQuad): void {
	quad.backend.destroyBuffer(quad.positionBuffer);
	quad.backend.destroyBuffer(quad.texcoordBuffer);
	quad.positionBuffer = null;
	quad.texcoordBuffer = null;
	quad.width = -1;
	quad.height = -1;
}

export function updateFullscreenQuad(quad: FullscreenQuad, width: number, height: number): void {
	if (quad.width === width && quad.height === height) {
		return;
	}
	quad.width = width;
	quad.height = height;
	const gl = quad.backend.gl;
	const positions = quad.positions;
	positions[0] = 0.0;
	positions[1] = 0.0;
	positions[2] = 0.0;
	positions[3] = height;
	positions[4] = width;
	positions[5] = 0.0;
	positions[6] = width;
	positions[7] = 0.0;
	positions[8] = 0.0;
	positions[9] = height;
	positions[10] = width;
	positions[11] = height;
	gl.bindBuffer(gl.ARRAY_BUFFER, quad.positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
}

export function bindFullscreenQuad(quad: FullscreenQuad, positionAttrib: number, texcoordAttrib: number): void {
	const gl = quad.backend.gl;
	gl.bindBuffer(gl.ARRAY_BUFFER, quad.positionBuffer);
	if (positionAttrib !== -1) {
		gl.enableVertexAttribArray(positionAttrib);
		gl.vertexAttribPointer(positionAttrib, 2, gl.FLOAT, false, 0, 0);
	}
	gl.bindBuffer(gl.ARRAY_BUFFER, quad.texcoordBuffer);
	if (texcoordAttrib !== -1) {
		gl.enableVertexAttribArray(texcoordAttrib);
		gl.vertexAttribPointer(texcoordAttrib, 2, gl.FLOAT, false, 0, 0);
	}
}
