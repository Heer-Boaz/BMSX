import type { RenderPassLibrary } from '../backend/pass/library';
import type { RenderContext, RenderPassStateRegistry } from '../backend/backend';
import { WebGLBackend } from '../backend/webgl/backend';
import { consoleCore } from '../../core/console';
import { TEXTURE_UNIT_POST_PROCESSING_SOURCE } from '../backend/webgl/constants';
import vertexShaderCode from './shaders/framebuffer_2d.vert.glsl';
import fragmentShaderCode from './shaders/framebuffer_2d.frag.glsl';
import {
	bindFullscreenQuad,
	createFullscreenQuad,
	deleteFullscreenQuad,
	FRAMEBUFFER_TEXCOORDS,
	type FullscreenQuad,
} from '../backend/webgl/fullscreen_quad';

interface FrameBuffer2DRuntime {
	backend: WebGLBackend;
	gl: WebGL2RenderingContext;
	context: RenderContext;
}

let fsq: FullscreenQuad = null;

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
			deleteFullscreenQuad(gl, fsq);
		}
		fsq = createFullscreenQuad(gl, state.width, state.height, FRAMEBUFFER_TEXCOORDS, 'Framebuffer2D');
	}
	backend.setBlendEnabled(true);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	bindFullscreenQuad(gl, fsq);
	context.activeTexUnit = TEXTURE_UNIT_POST_PROCESSING_SOURCE;
	context.bind2DTex(state.colorTex);
	gl.drawArrays(gl.TRIANGLES, 0, 6);
	backend.setBlendEnabled(false);
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
			const runtime: FrameBuffer2DRuntime = { backend, gl: backend.gl as WebGL2RenderingContext, context: consoleCore.view };
			renderFrameBuffer(runtime, fbo as WebGLFramebuffer, state);
		},
		prepare: (backend: WebGLBackend, _state: RenderPassStateRegistry['framebuffer_2d']) => {
			const state: RenderPassStateRegistry['framebuffer_2d'] = {
				width: consoleCore.view.offscreenCanvasSize.x,
				height: consoleCore.view.offscreenCanvasSize.y,
				baseWidth: consoleCore.view.viewportSize.x,
				baseHeight: consoleCore.view.viewportSize.y,
				colorTex: consoleCore.view.vdpFrameBufferTextures.displayTexture(),
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
