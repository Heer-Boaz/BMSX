import { GPUBackend, TextureHandle } from '../backend/pipeline_interfaces';
import { RenderPassLibrary } from '../backend/renderpasslib';
import { WebGPUBackend, WebGPUPassEncoder } from '../backend/webgpu/webgpu_backend';

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

interface CRTState { width: number; height: number; baseWidth?: number; baseHeight?: number; colorTex?: TextureHandle | null; options?: any }

export function registerCRT_WebGPU(registry: RenderPassLibrary): void {
	registry.register({
		id: 'crt',
		label: 'crt',
		name: 'Present/CRT (WebGPU)',
		present: true,
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
			if (!state?.colorTex) return;
			(backend as WebGPUBackend).bindTextureWithSampler(0, 1, state.colorTex as GPUTexture);
		},
		exec: (backend: GPUBackend, fbo: any, _st: unknown) => {
			const wgpu = backend as WebGPUBackend;
			if (wgpu.type !== 'webgpu' || !wgpu.context) return;
			// Create a render pass targeting the swapchain texture
			const swapTex = wgpu.context.getCurrentTexture();
			const pass = backend.beginRenderPass({ label: 'Present/CRT', color: { tex: swapTex } }) as WebGPUPassEncoder;
			wgpu.setActivePassEncoder(pass);
			// Bind the pipeline built at registration time (provided by registry via fbo param)
			const ph = fbo?.pipelineHandle; // TODO: REMOVE BULLSHIT CODE
			if (ph) { wgpu.setGraphicsPipeline(pass, ph); }
			// Draw full-screen triangle
			wgpu.draw(pass, 0, 3);
			(backend as GPUBackend).endRenderPass(pass);
			wgpu.setActivePassEncoder(null);
		},
	});
}
