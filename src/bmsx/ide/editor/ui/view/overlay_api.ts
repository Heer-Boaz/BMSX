import type { BFont } from '../../../../render/shared/bitmap_font';
import type { color, RenderLayer } from '../../../../render/shared/render_types';
import { BmsxColors } from '../../../../machine/devices/vdp/vdp';
import { OverlayRenderer } from '../../../runtime/overlay_renderer';

type OverlayBlitOptions = {
	scale?: number | { x: number; y: number };
	flip_h?: boolean;
	flip_v?: boolean;
	colorize?: color;
	layer?: RenderLayer;
};

export class OverlayApi {
	private renderer: OverlayRenderer = null;

	public beginFrame(renderer: OverlayRenderer): void {
		this.renderer = renderer;
	}

	public endFrame(): void {
		this.renderer = null;
	}

	private get activeRenderer(): OverlayRenderer {
		if (this.renderer === null) {
			throw new Error('[overlay_api] No active overlay renderer.');
		}
		return this.renderer;
	}

	private resolveColor(value: number | color): color {
		if (typeof value === 'number') {
			return this.resolvePaletteIndex(value);
		}
		return value;
	}

	private resolvePaletteIndex(value: number): color {
		if (!Number.isFinite(value) || value < 0 || value > 255) {
			throw new Error(`[overlay_api] Invalid palette index: ${value}`);
		}
		const color = BmsxColors[value];
		if (!color) {
			throw new Error(`[overlay_api] Palette index has no color: ${value}`);
		}
		return color;
	}

	public fill_rect(x0: number, y0: number, x1: number, y1: number, z: number, colorindex: number): void {
		this.activeRenderer.rect({
			kind: 'fill',
			area: { left: x0, top: y0, right: x1, bottom: y1, z },
			color: this.resolvePaletteIndex(colorindex),
			layer: 'ide',
		});
	}

	public fill_rect_color(x0: number, y0: number, x1: number, y1: number, z: number, colorvalue: number | color): void {
		this.activeRenderer.rect({
			kind: 'fill',
			area: { left: x0, top: y0, right: x1, bottom: y1, z },
			color: this.resolveColor(colorvalue),
			layer: 'ide',
		});
	}

	public blit_rect(x0: number, y0: number, x1: number, y1: number, z: number, colorindex: number): void {
		this.activeRenderer.rect({
			kind: 'rect',
			area: { left: x0, top: y0, right: x1, bottom: y1, z },
			color: this.resolvePaletteIndex(colorindex),
			layer: 'ide',
		});
	}

	public blit(imgid: string, x: number, y: number, z: number, options?: OverlayBlitOptions): void {
		let scaleX = 1;
		let scaleY = 1;
		if (options !== undefined && options.scale !== undefined) {
			if (typeof options.scale === 'number') {
				scaleX = options.scale;
				scaleY = options.scale;
			} else {
				scaleX = options.scale.x;
				scaleY = options.scale.y;
			}
		}
		this.activeRenderer.sprite({
			imgid,
			pos: { x, y, z },
			scale: { x: scaleX, y: scaleY },
			flip: {
				flip_h: options !== undefined && options.flip_h === true,
				flip_v: options !== undefined && options.flip_v === true,
			},
			colorize: options !== undefined && options.colorize !== undefined
				? options.colorize
				: { r: 1, g: 1, b: 1, a: 1 },
			layer: options !== undefined && options.layer !== undefined ? options.layer : 'ide',
		});
	}

	public blit_text_inline_with_font(text: string, x: number, y: number, z: number, colorindex: number, font?: BFont): void {
		this.activeRenderer.glyphs({
			glyphs: text,
			x,
			y,
			z,
			color: this.resolvePaletteIndex(colorindex),
			font,
			layer: 'ide',
		});
	}

	public blit_text_inline_span_with_font(text: string, start: number, end: number, x: number, y: number, z: number, colorindex: number, font?: BFont): void {
		this.activeRenderer.glyphs({
			glyphs: text,
			glyph_start: start,
			glyph_end: end,
			x,
			y,
			z,
			color: this.resolvePaletteIndex(colorindex),
			font,
			layer: 'ide',
		});
	}
}

export const api = new OverlayApi();
