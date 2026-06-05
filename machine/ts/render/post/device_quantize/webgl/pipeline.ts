import type { RenderPassLibrary } from '../../../backend/pass/library';
import type { RenderGraphPassContext, RenderPassStateRegistry, TextureHandle } from '../../../backend/backend';
import type { WebGLBackend } from '../../../backend/webgl/backend';
import { TEXTURE_UNIT_POST_PROCESSING_SOURCE } from '../../../backend/webgl/constants';
import fragmentShaderDeviceCode from './shaders/device_quantize.frag.glsl';
import vertexShaderCRTCode from '../../webgl/shaders/fullscreen.vert.glsl';
import type { GameView } from '../../../gameview';
import {
	bindFullscreenQuad,
	createFullscreenQuad,
	updateFullscreenQuad,
	POST_PROCESS_TEXCOORDS,
	type FullscreenQuad,
} from '../../../backend/webgl/fullscreen_quad';

function createDeviceQuantizeState(): RenderPassStateRegistry['device_quantize'] {
	return {
		width: 0,
		height: 0,
		baseWidth: 0,
		baseHeight: 0,
		colorTex: null as TextureHandle,
		ditherType: 0,
	};
}

function writeDeviceQuantizeState(ctx: RenderGraphPassContext, state: RenderPassStateRegistry['device_quantize']): void {
	state.width = ctx.view.offscreenCanvasSize.x;
	state.height = ctx.view.offscreenCanvasSize.y;
	state.baseWidth = ctx.view.viewportSize.x;
	state.baseHeight = ctx.view.viewportSize.y;
	state.colorTex = ctx.getTex('frame_color');
	state.ditherType = (ctx.view as GameView).dither_type;
}

export function registerDeviceQuantize_WebGL(registry: RenderPassLibrary): void {
	let fullscreenQuad: FullscreenQuad;
	registry.register({
		id: 'device_quantize',
		name: 'DeviceQuantize',
		initialState: createDeviceQuantizeState(),
		graph: {
			reads: ['frame_color'],
			writes: ['device_color'],
			writeState: writeDeviceQuantizeState,
		},
		vsCode: vertexShaderCRTCode,
		fsCode: fragmentShaderDeviceCode,
		bootstrap: (backend) => {
			const gl = (backend as WebGLBackend).gl as WebGL2RenderingContext;
			fullscreenQuad = {
				gl,
				positionBuffer: null,
				texcoordBuffer: null,
				positionAttrib: -1,
				texcoordAttrib: -1,
				width: -1,
				height: -1,
				texcoords: POST_PROCESS_TEXCOORDS,
				label: 'DeviceQuantize',
			};
			createFullscreenQuad(fullscreenQuad);
		},
		shouldExecute: (view) => view.dither_type !== 0,
		exec: (_be: WebGLBackend, fbo, state: RenderPassStateRegistry['device_quantize']) => {
			renderDeviceQuantize(fullscreenQuad, fbo as WebGLFramebuffer, state);
		},
		prepare: (be: WebGLBackend, state: RenderPassStateRegistry['device_quantize']) => {
			bindDeviceQuantizeUniforms(be, state);
			be.setActiveTexture(TEXTURE_UNIT_POST_PROCESSING_SOURCE);
			be.bindTexture2D(state.colorTex as WebGLTexture);
		},
	});
}

function renderDeviceQuantize(fullscreenQuad: FullscreenQuad, fbo: WebGLFramebuffer, state: RenderPassStateRegistry['device_quantize']): void {
	const gl = fullscreenQuad.gl;
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.viewport(0, 0, state.width, state.height);
	updateFullscreenQuad(fullscreenQuad, state.width, state.height);
	bindFullscreenQuad(fullscreenQuad, fullscreenQuad.positionAttrib, fullscreenQuad.texcoordAttrib);
	gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function bindDeviceQuantizeUniforms(backend: WebGLBackend, state: RenderPassStateRegistry['device_quantize']): void {
	backend.setUniform2f('u_resolution', state.width, state.height);
	backend.setUniform1f('u_scale', 1.0);
	backend.setUniform2f('u_srcResolution', state.baseWidth, state.baseHeight);
	backend.setUniform1f('u_fragscale', state.width / state.baseWidth);
	backend.setUniform1i('u_dither_type', state.ditherType);
	backend.setUniform1i('u_texture', TEXTURE_UNIT_POST_PROCESSING_SOURCE);
}
