import type { ColorAttachmentSpec, GPUBackend, RenderPassDesc, RenderPassInstanceHandle, RenderPassStateRegistry } from '../../../backend/backend';
import type { RenderPassLibrary } from '../../../backend/pass/library';
import type { WebGPUBackend } from '../../../backend/webgpu/backend';
import { createCrtPassState, createPresentPassState, shouldExecuteAutoCrtPass, shouldExecuteAutoPresentPass, writeCrtPassState, writePresentPassState } from '../state';
import fragmentShaderCRTCode from './shaders/crt.frag.wgsl';
import fragmentShaderPresentCode from './shaders/present.frag.wgsl';
import vertexShaderCRTCode from './shaders/crt.vert.wgsl';

const CRT_UNIFORM_FLOATS = 24;
const crtUniformScratch = new Float32Array(CRT_UNIFORM_FLOATS);

function writeCrtWebGPUUniforms(out: Float32Array, state: RenderPassStateRegistry['crt']): void {
	out[0] = state.baseWidth;
	out[1] = state.baseHeight;
	out[2] = state.srcWidth / state.baseWidth;
	out[3] = state.time;
	out[4] = Math.random();
	const opts = state.options;
	out[5] = opts.applyNoise ? 1 : 0;
	out[6] = opts.applyColorBleed ? 1 : 0;
	out[7] = opts.applyScanlines ? 1 : 0;
	out[8] = opts.applyBlur ? 1 : 0;
	out[9] = opts.applyGlow ? 1 : 0;
	out[10] = opts.applyFringing ? 1 : 0;
	out[11] = opts.applyAperture ? 1 : 0;
	out[12] = opts.noiseIntensity;
	out[13] = opts.blurIntensity;
	out[16] = opts.colorBleed[0];
	out[17] = opts.colorBleed[1];
	out[18] = opts.colorBleed[2];
	out[20] = opts.glowColor[0];
	out[21] = opts.glowColor[1];
	out[22] = opts.glowColor[2];
}

export function registerCRT_WebGPU(registry: RenderPassLibrary): void {
	const presentOnlyColorAttachment: ColorAttachmentSpec = { tex: null };
	const presentOnlyPassDesc: RenderPassDesc = { label: 'Present', color: presentOnlyColorAttachment };
	let presentSampler: GPUSampler;
	let presentSampledTexture: GPUTexture | null = null;
	let presentSampledTextureView!: GPUTextureView;
	registry.register({
		id: 'present',
		name: 'Present (WebGPU)',
		present: true,
		initialState: createPresentPassState(),
		graph: { presentInput: 'auto', writeState: writePresentPassState },
		shouldExecute: shouldExecuteAutoPresentPass,
		vsCode: vertexShaderCRTCode,
		fsCode: fragmentShaderPresentCode,
		bindingLayout: {
			textures: [{ name: 'u_texture' }],
			samplers: [{ name: 'u_sampler' }],
		},
		bootstrap: (backend: GPUBackend) => {
			const wgpu = backend as WebGPUBackend;
			presentSampler = wgpu.device.createSampler({ magFilter: 'nearest', minFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
		},
		prepare: (backend: GPUBackend, state: RenderPassStateRegistry['present']) => {
			const wgpu = backend as WebGPUBackend;
			const texture = state.colorTex as GPUTexture;
			if (texture !== presentSampledTexture) {
				presentSampledTexture = texture;
				presentSampledTextureView = texture.createView();
			}
			wgpu.bindTextureView(0, presentSampledTextureView);
			wgpu.bindSampler(1, presentSampler);
		},
		exec: (backend: GPUBackend, _fbo: unknown, _state: RenderPassStateRegistry['present'], pipelineHandle: RenderPassInstanceHandle | null) => {
			const wgpu = backend as WebGPUBackend;
			const pipeline = pipelineHandle as RenderPassInstanceHandle;
			presentOnlyColorAttachment.tex = wgpu.context.getCurrentTexture();
			const pass = backend.beginRenderPass(presentOnlyPassDesc);
			wgpu.setGraphicsPipeline(pass, pipeline);
			wgpu.draw(pass, 0, 3);
			backend.endRenderPass(pass);
		},
	});

	const presentColorAttachment: ColorAttachmentSpec = { tex: null };
	const presentPassDesc: RenderPassDesc = { label: 'Present/CRT', color: presentColorAttachment };
	let uniformBuffer: GPUBuffer;
	let sampler: GPUSampler;
	let sampledTexture: GPUTexture | null = null;
	let sampledTextureView!: GPUTextureView;
	registry.register({
		id: 'crt',
		name: 'Present/CRT (WebGPU)',
		present: true,
		initialState: createCrtPassState(),
		graph: { presentInput: 'auto', writeState: writeCrtPassState },
		shouldExecute: shouldExecuteAutoCrtPass,
		vsCode: vertexShaderCRTCode,
		fsCode: fragmentShaderCRTCode,
		bindingLayout: {
			uniforms: ['CRTUniforms'],
			textures: [{ name: 'u_texture' }],
			samplers: [{ name: 'u_sampler' }],
		},
		bootstrap: (backend: GPUBackend) => {
			const wgpu = backend as WebGPUBackend;
			uniformBuffer = wgpu.createUniformBuffer(CRT_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT, 'dynamic');
			sampler = wgpu.device.createSampler({ magFilter: 'nearest', minFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
		},
		prepare: (backend: GPUBackend, state: RenderPassStateRegistry['crt']) => {
			const wgpu = backend as WebGPUBackend;
			writeCrtWebGPUUniforms(crtUniformScratch, state);
			wgpu.updateUniformBuffer(uniformBuffer, crtUniformScratch);
			const texture = state.colorTex as GPUTexture;
			if (texture !== sampledTexture) {
				sampledTexture = texture;
				sampledTextureView = texture.createView();
			}
			wgpu.bindUniformBufferBase(0, uniformBuffer);
			wgpu.bindTextureView(1, sampledTextureView);
			wgpu.bindSampler(2, sampler);
		},
		exec: (backend: GPUBackend, _fbo: unknown, _state: RenderPassStateRegistry['crt'], pipelineHandle: RenderPassInstanceHandle | null) => {
			const wgpu = backend as WebGPUBackend;
			const pipeline = pipelineHandle as RenderPassInstanceHandle;
			presentColorAttachment.tex = wgpu.context.getCurrentTexture();
			const pass = backend.beginRenderPass(presentPassDesc);
			wgpu.setGraphicsPipeline(pass, pipeline);
			wgpu.draw(pass, 0, 3);
			backend.endRenderPass(pass);
		},
	});
}
