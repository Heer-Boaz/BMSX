// Lightweight shader module wrapper and helpers
// This is intentionally simple: it pairs shader source with a declared binding layout
// and provides a stable signature for pipeline/material caching.

import type { GraphicsPipelineBindingLayout, GraphicsPipelineBuildDesc } from './interfaces';

export interface ShaderModule {
	code: string;
	layout?: GraphicsPipelineBindingLayout;
	defines?: Record<string, string | number | boolean>;
	name?: string;
}

export function shaderModule(code: string, layout?: GraphicsPipelineBindingLayout, name?: string, defines?: Record<string, string | number | boolean>): ShaderModule {
	return { code, layout, name, defines };
}

export function moduleSignature(m: ShaderModule): string {
	const d = m.defines ? Object.keys(m.defines).sort().map(k => `${k}=${String(m.defines![k])}`).join(';') : '';
	const layout = m.layout;
	const uniforms = layout && Array.isArray(layout.uniforms) ? layout.uniforms.join(',') : '';
	const textures = layout && Array.isArray(layout.textures) ? layout.textures.map(x => x.name).join(',') : '';
	const samplers = layout && Array.isArray(layout.samplers) ? layout.samplers.map(x => x.name).join(',') : '';
	const buffers = layout && Array.isArray(layout.buffers) ? layout.buffers.map(x => `${x.name}:${x.usage}:${x.size}`).join(',') : '';
	return `${m.name ?? 'mod'}|D:${d}|U:${uniforms}|T:${textures}|S:${samplers}|B:${buffers}`;
}

// Merge two binding layouts conservatively: concat arrays and keep order.
function mergeLayouts(a?: GraphicsPipelineBindingLayout, b?: GraphicsPipelineBindingLayout): GraphicsPipelineBindingLayout {
	if (!a && !b) return undefined;
	const uniforms = [...(a && Array.isArray(a.uniforms) ? a.uniforms : []), ...(b && Array.isArray(b.uniforms) ? b.uniforms : [])];
	const textures = [...(a && Array.isArray(a.textures) ? a.textures : []), ...(b && Array.isArray(b.textures) ? b.textures : [])];
	const samplers = [...(a && Array.isArray(a.samplers) ? a.samplers : []), ...(b && Array.isArray(b.samplers) ? b.samplers : [])];
	const buffers = [...(a && Array.isArray(a.buffers) ? a.buffers : []), ...(b && Array.isArray(b.buffers) ? b.buffers : [])];
	return { uniforms, textures, samplers, buffers };
}

export function makePipelineBuildDesc(label: string, vs: ShaderModule, fs: ShaderModule): GraphicsPipelineBuildDesc {
	return {
		label,
		vsCode: vs.code,
		fsCode: fs.code,
		bindingLayout: mergeLayouts(vs.layout, fs.layout),
	};
}
