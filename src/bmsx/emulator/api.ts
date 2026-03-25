import { $, runGate } from '../core/engine_core';
import { Input } from '../input/input';
import type {
	color,
	GlyphRenderSubmission,
	ImgRenderSubmission,
	MeshRenderSubmission,
	ParticleRenderSubmission,
	PolyRenderSubmission,
	RectRenderSubmission,
	RenderLayer
} from '../render/shared/render_types';
import { wrapGlyphs } from '../render/shared/render_queues';
import { Font } from './font';
import { BFont, GlyphMap } from '../render/shared/bitmap_font';
import { RuntimeStorage } from './storage';
import type { AudioPlayOptions } from '../audio/soundmaster';
import type { Polygon, vec3arr } from '../rompack/rompack';
import { taskGate, GateGroup } from '../core/taskgate';
import { RenderFacade } from './render_facade';
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

export type ApiOptions = {
	storage: RuntimeStorage;
	runtime: Runtime;
};

const TAB_SPACES = 2;
type FontDefinition = {
	glyphs: Record<string, string>;
	advance_padding?: number;
};

export class Api {
	private readonly storage: RuntimeStorage;
	private readonly font: BFont;
	private readonly defaultPrintColorIndex = 15;
	private textCursorX = 0;
	private textCursorY = 0;
	private textCursorHomeX = 0;
	private textCursorColorIndex = 0;
	private renderBackend: RenderFacade = new RenderFacade();
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
		this.reset_print_cursor();
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

		// const value = Math.trunc(index);
		// switch (value) {
		// 	case 32: {
		// 		const viewport = this.pointer_viewport_position_internal();
		// 		if (!viewport.valid) {
		// 			return 0;
		// 		}
		// 		return Math.floor(viewport.x);
		// 	}
		// 	case 33: {
		// 		const viewport = this.pointer_viewport_position_internal();
		// 		if (!viewport.valid) {
		// 			return 0;
		// 		}
		// 		return Math.floor(viewport.y);
		// 	}
		// 	case 34: {
		// 		return this.compute_pointer_button_mask();
		// 	}
		// 	case 36: {
		// 		const wheel = this.mousewheel();
		// 		if (!wheel.valid) {
		// 			return 0;
		// 		}
		// 		return Math.floor(wheel.value);
		// 	}
		// 	default:
		// 		return 0;
		// }
	}

	public isFrameCaptureActive(): boolean {
		return this.renderBackend.isCapturingFrame();
	}

	public beginFrameCapture(): void {
		this.renderBackend.beginFrame();
	}

	public commitFrameCapture(): void {
		this.renderBackend.endFrameToRenderer();
	}

	public abandonFrameCapture(): void {
		this.renderBackend.abandonFrame();
	}

	public cls(colorindex: number = 0): void {
		const color = this.palette_color(colorindex);
		const rect: RectRenderSubmission = {
			kind: 'fill',
			area: {
				left: 0,
				top: 0,
				right: this.display_width(),
				bottom: this.display_height(),
			},
			color,
		};
		this.renderBackend.rect(rect);
		this.reset_print_cursor();
	}

	public put_rect(x0: number, y0: number, x1: number, y1: number, z: number, colorindex: number): void {
		const rect: RectRenderSubmission = {
			kind: 'rect',
			area: {
				left: x0,
				top: y0,
				right: x1,
				bottom: y1,
				z: z,
			},
			color: this.palette_color(colorindex),
		};
		this.renderBackend.rect(rect);
	}

	public put_rectfill(x0: number, y0: number, x1: number, y1: number, z: number, colorindex: number): void {
		const rect: RectRenderSubmission = {
			kind: 'fill',
			area: {
				left: x0,
				top: y0,
				right: x1,
				bottom: y1,
				z: z,
			},
			color: this.palette_color(colorindex),
		};
		this.renderBackend.rect(rect);
	}

	public put_rectfillcolor(
		x0: number,
		y0: number,
		x1: number,
		y1: number,
		z: number,
		colorvalue: number | color,
		options?: { layer?: RenderLayer },
	): void {
		const resolved = this.resolve_color(colorvalue);
		const rect: RectRenderSubmission = {
			kind: 'fill',
			area: {
				left: x0,
				top: y0,
				right: x1,
				bottom: y1,
				z: z,
			},
			color: resolved,
			layer: options?.layer,
		};
		this.renderBackend.rect(rect);
	}

	public put_sprite(img_id: string, x: number, y: number, z: number, options?: { scale?: number | { x: number; y: number }; flip_h?: boolean; flip_v?: boolean; colorize?: color; parallax_weight?: number }): void {
		const scaleValue = options?.scale ?? 1;
		const scale = typeof scaleValue === 'number' ? { x: scaleValue, y: scaleValue } : scaleValue;
		const submission: ImgRenderSubmission = {
			imgid: img_id,
			pos: { x, y, z },
			scale,
			flip: options?.flip_h || options?.flip_v ? { flip_h: options?.flip_h === true, flip_v: options?.flip_v === true } : undefined,
			colorize: options?.colorize,
			parallax_weight: options?.parallax_weight,
		};
		this.renderBackend.sprite(submission);
	}

	public put_glyphs(glyphs: string | string[], x: number, y: number, z: number, options?: {
		font?: BFont;
		color?: number | color;
		background_color?: number | color;
		wrap_chars?: number;
		center_block_width?: number;
		glyph_start?: number;
		glyph_end?: number;
		align?: CanvasTextAlign;
		baseline?: CanvasTextBaseline;
		layer?: RenderLayer;
	}): void {
		const submission: GlyphRenderSubmission = {
			glyphs,
			x,
			y,
			z,
			font: options?.font,
			color: options?.color !== undefined ? this.resolve_color(options.color) : undefined,
			background_color: options?.background_color !== undefined ? this.resolve_color(options.background_color) : undefined,
			wrap_chars: options?.wrap_chars,
			center_block_width: options?.center_block_width,
			glyph_start: options?.glyph_start,
			glyph_end: options?.glyph_end,
			align: options?.align,
			baseline: options?.baseline,
			layer: options?.layer,
		};
		this.renderBackend.glyphs(submission);
	}

	public put_poly(points: Polygon, z: number, colorvalue: number | color, thickness?: number, layer?: RenderLayer): void {
		const submission: PolyRenderSubmission = {
			points,
			z,
			color: this.resolve_color(colorvalue),
			thickness,
			layer,
		};
		this.renderBackend.poly(submission);
	}

	public put_mesh(mesh: MeshRenderSubmission['mesh'], matrix: MeshRenderSubmission['matrix'], options?: Omit<MeshRenderSubmission, 'mesh' | 'matrix'>): void {
		const submission: MeshRenderSubmission = {
			mesh,
			matrix,
			joint_matrices: options?.joint_matrices,
			morph_weights: options?.morph_weights,
			receive_shadow: options?.receive_shadow,
		};
		this.renderBackend.mesh(submission);
	}

	public put_particle(position: vec3arr, size: number, colorvalue: number | color, options?: Omit<ParticleRenderSubmission, 'position' | 'size' | 'color'>): void {
		const texture = options?.texture ?? 'whitepixel';
		const submission: ParticleRenderSubmission = {
			position,
			size,
			color: this.resolve_color(colorvalue),
			texture,
			ambient_mode: options?.ambient_mode,
			ambient_factor: options?.ambient_factor,
		};
		this.renderBackend.particle(submission);
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

	public write(
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
		const renderFont = options?.font ?? this.font;
		const { baseX, baseY, color, autoAdvance } = this.resolve_write_context(renderFont, x, y, z, colorindex);
		const resolvedColor = options?.color !== undefined ? this.resolve_color(options.color) : color;
		const backgroundColor = options?.background_color !== undefined ? this.resolve_color(options.background_color) : undefined;
		const expanded = this.expand_tabs(text);
		let lines: string[] | null = null;
		if (options?.wrap_chars && options.wrap_chars > 0) {
			lines = wrapGlyphs(expanded, options.wrap_chars);
		} else if (expanded.indexOf('\n') !== -1) {
			lines = expanded.split('\n');
		}
		const glyphs: GlyphRenderSubmission = {
			glyphs: lines ?? expanded,
			x: baseX,
			y: baseY,
			z,
			font: renderFont,
			color: resolvedColor,
			background_color: backgroundColor,
			center_block_width: options?.center_block_width,
			glyph_start: options?.glyph_start,
			glyph_end: options?.glyph_end,
			align: options?.align,
			baseline: options?.baseline,
			layer: options?.layer,
		};
		this.renderBackend.glyphs(glyphs);
		const shouldAdvance = options?.auto_advance === undefined ? autoAdvance : options.auto_advance;
		if (shouldAdvance) {
			const lineCount = lines ? lines.length : 1;
			this.textCursorY = baseY + ((lineCount - 1) * renderFont.lineHeight);
			this.advance_print_cursor(renderFont.lineHeight);
		}
	}

	public write_color(text: string, x?: number, y?: number, z?: number, colorvalue?: number | color): void {
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

	public write_with_font(text: string, x?: number, y?: number, z?: number, colorindex?: number, font?: BFont): void {
		const renderFont = font ?? this.font;
		const { baseX, baseY, color, autoAdvance } = this.resolve_write_context(renderFont, x, y, z, colorindex);
		this.draw_multiline_text(text, baseX, baseY, z, color, renderFont);
		if (autoAdvance) {
			this.advance_print_cursor(renderFont.lineHeight);
		}
	}

	public write_inline_with_font(text: string, x: number, y: number, z: number, colorindex: number, font?: BFont): void {
		const renderFont = font ?? this.font;
		const glyphs: GlyphRenderSubmission = {
			glyphs: text,
			x,
			y,
			z,
			color: BmsxColors[colorindex],
			font: renderFont,
		};
		this.renderBackend.glyphs(glyphs);
	}

	public write_inline_span_with_font(text: string, start: number, end: number, x: number, y: number, z: number, colorindex: number, font?: BFont): void {
		const renderFont = font ?? this.font;
		const glyphs: GlyphRenderSubmission = {
			glyphs: text,
			glyph_start: start,
			glyph_end: end,
			x,
			y,
			z,
			color: BmsxColors[colorindex],
			font: renderFont,
		};
		this.renderBackend.glyphs(glyphs);
	}

	public action_triggered(actiondefinition: string, player?: number): boolean {
		return $.action_triggered(player ?? 1, actiondefinition)
	}

	public consume_action(actionToConsume: ActionState | string, player?: number): void {
		$.consume_action(player ?? 1, actionToConsume);
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
		const cached = getWorkspaceCachedSource(sourcePath) ?? (dirtyPath ? getWorkspaceCachedSource(dirtyPath) : null);
		return cached ?? record.src;
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

	public create_font(definition: FontDefinition): BFont {
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
		return new BFont(glyphMap, advancePadding);
	}

	public get_default_font(): BFont {
		return this.font;
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
		runtimeLuaPipeline.reloadProgramAndResetWorld(this.runtime); // Reboot to initial state
		console.log('[Runtime API] Reboot completed.');
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
				};
				this.renderBackend.glyphs(glyphs);
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
