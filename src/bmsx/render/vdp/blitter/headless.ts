import { $ } from '../../../core/engine';
import { Runtime } from '../../../machine/runtime/runtime';
import type {
	VdpBlitterCommand,
	VdpBlitterExecutor,
	VdpBlitterContext,
	VdpBlitterSource,
	VdpFrameBufferColor,
} from '../../../machine/devices/vdp/vdp';
import type { Layer2D } from '../../shared/submissions';
import { HeadlessGPUBackend } from '../../headless/backend';
import { syncVdpSlotTextures } from '../slot_textures';

const BLITTER_WHITE: VdpFrameBufferColor = { r: 255, g: 255, b: 255, a: 255 };

type HeadlessSurfacePixels = {
	pixels: Uint8Array;
	stride: number;
};

export class HeadlessVdpBlitterExecutor implements VdpBlitterExecutor {
	private frameBufferPriorityLayer = new Uint8Array(0);
	private frameBufferPriorityZ = new Float32Array(0);
	private frameBufferPrioritySeq = new Uint32Array(0);
	private readonly surfacePixelsByTextureKey = new Map<string, HeadlessSurfacePixels>();

	public constructor(
		private readonly backend: HeadlessGPUBackend,
	) {
	}

	public execute(context: VdpBlitterContext, commands: readonly VdpBlitterCommand[]): void {
		if (commands.length === 0) {
			return;
		}
		syncVdpSlotTextures(Runtime.instance.machine.vdp);
		const frameBufferTexture = $.texmanager.getTextureByUri(context.frameBufferTextureKey);
		const frameBufferPixels = this.backend.readTextureRegion(frameBufferTexture, 0, 0, context.width, context.height);
		this.ensurePriorityCapacity(context.width * context.height);
		this.resetPriority();
		this.surfacePixelsByTextureKey.clear();
		for (let index = 0; index < commands.length; index += 1) {
			const command = commands[index];
			if (command.opcode === 'clear') {
				for (let pixelIndex = 0; pixelIndex < frameBufferPixels.length; pixelIndex += 4) {
					frameBufferPixels[pixelIndex + 0] = command.color.r;
					frameBufferPixels[pixelIndex + 1] = command.color.g;
					frameBufferPixels[pixelIndex + 2] = command.color.b;
					frameBufferPixels[pixelIndex + 3] = command.color.a;
				}
				this.resetPriority();
				continue;
			}
			if (command.opcode === 'fill_rect') {
				this.rasterizeFill(frameBufferPixels, context.width, context.height, command.x0, command.y0, command.x1, command.y1, command.color, command.layer, command.z, command.seq);
				continue;
			}
			if (command.opcode === 'draw_line') {
				this.rasterizeLine(frameBufferPixels, context.width, context.height, command.x0, command.y0, command.x1, command.y1, command.thickness, command.color, command.layer, command.z, command.seq);
				continue;
			}
			if (command.opcode === 'blit') {
				this.rasterizeBlit(context, frameBufferPixels, context.width, context.height, command.source, command.dstX, command.dstY, command.scaleX, command.scaleY, command.flipH, command.flipV, command.color, command.layer, command.z, command.seq);
				continue;
			}
			if (command.opcode === 'copy_rect') {
				this.copyFrameBufferRect(frameBufferPixels, context.width, command.srcX, command.srcY, command.width, command.height, command.dstX, command.dstY, command.layer, command.z, command.seq);
				continue;
			}
			if (command.opcode === 'glyph_run') {
				if (command.backgroundColor !== null) {
					for (let glyphIndex = 0; glyphIndex < command.glyphs.length; glyphIndex += 1) {
						const glyph = command.glyphs[glyphIndex];
						this.rasterizeFill(frameBufferPixels, context.width, context.height, glyph.dstX, glyph.dstY, glyph.dstX + glyph.advance, glyph.dstY + command.lineHeight, command.backgroundColor, command.layer, command.z, command.seq);
					}
				}
				for (let glyphIndex = 0; glyphIndex < command.glyphs.length; glyphIndex += 1) {
					const glyph = command.glyphs[glyphIndex];
					this.rasterizeBlit(context, frameBufferPixels, context.width, context.height, glyph, glyph.dstX, glyph.dstY, 1, 1, false, false, command.color, command.layer, command.z, command.seq);
				}
				continue;
			}
			for (let tileIndex = 0; tileIndex < command.tiles.length; tileIndex += 1) {
				const tile = command.tiles[tileIndex];
				this.rasterizeBlit(context, frameBufferPixels, context.width, context.height, tile, tile.dstX, tile.dstY, 1, 1, false, false, BLITTER_WHITE, command.layer, command.z, command.seq);
			}
		}
		this.backend.updateTexture(frameBufferTexture, { width: context.width, height: context.height, data: frameBufferPixels });
	}

	private ensurePriorityCapacity(pixelCount: number): void {
		if (this.frameBufferPriorityLayer.length === pixelCount) {
			return;
		}
		this.frameBufferPriorityLayer = new Uint8Array(pixelCount);
		this.frameBufferPriorityZ = new Float32Array(pixelCount);
		this.frameBufferPrioritySeq = new Uint32Array(pixelCount);
	}

	private resetPriority(): void {
		this.frameBufferPriorityLayer.fill(0);
		this.frameBufferPriorityZ.fill(Number.NEGATIVE_INFINITY);
		this.frameBufferPrioritySeq.fill(0);
	}

	private getSourcePixels(context: VdpBlitterContext, source: VdpBlitterSource): HeadlessSurfacePixels {
		const surface = context.getSurface(source.surfaceId);
		const cached = this.surfacePixelsByTextureKey.get(surface.textureKey);
		if (cached) {
			return cached;
		}
		const texture = $.texmanager.getTextureByUri(surface.textureKey);
		const pixels = this.backend.readTextureRegion(texture, 0, 0, surface.width, surface.height);
		const resolved = { pixels, stride: surface.width * 4 };
		this.surfacePixelsByTextureKey.set(surface.textureKey, resolved);
		return resolved;
	}

	private blendFrameBufferPixel(pixels: Uint8Array, index: number, r: number, g: number, b: number, a: number, layer: Layer2D, z: number, seq: number): void {
		if (a <= 0) {
			return;
		}
		const pixelIndex = index >> 2;
		const currentLayer = this.frameBufferPriorityLayer[pixelIndex] as Layer2D;
		if (layer < currentLayer) {
			return;
		}
		if (layer === currentLayer) {
			const currentZ = this.frameBufferPriorityZ[pixelIndex];
			if (z < currentZ) {
				return;
			}
			if (z === currentZ && seq < this.frameBufferPrioritySeq[pixelIndex]) {
				return;
			}
		}
		if (a >= 255) {
			pixels[index + 0] = r;
			pixels[index + 1] = g;
			pixels[index + 2] = b;
			pixels[index + 3] = 255;
			this.frameBufferPriorityLayer[pixelIndex] = layer;
			this.frameBufferPriorityZ[pixelIndex] = z;
			this.frameBufferPrioritySeq[pixelIndex] = seq;
			return;
		}
		const inverse = 255 - a;
		pixels[index + 0] = ((r * a) + (pixels[index + 0] * inverse) + 127) / 255;
		pixels[index + 1] = ((g * a) + (pixels[index + 1] * inverse) + 127) / 255;
		pixels[index + 2] = ((b * a) + (pixels[index + 2] * inverse) + 127) / 255;
		pixels[index + 3] = a + ((pixels[index + 3] * inverse) + 127) / 255;
		this.frameBufferPriorityLayer[pixelIndex] = layer;
		this.frameBufferPriorityZ[pixelIndex] = z;
		this.frameBufferPrioritySeq[pixelIndex] = seq;
	}

	private rasterizeFill(pixels: Uint8Array, frameWidth: number, frameHeight: number, x0: number, y0: number, x1: number, y1: number, color: VdpFrameBufferColor, layer: Layer2D, z: number, seq: number): void {
		let left = Math.round(x0);
		let top = Math.round(y0);
		let right = Math.round(x1);
		let bottom = Math.round(y1);
		if (right < left) {
			const swap = left;
			left = right;
			right = swap;
		}
		if (bottom < top) {
			const swap = top;
			top = bottom;
			bottom = swap;
		}
		if (left < 0) left = 0;
		if (top < 0) top = 0;
		if (right > frameWidth) right = frameWidth;
		if (bottom > frameHeight) bottom = frameHeight;
		for (let y = top; y < bottom; y += 1) {
			let index = (y * frameWidth + left) * 4;
			for (let x = left; x < right; x += 1) {
				this.blendFrameBufferPixel(pixels, index, color.r, color.g, color.b, color.a, layer, z, seq);
				index += 4;
			}
		}
	}

	// start numeric-sanitization-acceptable -- headless framebuffer rasterization maps float VDP geometry to integer pixel spans.
	private rasterizeLine(pixels: Uint8Array, frameWidth: number, frameHeight: number, x0: number, y0: number, x1: number, y1: number, thicknessValue: number, color: VdpFrameBufferColor, layer: Layer2D, z: number, seq: number): void {
		let currentX = Math.round(x0);
		let currentY = Math.round(y0);
		const targetX = Math.round(x1);
		const targetY = Math.round(y1);
		const dx = Math.abs(targetX - currentX);
		const dy = Math.abs(targetY - currentY);
		const sx = currentX < targetX ? 1 : -1;
		const sy = currentY < targetY ? 1 : -1;
		let err = dx - dy;
		const thickness = Math.max(1, Math.round(thicknessValue));
		while (true) {
			const half = thickness >> 1;
			for (let yy = currentY - half; yy < currentY - half + thickness; yy += 1) {
				if (yy < 0 || yy >= frameHeight) {
					continue;
				}
				for (let xx = currentX - half; xx < currentX - half + thickness; xx += 1) {
					if (xx < 0 || xx >= frameWidth) {
						continue;
					}
					const index = (yy * frameWidth + xx) * 4;
					this.blendFrameBufferPixel(pixels, index, color.r, color.g, color.b, color.a, layer, z, seq);
				}
			}
			if (currentX === targetX && currentY === targetY) {
				return;
			}
			const e2 = err << 1;
			if (e2 > -dy) {
				err -= dy;
				currentX += sx;
			}
			if (e2 < dx) {
				err += dx;
				currentY += sy;
			}
		}
	}

	private rasterizeBlit(context: VdpBlitterContext, pixels: Uint8Array, frameWidth: number, frameHeight: number, source: VdpBlitterSource, dstXValue: number, dstYValue: number, scaleX: number, scaleY: number, flipH: boolean, flipV: boolean, color: VdpFrameBufferColor, layer: Layer2D, z: number, seq: number): void {
		const sourcePixels = this.getSourcePixels(context, source);
		const dstW = Math.max(1, Math.round(source.width * scaleX));
		const dstH = Math.max(1, Math.round(source.height * scaleY));
		const dstX = Math.round(dstXValue);
		const dstY = Math.round(dstYValue);
		for (let y = 0; y < dstH; y += 1) {
			const targetY = dstY + y;
			if (targetY < 0 || targetY >= frameHeight) {
				continue;
			}
			const srcY = flipV
				? source.height - 1 - Math.floor((y * source.height) / dstH)
				: Math.floor((y * source.height) / dstH);
			for (let x = 0; x < dstW; x += 1) {
				const targetX = dstX + x;
				if (targetX < 0 || targetX >= frameWidth) {
					continue;
				}
				const srcX = flipH
					? source.width - 1 - Math.floor((x * source.width) / dstW)
					: Math.floor((x * source.width) / dstW);
				const srcIndex = ((source.srcY + srcY) * sourcePixels.stride) + ((source.srcX + srcX) * 4);
				const srcA = sourcePixels.pixels[srcIndex + 3];
				if (srcA === 0) {
					continue;
				}
				const outA = (srcA * color.a + 127) / 255;
				const outR = (sourcePixels.pixels[srcIndex + 0] * color.r + 127) / 255;
				const outG = (sourcePixels.pixels[srcIndex + 1] * color.g + 127) / 255;
				const outB = (sourcePixels.pixels[srcIndex + 2] * color.b + 127) / 255;
				const dstIndex = (targetY * frameWidth + targetX) * 4;
				this.blendFrameBufferPixel(pixels, dstIndex, outR, outG, outB, outA, layer, z, seq);
			}
		}
	}
	// end numeric-sanitization-acceptable

	private copyFrameBufferRect(pixels: Uint8Array, frameWidth: number, srcX: number, srcY: number, width: number, height: number, dstX: number, dstY: number, layer: Layer2D, z: number, seq: number): void {
		const rowBytes = width * 4;
		const overlapping =
			dstX < srcX + width
			&& dstX + width > srcX
			&& dstY < srcY + height
			&& dstY + height > srcY;
		const copyBackward = overlapping && dstY > srcY;
		const startRow = copyBackward ? height - 1 : 0;
		const endRow = copyBackward ? -1 : height;
		const step = copyBackward ? -1 : 1;
		for (let row = startRow; row !== endRow; row += step) {
			const sourceIndex = ((srcY + row) * frameWidth + srcX) * 4;
			const targetIndex = ((dstY + row) * frameWidth + dstX) * 4;
			pixels.copyWithin(targetIndex, sourceIndex, sourceIndex + rowBytes);
			const targetPixel = ((dstY + row) * frameWidth) + dstX;
			for (let col = 0; col < width; col += 1) {
				const pixelIndex = targetPixel + col;
				this.frameBufferPriorityLayer[pixelIndex] = layer;
				this.frameBufferPriorityZ[pixelIndex] = z;
				this.frameBufferPrioritySeq[pixelIndex] = seq;
			}
		}
	}
}
