import {
	HOST_SYSTEM_ATLAS_HEIGHT,
	HOST_SYSTEM_ATLAS_WIDTH,
	hostSystemAtlasImage,
} from '../../rompack/host_system_atlas';
import { forEachBatchBlitGlyph } from '../shared/glyph_runs';
import type { FontGlyph } from '../shared/bitmap_font';
import {
	RectRenderKind,
	type GlyphRenderSubmission,
	type Host2DKind,
	type Host2DRef,
	type Host2DSubmission,
	type HostImageRenderSubmission,
	type PolyRenderSubmission,
	type RectRenderSubmission,
	type color,
} from '../shared/submissions';

export const HOST_OVERLAY_INSTANCE_FLOATS = 14;
export const HOST_OVERLAY_INSTANCE_FLOAT_BYTES = HOST_OVERLAY_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
export const HOST_OVERLAY_TEXTURE_SOLID = 0;
export const HOST_OVERLAY_TEXTURE_ATLAS = 1;

const INITIAL_INSTANCE_CAPACITY = 4096;
const HOST_ATLAS_U_SCALE = 1 / HOST_SYSTEM_ATLAS_WIDTH;
const HOST_ATLAS_V_SCALE = 1 / HOST_SYSTEM_ATLAS_HEIGHT;

export class HostOverlayQuadStream {
	public floatData = new Float32Array(INITIAL_INSTANCE_CAPACITY * HOST_OVERLAY_INSTANCE_FLOATS);
	public textureKinds = new Uint32Array(INITIAL_INSTANCE_CAPACITY);
	public capacity = INITIAL_INSTANCE_CAPACITY;
	public count = 0;
	private glyphBackgroundLineHeight = 0;
	private glyphBackgroundColor = 0;
	private glyphColor = 0;

	public reset(): void {
		this.count = 0;
	}

	public appendSubmission(command: Host2DSubmission): void {
		switch (command.type) {
			case 'rect':
				this.appendRect(command);
				return;
			case 'img':
				this.appendImage(command);
				return;
			case 'items':
				this.appendGlyphRun(command);
				return;
			case 'poly':
				this.appendPoly(command);
				return;
		}
	}

	public appendEntry(kind: Host2DKind, command: Host2DRef): void {
		switch (kind) {
			case 'rect':
				this.appendRect(command as RectRenderSubmission);
				return;
			case 'img':
				this.appendImage(command as HostImageRenderSubmission);
				return;
			case 'items':
				this.appendGlyphRun(command as GlyphRenderSubmission);
				return;
			case 'poly':
				this.appendPoly(command as PolyRenderSubmission);
				return;
		}
	}

	private ensureCapacity(required: number): void {
		if (required <= this.capacity) {
			return;
		}
		let capacity = this.capacity;
		while (capacity < required) {
			capacity <<= 1;
		}
		const floatData = new Float32Array(capacity * HOST_OVERLAY_INSTANCE_FLOATS);
		floatData.set(this.floatData, 0);
		this.floatData = floatData;
		const textureKinds = new Uint32Array(capacity);
		textureKinds.set(this.textureKinds, 0);
		this.textureKinds = textureKinds;
		this.capacity = capacity;
	}

	private appendQuad(originX: number, originY: number, axisXX: number, axisXY: number, axisYX: number, axisYY: number, u0: number, v0: number, u1: number, v1: number, textureKind: number, colorValue: color): void {
		const index = this.count;
		this.ensureCapacity(index + 1);
		const base = index * HOST_OVERLAY_INSTANCE_FLOATS;
		const data = this.floatData;
		data[base + 0] = originX;
		data[base + 1] = originY;
		data[base + 2] = axisXX;
		data[base + 3] = axisXY;
		data[base + 4] = axisYX;
		data[base + 5] = axisYY;
		data[base + 6] = u0;
		data[base + 7] = v0;
		data[base + 8] = u1;
		data[base + 9] = v1;
		data[base + 10] = ((colorValue >>> 16) & 0xff) / 255;
		data[base + 11] = ((colorValue >>> 8) & 0xff) / 255;
		data[base + 12] = (colorValue & 0xff) / 255;
		data[base + 13] = ((colorValue >>> 24) & 0xff) / 255;
		this.textureKinds[index] = textureKind;
		this.count = index + 1;
	}

	private appendFillRect(leftValue: number, topValue: number, rightValue: number, bottomValue: number, colorValue: color): void {
		let left = leftValue;
		let top = topValue;
		let right = rightValue;
		let bottom = bottomValue;
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
		const width = right - left;
		const height = bottom - top;
		if (width === 0 || height === 0) {
			return;
		}
		this.appendQuad(left, top, width, 0, 0, height, 0, 0, 1, 1, HOST_OVERLAY_TEXTURE_SOLID, colorValue);
	}

	private appendRect(command: RectRenderSubmission): void {
		const area = command.area;
		if (command.kind === RectRenderKind.Fill) {
			this.appendFillRect(area.left, area.top, area.right, area.bottom, command.color);
			return;
		}
		this.appendFillRect(area.left, area.top, area.right, area.top + 1, command.color);
		this.appendFillRect(area.left, area.bottom - 1, area.right, area.bottom, command.color);
		this.appendFillRect(area.left, area.top, area.left + 1, area.bottom, command.color);
		this.appendFillRect(area.right - 1, area.top, area.right, area.bottom, command.color);
	}

	private appendImage(command: HostImageRenderSubmission): void {
		const source = hostSystemAtlasImage(command.imgid);
		let u0 = source.u * HOST_ATLAS_U_SCALE;
		let v0 = source.v * HOST_ATLAS_V_SCALE;
		let u1 = (source.u + source.w) * HOST_ATLAS_U_SCALE;
		let v1 = (source.v + source.h) * HOST_ATLAS_V_SCALE;
		if (command.flip.flip_h) {
			const swap = u0;
			u0 = u1;
			u1 = swap;
		}
		if (command.flip.flip_v) {
			const swap = v0;
			v0 = v1;
			v1 = swap;
		}
		const width = source.width * command.scale.x;
		const height = source.height * command.scale.y;
		if (width === 0 || height === 0) {
			return;
		}
		this.appendQuad(command.pos.x, command.pos.y, width, 0, 0, height, u0, v0, u1, v1, HOST_OVERLAY_TEXTURE_ATLAS, command.colorize);
	}

	private appendLine(x0: number, y0: number, x1: number, y1: number, thickness: number, colorValue: color): void {
		const dx = x1 - x0;
		const dy = y1 - y0;
		if (dx === 0 && dy === 0) {
			this.appendFillRect(x0, y0, x0 + thickness, y0 + thickness, colorValue);
			return;
		}
		const length = Math.sqrt(dx * dx + dy * dy);
		const half = thickness * 0.5;
		const normalX = -dy / length;
		const normalY = dx / length;
		this.appendQuad(x0 - normalX * half, y0 - normalY * half, dx, dy, normalX * thickness, normalY * thickness, 0, 0, 1, 1, HOST_OVERLAY_TEXTURE_SOLID, colorValue);
	}

	private appendPoly(command: PolyRenderSubmission): void {
		const points = command.points;
		for (let index = 0; index + 3 < points.length; index += 2) {
			this.appendLine(points[index], points[index + 1], points[index + 2], points[index + 3], command.thickness, command.color);
		}
	}

	private appendGlyphRun(command: GlyphRenderSubmission): void {
		if (command.has_background_color) {
			this.glyphBackgroundLineHeight = command.font.lineHeight;
			this.glyphBackgroundColor = command.background_color;
			forEachBatchBlitGlyph(command, this, HostOverlayQuadStream.appendGlyphBackground);
		}
		this.glyphColor = command.color;
		forEachBatchBlitGlyph(command, this, HostOverlayQuadStream.appendGlyph);
	}

	private static appendGlyphBackground(stream: HostOverlayQuadStream, item: FontGlyph, x: number, y: number): void {
		stream.appendFillRect(x, y, x + item.advance, y + stream.glyphBackgroundLineHeight, stream.glyphBackgroundColor);
	}

	private static appendGlyph(stream: HostOverlayQuadStream, item: FontGlyph, x: number, y: number): void {
		const rect = item.rect;
		stream.appendQuad(
			x,
			y,
			item.width,
			0,
			0,
			item.height,
			rect.u * HOST_ATLAS_U_SCALE,
			rect.v * HOST_ATLAS_V_SCALE,
			(rect.u + rect.w) * HOST_ATLAS_U_SCALE,
			(rect.v + rect.h) * HOST_ATLAS_V_SCALE,
			HOST_OVERLAY_TEXTURE_ATLAS,
			stream.glyphColor,
		);
	}
}
