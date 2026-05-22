export interface FullscreenQuad {
	gl: WebGL2RenderingContext;
	positionBuffer: WebGLBuffer | null;
	texcoordBuffer: WebGLBuffer | null;
	positionAttrib: number;
	texcoordAttrib: number;
	width: number;
	height: number;
	texcoords: Float32Array;
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

const fullscreenQuadPositionsScratch = new Float32Array(12);

function writeFullscreenQuadPositions(width: number, height: number): Float32Array {
	fullscreenQuadPositionsScratch[0] = 0.0;
	fullscreenQuadPositionsScratch[1] = 0.0;
	fullscreenQuadPositionsScratch[2] = 0.0;
	fullscreenQuadPositionsScratch[3] = height;
	fullscreenQuadPositionsScratch[4] = width;
	fullscreenQuadPositionsScratch[5] = 0.0;
	fullscreenQuadPositionsScratch[6] = width;
	fullscreenQuadPositionsScratch[7] = 0.0;
	fullscreenQuadPositionsScratch[8] = 0.0;
	fullscreenQuadPositionsScratch[9] = height;
	fullscreenQuadPositionsScratch[10] = width;
	fullscreenQuadPositionsScratch[11] = height;
	return fullscreenQuadPositionsScratch;
}

export function createFullscreenQuad(quad: FullscreenQuad): void {
	const gl = quad.gl;
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
	const gl = quad.gl;
	gl.deleteBuffer(quad.positionBuffer);
	gl.deleteBuffer(quad.texcoordBuffer);
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
	const gl = quad.gl;
	gl.bindBuffer(gl.ARRAY_BUFFER, quad.positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, writeFullscreenQuadPositions(width, height), gl.STATIC_DRAW);
}

export function bindFullscreenQuad(quad: FullscreenQuad, positionAttrib: number, texcoordAttrib: number): void {
	const gl = quad.gl;
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
