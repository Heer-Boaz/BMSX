import { $, runGate } from '../core/engine_core';
import { Input } from '../input/input';
import {
	renderLayerTo2dLayer,
	color,
	GlyphRenderSubmission,
	MeshRenderSubmission,
	ParticleRenderSubmission,
	RenderLayer
} from '../render/shared/render_types';
import { wrapGlyphs } from '../render/shared/render_queues';
import { Font } from './font';
import { BFont, GlyphMap } from '../render/shared/bitmap_font';
import { RuntimeStorage } from './storage';
import type { AudioPlayOptions } from '../audio/soundmaster';
import type { Polygon, vec3arr } from '../rompack/rompack';
import { taskGate, GateGroup } from '../core/taskgate';
import { Runtime } from './runtime';
import * as runtimeLuaPipeline from './runtime_lua_pipeline';
import { setHardwareCamera } from '../render/shared/hardware_camera';
import { putHardwareAmbientLight, putHardwareDirectionalLight, putHardwarePointLight } from '../render/shared/hardware_lighting';
import { listResources } from './workspace';
import { getWorkspaceCachedSource } from './workspace_cache';
import { buildDirtyFilePath, hasWorkspaceStorage } from './ide/workspace_storage';
import { DEFAULT_LUA_BUILTIN_NAMES } from './lua_builtins';
import { createLuaTable, type LuaTable } from '../lua/luavalue';
import { ActionState } from 'bmsx/input/inputtypes';
import { BmsxColors } from './vdp';
import {
	IO_ARG_STRIDE,
	IO_BUFFER_BASE,
	IO_CMD_VDP_BLIT,
	IO_CMD_VDP_CLEAR,
	IO_CMD_VDP_DRAW_LINE,
	IO_CMD_VDP_FILL_RECT,
	IO_CMD_VDP_GLYPH_RUN,
	IO_CMD_VDP_TILE_RUN,
	IO_COMMAND_CAPACITY,
	IO_COMMAND_STRIDE,
	IO_PAYLOAD_BUFFER_BASE,
	IO_PAYLOAD_CAPACITY,
	IO_PAYLOAD_WRITE_PTR_ADDR,
	IO_VDP_TILE_HANDLE_NONE,
	IO_WRITE_PTR_ADDR,
} from './io';

export type ApiOptions = {
	storage: RuntimeStorage;
	runtime: Runtime;
};

const TAB_SPACES = 2;
const ioGlyphRunUtf8Encoder = new TextEncoder();
type FontDefinition = {
	glyphs: Record<string, string>;
	advance_padding?: number;
};
type FirmwareFontGlyphDescriptor = {
	imgid: string;
	width: number;
	height: number;
	advance: number;
};
type FirmwareFontDescriptor = {
	id: number;
	line_height: number;
	advance_padding: number;
	glyphs: Record<string, FirmwareFontGlyphDescriptor>;
};
type FrameBufferBlitOptions = {
	scale?: number | { x: number; y: number };
	flip_h?: boolean;
	flip_v?: boolean;
	colorize?: color;
	parallax_weight?: number;
	layer?: RenderLayer;
};
type FrameBufferGlyphOptions = {
	font: BFont;
	color?: number | color;
	background_color?: number | color;
	wrap_chars?: number;
	center_block_width?: number;
	glyph_start?: number;
	glyph_end?: number;
	align?: CanvasTextAlign;
	baseline?: CanvasTextBaseline;
	layer?: RenderLayer;
};
type FrameBufferTileBlitDescriptor = {
	tiles: Array<string | false>;
	cols: number;
	rows: number;
	tile_w: number;
	tile_h: number;
	origin_x: number;
	origin_y: number;
	scroll_x: number;
	scroll_y: number;
	z: number;
	layer: RenderLayer;
};

export class Api {
	private readonly storage: RuntimeStorage;
	private readonly font: BFont;
	private readonly runtimeFonts: BFont[] = [];
	private readonly fontIds = new WeakMap<BFont, number>();
	private readonly fontDescriptors = new WeakMap<BFont, FirmwareFontDescriptor>();
	private readonly defaultPrintColorIndex = 15;
	private textCursorX = 0;
	private textCursorY = 0;
	private textCursorHomeX = 0;
	private textCursorColorIndex = 0;
	private readonly cameraViewScratch = new Float32Array(16);
	private readonly cameraProjScratch = new Float32Array(16);
	private readonly cameraEyeScratch: vec3arr = [0, 0, 0];
	private readonly lightColorScratch: vec3arr = [0, 0, 0];
	private readonly lightVecScratch: vec3arr = [0, 0, 0];
	private _runtime: Runtime;

	constructor(options: ApiOptions) {
		const view = $.view;
		if (!view) {
			throw new Error('Game view not initialised.');
		}
		const viewport = view.viewportSize;
		if (viewport.x <= 0 || viewport.y <= 0) {
			throw new Error('Invalid viewport size.');
		}
		this.storage = options.storage;
		this._runtime = options.runtime;
		this.font = new Font();
		this.registerFont(this.font);
		this.reset_print_cursor();
	}

	private registerFont(font: BFont): number {
		const existing = this.fontIds.get(font);
		if (existing !== undefined) {
			return existing;
		}
		const id = this.runtimeFonts.length;
		this.runtimeFonts.push(font);
		this.fontIds.set(font, id);
		return id;
	}

	public resolveFontId(id: number): BFont {
		const font = this.runtimeFonts[id];
		if (font === undefined) {
			throw new Error(`[FirmwareApi] Unknown font id ${id}.`);
		}
		return font;
	}

	public getFontId(font: BFont): number {
		return this.registerFont(font);
	}

	private buildFontDescriptor(font: BFont): FirmwareFontDescriptor {
		const cached = this.fontDescriptors.get(font);
		if (cached) {
			return cached;
		}
		const glyphs: Record<string, FirmwareFontGlyphDescriptor> = {};
		const glyphEntries = Object.entries(font.glyphMap);
		for (let index = 0; index < glyphEntries.length; index += 1) {
			const [char] = glyphEntries[index];
			const glyph = font.getGlyph(char);
			glyphs[char] = {
				imgid: glyph.imgid,
				width: glyph.width,
				height: glyph.height,
				advance: glyph.advance,
			};
		}
		const descriptor: FirmwareFontDescriptor = {
			id: this.registerFont(font),
			line_height: font.lineHeight,
			advance_padding: font.glyphAdvancePadding,
			glyphs,
		};
		this.fontDescriptors.set(font, descriptor);
		return descriptor;
	}

	private writeIoArg(base: number, index: number, value: number): void {
		this._runtime.memory.writeValue(base + index * IO_ARG_STRIDE, value);
	}

	private writeIoColor(base: number, offset: number, value: color): void {
		this.writeIoArg(base, offset + 0, value.r);
		this.writeIoArg(base, offset + 1, value.g);
		this.writeIoArg(base, offset + 2, value.b);
		this.writeIoArg(base, offset + 3, value.a);
	}

	private allocIoCommand(opcode: number): number {
		const count = this._runtime.memory.readValue(IO_WRITE_PTR_ADDR) as number;
		if (count >= IO_COMMAND_CAPACITY) {
			throw new Error(`[FirmwareApi] IO command buffer overflow at opcode ${opcode}.`);
		}
		const base = IO_BUFFER_BASE + count * IO_COMMAND_STRIDE;
		this._runtime.memory.writeValue(base, opcode);
		return base;
	}

	private commitIoCommand(): void {
		const count = this._runtime.memory.readValue(IO_WRITE_PTR_ADDR) as number;
		this._runtime.memory.writeValue(IO_WRITE_PTR_ADDR, count + 1);
	}

	private allocIoPayload(words: number): number {
		const writePtr = this._runtime.memory.readValue(IO_PAYLOAD_WRITE_PTR_ADDR) as number;
		const next = writePtr + words;
		if (next > IO_PAYLOAD_CAPACITY) {
			throw new Error(`[FirmwareApi] IO payload buffer overflow (${next} > ${IO_PAYLOAD_CAPACITY}).`);
		}
		this._runtime.memory.writeValue(IO_PAYLOAD_WRITE_PTR_ADDR, next);
		return writePtr;
	}

	private queueClear(colorValue: color): void {
		const base = this.allocIoCommand(IO_CMD_VDP_CLEAR);
		this.writeIoColor(base, 1, colorValue);
		this.commitIoCommand();
	}

	private queueFillRect(x0: number, y0: number, x1: number, y1: number, z: number, layer: number, colorValue: color): void {
		const base = this.allocIoCommand(IO_CMD_VDP_FILL_RECT);
		this.writeIoArg(base, 1, x0);
		this.writeIoArg(base, 2, y0);
		this.writeIoArg(base, 3, x1);
		this.writeIoArg(base, 4, y1);
		this.writeIoArg(base, 5, z);
		this.writeIoArg(base, 6, layer);
		this.writeIoColor(base, 7, colorValue);
		this.commitIoCommand();
	}

	private queueDrawLine(x0: number, y0: number, x1: number, y1: number, z: number, layer: number, colorValue: color, thickness: number): void {
		const base = this.allocIoCommand(IO_CMD_VDP_DRAW_LINE);
		this.writeIoArg(base, 1, x0);
		this.writeIoArg(base, 2, y0);
		this.writeIoArg(base, 3, x1);
		this.writeIoArg(base, 4, y1);
		this.writeIoArg(base, 5, z);
		this.writeIoArg(base, 6, layer);
		this.writeIoColor(base, 7, colorValue);
		this.writeIoArg(base, 11, thickness);
		this.commitIoCommand();
	}

	private queueBlit(handle: number, x: number, y: number, z: number, layer: number, scaleX: number, scaleY: number, flipH: boolean, flipV: boolean, colorValue: color, parallaxWeight: number): void {
		const base = this.allocIoCommand(IO_CMD_VDP_BLIT);
		this.writeIoArg(base, 1, handle);
		this.writeIoArg(base, 2, x);
		this.writeIoArg(base, 3, y);
		this.writeIoArg(base, 4, z);
		this.writeIoArg(base, 5, layer);
		this.writeIoArg(base, 6, scaleX);
		this.writeIoArg(base, 7, scaleY);
		this.writeIoArg(base, 8, (flipH ? 1 : 0) | (flipV ? 2 : 0));
		this.writeIoColor(base, 9, colorValue);
		this.writeIoArg(base, 13, parallaxWeight);
		this.commitIoCommand();
	}

	private queueGlyphLine(text: string, x: number, y: number, z: number, font: BFont, colorValue: color, backgroundColor: color | undefined, start: number, end: number, layer: number): void {
		if (text.length === 0) {
			return;
		}
		const textBytes = ioGlyphRunUtf8Encoder.encode(text);
		const payloadWords = Math.ceil(textBytes.length / 4);
		const payloadOffset = this.allocIoPayload(payloadWords);
		for (let wordIndex = 0; wordIndex < payloadWords; wordIndex += 1) {
			const byteIndex = wordIndex * 4;
			const word =
				(textBytes[byteIndex] ?? 0)
				| ((textBytes[byteIndex + 1] ?? 0) << 8)
				| ((textBytes[byteIndex + 2] ?? 0) << 16)
				| ((textBytes[byteIndex + 3] ?? 0) << 24);
			this._runtime.memory.writeValue(IO_PAYLOAD_BUFFER_BASE + (payloadOffset + wordIndex) * IO_ARG_STRIDE, word >>> 0);
		}
		const base = this.allocIoCommand(IO_CMD_VDP_GLYPH_RUN);
		this.writeIoArg(base, 1, payloadOffset);
		this.writeIoArg(base, 2, textBytes.length);
		this.writeIoArg(base, 3, x);
		this.writeIoArg(base, 4, y);
		this.writeIoArg(base, 5, z);
		this.writeIoArg(base, 6, this.registerFont(font));
		this.writeIoArg(base, 7, start);
		this.writeIoArg(base, 8, end);
		this.writeIoArg(base, 9, layer);
		this.writeIoColor(base, 10, colorValue);
		if (backgroundColor) {
			this.writeIoArg(base, 14, 1);
			this.writeIoColor(base, 15, backgroundColor);
			this.commitIoCommand();
			return;
		}
		this.writeIoArg(base, 14, 0);
		this.commitIoCommand();
	}

	private queueGlyphRun(text: string | string[], x: number, y: number, z: number, font: BFont, colorValue: color, backgroundColor: color | undefined, start: number, end: number, layer: number): void {
		const lines = Array.isArray(text) ? text : [text];
		let cursorY = y;
		for (let index = 0; index < lines.length; index += 1) {
			this.queueGlyphLine(lines[index], x, cursorY, z, font, colorValue, backgroundColor, start, end, layer);
			cursorY += font.lineHeight;
		}
	}

	private queueTileRun(desc: FrameBufferTileBlitDescriptor): void {
		const tileCount = desc.cols * desc.rows;
		const payloadOffset = this.allocIoPayload(tileCount);
		for (let index = 0; index < tileCount; index += 1) {
			const tile = desc.tiles[index];
			if (tile === undefined) {
				throw new Error(`[FirmwareApi] dma_blit_tiles missing tile at index ${index}.`);
			}
			const handle = tile === false ? IO_VDP_TILE_HANDLE_NONE : this._runtime.resolveAssetHandle(tile);
			this._runtime.memory.writeValue(IO_PAYLOAD_BUFFER_BASE + (payloadOffset + index) * IO_ARG_STRIDE, handle);
		}
		const base = this.allocIoCommand(IO_CMD_VDP_TILE_RUN);
		this.writeIoArg(base, 1, payloadOffset);
		this.writeIoArg(base, 2, tileCount);
		this.writeIoArg(base, 3, desc.cols);
		this.writeIoArg(base, 4, desc.rows);
		this.writeIoArg(base, 5, desc.tile_w);
		this.writeIoArg(base, 6, desc.tile_h);
		this.writeIoArg(base, 7, desc.origin_x);
		this.writeIoArg(base, 8, desc.origin_y);
		this.writeIoArg(base, 9, desc.scroll_x);
		this.writeIoArg(base, 10, desc.scroll_y);
		this.writeIoArg(base, 11, desc.z);
		this.writeIoArg(base, 12, renderLayerTo2dLayer(desc.layer));
		this.commitIoCommand();
	}

	public display_width(): number {
		return $.view.viewportSize.x;
	}

	public display_height(): number {
		return $.view.viewportSize.y;
	}

	public get keyboard() {
		return Input.instance.getPlayerInput(1).inputHandlers.keyboard;
	}

	private pointerButtonCode(button: number): string {
		switch (button) {
			case 0: return 'pointer_primary';
			case 1: return 'pointer_secondary';
			case 2: return 'pointer_aux';
			case 3: return 'pointer_back';
			case 4: return 'pointer_forward';
			default:
				throw new Error(`Unsupported pointer button index ${button}.`);
		}
	}

	public mousebtn(button: number): boolean {
		return Input.instance.getPlayerInput(1).getButtonState(this.pointerButtonCode(button), 'pointer').pressed === true;
	}

	public mousebtnp(button: number): boolean {
		return Input.instance.getPlayerInput(1).getButtonState(this.pointerButtonCode(button), 'pointer').justpressed === true;
	}

	public mousebtnr(button: number): boolean {
		return Input.instance.getPlayerInput(1).getButtonState(this.pointerButtonCode(button), 'pointer').justreleased === true;
	}

	public pointer_screen_position(): { x: number; y: number; valid: boolean } {
		const state = Input.instance.getPlayerInput(1).getButtonState('pointer_position', 'pointer');
		const value = state.value2d;
		if (!value) {
			return { x: 0, y: 0, valid: false };
		}
		return { x: value[0], y: value[1], valid: true };
	}

	public pointer_delta(): { x: number; y: number; valid: boolean } {
		const state = Input.instance.getPlayerInput(1).getButtonState('pointer_delta', 'pointer');
		const value = state.value2d;
		if (!value) {
			return { x: 0, y: 0, valid: false };
		}
		return { x: value[0], y: value[1], valid: true };
	}

	public pointer_viewport_position(): { x: number; y: number; valid: boolean; inside: boolean } {
		const position = this.pointer_screen_position();
		if (!position.valid) {
			return { x: 0, y: 0, valid: false, inside: false };
		}
		const view = $.view;
		const rect = view.surface.measureDisplay();
		const width = rect.width;
		const height = rect.height;
		if (width <= 0 || height <= 0) {
			return { x: 0, y: 0, valid: false, inside: false };
		}
		const relativeX = position.x - rect.left;
		const relativeY = position.y - rect.top;
		const inside = relativeX >= 0 && relativeX < width && relativeY >= 0 && relativeY < height;
		const viewport = view.viewportSize;
		return {
			x: (relativeX / width) * viewport.x,
			y: (relativeY / height) * viewport.y,
			valid: true,
			inside,
		};
	}

	public mousepos(): { x: number; y: number; valid: boolean; inside: boolean } {
		return this.pointer_viewport_position();
	}

	public mousewheel(): { value: number; valid: boolean } {
		const state = Input.instance.getPlayerInput(1).getButtonState('pointer_wheel', 'pointer');
		if (state.value === null || state.value === undefined) {
			return { value: 0, valid: false };
		}
		return { value: state.value, valid: true };
	}

	public stat(index: number): number {
		if (!Number.isFinite(index)) {
			throw new Error('stat index must be finite.');
		}
		throw new Error('stat is not implemented.');
	}

	public cls(colorindex: number = 0): void {
		this.queueClear(this.palette_color(colorindex));
		this.reset_print_cursor();
	}

	public blit_rect(x0: number, y0: number, x1: number, y1: number, z: number, colorindex: number): void {
		const colorValue = this.palette_color(colorindex);
		const layer = renderLayerTo2dLayer('world');
		this.queueDrawLine(x0, y0, x1, y0, z, layer, colorValue, 1);
		this.queueDrawLine(x0, y1, x1, y1, z, layer, colorValue, 1);
		this.queueDrawLine(x0, y0, x0, y1, z, layer, colorValue, 1);
		this.queueDrawLine(x1, y0, x1, y1, z, layer, colorValue, 1);
	}

	public fill_rect(x0: number, y0: number, x1: number, y1: number, z: number, colorindex: number): void {
		this.queueFillRect(x0, y0, x1, y1, z, renderLayerTo2dLayer('world'), this.palette_color(colorindex));
	}

	public fill_rect_color(
		x0: number,
		y0: number,
		x1: number,
		y1: number,
		z: number,
		colorvalue: number | color,
		options?: { layer?: RenderLayer },
	): void {
		const renderLayer = options === undefined || options.layer === undefined ? 'world' : options.layer;
		this.queueFillRect(x0, y0, x1, y1, z, renderLayerTo2dLayer(renderLayer), this.resolve_color(colorvalue));
	}

	public blit(img_id: string, x: number, y: number, z: number, options?: FrameBufferBlitOptions): void {
		const handle = Runtime.instance.resolveAssetHandle(img_id);
		let scaleX = 1;
		let scaleY = 1;
		let flipH = false;
		let flipV = false;
		let colorize: color = { r: 1, g: 1, b: 1, a: 1 };
		let parallaxWeight = 0;
		let renderLayer: RenderLayer = 'world';
		if (options !== undefined) {
			if (options.scale !== undefined) {
				if (typeof options.scale === 'number') {
					scaleX = options.scale;
					scaleY = options.scale;
				} else {
					scaleX = options.scale.x;
					scaleY = options.scale.y;
				}
			}
			flipH = options.flip_h === true;
			flipV = options.flip_v === true;
			if (options.colorize !== undefined) {
				colorize = options.colorize;
			}
			parallaxWeight = options.parallax_weight ?? 0;
			if (options.layer !== undefined) {
				renderLayer = options.layer;
			}
		}
		this.queueBlit(
			handle,
			x,
			y,
			z,
			renderLayerTo2dLayer(renderLayer),
			scaleX,
			scaleY,
			flipH,
			flipV,
			colorize,
			parallaxWeight,
		);
	}

	public dma_blit_tiles(desc: FrameBufferTileBlitDescriptor): void {
		this.queueTileRun(desc);
	}

	public blit_glyphs(glyphs: string | string[], x: number, y: number, z: number, options: FrameBufferGlyphOptions): void {
		const glyphStart = options.glyph_start === undefined ? 0 : options.glyph_start;
		const glyphEnd = options.glyph_end === undefined ? Number.MAX_SAFE_INTEGER : options.glyph_end;
		const renderLayer = options.layer === undefined ? 'world' : options.layer;
		const submission: GlyphRenderSubmission = {
			glyphs,
			x,
			y,
			z,
			font: options.font,
			color: options.color === undefined ? this.palette_color(this.defaultPrintColorIndex) : this.resolve_color(options.color),
			background_color: options.background_color !== undefined ? this.resolve_color(options.background_color) : undefined,
			wrap_chars: options.wrap_chars,
			center_block_width: options.center_block_width,
			glyph_start: glyphStart,
			glyph_end: glyphEnd,
			align: options.align,
			baseline: options.baseline,
			layer: renderLayer,
		};
		this.queueGlyphRun(
			submission.glyphs,
			submission.x,
			submission.y,
			submission.z,
			submission.font,
			submission.color,
			submission.background_color,
			glyphStart,
			glyphEnd,
			renderLayerTo2dLayer(submission.layer),
		);
	}

	public blit_poly(points: Polygon, z: number, colorvalue: number | color, thickness?: number, layer?: RenderLayer): void {
		if (points.length < 4) {
			return;
		}
		const renderLayer = layer === undefined ? 'world' : layer;
		const color = this.resolve_color(colorvalue);
		const lineThickness = thickness === undefined ? 1 : thickness;
		const layer2d = renderLayerTo2dLayer(renderLayer);
		for (let index = 0; index < points.length; index += 2) {
			const next = (index + 2) % points.length;
			this.queueDrawLine(points[index], points[index + 1], points[next], points[next + 1], z, layer2d, color, lineThickness);
		}
	}

	public put_mesh(mesh: MeshRenderSubmission['mesh'], matrix: MeshRenderSubmission['matrix'], options?: Omit<MeshRenderSubmission, 'mesh' | 'matrix'>): void {
		const submission: MeshRenderSubmission = {
			mesh,
			matrix,
			joint_matrices: options?.joint_matrices,
			morph_weights: options?.morph_weights,
			receive_shadow: options?.receive_shadow,
		};
		$.view.renderer.submit.mesh(submission);
	}

	public put_particle(position: vec3arr, size: number, colorvalue: number | color, options?: Omit<ParticleRenderSubmission, 'position' | 'size' | 'color'>): void {
		if (options === undefined || options.texture === undefined) {
			throw new Error('put_particle requires options.texture.');
		}
		const submission: ParticleRenderSubmission = {
			position,
			size,
			color: this.resolve_color(colorvalue),
			texture: options.texture,
			ambient_mode: options.ambient_mode,
			ambient_factor: options.ambient_factor,
		};
		$.view.renderer.submit.particle(submission);
	}

	public set_camera(view: Float32Array | number[], proj: Float32Array | number[], eye: vec3arr | number[]): void {
		const viewMat = this.coerceMat4(view, this.cameraViewScratch, 'view');
		const projMat = this.coerceMat4(proj, this.cameraProjScratch, 'proj');
		const eyeVec = this.coerceVec3(eye, this.cameraEyeScratch, 'eye');
		setHardwareCamera(viewMat, projMat, eyeVec[0], eyeVec[1], eyeVec[2]);
	}

	public skybox(posx: string, negx: string, posy: string, negy: string, posz: string, negz: string): void {
		this.runtime.setSkyboxImages({ posx, negx, posy, negy, posz, negz });
	}

	public put_ambient_light(id: string, colorvalue: number | color | vec3arr | number[], intensity: number): void {
		if (typeof id !== 'string' || id.length === 0) {
			throw new Error('put_ambient_light id must be a non-empty string.');
		}
		if (!Number.isFinite(intensity)) {
			throw new Error('put_ambient_light intensity must be a finite number.');
		}
		const colorVec = this.coerceLightColor(colorvalue, this.lightColorScratch, 'put_ambient_light color');
		putHardwareAmbientLight(id, {
			type: 'ambient',
			color: [colorVec[0], colorVec[1], colorVec[2]],
			intensity,
		});
	}

	public put_directional_light(id: string, orientation: vec3arr | number[] | { x: number; y: number; z: number }, colorvalue: number | color | vec3arr | number[], intensity: number): void {
		if (typeof id !== 'string' || id.length === 0) {
			throw new Error('put_directional_light id must be a non-empty string.');
		}
		if (!Number.isFinite(intensity)) {
			throw new Error('put_directional_light intensity must be a finite number.');
		}
		const direction = this.coerceVec3(orientation, this.lightVecScratch, 'directional_light orientation');
		const colorVec = this.coerceLightColor(colorvalue, this.lightColorScratch, 'put_directional_light color');
		putHardwareDirectionalLight(id, {
			type: 'directional',
			orientation: [direction[0], direction[1], direction[2]],
			color: [colorVec[0], colorVec[1], colorVec[2]],
			intensity,
		});
	}

	public put_point_light(id: string, position: vec3arr | number[] | { x: number; y: number; z: number }, colorvalue: number | color | vec3arr | number[], range: number, intensity: number): void {
		if (typeof id !== 'string' || id.length === 0) {
			throw new Error('put_point_light id must be a non-empty string.');
		}
		if (!Number.isFinite(range) || range <= 0) {
			throw new Error('put_point_light range must be a positive finite number.');
		}
		if (!Number.isFinite(intensity)) {
			throw new Error('put_point_light intensity must be a finite number.');
		}
		const point = this.coerceVec3(position, this.lightVecScratch, 'point_light position');
		const colorVec = this.coerceLightColor(colorvalue, this.lightColorScratch, 'put_point_light color');
		putHardwarePointLight(id, {
			type: 'point',
			pos: [point[0], point[1], point[2]],
			color: [colorVec[0], colorVec[1], colorVec[2]],
			range,
			intensity,
		});
	}

	public blit_text(
		text: string,
		x?: number,
		y?: number,
		z?: number,
		colorindex?: number,
		options?: {
			color?: number | color;
			background_color?: number | color;
			wrap_chars?: number;
			center_block_width?: number;
			glyph_start?: number;
			glyph_end?: number;
			align?: CanvasTextAlign;
			baseline?: CanvasTextBaseline;
			layer?: RenderLayer;
			font?: BFont;
			auto_advance?: boolean;
		},
	): void {
		const renderFont = options === undefined || options.font === undefined ? this.font : options.font;
		const { baseX, baseY, color, autoAdvance } = this.resolve_write_context(renderFont, x, y, z, colorindex);
		const resolvedColor = options === undefined || options.color === undefined ? color : this.resolve_color(options.color);
		const backgroundColor = options === undefined || options.background_color === undefined ? undefined : this.resolve_color(options.background_color);
		const wrapChars = options === undefined ? undefined : options.wrap_chars;
		const glyphStart = options === undefined || options.glyph_start === undefined ? 0 : options.glyph_start;
		const glyphEnd = options === undefined || options.glyph_end === undefined ? Number.MAX_SAFE_INTEGER : options.glyph_end;
		const renderLayer = options === undefined || options.layer === undefined ? 'world' : options.layer;
		const expanded = this.expand_tabs(text);
		let lines: string[] | null = null;
		if (wrapChars !== undefined && wrapChars > 0) {
			lines = wrapGlyphs(expanded, wrapChars);
		} else if (expanded.indexOf('\n') !== -1) {
			lines = expanded.split('\n');
		}
		const glyphs: GlyphRenderSubmission = {
			glyphs: lines === null ? expanded : lines,
			x: baseX,
			y: baseY,
			z,
			font: renderFont,
			color: resolvedColor,
			background_color: backgroundColor,
			center_block_width: options === undefined ? undefined : options.center_block_width,
			glyph_start: glyphStart,
			glyph_end: glyphEnd,
			align: options === undefined ? undefined : options.align,
			baseline: options === undefined ? undefined : options.baseline,
			layer: renderLayer,
		};
		this.queueGlyphRun(glyphs.glyphs, glyphs.x, glyphs.y, glyphs.z, glyphs.font, glyphs.color, glyphs.background_color, glyphStart, glyphEnd, renderLayerTo2dLayer(renderLayer));
		const shouldAdvance = options === undefined || options.auto_advance === undefined ? autoAdvance : options.auto_advance;
		if (shouldAdvance) {
			const lineCount = lines ? lines.length : 1;
			this.textCursorY = baseY + ((lineCount - 1) * renderFont.lineHeight);
			this.advance_print_cursor(renderFont.lineHeight);
		}
	}

	public blit_text_color(text: string, x?: number, y?: number, z?: number, colorvalue?: number | color): void {
		const hasExplicitPosition = x !== undefined && y !== undefined;
		if (hasExplicitPosition) {
			this.textCursorHomeX = x;
			this.textCursorX = this.textCursorHomeX;
			this.textCursorY = y;
		}
		if (typeof colorvalue === 'number') {
			this.textCursorColorIndex = colorvalue;
		}
		const baseX = this.textCursorX;
		const baseY = this.textCursorY;
		const color = colorvalue !== undefined ? this.resolve_color(colorvalue) : this.palette_color(this.textCursorColorIndex);
		this.draw_multiline_text(text, baseX, baseY, z, color, this.font);
		this.advance_print_cursor(this.font.lineHeight);
	}

	public blit_text_with_font(text: string, x?: number, y?: number, z?: number, colorindex?: number, font?: BFont): void {
		const renderFont = font === undefined ? this.font : font;
		const { baseX, baseY, color, autoAdvance } = this.resolve_write_context(renderFont, x, y, z, colorindex);
		this.draw_multiline_text(text, baseX, baseY, z, color, renderFont);
		if (autoAdvance) {
			this.advance_print_cursor(renderFont.lineHeight);
		}
	}

	public blit_text_inline_with_font(text: string, x: number, y: number, z: number, colorindex: number, font?: BFont): void {
		const renderFont = font === undefined ? this.font : font;
		const glyphs: GlyphRenderSubmission = {
			glyphs: text,
			x,
			y,
			z,
			color: BmsxColors[colorindex],
			font: renderFont,
			layer: 'world',
		};
		this.queueGlyphRun(glyphs.glyphs, glyphs.x, glyphs.y, glyphs.z, glyphs.font, glyphs.color, glyphs.background_color, 0, Number.MAX_SAFE_INTEGER, renderLayerTo2dLayer(glyphs.layer));
	}

	public blit_text_inline_span_with_font(text: string, start: number, end: number, x: number, y: number, z: number, colorindex: number, font?: BFont): void {
		const renderFont = font === undefined ? this.font : font;
		const glyphs: GlyphRenderSubmission = {
			glyphs: text,
			glyph_start: start,
			glyph_end: end,
			x,
			y,
			z,
			color: BmsxColors[colorindex],
			font: renderFont,
			layer: 'world',
		};
		this.queueGlyphRun(glyphs.glyphs, glyphs.x, glyphs.y, glyphs.z, glyphs.font, glyphs.color, glyphs.background_color, start, end, renderLayerTo2dLayer(glyphs.layer));
	}

	public action_triggered(actiondefinition: string, player?: number): boolean {
		return $.action_triggered(player === undefined ? 1 : player, actiondefinition)
	}

	public consume_action(actionToConsume: ActionState | string, player?: number): void {
		$.consume_action(player === undefined ? 1 : player, actionToConsume);
	}

	public cartdata(namespace: string): void {
		this.storage.setNamespace(namespace);
	}

	public list_lua_resources(): LuaTable {
		const descriptors = listResources();
		const table = createLuaTable();
		for (let index = 0; index < descriptors.length; index += 1) {
			table.set(index + 1, this._runtime.luaJsBridge.toLua(descriptors[index]));
		}
		return table;
	}

	public get_lua_entry_path(): string {
		const registry = runtimeLuaPipeline.listLuaSourceRegistries(this._runtime)[0].registry;
		const record = registry.path2lua[registry.entry_path];
		const value = record ? record.source_path : registry.entry_path;
		if (typeof value !== 'string') {
			throw new Error(`[api.get_lua_entry_path] Expected string entry path, got ${Object.prototype.toString.call(value)}.`);
		}
		return value;
	}

	public get_lua_resource_source(path: string): string {
		const record = runtimeLuaPipeline.resolveLuaSourceRecord(this._runtime, path);
		if (!record) {
			const registries = runtimeLuaPipeline.listLuaSourceRegistries(this._runtime);
			const available = registries.flatMap(entry => Object.keys(entry.registry.path2lua)).slice(0, 16);
			throw new Error(`[api.get_lua_resource_source] Missing Lua resource for path '${path}'. Available: ${available.join(', ')}`);
		}
		const sourcePath = record.source_path;
		const dirtyPath = hasWorkspaceStorage() ? buildDirtyFilePath(sourcePath) : null;
		const cached = getWorkspaceCachedSource(sourcePath);
		if (cached !== null && cached !== undefined) {
			return cached;
		}
		if (dirtyPath) {
			const dirtyCached = getWorkspaceCachedSource(dirtyPath);
			if (dirtyCached !== null && dirtyCached !== undefined) {
				return dirtyCached;
			}
		}
		return record.src;
	}

	public get_cpu_freq_hz(): number {
		return this._runtime.cpuHz;
	}

	public set_cpu_freq_hz(cpuHz: number): void {
		if (!Number.isSafeInteger(cpuHz) || cpuHz <= 0) {
			throw new Error('[api.set_cpu_freq_hz] cpuHz must be a positive safe integer.');
		}
		this._runtime.applyActiveMachineTiming(cpuHz);
	}

	public list_lua_builtins(): LuaTable {
		const table = createLuaTable();
		for (let index = 0; index < DEFAULT_LUA_BUILTIN_NAMES.length; index += 1) {
			table.set(index + 1, DEFAULT_LUA_BUILTIN_NAMES[index]);
		}
		return table;
	}

	public create_font(definition: FontDefinition): FirmwareFontDescriptor {
		if (!definition || typeof definition !== 'object') {
			throw new Error('create_font(definition) requires a table.');
		}
		if (!definition.glyphs || typeof definition.glyphs !== 'object') {
			throw new Error('create_font(definition) requires definition.glyphs to be a table.');
		}
		const glyphMap: GlyphMap = {};
		const glyphEntries = Object.entries(definition.glyphs);
		for (let index = 0; index < glyphEntries.length; index += 1) {
			const entry = glyphEntries[index];
			const glyphKey = entry[0];
			const glyphValue = entry[1];
			if (Array.from(glyphKey).length !== 1) {
				throw new Error(`create_font(definition) requires glyph keys to be single UTF-8 characters. Invalid key: '${glyphKey}'.`);
			}
			if (typeof glyphValue !== 'string') {
				throw new Error(`create_font(definition) requires glyph '${glyphKey}' to map to a string image id.`);
			}
			glyphMap[glyphKey] = glyphValue;
		}
		let advancePadding = 0;
		if (definition.advance_padding !== undefined) {
			if (!Number.isFinite(definition.advance_padding)) {
				throw new Error('create_font(definition) requires advance_padding to be a finite number.');
			}
			advancePadding = Math.floor(definition.advance_padding);
		}
		const font = new BFont(glyphMap, advancePadding);
		return this.buildFontDescriptor(font);
	}

	public get_default_font(): FirmwareFontDescriptor {
		return this.buildFontDescriptor(this.font);
	}

	public dset(index: number, value: number): void {
		this.storage.setValue(index, value);
	}

	public dget(index: number): number {
		return this.storage.getValue(index);
	}

	public sfx(id: string, options?: AudioPlayOptions): void {
		$.sndmaster.playSfx(id, options);
	}

	public stop_sfx(): void {
		$.sndmaster.stopEffect();
	}

	public music(id: string, options?: AudioPlayOptions): void {
		$.sndmaster.playMusic(id, options);
	}

	public stop_music(options?: AudioPlayOptions): void {
		$.sndmaster.stopMusicWithOptions(options);
	}

	public set_master_volume(volume: number): void {
		$.sndmaster.volume = volume;
	}

	public set_sprite_parallax_rig(vy: number, scale: number, impact: number, impact_t: number, bias_px: number, parallax_strength: number, scale_strength: number, flip_strength: number, flip_window: number): void {
		if (arguments.length !== 9) {
			throw new Error('set_sprite_parallax_rig(vy, scale, impact, impact_t, bias_px, parallax_strength, scale_strength, flip_strength, flip_window) requires exactly 9 arguments.');
		}
		$.view.setSpriteParallaxRig(vy, scale, impact, impact_t, bias_px, parallax_strength, scale_strength, flip_strength, flip_window);
	}

	public pause_audio(): void {
		$.sndmaster.pause();
	}

	public resume_audio(): void {
		$.sndmaster.resume();
	}

	public taskgate(name: string): GateGroup {
		return taskGate.group(name);
	}

	public get rungate(): GateGroup {
		return runGate;
	}

	public get runtime(): Runtime {
		return this._runtime;
	}

	public reboot(): void {
		console.log('[Runtime API] Reboot requested.');
		void this.runtime.rebootToBootRom().catch((error) => {
			console.error('[Runtime API] Reboot failed:', error);
		});
	}

	private expand_tabs(text: string): string {
		if (text.indexOf('\t') === -1) {
			return text;
		}
		let result = '';
		for (let i = 0; i < text.length; i++) {
			const ch = text.charAt(i);
			if (ch === '\t') {
				for (let j = 0; j < TAB_SPACES; j++) {
					result += ' ';
				}
			} else {
				result += ch;
			}
		}
		return result;
	}

	private palette_color(index: number): color {
		if (!Number.isInteger(index)) {
			throw new Error('Color index must be an integer.');
		}
		if (index < 0 || index >= BmsxColors.length) {
			throw new Error(`Color index ${index} outside palette range 0-${BmsxColors.length - 1}.`);
		}
		return BmsxColors[index];
	}

	private resolve_color(value: number | color): color {
		return typeof value === 'number' ? this.palette_color(value) : value;
	}

	private coerceLightColor(value: number | color | vec3arr | number[], out: vec3arr, label: string): vec3arr {
		if (typeof value === 'number') {
			const resolved = this.palette_color(value);
			out[0] = resolved.r;
			out[1] = resolved.g;
			out[2] = resolved.b;
			return out;
		}
		if (Array.isArray(value) || ArrayBuffer.isView(value)) {
			const arr = value as ArrayLike<number>;
			if (arr.length < 3) {
				throw new Error(`${label} must have 3 elements.`);
			}
			const r = arr[0];
			const g = arr[1];
			const b = arr[2];
			if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
				throw new Error(`${label} must contain finite numbers.`);
			}
			out[0] = r;
			out[1] = g;
			out[2] = b;
			return out;
		}
		if (value && typeof value === 'object' && 'r' in value && 'g' in value && 'b' in value) {
			const colorValue = value as color;
			if (!Number.isFinite(colorValue.r) || !Number.isFinite(colorValue.g) || !Number.isFinite(colorValue.b)) {
				throw new Error(`${label} must contain finite numbers.`);
			}
			out[0] = colorValue.r;
			out[1] = colorValue.g;
			out[2] = colorValue.b;
			return out;
		}
		throw new Error(`${label} must be a palette index, color object, or vec3 array.`);
	}

	private coerceMat4(value: Float32Array | number[], out: Float32Array, label: string): Float32Array {
		if (ArrayBuffer.isView(value)) {
			const arr = value as ArrayLike<number>;
			if (arr.length < 16) {
				throw new Error(`set_camera ${label} matrix must have 16 elements.`);
			}
			for (let i = 0; i < 16; i += 1) {
				const n = arr[i];
				if (!Number.isFinite(n)) {
					throw new Error(`set_camera ${label} matrix contains non-finite values.`);
				}
				out[i] = n;
			}
			return out;
		}
		if (Array.isArray(value)) {
			if (value.length < 16) {
				throw new Error(`set_camera ${label} matrix must have 16 elements.`);
			}
			for (let i = 0; i < 16; i += 1) {
				const n = value[i];
				if (!Number.isFinite(n)) {
					throw new Error(`set_camera ${label} matrix contains non-finite values.`);
				}
				out[i] = n;
			}
			return out;
		}
		throw new Error(`set_camera ${label} matrix must be a Float32Array or number[] with 16 elements.`);
	}

	private coerceVec3(value: vec3arr | number[] | { x: number; y: number; z: number }, out: vec3arr, label: string): vec3arr {
		let x: number;
		let y: number;
		let z: number;
		if (Array.isArray(value) || ArrayBuffer.isView(value)) {
			const arr = value as ArrayLike<number>;
			if (arr.length < 3) {
				throw new Error(`${label} must have 3 elements.`);
			}
			x = arr[0];
			y = arr[1];
			z = arr[2];
		} else if (value && typeof value === 'object' && 'x' in value && 'y' in value && 'z' in value) {
			const vec = value as { x: number; y: number; z: number };
			x = vec.x;
			y = vec.y;
			z = vec.z;
		} else {
			throw new Error(`${label} must be a vec3 array or xyz object.`);
		}
		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
			throw new Error(`${label} must contain finite numbers.`);
		}
		out[0] = x;
		out[1] = y;
		out[2] = z;
		return out;
	}

	private resolve_write_context(font: BFont, x: number, y: number, z: number, colorindex: number) {
		const hasExplicitPosition = x !== undefined && y !== undefined;
		if (hasExplicitPosition) {
			this.textCursorHomeX = x;
			this.textCursorX = this.textCursorHomeX;
			this.textCursorY = y;
		}
		if (colorindex !== undefined) {
			this.textCursorColorIndex = colorindex;
		}
		const baseX = this.textCursorX;
		const baseY = this.textCursorY;
		const color = this.palette_color(this.textCursorColorIndex);
		return { baseX, baseY, color, autoAdvance: true, font, z };
	}

	private draw_multiline_text(text: string, x: number, y: number, z: number, color: color, font: BFont): number {
		const lines = text.split('\n');
		let cursorY = y;
		for (let i = 0; i < lines.length; i += 1) {
			const expanded = this.expand_tabs(lines[i]);
			if (expanded.length > 0) {
				const glyphs: GlyphRenderSubmission = {
					glyphs: expanded,
					x,
					y: cursorY,
					z,
					color,
					font,
					layer: 'world',
				};
				this.queueGlyphRun(glyphs.glyphs, glyphs.x, glyphs.y, glyphs.z, glyphs.font, glyphs.color, glyphs.background_color, 0, Number.MAX_SAFE_INTEGER, renderLayerTo2dLayer(glyphs.layer));
			}
			if (i < lines.length - 1) {
				cursorY += font.lineHeight;
			}
		}
		this.textCursorX = this.textCursorHomeX;
		this.textCursorY = cursorY;
		return cursorY;
	}

	private advance_print_cursor(lineHeight: number): void {
		this.textCursorY += lineHeight;
		const limit = this.display_height() - lineHeight;
		if (this.textCursorY >= limit) {
			this.textCursorY = 0;
		}
	}

	private reset_print_cursor(): void {
		this.textCursorHomeX = 0;
		this.textCursorX = 0;
		this.textCursorY = 0;
		this.textCursorColorIndex = this.defaultPrintColorIndex;
	}
}
