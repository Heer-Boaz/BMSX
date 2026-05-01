import type {
	VDP,
	VdpBlitterCommand,
	VdpBlitterSource,
	VdpFrameBufferColor,
} from '../../../machine/devices/vdp/vdp';
import type { Layer2D } from '../../../machine/devices/vdp/contracts';
import { writeVdpRenderFrameBufferPixels } from '../framebuffer';
import { resolveVdpSurfacePixels } from '../source_pixels';

const BLITTER_WHITE: VdpFrameBufferColor = { r: 255, g: 255, b: 255, a: 255 };
const IMPLICIT_CLEAR_COLOR: VdpFrameBufferColor = { r: 0, g: 0, b: 0, a: 255 };

type HeadlessSurfacePixels = {
	pixels: Uint8Array;
	width: number;
	height: number;
	stride: number;
};

type BlitParallaxTransform = {
	scale: number;
	offsetY: number;
};

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function smoothstep01(value: number): number {
	const t = clamp01(value);
	return t * t * (3 - 2 * t);
}

function computeBlitParallax(vdp: VDP, parallaxWeight: number): BlitParallaxTransform {
	const dir = Math.sign(parallaxWeight);
	if (dir === 0) {
		return { scale: 1, offsetY: 0 };
	}
	const rig = vdp.executionParallaxRig;
	const weight = Math.abs(parallaxWeight);
	const timeSeconds = vdp.executionParallaxClockSeconds;
	const wobble = Math.sin(timeSeconds * 2.2) * 0.5 + Math.sin(timeSeconds * 1.1 + 1.7) * 0.5;
	let offsetY = (rig.bias_px + wobble * rig.vy) * weight * rig.parallax_strength * dir;
	const flipWindowSeconds = Math.max(rig.flip_window, 0.0001);
	const hold = 0.2 * flipWindowSeconds;
	const flipU = clamp01((rig.impact_t - hold) / Math.max(flipWindowSeconds - hold, 0.0001));
	const flipWindow = 1 - smoothstep01(flipU);
	const flip = 1 + (-2 * (flipWindow * rig.flip_strength));
	offsetY *= flip;
	const baseScale = 1 + (rig.scale - 1) * weight * rig.scale_strength;
	const impactSign = Math.sign(rig.impact);
	const impactMask = Math.max(0, dir * impactSign);
	const pulse = Math.exp(-8 * rig.impact_t) * Math.abs(rig.impact) * weight * impactMask;
	return { scale: baseScale + pulse, offsetY };
}

export class HeadlessVdpBlitterExecutor {
	private frameBufferPriorityLayer = new Uint8Array(0);
	private frameBufferPriorityZ = new Float32Array(0);
	private frameBufferPrioritySeq = new Uint32Array(0);
	private readonly surfacePixelsBySurfaceId = new Map<number, HeadlessSurfacePixels>();

	public execute(vdp: VDP, commands: readonly VdpBlitterCommand[]): void {
		if (commands.length === 0) {
			return;
		}
		const frameBufferWidth = vdp.frameBufferWidth;
		const frameBufferHeight = vdp.frameBufferHeight;
		const frameBufferPixels = vdp.frameBufferRenderReadback;
		this.ensurePriorityCapacity(frameBufferWidth * frameBufferHeight);
		if (commands[0].opcode !== 'clear') {
			for (let pixelIndex = 0; pixelIndex < frameBufferPixels.length; pixelIndex += 4) {
				frameBufferPixels[pixelIndex + 0] = IMPLICIT_CLEAR_COLOR.r;
				frameBufferPixels[pixelIndex + 1] = IMPLICIT_CLEAR_COLOR.g;
				frameBufferPixels[pixelIndex + 2] = IMPLICIT_CLEAR_COLOR.b;
				frameBufferPixels[pixelIndex + 3] = IMPLICIT_CLEAR_COLOR.a;
			}
		}
		this.resetPriority();
		this.surfacePixelsBySurfaceId.clear();
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
				this.rasterizeFill(frameBufferPixels, frameBufferWidth, frameBufferHeight, command.x0, command.y0, command.x1, command.y1, command.color, command.layer, command.z, command.seq);
				continue;
			}
			if (command.opcode === 'draw_line') {
				this.rasterizeLine(frameBufferPixels, frameBufferWidth, frameBufferHeight, command.x0, command.y0, command.x1, command.y1, command.thickness, command.color, command.layer, command.z, command.seq);
				continue;
			}
			if (command.opcode === 'blit') {
				this.rasterizeBlit(vdp, frameBufferPixels, frameBufferWidth, frameBufferHeight, command.source, command.dstX, command.dstY, command.scaleX, command.scaleY, command.flipH, command.flipV, command.parallaxWeight, command.color, command.layer, command.z, command.seq);
				continue;
			}
			if (command.opcode === 'copy_rect') {
				this.copyFrameBufferRect(frameBufferPixels, frameBufferWidth, command.srcX, command.srcY, command.width, command.height, command.dstX, command.dstY, command.layer, command.z, command.seq);
				continue;
			}
			if (command.opcode === 'glyph_run') {
				if (command.backgroundColor !== null) {
					for (let glyphIndex = 0; glyphIndex < command.glyphs.length; glyphIndex += 1) {
						const glyph = command.glyphs[glyphIndex];
						this.rasterizeFill(frameBufferPixels, frameBufferWidth, frameBufferHeight, glyph.dstX, glyph.dstY, glyph.dstX + glyph.advance, glyph.dstY + command.lineHeight, command.backgroundColor, command.layer, command.z, command.seq);
					}
				}
				for (let glyphIndex = 0; glyphIndex < command.glyphs.length; glyphIndex += 1) {
					const glyph = command.glyphs[glyphIndex];
					this.rasterizeBlit(vdp, frameBufferPixels, frameBufferWidth, frameBufferHeight, glyph, glyph.dstX, glyph.dstY, 1, 1, false, false, 0, command.color, command.layer, command.z, command.seq);
				}
				continue;
			}
			for (let tileIndex = 0; tileIndex < command.tiles.length; tileIndex += 1) {
				const tile = command.tiles[tileIndex];
				this.rasterizeBlit(vdp, frameBufferPixels, frameBufferWidth, frameBufferHeight, tile, tile.dstX, tile.dstY, 1, 1, false, false, 0, BLITTER_WHITE, command.layer, command.z, command.seq);
			}
		}
		writeVdpRenderFrameBufferPixels(frameBufferPixels, frameBufferWidth, frameBufferHeight);
		vdp.invalidateFrameBufferReadCache();
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

	private getSourcePixels(vdp: VDP, source: VdpBlitterSource): HeadlessSurfacePixels {
		const cached = this.surfacePixelsBySurfaceId.get(source.surfaceId);
		if (cached) {
			return cached;
		}
		const surface = resolveVdpSurfacePixels(vdp, source.surfaceId);
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

	private rasterizeBlit(vdp: VDP, pixels: Uint8Array, frameWidth: number, frameHeight: number, source: VdpBlitterSource, dstXValue: number, dstYValue: number, scaleX: number, scaleY: number, flipH: boolean, flipV: boolean, parallaxWeight: number, color: VdpFrameBufferColor, layer: Layer2D, z: number, seq: number): void {
		const sourcePixels = this.getSourcePixels(vdp, source);
		const baseDstW = source.width * scaleX;
		const baseDstH = source.height * scaleY;
		const parallax = computeBlitParallax(vdp, parallaxWeight);
		const dstW = Math.max(1, Math.round(baseDstW * parallax.scale));
		const dstH = Math.max(1, Math.round(baseDstH * parallax.scale));
		const centerX = dstXValue + baseDstW * 0.5;
		const centerY = dstYValue + baseDstH * 0.5;
		const dstX = Math.round(centerX - dstW * 0.5);
		const dstY = Math.round(centerY - dstH * 0.5 + parallax.offsetY);
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
