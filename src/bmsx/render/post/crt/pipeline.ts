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
	updateFullscreenQuad,
	POST_PROCESS_TEXCOORDS,
	type FullscreenQuad,
} from '../../backend/webgl/fullscreen_quad';

// interface CRTState { width: number; height: number; baseWidth: number; baseHeight: number; outWidth: number; outHeight: number; colorTex?: TextureHandle; options?: any }

let fsq: FullscreenQuad = null;
const crtColorBleedScratch = new Float32Array(3);
const crtGlowColorScratch = new Float32Array(3);


function writeCrtVec3(out: Float32Array, src: readonly number[]): Float32Array {
	out[0] = src[0];
	out[1] = src[1];
	out[2] = src[2];
	return out;
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
			renderCRT(be.gl as WebGL2RenderingContext, consoleCore.view, state);
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
	backend.setUniform1i('u_enableNoise', opts.enableNoise ? 1 : 0);
	backend.setUniform1i('u_enableColorBleed', opts.enableColorBleed ? 1 : 0);
	backend.setUniform1i('u_enableScanlines', opts.enableScanlines ? 1 : 0);
	backend.setUniform1i('u_enableBlur', opts.enableBlur ? 1 : 0);
	backend.setUniform1i('u_enableGlow', opts.enableGlow ? 1 : 0);
	backend.setUniform1i('u_enableFringing', opts.enableFringing ? 1 : 0);
	backend.setUniform1i('u_enableAperture', opts.enableAperture ? 1 : 0);
	backend.setUniform1f('u_noiseIntensity', opts.noiseIntensity);
	backend.setUniform3fv('u_colorBleed', writeCrtVec3(crtColorBleedScratch, opts.colorBleed));
	backend.setUniform1f('u_blurIntensity', opts.blurIntensity);
	backend.setUniform3fv('u_glowColor', writeCrtVec3(crtGlowColorScratch, opts.glowColor));
	backend.setUniform1i('u_texture', TEXTURE_UNIT_POST_PROCESSING_SOURCE);
}

function renderCRT(gl: WebGL2RenderingContext, context: RenderContext, state: RenderPassStateRegistry['crt']): void {
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	const outW = state.width;
	const outH = state.height;
	gl.viewport(0, 0, outW, outH);
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
			label: 'CRT',
		};
		createFullscreenQuad(fsq);
	}
	updateFullscreenQuad(fsq, outW, outH);
	bindFullscreenQuad(fsq, fsq.positionAttrib, fsq.texcoordAttrib);
	if (state.colorTex) {
		context.activeTexUnit = TEXTURE_UNIT_POST_PROCESSING_SOURCE;
		context.bind2DTex(state.colorTex);
	}
	gl.drawArrays(gl.TRIANGLES, 0, 6);
}
