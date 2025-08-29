// Lightweight shader module wrapper and helpers
// This is intentionally simple: it pairs shader source with a declared binding layout
// and provides a stable signature for pipeline/material caching.

import type { GraphicsPipelineBindingLayout, GraphicsPipelineBuildDesc } from './pipeline_interfaces';

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
    const u = m.layout?.uniforms?.join(',') ?? '';
    const t = m.layout?.textures?.map(x => x.name).join(',') ?? '';
    const s = m.layout?.samplers?.map(x => x.name).join(',') ?? '';
    const b = m.layout?.buffers?.map(x => `${x.name}:${x.usage}:${x.size}`).join(',') ?? '';
    return `${m.name ?? 'mod'}|D:${d}|U:${u}|T:${t}|S:${s}|B:${b}`;
}

// Merge two binding layouts conservatively: concat arrays and keep order.
function mergeLayouts(a?: GraphicsPipelineBindingLayout, b?: GraphicsPipelineBindingLayout): GraphicsPipelineBindingLayout | undefined {
    if (!a && !b) return undefined;
    return {
        uniforms: [...(a?.uniforms ?? []), ...(b?.uniforms ?? [])],
        textures: [...(a?.textures ?? []), ...(b?.textures ?? [])],
        samplers: [...(a?.samplers ?? []), ...(b?.samplers ?? [])],
        buffers: [...(a?.buffers ?? []), ...(b?.buffers ?? [])],
    };
}

export function makePipelineBuildDesc(label: string, vs: ShaderModule, fs: ShaderModule): GraphicsPipelineBuildDesc {
    return {
        label,
        vsCode: vs.code,
        fsCode: fs.code,
        bindingLayout: mergeLayouts(vs.layout, fs.layout),
    };
}

