import { GPUBackend } from '../backend/pipeline_interfaces';
import { RenderPassLibrary } from '../backend/renderpasslib';
import { WebGPUBackend, WebGPUPassEncoder } from '../backend/webgpu/webgpu_backend';

// Minimal solid-color writer for WebGPU. Uses a fullscreen triangle and emits a constant color.
const VS_SOLID = /* wgsl */ `
struct VSOut {
  @builtin(position) Position : vec4<f32>,
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
  return out;
}
`;

const FS_SOLID = /* wgsl */ `
@fragment
fn main() -> @location(0) vec4<f32> {
  // Debug pink-ish color
  return vec4<f32>(1.0, 0.0, 1.0, 1.0);

//   return vec4<f32>(0.15, 0.05, 0.25, 1.0);
}
`;

export function registerSolidColorPass_WebGPU(library: RenderPassLibrary): void {
	library.register({
		id: 'debug_solid',
		label: 'debug_solid',
		name: 'Debug Solid (WebGPU)',
		vsCode: VS_SOLID,
		fsCode: FS_SOLID,
		depthTest: false,
		depthWrite: false,
		writesDepth: false,
		exec: (backend: GPUBackend, fbo: unknown) => {
			const be = backend as WebGPUBackend;
			// Scope validation errors around this draw for lightweight debugging
			be.device.pushErrorScope('validation');
			be.draw(fbo as WebGPUPassEncoder, 0, 3);
			// Pop the error scope once submitted work completes
			void be.device.queue.onSubmittedWorkDone().then(async () => {
				const err = await be.device.popErrorScope?.();
				if (err) console.error('WebGPU validation error (debug_solid):', err.message ?? err);
			});
		},
	});
}
