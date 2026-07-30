import type { RenderPassLibrary } from '../../../backend/pass/library';
import type { RenderPassStateRegistry } from '../../../backend/backend';
import type { WebGLBackend } from '../../../backend/webgl/backend';
import { TEXTURE_UNIT_DEVICE_QUANTIZE_LUT, TEXTURE_UNIT_POST_PROCESSING_SOURCE } from '../../../backend/webgl/constants';
import { RGBA8_LINEAR_TEXTURE_PARAMS } from '../../../backend/texture_params';
import fragmentShaderDeviceCode from './shaders/device_quantize.frag.glsl';
import vertexShaderCRTCode from '../../webgl/shaders/fullscreen.vert.glsl';
import { DeviceQuantizeMode } from '../mode';
import { DEVICE_QUANTIZE_LUT_HEIGHT, DEVICE_QUANTIZE_LUTS, DEVICE_QUANTIZE_LUT_WIDTH } from '../lut';
import { createDeviceQuantizeState, writeDeviceQuantizeState } from '../state';
import {
	bindFullscreenQuad,
	createFullscreenQuad,
	destroyFullscreenQuad,
	updateFullscreenQuad,
	POST_PROCESS_TEXCOORDS,
	type FullscreenQuad,
} from '../../../backend/webgl/fullscreen_quad';

export function registerDeviceQuantize(registry: RenderPassLibrary): void {
	let fullscreenQuad: FullscreenQuad;
	let lutTextures: [WebGLTexture, WebGLTexture];
	let activeLutTexture: WebGLTexture;
	let publishedConfigurationRevision = -1;
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
			const webgl = backend as WebGLBackend;
			fullscreenQuad = {
				backend: webgl,
				positionBuffer: null,
				texcoordBuffer: null,
				positionAttrib: -1,
				texcoordAttrib: -1,
				width: -1,
				height: -1,
				texcoords: POST_PROCESS_TEXCOORDS,
				positions: new Float32Array(12),
				label: 'DeviceQuantize',
			};
			createFullscreenQuad(fullscreenQuad);
			lutTextures = [
				webgl.createTexture(DEVICE_QUANTIZE_LUTS[0].texture, DEVICE_QUANTIZE_LUT_WIDTH, DEVICE_QUANTIZE_LUT_HEIGHT, RGBA8_LINEAR_TEXTURE_PARAMS),
				webgl.createTexture(DEVICE_QUANTIZE_LUTS[1].texture, DEVICE_QUANTIZE_LUT_WIDTH, DEVICE_QUANTIZE_LUT_HEIGHT, RGBA8_LINEAR_TEXTURE_PARAMS),
			];
			webgl.setUniform1f('u_scale', 1.0);
			webgl.setUniform1i('u_texture', TEXTURE_UNIT_POST_PROCESSING_SOURCE);
			webgl.setUniform1i('u_quantize_lut', TEXTURE_UNIT_DEVICE_QUANTIZE_LUT);
		},
		teardown: (backend) => {
			destroyFullscreenQuad(fullscreenQuad);
			backend.destroyTexture(lutTextures[0]);
			backend.destroyTexture(lutTextures[1]);
		},
		shouldExecute: (view) => view.deviceQuantizeMode !== DeviceQuantizeMode.None,
		exec: function executeDeviceQuantizeWebGl(_be: WebGLBackend, fbo, state: RenderPassStateRegistry['device_quantize']) {
			renderDeviceQuantize(fullscreenQuad, fbo as WebGLFramebuffer, state);
		},
		prepare: function prepareDeviceQuantizeWebGl(be: WebGLBackend, state: RenderPassStateRegistry['device_quantize']) {
			if (publishedConfigurationRevision !== state.configurationRevision) {
				be.setUniform2f('u_resolution', state.width, state.height);
				activeLutTexture = state.luts === DEVICE_QUANTIZE_LUTS[0] ? lutTextures[0] : lutTextures[1];
				be.setActiveTexture(TEXTURE_UNIT_DEVICE_QUANTIZE_LUT);
				be.bindTexture2D(activeLutTexture);
				publishedConfigurationRevision = state.configurationRevision;
			}
			be.setActiveTexture(TEXTURE_UNIT_POST_PROCESSING_SOURCE);
			be.bindTexture2D(state.colorTex as WebGLTexture);
		},
	});
}

function renderDeviceQuantize(fullscreenQuad: FullscreenQuad, fbo: WebGLFramebuffer, state: RenderPassStateRegistry['device_quantize']): void {
	const gl = fullscreenQuad.backend.gl;
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.viewport(0, 0, state.width, state.height);
	updateFullscreenQuad(fullscreenQuad, state.width, state.height);
	bindFullscreenQuad(fullscreenQuad, fullscreenQuad.positionAttrib, fullscreenQuad.texcoordAttrib);
	gl.drawArrays(gl.TRIANGLES, 0, 6);
}
