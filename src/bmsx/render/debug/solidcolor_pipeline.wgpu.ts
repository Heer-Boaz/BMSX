import { GPUBackend } from '../backend/pipeline_interfaces';
import { RenderPassLibrary } from '../backend/renderpasslib';

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
  // Debug purple-ish color
  return vec4<f32>(0.15, 0.05, 0.25, 1.0);
}
`;

export function registerSolidColorPass_WebGPU(library: RenderPassLibrary): void {
  library.register({
    id: 'debug_solid',
    label: 'debug_solid',
    name: 'Debug Solid (WebGPU)',
    // Non-state, non-present → treated as a writer by the render graph
    vsCode: VS_SOLID,
    fsCode: FS_SOLID,
    writesDepth: false,
    exec: (_backend: GPUBackend) => {
      // Encoder and pipeline are already bound by the graph + library; draw 1 tri
      // Use backend draw API with the active encoder
      (_backend as any).draw({} as any, 0, 3);
    },
  });
}

