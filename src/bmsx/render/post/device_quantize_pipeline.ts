import type { RenderPassLibrary } from '../backend/pass/library';
import type { RenderContext, RenderGraphPassContext, RenderPassStateRegistry } from '../backend/backend';
import { WebGLBackend } from '../backend/webgl/backend';
import { consoleCore } from '../../core/console';
import { TEXTURE_UNIT_POST_PROCESSING_SOURCE } from '../backend/webgl/constants';
import fragmentShaderDeviceCode from './shaders/device_quantize.frag.glsl';
import vertexShaderCRTCode from './shaders/crt.vert.glsl';
import type { GameView } from '../gameview';
import {
	bindFullscreenQuad,
	createFullscreenQuad,
	deleteFullscreenQuad,
	POST_PROCESS_TEXCOORDS,
	type FullscreenQuad,
} from '../backend/webgl/fullscreen_quad';

let fsq: FullscreenQuad = null;

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
		shouldExecute: () => consoleCore.view.dither_type !== 0,
		exec: (be: WebGLBackend, fbo, state: RenderPassStateRegistry['device_quantize']) => {
			const runtime: DeviceQuantizeRuntime = { backend: be, gl: be.gl as WebGL2RenderingContext, context: consoleCore.view };
			renderDeviceQuantize(runtime, fbo as WebGLFramebuffer, state);
		},
		prepare: (be: WebGLBackend, state: RenderPassStateRegistry['device_quantize']) => {
			const gl = be.gl;
			bindDeviceQuantizeUniforms(be, state);
			if (state.colorTex) {
				gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_POST_PROCESSING_SOURCE);
				gl.bindTexture(gl.TEXTURE_2D, state.colorTex);
			}
			registry.validatePassResources('device_quantize', be);
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

function renderDeviceQuantize(runtime: DeviceQuantizeRuntime, fbo: WebGLFramebuffer, state: RenderPassStateRegistry['device_quantize']): void {
	const { gl, context } = runtime;
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.viewport(0, 0, state.width, state.height);
	if (!fsq || fsq.w !== state.width || fsq.h !== state.height) {
		if (fsq) deleteFullscreenQuad(gl, fsq);
		fsq = createFullscreenQuad(gl, state.width, state.height, POST_PROCESS_TEXCOORDS, 'DeviceQuantize');
	}
	bindFullscreenQuad(gl, fsq);
	if (state.colorTex) {
		context.activeTexUnit = TEXTURE_UNIT_POST_PROCESSING_SOURCE;
		context.bind2DTex(state.colorTex);
	}
	gl.drawArrays(gl.TRIANGLES, 0, 6);
}
