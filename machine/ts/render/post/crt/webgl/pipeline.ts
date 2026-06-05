import type { RenderPassLibrary } from '../../../backend/pass/library';
import type { RenderPassStateRegistry } from '../../../backend/backend';
import type { WebGLBackend } from '../../../backend/webgl/backend';
import { createCrtPassState, createPresentPassState, shouldExecuteAutoCrtPass, shouldExecuteAutoPresentPass, writeCrtPassState, writePresentPassState } from '../state';
import { TEXTURE_UNIT_POST_PROCESSING_SOURCE } from '../../../backend/webgl/constants';
import fragmentShaderCRTCode from './shaders/crt.frag.glsl';
import fragmentShaderPresentCode from './shaders/present.frag.glsl';
import vertexShaderCRTCode from '../../webgl/shaders/fullscreen.vert.glsl';
import {
	bindFullscreenQuad,
	createFullscreenQuad,
	updateFullscreenQuad,
	POST_PROCESS_TEXCOORDS,
	type FullscreenQuad,
} from '../../../backend/webgl/fullscreen_quad';

const crtColorBleedScratch = new Float32Array(3);
const crtGlowColorScratch = new Float32Array(3);


function writeCrtVec3(out: Float32Array, src: readonly number[]): Float32Array {
	out[0] = src[0];
	out[1] = src[1];
	out[2] = src[2];
	return out;
}

export function registerCRT_WebGL(registry: RenderPassLibrary): void {
	let presentQuad: FullscreenQuad;
	registry.register({
		id: 'present',
		name: 'Present',
		vsCode: vertexShaderCRTCode,
		fsCode: fragmentShaderPresentCode,
		present: true,
		initialState: createPresentPassState(),
		graph: { presentInput: 'auto', writeState: writePresentPassState },
		shouldExecute: shouldExecuteAutoPresentPass,
		bootstrap: (backend) => {
			const gl = (backend as WebGLBackend).gl as WebGL2RenderingContext;
			presentQuad = {
				gl,
				positionBuffer: null,
				texcoordBuffer: null,
				positionAttrib: -1,
				texcoordAttrib: -1,
				width: -1,
				height: -1,
				texcoords: POST_PROCESS_TEXCOORDS,
				label: 'Present',
			};
			createFullscreenQuad(presentQuad);
		},
		exec: (_be: WebGLBackend, _fbo, state: RenderPassStateRegistry['present']) => {
			renderFullscreenToBackbuffer(presentQuad, state.width, state.height);
		},
		prepare: (be: WebGLBackend, state: RenderPassStateRegistry['present']) => {
			be.setActiveTexture(TEXTURE_UNIT_POST_PROCESSING_SOURCE);
			be.bindTexture2D(state.colorTex as WebGLTexture);
			be.setUniform1i('u_texture', TEXTURE_UNIT_POST_PROCESSING_SOURCE);
		}
	});

	let crtQuad: FullscreenQuad;
	registry.register({
		id: 'crt',
		name: 'Present/CRT',
		vsCode: vertexShaderCRTCode,
		fsCode: fragmentShaderCRTCode,
		present: true,
		initialState: createCrtPassState(),
		graph: { presentInput: 'auto', writeState: writeCrtPassState },
		shouldExecute: shouldExecuteAutoCrtPass,
		bootstrap: (backend) => {
			const gl = (backend as WebGLBackend).gl as WebGL2RenderingContext;
			crtQuad = {
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
			createFullscreenQuad(crtQuad);
		},
		exec: (_be: WebGLBackend, _fbo, state: RenderPassStateRegistry['crt']) => {
			renderFullscreenToBackbuffer(crtQuad, state.width, state.height);
		},
		prepare: (be: WebGLBackend, state: RenderPassStateRegistry['crt']) => {
			bindCRTUniforms(be, state);
			be.setActiveTexture(TEXTURE_UNIT_POST_PROCESSING_SOURCE);
			be.bindTexture2D(state.colorTex as WebGLTexture);
		}
	});
}

function renderFullscreenToBackbuffer(fullscreenQuad: FullscreenQuad, width: number, height: number): void {
	const gl = fullscreenQuad.gl;
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.viewport(0, 0, width, height);
	updateFullscreenQuad(fullscreenQuad, width, height);
	bindFullscreenQuad(fullscreenQuad, fullscreenQuad.positionAttrib, fullscreenQuad.texcoordAttrib);
	gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function bindCRTUniforms(backend: WebGLBackend, state: RenderPassStateRegistry['crt']): void {
	const outW = state.width;
	const outH = state.height;
	backend.setUniform1f('u_random', Math.random());
	backend.setUniform2f('u_resolution', outW, outH);
	backend.setUniform2f('u_srcResolution', state.baseWidth, state.baseHeight);
	backend.setUniform1f('u_scale', 1.0);
	backend.setUniform1f('u_fragscale', state.srcWidth / state.baseWidth);
	backend.setUniform1f('u_time', state.time);
	const opts = state.options;
	backend.setUniform1i('u_enableNoise', opts.applyNoise ? 1 : 0);
	backend.setUniform1i('u_enableColorBleed', opts.applyColorBleed ? 1 : 0);
	backend.setUniform1i('u_enableScanlines', opts.applyScanlines ? 1 : 0);
	backend.setUniform1i('u_enableBlur', opts.applyBlur ? 1 : 0);
	backend.setUniform1i('u_enableGlow', opts.applyGlow ? 1 : 0);
	backend.setUniform1i('u_enableFringing', opts.applyFringing ? 1 : 0);
	backend.setUniform1i('u_enableAperture', opts.applyAperture ? 1 : 0);
	backend.setUniform1f('u_noiseIntensity', opts.noiseIntensity);
	backend.setUniform3fv('u_colorBleed', writeCrtVec3(crtColorBleedScratch, opts.colorBleed));
	backend.setUniform1f('u_blurIntensity', opts.blurIntensity);
	backend.setUniform3fv('u_glowColor', writeCrtVec3(crtGlowColorScratch, opts.glowColor));
	backend.setUniform1i('u_texture', TEXTURE_UNIT_POST_PROCESSING_SOURCE);
}
