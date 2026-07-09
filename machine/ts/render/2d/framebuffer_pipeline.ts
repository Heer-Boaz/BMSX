import type { RenderPassLibrary } from '../backend/pass/library';
import type { RenderPassStateRegistry } from '../backend/backend';
import type { WebGLBackend } from '../backend/webgl/backend';
import { TEXTURE_UNIT_POST_PROCESSING_SOURCE } from '../backend/webgl/constants';
import vertexShaderCode from './shaders/framebuffer_2d.vert.glsl';
import fragmentShaderCode from './shaders/framebuffer_2d.frag.glsl';
import {
	bindFullscreenQuad,
	createFullscreenQuad,
	updateFullscreenQuad,
	POST_PROCESS_TEXCOORDS,
	type FullscreenQuad,
} from '../backend/webgl/fullscreen_quad';

let fsq: FullscreenQuad;
let framebuffer2DTextureUniform: WebGLUniformLocation;
let framebuffer2DResolutionUniform: WebGLUniformLocation;
let framebuffer2DScaleUniform: WebGLUniformLocation;

function bootstrapFramebuffer2DPass(backend: WebGLBackend): void {
	const gl = backend.gl as WebGL2RenderingContext;
	const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
	framebuffer2DTextureUniform = gl.getUniformLocation(program, 'u_texture') as WebGLUniformLocation;
	framebuffer2DResolutionUniform = gl.getUniformLocation(program, 'u_resolution') as WebGLUniformLocation;
	framebuffer2DScaleUniform = gl.getUniformLocation(program, 'u_scale') as WebGLUniformLocation;
	fsq = {
		gl,
		positionBuffer: null,
		texcoordBuffer: null,
		positionAttrib: -1,
		texcoordAttrib: -1,
		width: -1,
		height: -1,
		texcoords: POST_PROCESS_TEXCOORDS,
		label: 'Framebuffer2D',
	};
	createFullscreenQuad(fsq);
	gl.uniform1i(framebuffer2DTextureUniform, TEXTURE_UNIT_POST_PROCESSING_SOURCE);
}

function bindFramebuffer2DUniforms(gl: WebGL2RenderingContext, state: RenderPassStateRegistry['framebuffer_2d']): void {
	gl.uniform1i(framebuffer2DTextureUniform, TEXTURE_UNIT_POST_PROCESSING_SOURCE);
	gl.uniform2f(framebuffer2DResolutionUniform, state.width, state.height);
	gl.uniform1f(framebuffer2DScaleUniform, 1.0);
}

function renderFrameBuffer(backend: WebGLBackend, gl: WebGL2RenderingContext, fbo: WebGLFramebuffer, state: RenderPassStateRegistry['framebuffer_2d']): void {
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.viewport(0, 0, state.width, state.height);
	backend.setDepthTestEnabled(false);
	backend.setDepthMask(false);
	updateFullscreenQuad(fsq, state.width, state.height);
	backend.setBlendEnabled(true);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	bindFullscreenQuad(fsq, fsq.positionAttrib, fsq.texcoordAttrib);
	backend.setActiveTexture(TEXTURE_UNIT_POST_PROCESSING_SOURCE);
	backend.bindTexture2D(state.colorTex as WebGLTexture);
	gl.drawArrays(gl.TRIANGLES, 0, 6);
	backend.setBlendEnabled(false);
	backend.setDepthMask(true);
}

export function registerFramebuffer2DPass(registry: RenderPassLibrary): void {
	const framebuffer2DState: RenderPassStateRegistry['framebuffer_2d'] = {
		width: 0,
		height: 0,
		baseWidth: 0,
		baseHeight: 0,
		colorTex: registry.view.vdpFrameBufferTextures.displayTexture(),
	};
	registry.register({
		id: 'framebuffer_2d',
		name: 'Framebuffer2D',
		vsCode: vertexShaderCode,
		fsCode: fragmentShaderCode,
		shouldExecute: (view) => view.presentWorkbenchFrameBufferTexture && view.vdpRpuFrame.commands.passCount === 0,
		bootstrap: (backend) => {
			bootstrapFramebuffer2DPass(backend as WebGLBackend);
		},
		exec: (backend: WebGLBackend, fbo, state: RenderPassStateRegistry['framebuffer_2d']) => {
			renderFrameBuffer(backend, backend.gl as WebGL2RenderingContext, fbo as WebGLFramebuffer, state);
		},
		prepare: (backend: WebGLBackend, _state: RenderPassStateRegistry['framebuffer_2d']) => {
			const view = registry.view;
			const state = framebuffer2DState;
			state.width = view.offscreenCanvasSize.x;
			state.height = view.offscreenCanvasSize.y;
			state.baseWidth = view.viewportSize.x;
			state.baseHeight = view.viewportSize.y;
			state.colorTex = view.vdpFrameBufferTextures.displayTexture();
			registry.setState('framebuffer_2d', state);
			const gl = backend.gl;
			bindFramebuffer2DUniforms(gl, state);
			gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_POST_PROCESSING_SOURCE);
			gl.bindTexture(gl.TEXTURE_2D, state.colorTex);
		},
	});
}
