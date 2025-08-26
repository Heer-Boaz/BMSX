import type { TextureHandle } from '../gpu_types';
import { GPUBackend, PassEncoder, RenderPassDesc } from './interfaces';

export interface ColorAttachmentSpec { tex: TextureHandle; clear?: [number, number, number, number]; discardAfter?: boolean }
export interface DepthAttachmentSpec { tex: TextureHandle; clearDepth?: number; discardAfter?: boolean }

// Fluent builder to assemble a RenderPassDesc consistently (single + multi color fields).
export class RenderPassBuilder {
    private _label?: string;
    private _colors: ColorAttachmentSpec[] = [];
    private _depth?: DepthAttachmentSpec;
    constructor(private backend: GPUBackend) { }
    label(l: string): this { this._label = l; return this; }
    color(tex: TextureHandle, clear?: [number, number, number, number], discardAfter?: boolean): this { this._colors.push({ tex, clear, discardAfter }); return this; }
    addColor(tex: TextureHandle, clear?: [number, number, number, number], discardAfter?: boolean): this { return this.color(tex, clear, discardAfter); }
    colors(specs: ColorAttachmentSpec[]): this { this._colors.push(...specs); return this; }
    depth(tex: TextureHandle, clearDepth?: number, discardAfter?: boolean): this { this._depth = { tex, clearDepth, discardAfter }; return this; }
    buildDesc(): RenderPassDesc {
        const desc: RenderPassDesc = {} as RenderPassDesc;
        if (this._colors.length) { desc.colors = this._colors.slice(); desc.color = this._colors[0]; }
        if (this._depth) desc.depth = this._depth;
        if (this._label) desc.label = this._label;
        return desc;
    }
    begin(): PassEncoder { return this.backend.beginRenderPass(this.buildDesc()); }
}
