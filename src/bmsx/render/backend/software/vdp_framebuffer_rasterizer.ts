import {
	type Layer2D,
} from '../../../machine/devices/vdp/contracts';
import {
	VdpBlitterCommandBuffer,
	type VdpBlitterSource,
	VDP_BLITTER_IMPLICIT_CLEAR,
	VDP_BLITTER_OPCODE_BATCH_BLIT,
	VDP_BLITTER_OPCODE_BLIT,
	VDP_BLITTER_OPCODE_CLEAR,
	VDP_BLITTER_OPCODE_DRAW_LINE,
	VDP_BLITTER_OPCODE_FILL_RECT,
} from '../../../machine/devices/vdp/blitter';
import type { VDP } from '../../../machine/devices/vdp/vdp';

export class VdpFrameBufferRasterizer {
	private frameBufferPriorityLayer = new Uint8Array(0);
	private frameBufferPriorityZ = new Float32Array(0);
	private frameBufferPrioritySeq = new Uint32Array(0);
	private readonly latchedSourceScratch: VdpBlitterSource = { surfaceId: 0, srcX: 0, srcY: 0, width: 0, height: 0 };

	public constructor(private readonly vdp: VDP) {}

	public executeFrameBufferCommands(commands: VdpBlitterCommandBuffer, frameWidth: number, frameHeight: number, pixels: Uint8Array): void {
		if (commands.length === 0) {
			return;
		}
		this.resizeFrameBufferPriorityStorage(frameWidth * frameHeight);
		if (commands.opcode[0] !== VDP_BLITTER_OPCODE_CLEAR) {
			this.fillFrameBuffer(pixels, VDP_BLITTER_IMPLICIT_CLEAR);
		}
		this.resetFrameBufferPriority();
		for (let index = 0; index < commands.length; index += 1) {
			const opcode = commands.opcode[index];
			if (opcode === VDP_BLITTER_OPCODE_CLEAR) {
				this.fillFrameBuffer(pixels, commands.color[index]);
				this.resetFrameBufferPriority();
				continue;
			}
			const layer = commands.layer[index] as Layer2D;
			const priority = commands.priority[index];
			const sequence = commands.seq[index];
			const color = commands.color[index];
			if (opcode === VDP_BLITTER_OPCODE_FILL_RECT) {
				this.rasterizeFrameBufferFill(pixels, frameWidth, frameHeight, commands.x0[index], commands.y0[index], commands.x1[index], commands.y1[index], color, layer, priority, sequence);
				continue;
			}
			if (opcode === VDP_BLITTER_OPCODE_DRAW_LINE) {
				this.rasterizeFrameBufferLine(pixels, frameWidth, frameHeight, commands.x0[index], commands.y0[index], commands.x1[index], commands.y1[index], commands.thickness[index], color, layer, priority, sequence);
				continue;
			}
			if (opcode === VDP_BLITTER_OPCODE_BLIT) {
				const source = this.latchedSourceScratch;
				source.surfaceId = commands.sourceSurfaceId[index];
				source.srcX = commands.sourceSrcX[index];
				source.srcY = commands.sourceSrcY[index];
				source.width = commands.sourceWidth[index];
				source.height = commands.sourceHeight[index];
				this.rasterizeFrameBufferBlit(pixels, frameWidth, frameHeight, source, commands.dstX[index], commands.dstY[index], commands.width[index], commands.height[index], commands.flipH[index] !== 0, commands.flipV[index] !== 0, color, layer, priority, sequence);
				continue;
			}
			if (opcode === VDP_BLITTER_OPCODE_BATCH_BLIT) {
				const firstItem = commands.batchBlitFirstEntry[index];
				const itemEnd = firstItem + commands.batchBlitItemCount[index];
				if (commands.hasBackgroundColor[index] !== 0) {
					for (let itemIndex = firstItem; itemIndex < itemEnd; itemIndex += 1) {
						this.rasterizeFrameBufferFill(pixels, frameWidth, frameHeight, commands.batchBlitDstX[itemIndex], commands.batchBlitDstY[itemIndex], commands.batchBlitDstX[itemIndex] + commands.batchBlitAdvance[itemIndex], commands.batchBlitDstY[itemIndex] + commands.lineHeight[index], commands.backgroundColor[index], layer, priority, sequence);
					}
				}
				for (let itemIndex = firstItem; itemIndex < itemEnd; itemIndex += 1) {
					const source = this.latchedSourceScratch;
					source.surfaceId = commands.batchBlitSurfaceId[itemIndex];
					source.srcX = commands.batchBlitSrcX[itemIndex];
					source.srcY = commands.batchBlitSrcY[itemIndex];
					source.width = commands.batchBlitWidth[itemIndex];
					source.height = commands.batchBlitHeight[itemIndex];
					this.rasterizeFrameBufferBlit(pixels, frameWidth, frameHeight, source, commands.batchBlitDstX[itemIndex], commands.batchBlitDstY[itemIndex], 1, 1, false, false, color, layer, priority, sequence);
				}
				continue;
			}
		}
	}

	private resizeFrameBufferPriorityStorage(pixelCount: number): void {
		if (this.frameBufferPriorityLayer.length === pixelCount) {
			return;
		}
		this.frameBufferPriorityLayer = new Uint8Array(pixelCount);
		this.frameBufferPriorityZ = new Float32Array(pixelCount);
		this.frameBufferPrioritySeq = new Uint32Array(pixelCount);
	}

	private resetFrameBufferPriority(): void {
		this.frameBufferPriorityLayer.fill(0);
		this.frameBufferPriorityZ.fill(Number.NEGATIVE_INFINITY);
		this.frameBufferPrioritySeq.fill(0);
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

	private blendFrameBufferPixel(pixels: Uint8Array, index: number, r: number, g: number, b: number, a: number, layer: Layer2D, priority: number, seq: number): void {
		if (a === 0) {
			return;
		}
		const pixelIndex = index / 4;
		const currentLayer = this.frameBufferPriorityLayer[pixelIndex] as Layer2D;
		if (layer < currentLayer) {
			return;
		}
		if (layer === currentLayer) {
			const currentPriority = this.frameBufferPriorityZ[pixelIndex];
			if (priority < currentPriority) {
				return;
			}
			if (priority === currentPriority && seq < this.frameBufferPrioritySeq[pixelIndex]) {
				return;
			}
		}
		if (a === 255) {
			pixels[index + 0] = r;
			pixels[index + 1] = g;
			pixels[index + 2] = b;
			pixels[index + 3] = 255;
			this.frameBufferPriorityLayer[pixelIndex] = layer;
			this.frameBufferPriorityZ[pixelIndex] = priority;
			this.frameBufferPrioritySeq[pixelIndex] = seq;
			return;
		}
		const inverse = 255 - a;
		pixels[index + 0] = ((r * a) + (pixels[index + 0] * inverse) + 127) / 255;
		pixels[index + 1] = ((g * a) + (pixels[index + 1] * inverse) + 127) / 255;
		pixels[index + 2] = ((b * a) + (pixels[index + 2] * inverse) + 127) / 255;
		pixels[index + 3] = a + ((pixels[index + 3] * inverse) + 127) / 255;
		this.frameBufferPriorityLayer[pixelIndex] = layer;
		this.frameBufferPriorityZ[pixelIndex] = priority;
		this.frameBufferPrioritySeq[pixelIndex] = seq;
	}

	private rasterizeFrameBufferFill(pixels: Uint8Array, frameWidth: number, frameHeight: number, x0: number, y0: number, x1: number, y1: number, color: number, layer: Layer2D, priority: number, seq: number): void {
		const r = (color >>> 16) & 0xff;
		const g = (color >>> 8) & 0xff;
		const b = color & 0xff;
		const a = (color >>> 24) & 0xff;
		let left = x0;
		let top = y0;
		let right = x1;
		let bottom = y1;
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
				this.blendFrameBufferPixel(pixels, index, r, g, b, a, layer, priority, seq);
				index += 4;
			}
		}
	}

	private rasterizeFrameBufferLine(pixels: Uint8Array, frameWidth: number, frameHeight: number, x0: number, y0: number, x1: number, y1: number, thicknessValue: number, color: number, layer: Layer2D, priority: number, seq: number): void {
		const r = (color >>> 16) & 0xff;
		const g = (color >>> 8) & 0xff;
		const b = color & 0xff;
		const a = (color >>> 24) & 0xff;
		let currentX = x0;
		let currentY = y0;
		const targetX = x1;
		const targetY = y1;
		const dx = Math.abs(targetX - currentX);
		const dy = Math.abs(targetY - currentY);
		const sx = currentX < targetX ? 1 : -1;
		const sy = currentY < targetY ? 1 : -1;
		let err = dx - dy;
		const thickness = thicknessValue;
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
					this.blendFrameBufferPixel(pixels, (yy * frameWidth + xx) * 4, r, g, b, a, layer, priority, seq);
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

	private rasterizeFrameBufferBlit(pixels: Uint8Array, frameWidth: number, frameHeight: number, source: VdpBlitterSource, dstX: number, dstY: number, dstW: number, dstH: number, flipH: boolean, flipV: boolean, color: number, layer: Layer2D, priority: number, seq: number): void {
		const colorR = (color >>> 16) & 0xff;
		const colorG = (color >>> 8) & 0xff;
		const colorB = color & 0xff;
		const colorA = (color >>> 24) & 0xff;
		const sourceSlot = this.vdp.resolveFrameBufferExecutionSource(source.surfaceId);
		if (sourceSlot === null) {
			return;
		}
		const sourcePixels = sourceSlot.cpuReadback;
		const sourceStride = sourceSlot.surfaceWidth * 4;
		let srcY = 0;
		let srcYRemainder = 0;
		for (let y = 0; y < dstH; y += 1) {
			const targetY = dstY + y;
			if (targetY >= 0 && targetY < frameHeight) {
				const sampleSourceY = flipV ? source.height - 1 - srcY : srcY;
				let srcX = 0;
				let srcXRemainder = 0;
				for (let x = 0; x < dstW; x += 1) {
					const targetX = dstX + x;
					if (targetX >= 0 && targetX < frameWidth) {
						const sampleSourceX = flipH ? source.width - 1 - srcX : srcX;
						const sampleX = source.srcX + sampleSourceX;
						const sampleY = source.srcY + sampleSourceY;
						if (sampleX < sourceSlot.surfaceWidth && sampleY < sourceSlot.surfaceHeight) {
							const srcIndex = sampleY * sourceStride + sampleX * 4;
							const srcA = sourcePixels[srcIndex + 3];
							if (srcA !== 0) {
								const outA = (srcA * colorA + 127) / 255;
								const outR = (sourcePixels[srcIndex + 0] * colorR + 127) / 255;
								const outG = (sourcePixels[srcIndex + 1] * colorG + 127) / 255;
								const outB = (sourcePixels[srcIndex + 2] * colorB + 127) / 255;
								this.blendFrameBufferPixel(pixels, (targetY * frameWidth + targetX) * 4, outR, outG, outB, outA, layer, priority, seq);
							}
						}
					}
					srcXRemainder += source.width;
					while (srcXRemainder >= dstW) {
						srcX += 1;
						srcXRemainder -= dstW;
					}
				}
			}
			srcYRemainder += source.height;
			while (srcYRemainder >= dstH) {
				srcY += 1;
				srcYRemainder -= dstH;
			}
		}
	}

}
