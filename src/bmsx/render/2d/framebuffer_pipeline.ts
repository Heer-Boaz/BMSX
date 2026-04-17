import type { RenderPassLibrary } from '../backend/pass_library';
import type { RenderContext, RenderPassStateRegistry } from '../backend/interfaces';
import { WebGLBackend } from '../backend/webgl/backend';
import { $ } from '../../core/engine';
import { TEXTURE_UNIT_POST_PROCESSING_SOURCE } from '../backend/webgl/constants';
import vertexShaderCode from './shaders/framebuffer_2d.vert.glsl';
import fragmentShaderCode from './shaders/framebuffer_2d.frag.glsl';
import { Runtime } from '../../machine/runtime/runtime';

interface FullscreenQuad {
	vbo: WebGLBuffer;
	tbo: WebGLBuffer;
	attribPos: number;
	attribTex: number;
	w: number;
	h: number;
}

interface FrameBuffer2DRuntime {
	backend: WebGLBackend;
	gl: WebGL2RenderingContext;
	context: RenderContext;
}

let fsq: FullscreenQuad = null;

function createFullscreenQuad(gl: WebGL2RenderingContext, outW: number, outH: number): FullscreenQuad {
	const vsProg = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
	const verts = new Float32Array([
		0.0, 0.0, 0.0, outH, outW, 0.0, outW, 0.0, 0.0, outH, outW, outH,
	]);
	const texcoords = new Float32Array([
		0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0,
	]);
	const vbo = gl.createBuffer();
	if (!vbo) {
		throw new Error('[Framebuffer2D] Failed to create VBO.');
	}
	gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
	gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
	const tbo = gl.createBuffer();
	if (!tbo) {
		throw new Error('[Framebuffer2D] Failed to create TBO.');
	}
	gl.bindBuffer(gl.ARRAY_BUFFER, tbo);
	gl.bufferData(gl.ARRAY_BUFFER, texcoords, gl.STATIC_DRAW);
	const attribPos = vsProg ? gl.getAttribLocation(vsProg, 'a_position') : -1;
	const attribTex = vsProg ? gl.getAttribLocation(vsProg, 'a_texcoord') : -1;
	return { vbo, tbo, attribPos, attribTex, w: outW, h: outH };
}

function bindUniforms(gl: WebGL2RenderingContext, state: RenderPassStateRegistry['framebuffer_2d']): void {
	const program = gl.getParameter(gl.CURRENT_PROGRAM);
	const textureUniform = gl.getUniformLocation(program, 'u_texture');
	const resolutionUniform = gl.getUniformLocation(program, 'u_resolution');
	const scaleUniform = gl.getUniformLocation(program, 'u_scale');
	gl.uniform1i(textureUniform, TEXTURE_UNIT_POST_PROCESSING_SOURCE);
	gl.uniform2f(resolutionUniform, state.width, state.height);
	gl.uniform1f(scaleUniform, 1.0);
}

function renderFrameBuffer(runtime: FrameBuffer2DRuntime, fbo: WebGLFramebuffer, state: RenderPassStateRegistry['framebuffer_2d']): void {
	const { backend, gl, context } = runtime;
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.viewport(0, 0, state.width, state.height);
	backend.setDepthTestEnabled(false);
	backend.setDepthMask(false);
	if (!fsq || fsq.w !== state.width || fsq.h !== state.height) {
		if (fsq) {
			gl.deleteBuffer(fsq.vbo);
			gl.deleteBuffer(fsq.tbo);
		}
		fsq = createFullscreenQuad(gl, state.width, state.height);
	}
	backend.setBlendEnabled(false);
	gl.bindBuffer(gl.ARRAY_BUFFER, fsq.vbo);
	if (fsq.attribPos !== -1) {
		gl.enableVertexAttribArray(fsq.attribPos);
		gl.vertexAttribPointer(fsq.attribPos, 2, gl.FLOAT, false, 0, 0);
	}
	gl.bindBuffer(gl.ARRAY_BUFFER, fsq.tbo);
	if (fsq.attribTex !== -1) {
		gl.enableVertexAttribArray(fsq.attribTex);
		gl.vertexAttribPointer(fsq.attribTex, 2, gl.FLOAT, false, 0, 0);
	}
	context.activeTexUnit = TEXTURE_UNIT_POST_PROCESSING_SOURCE;
	context.bind2DTex(state.colorTex);
	gl.drawArrays(gl.TRIANGLES, 0, 6);
	backend.setDepthMask(true);
}

export function registerFramebuffer2DPass_WebGL(registry: RenderPassLibrary): void {
	registry.register({
		id: 'framebuffer_2d',
		name: 'Framebuffer2D',
		vsCode: vertexShaderCode,
		fsCode: fragmentShaderCode,
		shouldExecute: () => true,
		exec: (backend: WebGLBackend, fbo, state: RenderPassStateRegistry['framebuffer_2d']) => {
			const runtime: FrameBuffer2DRuntime = { backend, gl: backend.gl as WebGL2RenderingContext, context: $.view };
			renderFrameBuffer(runtime, fbo as WebGLFramebuffer, state);
		},
		prepare: (backend: WebGLBackend, _state: RenderPassStateRegistry['framebuffer_2d']) => {
			const state: RenderPassStateRegistry['framebuffer_2d'] = {
				width: $.view.offscreenCanvasSize.x,
				height: $.view.offscreenCanvasSize.y,
				baseWidth: $.view.viewportSize.x,
				baseHeight: $.view.viewportSize.y,
				colorTex: $.view.textures[Runtime.instance.machine.vdp.frameBufferTextureKey],
			};
			registry.setState('framebuffer_2d', state);
			const gl = backend.gl;
			bindUniforms(gl, state);
			if (state.colorTex) {
				gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_POST_PROCESSING_SOURCE);
				gl.bindTexture(gl.TEXTURE_2D, state.colorTex);
			}
		},
	});
}
