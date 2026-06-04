import type { RenderPassLibrary } from '../backend/pass/library';
import type { RenderContext, RenderGraphPassContext, RenderPassStateRegistry, TextureHandle } from '../backend/backend';
import type { WebGLBackend } from '../backend/webgl/backend';
import { TEXTURE_UNIT_POST_PROCESSING_SOURCE } from '../backend/webgl/constants';
import fragmentShaderDeviceCode from './shaders/device_quantize.frag.glsl';
import vertexShaderCRTCode from './shaders/crt.vert.glsl';
import type { GameView } from '../gameview';
import {
	bindFullscreenQuad,
	createFullscreenQuad,
	updateFullscreenQuad,
	POST_PROCESS_TEXCOORDS,
	type FullscreenQuad,
} from '../backend/webgl/fullscreen_quad';

let fsq: FullscreenQuad = null;

const deviceQuantizeStateScratch: RenderPassStateRegistry['device_quantize'] = {
	width: 0,
	height: 0,
	baseWidth: 0,
	baseHeight: 0,
	colorTex: null as unknown as TextureHandle,
	ditherType: 0,
};

function buildDeviceQuantizeState(ctx: RenderGraphPassContext): RenderPassStateRegistry['device_quantize'] {
	const state = deviceQuantizeStateScratch;
	state.width = ctx.view.offscreenCanvasSize.x;
	state.height = ctx.view.offscreenCanvasSize.y;
	state.baseWidth = ctx.view.viewportSize.x;
	state.baseHeight = ctx.view.viewportSize.y;
	state.colorTex = ctx.getTex('frame_color');
	state.ditherType = (ctx.view as GameView).dither_type;
	return state;
}

export function registerDeviceQuantize_WebGL(registry: RenderPassLibrary): void {
	registry.register({
		id: 'device_quantize',
		name: 'DeviceQuantize',
		graph: {
			reads: ['frame_color'],
			writes: ['device_color'],
			buildState: buildDeviceQuantizeState,
		},
		vsCode: vertexShaderCRTCode,
		fsCode: fragmentShaderDeviceCode,
		shouldExecute: () => registry.view.dither_type !== 0,
		exec: (be: WebGLBackend, fbo, state: RenderPassStateRegistry['device_quantize']) => {
			renderDeviceQuantize(be.gl as WebGL2RenderingContext, registry.view, fbo as WebGLFramebuffer, state);
		},
		prepare: (be: WebGLBackend, state: RenderPassStateRegistry['device_quantize']) => {
			const gl = be.gl;
			bindDeviceQuantizeUniforms(be, state);
			if (state.colorTex) {
				gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_POST_PROCESSING_SOURCE);
				gl.bindTexture(gl.TEXTURE_2D, state.colorTex);
			}
		},
	});
}

function bindDeviceQuantizeUniforms(backend: WebGLBackend, state: RenderPassStateRegistry['device_quantize']): void {
	backend.setUniform2f('u_resolution', state.width, state.height);
	backend.setUniform1f('u_scale', 1.0);
	backend.setUniform2f('u_srcResolution', state.baseWidth, state.baseHeight);
	backend.setUniform1f('u_fragscale', state.width / state.baseWidth);
	backend.setUniform1ui('u_dither_type', state.ditherType >>> 0);
	backend.setUniform1i('u_texture', TEXTURE_UNIT_POST_PROCESSING_SOURCE);
}

function renderDeviceQuantize(gl: WebGL2RenderingContext, context: RenderContext, fbo: WebGLFramebuffer, state: RenderPassStateRegistry['device_quantize']): void {
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.viewport(0, 0, state.width, state.height);
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
			label: 'DeviceQuantize',
		};
		createFullscreenQuad(fsq);
	}
	updateFullscreenQuad(fsq, state.width, state.height);
	bindFullscreenQuad(fsq, fsq.positionAttrib, fsq.texcoordAttrib);
	if (state.colorTex) {
		context.activeTexUnit = TEXTURE_UNIT_POST_PROCESSING_SOURCE;
		context.bind2DTex(state.colorTex);
	}
	gl.drawArrays(gl.TRIANGLES, 0, 6);
}
