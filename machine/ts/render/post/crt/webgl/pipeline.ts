import type { RenderPassLibrary } from '../../../backend/pass/library';
import type { RenderPassStateRegistry } from '../../../backend/backend';
import type { WebGLBackend } from '../../../backend/webgl/backend';
import { createCrtPassState, createPresentPassState, shouldExecuteAutoCrtPass, shouldExecuteAutoPresentPass, shouldUpdatePresentationHistoryA, shouldUpdatePresentationHistoryB, writeCrtPassState, writePresentationHistoryPassState, writePresentPassState } from '../state';
import { TEXTURE_UNIT_POST_PROCESSING_SOURCE } from '../../../backend/webgl/constants';
import fragmentShaderCRTCode from './shaders/crt.frag.glsl';
import fragmentShaderPresentCode from './shaders/present.frag.glsl';
import vertexShaderCRTCode from '../../webgl/shaders/fullscreen.vert.glsl';
import {
	bindFullscreenQuad,
	createFullscreenQuad,
	destroyFullscreenQuad,
	updateFullscreenQuad,
	POST_PROCESS_TEXCOORDS,
	type FullscreenQuad,
} from '../../../backend/webgl/fullscreen_quad';

function writeCrtVec3(out: Float32Array, src: readonly number[]): Float32Array {
	out[0] = src[0];
	out[1] = src[1];
	out[2] = src[2];
	return out;
}

function bindPresentShaderInputs(backend: WebGLBackend, state: RenderPassStateRegistry['present'] | RenderPassStateRegistry['presentation_history_a'] | RenderPassStateRegistry['presentation_history_b']): void {
	backend.setUniform2f('u_resolution', state.width, state.height);
	backend.setUniform1f('u_scale', 1.0);
	backend.setActiveTexture(TEXTURE_UNIT_POST_PROCESSING_SOURCE);
	backend.bindTexture2D(state.colorTex as WebGLTexture);
}

export function registerCRT(registry: RenderPassLibrary): void {
	let historyQuadA: FullscreenQuad;
	let historyQuadB: FullscreenQuad;
	let presentQuad: FullscreenQuad;
	let crtSourceWidth = 0;
	let crtSourceHeight = 0;
	const crtColorBleedScratch = new Float32Array(3);
	const crtGlowColorScratch = new Float32Array(3);
	function bindCRTUniforms(backend: WebGLBackend, state: RenderPassStateRegistry['crt']): void {
		backend.setUniform2f('u_resolution', state.width, state.height);
		backend.setUniform1f('u_scale', 1.0);
		if (crtSourceWidth !== state.srcWidth || crtSourceHeight !== state.srcHeight) {
			crtSourceWidth = state.srcWidth;
			crtSourceHeight = state.srcHeight;
			backend.setUniform2f('u_srcResolution', state.srcWidth, state.srcHeight);
			backend.setUniform2f('u_srcTexel', 1 / state.srcWidth, 1 / state.srcHeight);
		}
		const opts = state.options;
		if (opts.applyNoise) {
			backend.setUniform1f('u_random', state.noiseOffset);
			backend.setUniform1f('u_time', state.time);
		}
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
	}

	registry.register({
		id: 'presentation_history_a',
		name: 'PresentationHistoryA',
		vsCode: vertexShaderCRTCode,
		fsCode: fragmentShaderPresentCode,
		initialState: createPresentPassState(),
		graph: { reads: ['frame_color', 'device_color'], writes: ['frame_history_a'], writeState: writePresentationHistoryPassState },
		shouldExecute: shouldUpdatePresentationHistoryA,
		bootstrap: (backend) => {
			const webgl = backend as WebGLBackend;
			historyQuadA = {
				backend: webgl,
				positionBuffer: null,
				texcoordBuffer: null,
				positionAttrib: -1,
				texcoordAttrib: -1,
				width: -1,
				height: -1,
				texcoords: POST_PROCESS_TEXCOORDS,
				positions: new Float32Array(12),
				label: 'PresentationHistoryA',
			};
			createFullscreenQuad(historyQuadA);
			webgl.setUniform1i('u_texture', TEXTURE_UNIT_POST_PROCESSING_SOURCE);
		},
		teardown: () => {
			destroyFullscreenQuad(historyQuadA);
		},
		exec: (_be: WebGLBackend, fbo, state: RenderPassStateRegistry['presentation_history_a']) => {
			renderFullscreenToFramebuffer(historyQuadA, fbo as WebGLFramebuffer, state.width, state.height);
		},
		prepare: (be: WebGLBackend, state: RenderPassStateRegistry['presentation_history_a']) => {
			bindPresentShaderInputs(be, state);
		}
	});

	registry.register({
		id: 'presentation_history_b',
		name: 'PresentationHistoryB',
		vsCode: vertexShaderCRTCode,
		fsCode: fragmentShaderPresentCode,
		initialState: createPresentPassState(),
		graph: { reads: ['frame_color', 'device_color'], writes: ['frame_history_b'], writeState: writePresentationHistoryPassState },
		shouldExecute: shouldUpdatePresentationHistoryB,
		bootstrap: (backend) => {
			const webgl = backend as WebGLBackend;
			historyQuadB = {
				backend: webgl,
				positionBuffer: null,
				texcoordBuffer: null,
				positionAttrib: -1,
				texcoordAttrib: -1,
				width: -1,
				height: -1,
				texcoords: POST_PROCESS_TEXCOORDS,
				positions: new Float32Array(12),
				label: 'PresentationHistoryB',
			};
			createFullscreenQuad(historyQuadB);
			webgl.setUniform1i('u_texture', TEXTURE_UNIT_POST_PROCESSING_SOURCE);
		},
		teardown: () => {
			destroyFullscreenQuad(historyQuadB);
		},
		exec: (_be: WebGLBackend, fbo, state: RenderPassStateRegistry['presentation_history_b']) => {
			renderFullscreenToFramebuffer(historyQuadB, fbo as WebGLFramebuffer, state.width, state.height);
		},
		prepare: (be: WebGLBackend, state: RenderPassStateRegistry['presentation_history_b']) => {
			bindPresentShaderInputs(be, state);
		}
	});

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
			const webgl = backend as WebGLBackend;
			presentQuad = {
				backend: webgl,
				positionBuffer: null,
				texcoordBuffer: null,
				positionAttrib: -1,
				texcoordAttrib: -1,
				width: -1,
				height: -1,
				texcoords: POST_PROCESS_TEXCOORDS,
				positions: new Float32Array(12),
				label: 'Present',
			};
			createFullscreenQuad(presentQuad);
			webgl.setUniform1i('u_texture', TEXTURE_UNIT_POST_PROCESSING_SOURCE);
		},
		teardown: () => {
			destroyFullscreenQuad(presentQuad);
		},
		exec: (_be: WebGLBackend, _fbo, state: RenderPassStateRegistry['present']) => {
			renderFullscreenToFramebuffer(presentQuad, null, state.width, state.height);
		},
		prepare: (be: WebGLBackend, state: RenderPassStateRegistry['present']) => {
			bindPresentShaderInputs(be, state);
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
			const webgl = backend as WebGLBackend;
			crtQuad = {
				backend: webgl,
				positionBuffer: null,
				texcoordBuffer: null,
				positionAttrib: -1,
				texcoordAttrib: -1,
				width: -1,
				height: -1,
				texcoords: POST_PROCESS_TEXCOORDS,
				positions: new Float32Array(12),
				label: 'CRT',
			};
			createFullscreenQuad(crtQuad);
			webgl.setUniform1i('u_texture', TEXTURE_UNIT_POST_PROCESSING_SOURCE);
		},
		teardown: () => {
			destroyFullscreenQuad(crtQuad);
		},
		exec: (_be: WebGLBackend, _fbo, state: RenderPassStateRegistry['crt']) => {
			renderFullscreenToFramebuffer(crtQuad, null, state.width, state.height);
		},
		prepare: (be: WebGLBackend, state: RenderPassStateRegistry['crt']) => {
			bindCRTUniforms(be, state);
			be.setActiveTexture(TEXTURE_UNIT_POST_PROCESSING_SOURCE);
			be.bindTexture2D(state.colorTex as WebGLTexture);
		}
	});
}

function renderFullscreenToFramebuffer(fullscreenQuad: FullscreenQuad, fbo: WebGLFramebuffer | null, width: number, height: number): void {
	const gl = fullscreenQuad.backend.gl;
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.viewport(0, 0, width, height);
	updateFullscreenQuad(fullscreenQuad, width, height);
	bindFullscreenQuad(fullscreenQuad, fullscreenQuad.positionAttrib, fullscreenQuad.texcoordAttrib);
	gl.drawArrays(gl.TRIANGLES, 0, 6);
}
