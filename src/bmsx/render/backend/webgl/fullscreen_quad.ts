export interface FullscreenQuad {
	vbo: WebGLBuffer;
	tbo: WebGLBuffer;
	attribPos: number;
	attribTex: number;
	w: number;
	h: number;
}

export const POST_PROCESS_TEXCOORDS = [
	0.0, 1.0,
	0.0, 0.0,
	1.0, 1.0,
	1.0, 1.0,
	0.0, 0.0,
	1.0, 0.0,
] as const;

export const FRAMEBUFFER_TEXCOORDS = [
	0.0, 0.0,
	0.0, 1.0,
	1.0, 0.0,
	1.0, 0.0,
	0.0, 1.0,
	1.0, 1.0,
] as const;

export function createFullscreenQuad(gl: WebGL2RenderingContext, outW: number, outH: number, texcoords: readonly number[], label: string): FullscreenQuad {
	const vsProg = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
	const verts = new Float32Array([
		0.0, 0.0,
		0.0, outH,
		outW, 0.0,
		outW, 0.0,
		0.0, outH,
		outW, outH,
	]);
	const vbo = gl.createBuffer();
	if (!vbo) {
		throw new Error(`[${label}] Failed to create VBO.`);
	}
	gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
	gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
	const tbo = gl.createBuffer();
	if (!tbo) {
		throw new Error(`[${label}] Failed to create TBO.`);
	}
	gl.bindBuffer(gl.ARRAY_BUFFER, tbo);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texcoords), gl.STATIC_DRAW);
	const attribPos = vsProg ? gl.getAttribLocation(vsProg, 'a_position') : -1;
	const attribTex = vsProg ? gl.getAttribLocation(vsProg, 'a_texcoord') : -1;
	return { vbo, tbo, attribPos, attribTex, w: outW, h: outH };
}

export function deleteFullscreenQuad(gl: WebGL2RenderingContext, quad: FullscreenQuad): void {
	gl.deleteBuffer(quad.vbo);
	gl.deleteBuffer(quad.tbo);
}

export function bindFullscreenQuad(gl: WebGL2RenderingContext, quad: FullscreenQuad): void {
	gl.bindBuffer(gl.ARRAY_BUFFER, quad.vbo);
	if (quad.attribPos !== -1) {
		gl.enableVertexAttribArray(quad.attribPos);
		gl.vertexAttribPointer(quad.attribPos, 2, gl.FLOAT, false, 0, 0);
	}
	gl.bindBuffer(gl.ARRAY_BUFFER, quad.tbo);
	if (quad.attribTex !== -1) {
		gl.enableVertexAttribArray(quad.attribTex);
		gl.vertexAttribPointer(quad.attribTex, 2, gl.FLOAT, false, 0, 0);
	}
}
