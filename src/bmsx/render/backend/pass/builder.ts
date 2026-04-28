import { color_arr } from '../../../rompack/format';
import type { TextureHandle } from '../interfaces';
import { GPUBackend, PassEncoder, RenderPassDesc } from '../interfaces';

// NOTE: Renamed to avoid clashing with similarly named interfaces exported from interfaces.
// Keep shape identical; external code should prefer the canonical types from interfaces.
export interface BuilderColorAttachmentSpec { tex: TextureHandle; clear?: color_arr; discardAfter?: boolean }
export interface BuilderDepthAttachmentSpec { tex: TextureHandle; clearDepth?: number; discardAfter?: boolean }

// Fluent builder to assemble a RenderPassDesc consistently (single + multi color fields).
export class RenderPassBuilder {
	private _label?: string;
	private _colors: BuilderColorAttachmentSpec[] = [];
	private _depth?: BuilderDepthAttachmentSpec;
	constructor(private backend: GPUBackend) { }
	label(l: string): this { this._label = l; return this; }
	color(tex: TextureHandle, clear?: color_arr, discardAfter?: boolean): this { this._colors.push({ tex, clear, discardAfter }); return this; }
	addColor(tex: TextureHandle, clear?: color_arr, discardAfter?: boolean): this { return this.color(tex, clear, discardAfter); }
	colors(specs: BuilderColorAttachmentSpec[]): this { this._colors.push(...specs); return this; }
	depth(tex: TextureHandle, clearDepth?: number, discardAfter?: boolean): this { this._depth = { tex, clearDepth, discardAfter }; return this; }
	buildDesc(): RenderPassDesc {
		const desc: RenderPassDesc = {} as RenderPassDesc;
		if (this._colors.length) { desc.colors = this._colors; desc.color = this._colors[0]; }
		if (this._depth) desc.depth = this._depth;
		if (this._label) desc.label = this._label;
		return desc;
	}
	begin(): PassEncoder { return this.backend.beginRenderPass(this.buildDesc()); }
}
