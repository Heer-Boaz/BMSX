import type { RenderPassLibrary } from '../../backend/pass/library';
import type { RenderContext, RenderPassStateRegistry } from '../../backend/backend';
import type { WebGLBackend } from '../../backend/webgl/backend';
import { consoleCore } from '../../../core/console';
import { buildCrtPassState } from './state';
import { TEXTURE_UNIT_POST_PROCESSING_SOURCE } from '../../backend/webgl/constants';
import fragmentShaderCRTCode from '../shaders/crt.frag.glsl';
import vertexShaderCRTCode from '../shaders/crt.vert.glsl';
import {
	bindFullscreenQuad,
	createFullscreenQuad,
	deleteFullscreenQuad,
	POST_PROCESS_TEXCOORDS,
	type FullscreenQuad,
} from '../../backend/webgl/fullscreen_quad';

// interface CRTState { width: number; height: number; baseWidth: number; baseHeight: number; outWidth: number; outHeight: number; colorTex?: TextureHandle; options?: any }

let fsq: FullscreenQuad = null;


interface CRTRuntime {
	backend: WebGLBackend;
	gl: WebGL2RenderingContext;
	context: RenderContext;
}

export function registerCRT_WebGL(registry: RenderPassLibrary): void {
	registry.register({
		id: 'crt',
		name: 'Present/CRT',
		vsCode: vertexShaderCRTCode,
		fsCode: fragmentShaderCRTCode,
		bindingLayout: { uniforms: ['FrameUniforms'] },
		present: true,
		graph: { presentInput: 'auto', buildState: buildCrtPassState },
		exec: (be: WebGLBackend, _fbo, state: RenderPassStateRegistry['crt']) => {
			const runtime: CRTRuntime = { backend: be, gl: be.gl as WebGL2RenderingContext, context: consoleCore.view };
			renderCRT(runtime, state);
		},
		prepare: (be: WebGLBackend, state: RenderPassStateRegistry['crt']) => {
			const gl = be.gl;
			bindCRTUniforms(be, state);
			if (state.colorTex) {
				gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_POST_PROCESSING_SOURCE);
				gl.bindTexture(gl.TEXTURE_2D, state.colorTex);
			}
		}
	});
}

function bindCRTUniforms(backend: WebGLBackend, state: RenderPassStateRegistry['crt']): void {
	const outW = state.width;
	const outH = state.height;
	backend.setUniform1f('u_random', Math.random());
	backend.setUniform2f('u_resolution', outW, outH);
	backend.setUniform2f('u_srcResolution', state.baseWidth, state.baseHeight);
	backend.setUniform1f('u_scale', 1.0);
	backend.setUniform1f('u_fragscale', state.width / state.baseWidth);
	const opts = state.options;
	const booleans: Array<[string, boolean]> = [
		['u_enableNoise', opts.enableNoise],
		['u_enableColorBleed', opts.enableColorBleed],
		['u_enableScanlines', opts.enableScanlines],
		['u_enableBlur', opts.enableBlur],
		['u_enableGlow', opts.enableGlow],
		['u_enableFringing', opts.enableFringing],
		['u_enableAperture', opts.enableAperture],
	];
	for (const [name, val] of booleans) backend.setUniform1i(name, val ? 1 : 0);
	backend.setUniform1f('u_noiseIntensity', opts.noiseIntensity);
	backend.setUniform3fv('u_colorBleed', new Float32Array(opts.colorBleed));
	backend.setUniform1f('u_blurIntensity', opts.blurIntensity);
	backend.setUniform3fv('u_glowColor', new Float32Array(opts.glowColor));
	backend.setUniform1i('u_texture', TEXTURE_UNIT_POST_PROCESSING_SOURCE);
}

function renderCRT(runtime: CRTRuntime, state: RenderPassStateRegistry['crt']): void {
	const { gl, context } = runtime;
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	const outW = state.width;
	const outH = state.height;
	gl.viewport(0, 0, outW, outH);
	if (!fsq || fsq.w !== outW || fsq.h !== outH) {
		if (fsq) deleteFullscreenQuad(gl, fsq);
		fsq = createFullscreenQuad(gl, outW, outH, POST_PROCESS_TEXCOORDS, 'CRT');
	}
	bindFullscreenQuad(gl, fsq);
	if (state.colorTex) {
		context.activeTexUnit = TEXTURE_UNIT_POST_PROCESSING_SOURCE;
		context.bind2DTex(state.colorTex);
	}
	gl.drawArrays(gl.TRIANGLES, 0, 6);
}
