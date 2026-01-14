import type { RenderPassLibrary } from '../backend/renderpasslib';
import type { RenderContext, RenderGraphPassContext, RenderPassStateRegistry } from '../backend/pipeline_interfaces';
import { WebGLBackend } from '../backend/webgl/webgl_backend';
import { $ } from '../../core/engine_core';
import { TEXTURE_UNIT_POST_PROCESSING_SOURCE } from '../backend/webgl/webgl.constants';
import fragmentShaderDeviceCode from './shaders/device_quantize.frag.glsl';
import vertexShaderCRTCode from './shaders/crt.vert.glsl';
import type { GameView } from '../gameview';

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

interface DeviceQuantizeRuntime {
	backend: WebGLBackend;
	gl: WebGL2RenderingContext;
	context: RenderContext;
}

export function registerDeviceQuantize_WebGL(registry: RenderPassLibrary): void {
	registry.register({
		id: 'device_quantize',
		name: 'DeviceQuantize',
		graph: {
			reads: ['frame_color'],
			writes: ['device_color'],
			buildState: (ctx: RenderGraphPassContext): RenderPassStateRegistry['device_quantize'] => ({
				width: ctx.view.offscreenCanvasSize.x,
				height: ctx.view.offscreenCanvasSize.y,
				baseWidth: ctx.view.viewportSize.x,
				baseHeight: ctx.view.viewportSize.y,
				colorTex: ctx.getTex('frame_color'),
				ditherType: (ctx.view as GameView).dither_type,
			}),
		},
		vsCode: vertexShaderCRTCode,
		fsCode: fragmentShaderDeviceCode,
		shouldExecute: () => $.view.dither_type !== 0,
		exec: (be: WebGLBackend, fbo, state: RenderPassStateRegistry['device_quantize']) => {
			const runtime: DeviceQuantizeRuntime = { backend: be, gl: be.gl as WebGL2RenderingContext, context: $.view };
			renderDeviceQuantize(runtime, fbo as WebGLFramebuffer, state);
		},
		prepare: (be: WebGLBackend, state: RenderPassStateRegistry['device_quantize']) => {
			const gl = be.gl;
			bindDeviceQuantizeUniforms(gl, state);
			if (state.colorTex) {
				gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_POST_PROCESSING_SOURCE);
				gl.bindTexture(gl.TEXTURE_2D, state.colorTex);
			}
			registry.validatePassResources('device_quantize', be);
		},
	});
}

function bindDeviceQuantizeUniforms(gl: WebGL2RenderingContext, state: RenderPassStateRegistry['device_quantize']): void {
	const program = gl.getParameter(gl.CURRENT_PROGRAM);
	const u = (n: string) => gl.getUniformLocation(program, n);
	const set1f = (n: string, v: number) => { const loc = u(n); gl.uniform1f(loc, v); };
	const set2f = (n: string, x: number, y: number) => { const loc = u(n); gl.uniform2f(loc, x, y); };

	set2f('u_resolution', state.width, state.height);
	set1f('u_scale', 1.0);
	set2f('u_srcResolution', state.baseWidth, state.baseHeight);
	set1f('u_fragscale', state.width / state.baseWidth);
	gl.uniform1ui(u('u_dither_type'), state.ditherType >>> 0);
	gl.uniform1i(u('u_texture'), TEXTURE_UNIT_POST_PROCESSING_SOURCE);
}

function renderDeviceQuantize(runtime: DeviceQuantizeRuntime, fbo: WebGLFramebuffer, state: RenderPassStateRegistry['device_quantize']): void {
	const { gl, context } = runtime;
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.viewport(0, 0, state.width, state.height);
	if (!fsq || fsq.w !== state.width || fsq.h !== state.height) {
		if (fsq) { gl.deleteBuffer(fsq.vbo); gl.deleteBuffer(fsq.tbo); }
		fsq = createFullscreenQuad(gl, state.width, state.height);
	}
	const { vbo, tbo, attribPos, attribTex } = fsq;
	gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
	if (attribPos !== -1) { gl.enableVertexAttribArray(attribPos); gl.vertexAttribPointer(attribPos, 2, gl.FLOAT, false, 0, 0); }
	gl.bindBuffer(gl.ARRAY_BUFFER, tbo);
	if (attribTex !== -1) { gl.enableVertexAttribArray(attribTex); gl.vertexAttribPointer(attribTex, 2, gl.FLOAT, false, 0, 0); }
	if (state.colorTex) {
		context.activeTexUnit = TEXTURE_UNIT_POST_PROCESSING_SOURCE;
		context.bind2DTex(state.colorTex);
	}
	gl.drawArrays(gl.TRIANGLES, 0, 6);
}
