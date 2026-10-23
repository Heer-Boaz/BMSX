import { formatNumberAsHex } from '../../../../machine/ts/common/byte_hex_string';
import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import * as commands from '../../../../machine/ts/machine/devices/gx/gpu_command_buffer';
import { gxGpuDrawingAreaBottomExclusive, gxGpuDrawingAreaLeft, gxGpuDrawingAreaRightExclusive, gxGpuDrawingAreaTop,
	gxGpuSigned11, gxGpuTransferHeight, gxGpuTransferWidth } from '../../../../machine/ts/spec/gx/gp0';
import * as rules from '../../../../machine/ts/render/backend/gx_gpu_render_rules';
import type { GpuOperationRecord, GpuOperationSnapshot, RuntimeGpuHistory } from '../../../runtime/gpu_history';
import type { InspectedProperty } from '../../ui/property_inspector/model';

export type GpuDebugView = 'geometry' | 'uv' | 'color' | 'words';
export type GpuDebugVertex = { packetX: number; packetY: number; x: number; y: number; u: number; v: number; color: number; argb: number; label: string; value: string };
export type GpuDebugPoint = { x: number; y: number; label: string; value: string };
export const GPU_RAW_WORDS_PER_PAGE = 64;
const OPERATION_NAMES: Readonly<Record<number, string>> = {
	[commands.GX_GPU_COMMAND_DRAW_POLYGON]: 'Polygon', [commands.GX_GPU_COMMAND_DRAW_LINE]: 'Line',
	[commands.GX_GPU_COMMAND_DRAW_POLYLINE]: 'Polyline segment', [commands.GX_GPU_COMMAND_DRAW_RECTANGLE]: 'Rectangle',
	[commands.GX_GPU_COMMAND_FILL_RECTANGLE]: 'Fill', [commands.GX_GPU_COMMAND_COPY_VRAM_TO_VRAM]: 'VRAM copy',
	[commands.GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM]: 'Upload', [commands.GX_GPU_COMMAND_READ_VRAM_TO_CPU]: 'Readback',
};
export function gpuOperationName(record: Readonly<GpuOperationRecord>): string {
	return record.kind === commands.GX_GPU_COMMAND_DRAW_LINE && (record.opcode & 8) !== 0 ? 'Polyline segment' : OPERATION_NAMES[record.kind];
}
export function rawPageCount(record: Readonly<GpuOperationRecord>): number {
	return Math.trunc((record.wordCount + GPU_RAW_WORDS_PER_PAGE - 1) / GPU_RAW_WORDS_PER_PAGE);
}

/** Incremental metadata projection; no mutable buffer slot is retained. */
export class GpuOperationProjection {
	public readonly rows: number[] = [];
	private generation = -1;
	private scanned = 0;
	private filter = '';
	private query = '';
	public update(history: RuntimeGpuHistory, filter: string): boolean {
		const query = filter === this.filter ? this.query : filter.toLowerCase(); this.filter = filter;
		let changed = false;
		if (this.generation !== history.generation || this.query !== query) {
			this.generation = history.generation; this.query = query; this.scanned = history.firstSequence; this.rows.length = 0; changed = true;
		}
		let removed = 0;
		while (removed < this.rows.length && this.rows[removed] < history.firstSequence) removed++;
		if (removed > 0) { this.rows.splice(0, removed); changed = true; }
		this.scanned = Math.max(this.scanned, history.firstSequence);
		for (; this.scanned < history.endSequence; this.scanned++) {
			const record = history.at(this.scanned);
			if (query !== '' && !`${gpuOperationName(record)} ${formatNumberAsHex(record.opcode, 2)}`.toLowerCase().includes(query)) continue;
			this.rows.push(this.scanned); changed = true;
		}
		return changed;
	}
}

/** Selected-operation display facts. No rasterization, VRAM borrowing or invented source associations. */
export class GpuDebugPresentation {
	public readonly vertices: GpuDebugVertex[] = [];
	public readonly points: GpuDebugPoint[] = [];
	public readonly edges: number[] = [];
	public readonly triangles: number[] = [];
	public readonly properties: InspectedProperty[] = [];
	public readonly area = create_rect_bounds();
	public drawingArea: RectBounds | undefined;
	public heading = '';
	public summary = '';
	public explanation = '';
	public textured = false;
	public hasColor = false;
	public gouraud = false;
	private readonly vertexStorage = Array.from({ length: 4 }, (): GpuDebugVertex => ({ packetX: 0, packetY: 0, x: 0, y: 0, u: 0, v: 0, color: 0, argb: 0, label: '', value: '' }));
	private readonly pointStorage = Array.from({ length: 4 }, (): GpuDebugPoint => ({ x: 0, y: 0, label: '', value: '' }));
	private record: GpuOperationSnapshot | undefined;
	private revision = -1;
	private view: GpuDebugView = 'geometry';
	public reset(): void {
		this.record = undefined; this.revision = -1;
		this.vertices.length = 0; this.points.length = 0; this.edges.length = 0; this.triangles.length = 0; this.properties.length = 0;
		this.heading = ''; this.summary = ''; this.explanation = ''; this.drawingArea = undefined;
	}
	public update(record: GpuOperationSnapshot, revision: number, view: GpuDebugView): boolean {
		if (this.record === record && this.revision === revision && this.view === view) return false;
		this.record = record; this.revision = revision; this.view = view;
		this.vertices.length = 0; this.points.length = 0; this.edges.length = 0; this.triangles.length = 0;
		this.textured = false; this.hasColor = false; this.gouraud = false; this.drawingArea = undefined;
		if (record.sequence < 0) { this.heading = ''; this.summary = ''; this.explanation = ''; return true; }
		this.heading = `${gpuOperationName(record)} ${formatNumberAsHex(record.opcode, 2)} / ${view === 'uv' ? 'RAW UV' : view === 'color' ? 'SUPPLIED RGB' : view === 'words' ? 'RAW WORDS' : 'DRAW XY / Y DOWN'}`;
		this.summary = `#${record.sequence} T${record.timeline} | tick ${record.completedTick} | observed ${record.cycles}`;
		this.explanation = '';
		const words = record.words, opcode = record.opcode, kind = record.kind;
		const dx = gxGpuSigned11(record.drawingOffsetWord), dy = rules.gxGpuDrawingOffsetY(record.drawingOffsetWord);
		if (kind <= commands.GX_GPU_COMMAND_DRAW_RECTANGLE) {
			this.hasColor = true; this.gouraud = kind !== commands.GX_GPU_COMMAND_DRAW_RECTANGLE && rules.gxGpuCommandGouraud(opcode);
			this.textured = (kind === commands.GX_GPU_COMMAND_DRAW_POLYGON || kind === commands.GX_GPU_COMMAND_DRAW_RECTANGLE) && rules.gxGpuCommandTextureEnabled(opcode);
			write_rect_bounds(this.area, gxGpuDrawingAreaLeft(record.drawingAreaTopLeftWord, record.drawingAreaBottomRightWord),
				gxGpuDrawingAreaTop(record.drawingAreaTopLeftWord, record.drawingAreaBottomRightWord, record.vramYAddressExtensionWord),
				gxGpuDrawingAreaRightExclusive(record.drawingAreaTopLeftWord, record.drawingAreaBottomRightWord),
				gxGpuDrawingAreaBottomExclusive(record.drawingAreaTopLeftWord, record.drawingAreaBottomRightWord, record.vramYAddressExtensionWord));
			this.drawingArea = this.area;
		}
		if (kind === commands.GX_GPU_COMMAND_DRAW_POLYGON) {
			const count = rules.gxGpuCommandQuadPolygon(opcode) ? 4 : 3, stride = 1 + (this.textured ? 1 : 0) + (this.gouraud ? 1 : 0);
			for (let index = 0; index < count; index++) {
				const position = 1 + index * stride;
				const color = words[this.gouraud ? index * stride : 0];
				this.vertex(index, gxGpuSigned11(words[position]), rules.gxGpuVertexY(words[position]), color, this.textured ? words[position + 1] : 0, dx, dy);
			}
			this.triangles.push(0, 1, 2); this.edges.push(0, 1, 1, 2, 2, 0);
			if (count === 4) { this.triangles.push(2, 1, 3); this.edges.push(1, 3, 3, 2); }
		} else if (kind === commands.GX_GPU_COMMAND_DRAW_LINE || kind === commands.GX_GPU_COMMAND_DRAW_POLYLINE) {
			this.vertex(0, gxGpuSigned11(words[1]), rules.gxGpuVertexY(words[1]), words[0], 0, dx, dy);
			const second = this.gouraud ? 3 : 2;
			this.vertex(1, gxGpuSigned11(words[second]), rules.gxGpuVertexY(words[second]), this.gouraud ? words[2] : words[0], 0, dx, dy);
			this.edges.push(0, 1);
		} else if (kind === commands.GX_GPU_COMMAND_DRAW_RECTANGLE) {
			const size = words[record.wordCount - 1], width = rules.gxGpuCommandRectangleWidth(opcode, size), height = rules.gxGpuCommandRectangleHeight(opcode, size);
			const px = gxGpuSigned11(words[1]), py = rules.gxGpuVertexY(words[1]);
			this.rectangle(gxGpuSigned11(px + dx), gxGpuSigned11(py + dy), width, height, words[0]);
			this.vertices[0].packetX = px; this.vertices[0].packetY = py;
			if (this.textured) {
				const u = rules.gxGpuTextureU(words[2]), v = rules.gxGpuTextureV(words[2]);
				const u1 = u + (rules.gxGpuDrawModeTextureRectangleXFlip(record.drawModeWord) ? -width : width);
				const v1 = v + (rules.gxGpuDrawModeTextureRectangleYFlip(record.drawModeWord) ? -height : height);
				for (let index = 0; index < 4; index++) { this.vertices[index].u = index & 1 ? u1 : u; this.vertices[index].v = index & 2 ? v1 : v; }
			}
		} else {
			const copy = kind === commands.GX_GPU_COMMAND_COPY_VRAM_TO_VRAM, position = words[copy ? 2 : 1], size = words[copy ? 3 : 2];
			const fill = kind === commands.GX_GPU_COMMAND_FILL_RECTANGLE;
			const width = fill ? rules.gxGpuFillWidth(size) : gxGpuTransferWidth(size), height = fill ? rules.gxGpuFillHeight(size) : gxGpuTransferHeight(size);
			this.rectangle(fill ? rules.gxGpuFillX(position) : rules.gxGpuTransferX(position), rules.gxGpuTransferY(position, record.vramYAddressExtensionWord), width, height, words[0]);
			this.hasColor = fill;
			this.explanation = kind === commands.GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM ? `Upload prefix: ${rules.gxGpuTransferEmittedPixelCount(width, height, record.wordCount)}/${width * height} pixels`
				: kind === commands.GX_GPU_COMMAND_READ_VRAM_TO_CPU ? `Readback request: ${width * height} pixels / not READY` : 'Logical VRAM extent / address wrapping applies.';
		}
		for (const vertex of this.vertices) {
			vertex.value = `${vertex.label} XY(${vertex.x},${vertex.y})${this.textured ? ` UV(${vertex.u},${vertex.v})` : ''}`;
			if (view === 'words' || view === 'color' && (!this.hasColor || !this.gouraud && this.points.length > 0) || view === 'uv' && !this.textured) continue;
			const point = this.pointStorage[this.points.length];
			point.x = view === 'uv' ? vertex.u : vertex.x; point.y = view === 'uv' ? vertex.v : vertex.y;
			point.label = vertex.label; point.value = view === 'uv' ? `${vertex.label} UV(${vertex.u},${vertex.v})` : view === 'color'
				? `${vertex.label} RGB(${vertex.color & 255},${vertex.color >>> 8 & 255},${vertex.color >>> 16 & 255})` : `${vertex.label} XY(${vertex.x},${vertex.y})`;
			this.points.push(point);
		}
		if (view === 'uv') this.explanation = this.textured ? kind === commands.GX_GPU_COMMAND_DRAW_RECTANGLE
			? 'Supplied UV origin / implicit border extents.' : 'Raw UV / before texture window / no image assumed.' : 'No texture coordinates in this operation.';
		if (view === 'color') this.explanation = this.hasColor ? 'Packet RGB / not rendered pixel color.' : 'No RGB attributes in this operation.';
		return true;
	}
	private vertex(index: number, x: number, y: number, color: number, texture: number, dx: number, dy: number): void {
		const vertex = this.vertexStorage[index];
		vertex.packetX = x; vertex.packetY = y; vertex.x = x + dx; vertex.y = y + dy;
		vertex.color = color & 0xffffff; vertex.argb = (0xff000000 | (color & 255) << 16 | color & 0xff00 | color >>> 16 & 255) >>> 0;
		vertex.u = rules.gxGpuTextureU(texture); vertex.v = rules.gxGpuTextureV(texture); vertex.label = `V${index}`;
		this.vertices.push(vertex);
	}
	private rectangle(x: number, y: number, width: number, height: number, color: number): void {
		for (let index = 0; index < 4; index++) this.vertex(index, x + (index & 1 ? width : 0), y + (index & 2 ? height : 0), color, 0, 0, 0);
		this.edges.push(0, 1, 1, 3, 3, 2, 2, 0);
	}
	/** Explicit Details formats only one raw page; the Raw words view virtualizes the complete operation. */
	public details(record: GpuOperationSnapshot, rawPage = 0): readonly InspectedProperty[] {
		this.properties.length = 0;
		this.properties.push({ compact: true, descriptionDisplay: 'inline', label: 'GPU operation', value: `${gpuOperationName(record)} / ${formatNumberAsHex(record.opcode, 2)}`,
			description: `Timeline ${record.timeline}, tick ${record.completedTick}; logical start ${record.startCycles}, observed ${record.cycles} cycles. Emitted operation, not completion, presentation or original GP0. Diagram only: no exact raster coverage, historical VRAM or inferred CPU/GTE/asset identity.`, warning: false },
			{ compact: true, descriptionDisplay: 'disclosure', label: 'Area / offset', value: `${formatNumberAsHex(record.drawingAreaTopLeftWord, 8)} / ${formatNumberAsHex(record.drawingAreaBottomRightWord, 8)} / ${formatNumberAsHex(record.drawingOffsetWord, 8)}`,
				description: `Latched offset (${gxGpuSigned11(record.drawingOffsetWord)},${rules.gxGpuDrawingOffsetY(record.drawingOffsetWord)}). Polygon/line offsets are integer sums; rectangle origins wrap at signed 11 bits. Fill and transfer operations have their own address rules. Diagram edges do not claim exact raster coverage.`, warning: false },
			{ compact: true, descriptionDisplay: 'disclosure', label: 'Draw mode', value: formatNumberAsHex(record.drawModeWord, 8),
				description: `Page (${rules.gxGpuDrawModeTexturePageBaseX(record.drawModeWord)},${rules.gxGpuDrawModeTexturePageBaseY(record.drawModeWord, record.vramYAddressExtensionWord)}), mode ${rules.gxGpuDrawModeTextureMode(record.drawModeWord)}, blend ${rules.gxGpuDrawModeTransparencyMode(record.drawModeWord)}, dither ${rules.gxGpuDrawModeDitherEnabled(record.drawModeWord)}.`, warning: false },
			{ compact: true, descriptionDisplay: 'disclosure', label: 'Texture window', value: formatNumberAsHex(record.textureWindowWord, 8), description: `U & ${rules.gxGpuTextureWindowAndX(record.textureWindowWord)} | ${rules.gxGpuTextureWindowOrX(record.textureWindowWord)}; V & ${rules.gxGpuTextureWindowAndY(record.textureWindowWord)} | ${rules.gxGpuTextureWindowOrY(record.textureWindowWord)}. No historical VRAM image is inferred.`, warning: false },
			{ compact: true, descriptionDisplay: 'disclosure', label: 'Mask / Y ext / parity', value: `${formatNumberAsHex(record.maskBitModeWord, 8)} / ${record.vramYAddressExtensionWord} / ${record.skippedLineParity}`,
				description: 'Latched drawing state; individual operation types determine which fields they consume.', warning: false });
		if (record.kind <= commands.GX_GPU_COMMAND_DRAW_RECTANGLE) this.properties.push({ compact: true, descriptionDisplay: 'disclosure', label: 'Color operation',
			value: `${this.gouraud ? 'Gouraud' : 'Flat'} / ${this.textured ? 'Textured' : 'Untextured'} / blend requested ${rules.gxGpuCommandSemiTransparencyEnabled(record.opcode)}`,
			description: 'Supplied color and blend request are distinct from destination pixels, texture transparency, mask tests and dither.', warning: false });
		if (this.triangles.length > 0) this.properties.push({ compact: true, descriptionDisplay: 'disclosure', label: 'Triangle order', value: this.triangles.length === 3 ? '(V0,V1,V2)' : '(V0,V1,V2), then (V2,V1,V3)',
			description: 'Actual polygon decomposition order. The diagram is not a second rasterizer or a proof of pixel coverage.', warning: false });
		if (record.kind >= commands.GX_GPU_COMMAND_COPY_VRAM_TO_VRAM) {
			const copy = record.kind === commands.GX_GPU_COMMAND_COPY_VRAM_TO_VRAM, size = record.words[copy ? 3 : 2];
			const width = gxGpuTransferWidth(size), height = gxGpuTransferHeight(size);
			this.properties.push({ compact: true, descriptionDisplay: 'inline', label: 'Transfer', value: `${width} x ${height}${copy ? ` / source (${rules.gxGpuTransferX(record.words[1])},${rules.gxGpuTransferY(record.words[1], record.vramYAddressExtensionWord)})` : ''}`,
				description: record.kind === commands.GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM
					? `${record.wordCount - 3} captured payload words supply ${rules.gxGpuTransferEmittedPixelCount(width, height, record.wordCount)}/${width * height} pixels. This emitted operation may be a partial upload prefix.`
					: 'Logical transfer extents use VRAM addressing and wrapping, not primitive drawing offsets. An emitted readback request is not a READY indication.', warning: false });
		}
		if (this.textured) {
			const texture = record.words[2];
			this.properties.push({ compact: true, descriptionDisplay: 'disclosure', label: 'Texture / CLUT', value: `${rules.gxGpuCommandRawTextureEnabled(record.opcode) ? 'Raw texture' : 'RGB modulated'} / CLUT (${rules.gxGpuTextureClutBaseX(texture)},${rules.gxGpuTextureClutBaseY(texture, record.vramYAddressExtensionWord)})`,
				description: `Blend requested: ${rules.gxGpuCommandSemiTransparencyEnabled(record.opcode)}. Rectangle UV border corners are implicit extents, including the latched flip directions; only the origin is supplied by the packet.`, warning: false });
		}
		for (const vertex of this.vertices) this.properties.push({ compact: true, descriptionDisplay: 'disclosure', label: vertex.label, value: vertex.value,
			description: `Packet XY (${vertex.packetX},${vertex.packetY})${this.hasColor ? `; supplied RGB (${vertex.color & 255},${vertex.color >>> 8 & 255},${vertex.color >>> 16 & 255})` : ''}. Rectangle/transfer border corners after V0 are diagram extents, not additional packet vertices.`, warning: false });
		const start = rawPage * GPU_RAW_WORDS_PER_PAGE, end = Math.min(record.wordCount, start + GPU_RAW_WORDS_PER_PAGE);
		this.properties.push({ compact: true, descriptionDisplay: 'inline', label: 'Raw words', value: `Page ${rawPage + 1}/${rawPageCount(record)} | words ${start}..${end - 1} of ${record.wordCount}`,
			description: 'This page is bounded. View > Raw words exposes every active word with scrolling and Home/End; unused snapshot capacity is not data.', warning: false });
		for (let index = start; index < end; index++) this.properties.push({ compact: true, descriptionDisplay: 'disclosure', label: `Word[${index}]`, value: formatNumberAsHex(record.words[index], 8), description: `Operation byte offset ${index * 4}. Emitted polyline segments and upload prefixes are not reconstructed original GP0 packets.`, warning: false });
		return this.properties;
	}
}
