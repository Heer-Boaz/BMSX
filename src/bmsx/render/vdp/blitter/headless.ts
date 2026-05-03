import type {
	VdpBlitterCommand,
	VdpBlitterSource,
	VdpHostOutput,
} from '../../../machine/devices/vdp/vdp';
import {
	VDP_BLITTER_IMPLICIT_CLEAR,
	VDP_BLITTER_OPCODE_BLIT,
	VDP_BLITTER_OPCODE_CLEAR,
	VDP_BLITTER_OPCODE_COPY_RECT,
	VDP_BLITTER_OPCODE_DRAW_LINE,
	VDP_BLITTER_OPCODE_FILL_RECT,
	VDP_BLITTER_OPCODE_GLYPH_RUN,
	VDP_BLITTER_WHITE,
} from '../../../machine/devices/vdp/blitter';
import type { Layer2D } from '../../../machine/devices/vdp/contracts';
import { writeVdpRenderFrameBufferPixels } from '../framebuffer';
import { resolveVdpSurfacePixels } from '../source_pixels';

type HeadlessSurfacePixels = {
	pixels: Uint8Array;
	width: number;
	height: number;
	stride: number;
};

export class HeadlessVdpBlitterExecutor {
	private frameBufferPriorityLayer = new Uint8Array(0);
	private frameBufferPriorityZ = new Float32Array(0);
	private frameBufferPrioritySeq = new Uint32Array(0);
	private readonly surfacePixelsBySurfaceId = new Map<number, HeadlessSurfacePixels>();
	private readonly sourceScratch: VdpBlitterSource = { surfaceId: 0, srcX: 0, srcY: 0, width: 0, height: 0 };

	public execute(output: VdpHostOutput, commands: VdpBlitterCommand): void {
		if (commands.length === 0) {
			return;
		}
		const frameBufferWidth = output.frameBufferWidth;
		const frameBufferHeight = output.frameBufferHeight;
		const frameBufferPixels = output.frameBufferRenderReadback;
		this.ensurePriorityCapacity(frameBufferWidth * frameBufferHeight);
		if (commands.opcode[0] !== VDP_BLITTER_OPCODE_CLEAR) {
			this.fillFrameBuffer(frameBufferPixels, VDP_BLITTER_IMPLICIT_CLEAR);
		}
		this.resetPriority();
		this.surfacePixelsBySurfaceId.clear();
		for (let index = 0; index < commands.length; index += 1) {
			const opcode = commands.opcode[index];
				if (opcode === VDP_BLITTER_OPCODE_CLEAR) {
					const color = commands.color[index];
					this.fillFrameBuffer(frameBufferPixels, color);
					this.resetPriority();
					continue;
				}
				const layer = commands.layer[index] as Layer2D;
				const priority = commands.priority[index];
				const sequence = commands.seq[index];
				const color = commands.color[index];
				if (opcode === VDP_BLITTER_OPCODE_FILL_RECT) {
					this.rasterizeFill(frameBufferPixels, frameBufferWidth, frameBufferHeight, commands.x0[index], commands.y0[index], commands.x1[index], commands.y1[index], color, layer, priority, sequence);
					continue;
				}
				if (opcode === VDP_BLITTER_OPCODE_DRAW_LINE) {
					this.rasterizeLine(frameBufferPixels, frameBufferWidth, frameBufferHeight, commands.x0[index], commands.y0[index], commands.x1[index], commands.y1[index], commands.thickness[index], color, layer, priority, sequence);
					continue;
				}
			if (opcode === VDP_BLITTER_OPCODE_BLIT) {
				const source = this.sourceScratch;
				source.surfaceId = commands.sourceSurfaceId[index];
				source.srcX = commands.sourceSrcX[index];
				source.srcY = commands.sourceSrcY[index];
				source.width = commands.sourceWidth[index];
				source.height = commands.sourceHeight[index];
					this.rasterizeBlit(output, frameBufferPixels, frameBufferWidth, frameBufferHeight, source, commands.dstX[index], commands.dstY[index], commands.scaleX[index], commands.scaleY[index], commands.flipH[index] !== 0, commands.flipV[index] !== 0, color, layer, priority, sequence);
					continue;
				}
				if (opcode === VDP_BLITTER_OPCODE_COPY_RECT) {
					this.copyFrameBufferRect(frameBufferPixels, frameBufferWidth, commands.srcX[index], commands.srcY[index], commands.width[index], commands.height[index], commands.dstX[index], commands.dstY[index], layer, priority, sequence);
					continue;
				}
			if (opcode === VDP_BLITTER_OPCODE_GLYPH_RUN) {
				const firstGlyph = commands.glyphRunFirstEntry[index];
				const glyphCount = commands.glyphRunEntryCount[index];
				const glyphEnd = firstGlyph + glyphCount;
					if (commands.hasBackgroundColor[index] !== 0) {
						for (let glyphIndex = firstGlyph; glyphIndex < glyphEnd; glyphIndex += 1) {
							this.rasterizeFill(frameBufferPixels, frameBufferWidth, frameBufferHeight, commands.glyphDstX[glyphIndex], commands.glyphDstY[glyphIndex], commands.glyphDstX[glyphIndex] + commands.glyphAdvance[glyphIndex], commands.glyphDstY[glyphIndex] + commands.lineHeight[index], commands.backgroundColor[index], layer, priority, sequence);
						}
					}
				for (let glyphIndex = firstGlyph; glyphIndex < glyphEnd; glyphIndex += 1) {
					const source = this.sourceScratch;
					source.surfaceId = commands.glyphSurfaceId[glyphIndex];
					source.srcX = commands.glyphSrcX[glyphIndex];
					source.srcY = commands.glyphSrcY[glyphIndex];
					source.width = commands.glyphWidth[glyphIndex];
					source.height = commands.glyphHeight[glyphIndex];
						this.rasterizeBlit(output, frameBufferPixels, frameBufferWidth, frameBufferHeight, source, commands.glyphDstX[glyphIndex], commands.glyphDstY[glyphIndex], 1, 1, false, false, color, layer, priority, sequence);
					}
					continue;
				}
			const firstTile = commands.tileRunFirstEntry[index];
			const tileEnd = firstTile + commands.tileRunEntryCount[index];
			for (let tileIndex = firstTile; tileIndex < tileEnd; tileIndex += 1) {
				const source = this.sourceScratch;
				source.surfaceId = commands.tileSurfaceId[tileIndex];
				source.srcX = commands.tileSrcX[tileIndex];
				source.srcY = commands.tileSrcY[tileIndex];
				source.width = commands.tileWidth[tileIndex];
				source.height = commands.tileHeight[tileIndex];
					this.rasterizeBlit(output, frameBufferPixels, frameBufferWidth, frameBufferHeight, source, commands.tileDstX[tileIndex], commands.tileDstY[tileIndex], 1, 1, false, false, VDP_BLITTER_WHITE, layer, priority, sequence);
				}
		}
		writeVdpRenderFrameBufferPixels(frameBufferPixels, frameBufferWidth, frameBufferHeight);
	}

	private fillFrameBuffer(pixels: Uint8Array, color: number): void {
		const r = (color >>> 16) & 0xff;
		const g = (color >>> 8) & 0xff;
		const b = color & 0xff;
		const a = (color >>> 24) & 0xff;
		for (let pixelIndex = 0; pixelIndex < pixels.length; pixelIndex += 4) {
			pixels[pixelIndex + 0] = r;
			pixels[pixelIndex + 1] = g;
			pixels[pixelIndex + 2] = b;
			pixels[pixelIndex + 3] = a;
		}
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

	private getSourcePixels(output: VdpHostOutput, source: VdpBlitterSource): HeadlessSurfacePixels {
		const cached = this.surfacePixelsBySurfaceId.get(source.surfaceId);
		if (cached) {
			return cached;
		}
		const surface = resolveVdpSurfacePixels(output, source.surfaceId);
		const resolved = {
			pixels: surface.pixels,
			width: surface.width,
			height: surface.height,
			stride: surface.stride,
		};
		this.surfacePixelsBySurfaceId.set(source.surfaceId, resolved);
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

	private rasterizeFill(pixels: Uint8Array, frameWidth: number, frameHeight: number, x0: number, y0: number, x1: number, y1: number, color: number, layer: Layer2D, z: number, seq: number): void {
		const r = (color >>> 16) & 0xff;
		const g = (color >>> 8) & 0xff;
		const b = color & 0xff;
		const a = (color >>> 24) & 0xff;
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
				this.blendFrameBufferPixel(pixels, index, r, g, b, a, layer, z, seq);
				index += 4;
			}
		}
	}

	// start numeric-sanitization-acceptable -- headless framebuffer rasterization maps float VDP geometry to integer pixel spans.
	private rasterizeLine(pixels: Uint8Array, frameWidth: number, frameHeight: number, x0: number, y0: number, x1: number, y1: number, thicknessValue: number, color: number, layer: Layer2D, z: number, seq: number): void {
		const r = (color >>> 16) & 0xff;
		const g = (color >>> 8) & 0xff;
		const b = color & 0xff;
		const a = (color >>> 24) & 0xff;
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
					this.blendFrameBufferPixel(pixels, index, r, g, b, a, layer, z, seq);
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

	private rasterizeBlit(output: VdpHostOutput, pixels: Uint8Array, frameWidth: number, frameHeight: number, source: VdpBlitterSource, dstXValue: number, dstYValue: number, scaleX: number, scaleY: number, flipH: boolean, flipV: boolean, color: number, layer: Layer2D, z: number, seq: number): void {
		const colorR = (color >>> 16) & 0xff;
		const colorG = (color >>> 8) & 0xff;
		const colorB = color & 0xff;
		const colorA = (color >>> 24) & 0xff;
		const sourcePixels = this.getSourcePixels(output, source);
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
				const sampleX = source.srcX + srcX;
				const sampleY = source.srcY + srcY;
				if (sampleX < 0 || sampleX >= sourcePixels.width || sampleY < 0 || sampleY >= sourcePixels.height) {
					continue;
				}
				const srcIndex = (sampleY * sourcePixels.stride) + (sampleX * 4);
				const srcA = sourcePixels.pixels[srcIndex + 3];
				if (srcA === 0) {
					continue;
				}
				const outA = (srcA * colorA + 127) / 255;
				const outR = (sourcePixels.pixels[srcIndex + 0] * colorR + 127) / 255;
				const outG = (sourcePixels.pixels[srcIndex + 1] * colorG + 127) / 255;
				const outB = (sourcePixels.pixels[srcIndex + 2] * colorB + 127) / 255;
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
