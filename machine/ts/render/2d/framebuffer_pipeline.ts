import type { RenderPassLibrary } from '../backend/pass/library';
import type { RenderContext, RenderPassStateRegistry, TextureHandle } from '../backend/backend';
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

let fsq: FullscreenQuad = null;
let framebuffer2DTextureUniform: WebGLUniformLocation = null;
let framebuffer2DResolutionUniform: WebGLUniformLocation = null;
let framebuffer2DScaleUniform: WebGLUniformLocation = null;

const framebuffer2DStateScratch: RenderPassStateRegistry['framebuffer_2d'] = {
	width: 0,
	height: 0,
	baseWidth: 0,
	baseHeight: 0,
	colorTex: null as unknown as TextureHandle,
};

function getFramebuffer2DUniform(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
	const location = gl.getUniformLocation(program, name);
	if (location === null) {
		throw new Error(`[Framebuffer2D] Missing uniform ${name}.`);
	}
	return location;
}

function bootstrapFramebuffer2DPass(backend: WebGLBackend): void {
	const gl = backend.gl as WebGL2RenderingContext;
	const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
	framebuffer2DTextureUniform = getFramebuffer2DUniform(gl, program, 'u_texture');
	framebuffer2DResolutionUniform = getFramebuffer2DUniform(gl, program, 'u_resolution');
	framebuffer2DScaleUniform = getFramebuffer2DUniform(gl, program, 'u_scale');
	gl.uniform1i(framebuffer2DTextureUniform, TEXTURE_UNIT_POST_PROCESSING_SOURCE);
}

function bindFramebuffer2DUniforms(gl: WebGL2RenderingContext, state: RenderPassStateRegistry['framebuffer_2d']): void {
	gl.uniform1i(framebuffer2DTextureUniform, TEXTURE_UNIT_POST_PROCESSING_SOURCE);
	gl.uniform2f(framebuffer2DResolutionUniform, state.width, state.height);
	gl.uniform1f(framebuffer2DScaleUniform, 1.0);
}

function renderFrameBuffer(backend: WebGLBackend, gl: WebGL2RenderingContext, context: RenderContext, fbo: WebGLFramebuffer, state: RenderPassStateRegistry['framebuffer_2d']): void {
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.viewport(0, 0, state.width, state.height);
	backend.setDepthTestEnabled(false);
	backend.setDepthMask(false);
	if (!fsq) {
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
	}
	updateFullscreenQuad(fsq, state.width, state.height);
	backend.setBlendEnabled(true);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	bindFullscreenQuad(fsq, fsq.positionAttrib, fsq.texcoordAttrib);
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
		shouldExecute: (view) => view.presentWorkbenchFrameBufferTexture && view.vdpRpuFrame.commands.passCount === 0,
		bootstrap: (backend) => {
			bootstrapFramebuffer2DPass(backend as WebGLBackend);
		},
		exec: (backend: WebGLBackend, fbo, state: RenderPassStateRegistry['framebuffer_2d']) => {
			renderFrameBuffer(backend, backend.gl as WebGL2RenderingContext, registry.view, fbo as WebGLFramebuffer, state);
		},
		prepare: (backend: WebGLBackend, _state: RenderPassStateRegistry['framebuffer_2d']) => {
			const view = registry.view;
			const state = framebuffer2DStateScratch;
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
