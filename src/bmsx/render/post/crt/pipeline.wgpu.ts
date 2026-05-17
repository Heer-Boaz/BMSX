import type { ColorAttachmentSpec, GPUBackend, RenderPassDesc, RenderPassInstanceHandle, TextureHandle } from '../../backend/backend';
import type { RenderPassLibrary } from '../../backend/pass/library';
import type { WebGPUBackend } from '../../backend/webgpu/backend';
import { buildCrtPassState } from './state';

// Minimal WGSL shaders for present pass (full-screen triangle)
const VS = /* wgsl */ `
struct VSOut {
  @builtin(position) Position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn main(@builtin(vertex_index) vid : u32) -> VSOut {
  var pos = array<vec2<f32>, 3>(
	vec2<f32>(-1.0, -3.0),
	vec2<f32>(3.0, 1.0),
	vec2<f32>(-1.0, 1.0)
  );
  var out : VSOut;
  out.Position = vec4<f32>(pos[vid], 0.0, 1.0);
  // Map to uv for a full-screen tri
  out.uv = (out.Position.xy * vec2<f32>(0.5, -0.5)) + vec2<f32>(0.5, 0.5);
  return out;
}
`;

const FS = /* wgsl */ `
@group(0) @binding(0) var u_tex : texture_2d<f32>;
@group(0) @binding(1) var s_tex : sampler;

@fragment
fn main(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(u_tex, s_tex, uv);
}
`;

interface CRTState { width: number; height: number; baseWidth?: number; baseHeight?: number; colorTex: TextureHandle; options?: any }

export function registerCRT_WebGPU(registry: RenderPassLibrary): void {
	const presentColorAttachment: ColorAttachmentSpec = { tex: null };
	const presentPassDesc: RenderPassDesc = { label: 'Present/CRT', color: presentColorAttachment };
	registry.register({
		id: 'crt',
		name: 'Present/CRT (WebGPU)',
		present: true,
		graph: { presentInput: 'auto', buildState: buildCrtPassState },
		// Provide WGSL + binding layout (texture + sampler)
		vsCode: VS,
		fsCode: FS,
		bindingLayout: {
			textures: [{ name: 'u_texture' }],
			samplers: [{ name: 's_texture' }],
		},
		// Bind sampled texture to bindings (0,1) for this pass
		prepare: (backend: GPUBackend, st: unknown) => {
			const state = st as CRTState;
			(backend as WebGPUBackend).bindTextureWithSampler(0, 1, state.colorTex as GPUTexture);
		},
		exec: (backend: GPUBackend, _fbo: unknown, _st: unknown, pipelineHandle: RenderPassInstanceHandle) => {
			const wgpu = backend as WebGPUBackend;
			const swapTex = wgpu.context.getCurrentTexture();
			presentColorAttachment.tex = swapTex;
			const pass = backend.beginRenderPass(presentPassDesc);
			wgpu.setGraphicsPipeline(pass, pipelineHandle);
			wgpu.draw(pass, 0, 3);
			backend.endRenderPass(pass);
		},
	});
}
