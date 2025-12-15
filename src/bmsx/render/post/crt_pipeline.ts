import type { RenderPassLibrary } from '../backend/renderpasslib';
import type { RenderContext, TextureHandle } from '../backend/pipeline_interfaces';
import type { GPUBackend } from '../backend/pipeline_interfaces';
import { WebGLBackend } from '../backend/webgl/webgl_backend';
import { $ } from '../../core/game';
import { TEXTURE_UNIT_POST_PROCESSING_SOURCE } from '../backend/webgl/webgl.constants';
import fragmentShaderCRTCode from './shaders/crt.frag.glsl';
import vertexShaderCRTCode from './shaders/crt.vert.glsl';
// Local copy of CRTState to avoid import issues after refactor (remove duplication later)
interface CRTState { width: number; height: number; baseWidth: number; baseHeight: number; outWidth?: number; outHeight?: number; colorTex?: TextureHandle; options?: any }

// Internal cached fullscreen quad (VBO + TBO + attrib locations)
interface FullscreenQuad { vbo: WebGLBuffer; tbo: WebGLBuffer; attribPos: number; attribTex: number; w: number; h: number }
let fsq: FullscreenQuad = null;

function createFullscreenQuad(gl: WebGL2RenderingContext, outW: number, outH: number): FullscreenQuad {
	const vsProg = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
	const verts = new Float32Array([
		0.0, 0.0, 0.0, outH, outW, 0.0, outW, 0.0, 0.0, outH, outW, outH,
	]);
	const texcoords = new Float32Array([
		0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0
	]);
	const vbo = gl.createBuffer(); if (!vbo) throw new Error('Failed to create VBO');
	gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
	const tbo = gl.createBuffer(); if (!tbo) throw new Error('Failed to create TBO');
	gl.bindBuffer(gl.ARRAY_BUFFER, tbo); gl.bufferData(gl.ARRAY_BUFFER, texcoords, gl.STATIC_DRAW);
	const attribPos = vsProg ? gl.getAttribLocation(vsProg, 'a_position') : -1;
	const attribTex = vsProg ? gl.getAttribLocation(vsProg, 'a_texcoord') : -1;
	return { vbo, tbo, attribPos, attribTex, w: outW, h: outH };
}

interface CRTRuntime {
	backend: WebGLBackend;
	gl: WebGL2RenderingContext;
	context: RenderContext;
}

export function registerCRT_WebGL(registry: RenderPassLibrary): void {
	registry.register({
		id: 'crt',
		label: 'crt',
		name: 'Present/CRT',
		vsCode: vertexShaderCRTCode,
		fsCode: fragmentShaderCRTCode,
		present: true,
		exec: (backend: GPUBackend, _fbo, state: unknown) => {
			const be = backend as WebGLBackend;
			const runtime: CRTRuntime = { backend: be, gl: be.gl as WebGL2RenderingContext, context: $.view };
			const st = state as CRTState;
			renderCRT(runtime, st);
		},
		prepare: (backend, state: unknown) => {
			const gl = (backend as WebGLBackend).gl as WebGL2RenderingContext;
			const st = state as CRTState;
			bindCRTUniforms(gl, st);
			if (st.colorTex) {
				gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_POST_PROCESSING_SOURCE);
				gl.bindTexture(gl.TEXTURE_2D, st.colorTex as WebGLTexture);
			}
			registry.validatePassResources('crt', backend);
		}
	});
}

function bindCRTUniforms(gl: WebGL2RenderingContext, st: CRTState): void {
	const now = $.platform.clock.now() / 1000;
	const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram; if (!program) return;
	const u = (n: string) => gl.getUniformLocation(program, n);
	const outW = st.outWidth ?? st.width;
	const outH = st.outHeight ?? st.height;
	const set1f = (n: string, v: number) => { const loc = u(n); if (loc) gl.uniform1f(loc, v); };
	const set2f = (n: string, x: number, y: number) => { const loc = u(n); if (loc) gl.uniform2f(loc, x, y); };
	set1f('u_time', now); set1f('u_random', Math.random());
	set2f('u_resolution', outW, outH);
	set2f('u_srcResolution', st.baseWidth, st.baseHeight);
	set1f('u_scale', 1.0);
	set1f('u_fragscale', st.width / st.baseWidth);
	const opts = st.options || {};
	const booleans: Array<[string, boolean, boolean]> = [
		['u_applyNoise', opts.applyNoise, true], ['u_applyColorBleed', opts.applyColorBleed, true], ['u_applyScanlines', opts.applyScanlines, true], ['u_applyBlur', opts.applyBlur, true], ['u_applyGlow', opts.applyGlow, true], ['u_applyFringing', opts.applyFringing, true]
	];
	for (const [name, val, def] of booleans) { const loc = u(name); if (loc) gl.uniform1i(loc, (val ?? def) ? 1 : 0); }
	set1f('u_noiseIntensity', opts.noiseIntensity ?? 0.4);
	{ const loc = u('u_colorBleed'); if (loc) gl.uniform3fv(loc, new Float32Array(opts.colorBleed ?? [0.02, 0.0, 0.0])); }
	set1f('u_blurIntensity', opts.blurIntensity ?? 0.6);
	{ const loc = u('u_glowColor'); if (loc) gl.uniform3fv(loc, new Float32Array(opts.glowColor ?? [0.12, 0.10, 0.09])); }
	{ const loc = u('u_texture'); if (loc) gl.uniform1i(loc, TEXTURE_UNIT_POST_PROCESSING_SOURCE); }
}

function renderCRT(runtime: CRTRuntime, st: CRTState): void {
	const { gl, context } = runtime;
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	const outW = st.outWidth ?? st.width;
	const outH = st.outHeight ?? st.height;
	gl.viewport(0, 0, outW, outH);
	if (!fsq || fsq.w !== outW || fsq.h !== outH) {
		if (fsq) { gl.deleteBuffer(fsq.vbo); gl.deleteBuffer(fsq.tbo); }
		fsq = createFullscreenQuad(gl, outW, outH);
	}
	const { vbo, tbo, attribPos, attribTex } = fsq;
	gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
	if (attribPos !== -1) { gl.enableVertexAttribArray(attribPos); gl.vertexAttribPointer(attribPos, 2, gl.FLOAT, false, 0, 0); }
	gl.bindBuffer(gl.ARRAY_BUFFER, tbo);
	if (attribTex !== -1) { gl.enableVertexAttribArray(attribTex); gl.vertexAttribPointer(attribTex, 2, gl.FLOAT, false, 0, 0); }
	if (st.colorTex) {
		context.activeTexUnit = TEXTURE_UNIT_POST_PROCESSING_SOURCE;
		context.bind2DTex(st.colorTex);
	}
	gl.drawArrays(gl.TRIANGLES, 0, 6);
}
