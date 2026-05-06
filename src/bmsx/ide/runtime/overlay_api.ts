import type { BFont } from '../../render/shared/bitmap_font';
import type { color } from '../../render/shared/submissions';
import { resolveThemeTokenColor } from '../theme/tokens';
import { OverlayRenderer } from './overlay_renderer';

export class OverlayApi {
	private renderer: OverlayRenderer;

	public beginFrame(renderer: OverlayRenderer): void {
		this.renderer = renderer;
	}

	public fill_rect(x0: number, y0: number, x1: number, y1: number, z: number, colorindex: number): void {
		this.renderer.fillRect(x0, y0, x1, y1, z, resolveThemeTokenColor(colorindex), 'ide');
	}

	public fill_rect_color(x0: number, y0: number, x1: number, y1: number, z: number, colorvalue: color): void {
		this.renderer.fillRect(x0, y0, x1, y1, z, colorvalue, 'ide');
	}

	public blit_rect(x0: number, y0: number, x1: number, y1: number, z: number, colorindex: number): void {
		this.renderer.strokeRect(x0, y0, x1, y1, z, resolveThemeTokenColor(colorindex), 'ide');
	}

	public blit_colorized(imgid: string, x: number, y: number, z: number, colorize: color): void {
		this.renderer.spriteColorized(imgid, x, y, z, colorize, 'ide');
	}

	public blit_text_inline_with_font(text: string, x: number, y: number, z: number, colorindex: number, font: BFont): void {
		this.renderer.glyphRun(text, 0, text.length, x, y, z, font, resolveThemeTokenColor(colorindex), 'ide');
	}

	public blit_text_inline_span_with_font(text: string, start: number, end: number, x: number, y: number, z: number, colorindex: number, font: BFont): void {
		this.renderer.glyphRun(text, start, end, x, y, z, font, resolveThemeTokenColor(colorindex), 'ide');
	}
}

export const api = new OverlayApi();
