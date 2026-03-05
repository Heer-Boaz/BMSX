import { $, runGate } from '../core/engine_core';
import { Input } from '../input/input';
import type { PlayerInput } from '../input/playerinput';
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
import { Msx1Colors } from '../systems/msx';
import { Font } from './font';
import { BFont, GlyphMap } from '../core/font';
import { RuntimeStorage } from './storage';
import type { RandomModulationParams, ModulationParams, SoundMasterPlayRequest } from '../audio/soundmaster';
import type { Polygon, vec3arr, asset_id, AudioType } from '../rompack/rompack';
import { taskGate, GateGroup } from '../core/taskgate';
import { RenderFacade } from './render_facade';
import { Runtime } from './runtime';
import * as runtimeLuaPipeline from './runtime_lua_pipeline';
import { setHardwareCamera } from '../render/shared/hardware_camera';
import { listResources } from './workspace';
import { getWorkspaceCachedSource } from './workspace_cache';
import { buildDirtyFilePath } from './ide/workspace_storage';
import { DEFAULT_LUA_BUILTIN_NAMES } from './lua_builtins';
import { createLuaTable, type LuaTable } from '../lua/luavalue';
import { ActionState } from 'bmsx/input/inputtypes';

type AudioPlaybackMode = 'replace' | 'ignore' | 'queue' | 'stop' | 'pause';
type MusicTransitionSync = 'immediate' | 'loop'
	| { delay_ms: number }
	| { stinger: asset_id; return_to?: asset_id; return_to_previous?: boolean };
type AudioRouterOptions = {
	modulation_params?: RandomModulationParams | ModulationParams;
	params?: RandomModulationParams | ModulationParams;
	modulation_preset?: asset_id;
	priority?: number;
	policy?: AudioPlaybackMode;
	max_voices?: number;
	channel?: AudioType;
	audio_id?: asset_id;
	sync?: MusicTransitionSync;
	fade_ms?: number;
	crossfade_ms?: number;
	start_at_loop_start?: boolean;
	start_fresh?: boolean;
};
type AudioPlayOptions = RandomModulationParams | ModulationParams | SoundMasterPlayRequest | AudioRouterOptions;

export type ApiOptions = {
	storage: RuntimeStorage;
	runtime: Runtime;
};

const TAB_SPACES = 2;
type FontDefinition = {
	glyphs: Record<string, string>;
	advance_padding?: number;
};

type ParsedAudioOptions = {
	request: SoundMasterPlayRequest;
	policy?: AudioPlaybackMode;
	maxVoices?: number;
	channel?: AudioType;
};

type AudioQueueItem = {
	id: asset_id;
	request: SoundMasterPlayRequest;
	maxVoices: number;
};

const audioQueueByType: Record<AudioType, AudioQueueItem[]> = { sfx: [], music: [], ui: [] };
const resumeOnNextEndByType: Record<AudioType, boolean> = { sfx: false, music: false, ui: false };
let audioPolicyListenersReady = false;

const ensureAudioPolicyListeners = (): void => {
	if (audioPolicyListenersReady) {
		return;
	}
	audioPolicyListenersReady = true;
	$.sndmaster.addEndedListener('sfx', () => onAudioChannelEnded('sfx'));
	$.sndmaster.addEndedListener('music', () => onAudioChannelEnded('music'));
	$.sndmaster.addEndedListener('ui', () => onAudioChannelEnded('ui'));
};

const onAudioChannelEnded = (channel: AudioType): void => {
	if (resumeOnNextEndByType[channel]) {
		resumeOnNextEndByType[channel] = false;
		const paused = $.sndmaster.drainPausedSnapshots(channel);
		for (let i = 0; i < paused.length; i += 1) {
			const snapshot = paused[i];
			const params: ModulationParams = { ...snapshot.params, offset: snapshot.offset };
			void $.sndmaster.play(snapshot.id, { params, priority: snapshot.priority });
		}
		return;
	}
	const queue = audioQueueByType[channel];
	while (queue.length > 0) {
		const item = queue[0];
		if ($.sndmaster.activeCountByType(channel) >= item.maxVoices) {
			return;
		}
		queue.shift();
		void $.sndmaster.play(item.id, item.request);
	}
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const parseAudioChannel = (value: unknown): AudioType => {
	if (value === 'sfx' || value === 'music' || value === 'ui') {
		return value;
	}
	throw new Error(`Unknown audio channel "${String(value)}".`);
};

const parsePlaybackMode = (value: unknown): AudioPlaybackMode => {
	if (value === 'replace' || value === 'ignore' || value === 'queue' || value === 'stop' || value === 'pause') {
		return value;
	}
	throw new Error(`Unknown audio policy "${String(value)}".`);
};

const hasModulationFields = (value: Record<string, unknown>): boolean => (
	value.pitchDelta !== undefined
	|| value.volumeDelta !== undefined
	|| value.offset !== undefined
	|| value.playbackRate !== undefined
	|| value.pitchRange !== undefined
	|| value.volumeRange !== undefined
	|| value.offsetRange !== undefined
	|| value.playbackRateRange !== undefined
	|| value.filter !== undefined
);

const parseAudioOptions = (options?: AudioPlayOptions): ParsedAudioOptions => {
	const out: ParsedAudioOptions = { request: {} };
	if (options === null || options === undefined) {
		return out;
	}
	if (!isObject(options)) {
		throw new Error('audio options must be a table.');
	}

	if (options.channel !== undefined) {
		out.channel = parseAudioChannel(options.channel);
	}
	if (options.policy !== undefined) {
		out.policy = parsePlaybackMode(options.policy);
	}
	if (options.max_voices !== undefined) {
		if (typeof options.max_voices !== 'number') {
			throw new Error('max_voices must be a number.');
		}
		out.maxVoices = Math.floor(options.max_voices);
	}
	if (options.priority !== undefined) {
		if (typeof options.priority !== 'number') {
			throw new Error('priority must be a number.');
		}
		out.request.priority = Math.floor(options.priority);
	}

	if (options.modulation_params !== undefined) {
		if (!isObject(options.modulation_params)) {
			throw new Error('modulation_params must be a table.');
		}
		out.request.params = options.modulation_params as RandomModulationParams | ModulationParams;
	} else if (options.params !== undefined) {
		if (!isObject(options.params)) {
			throw new Error('params must be a table.');
		}
		out.request.params = options.params as RandomModulationParams | ModulationParams;
	} else if (hasModulationFields(options)) {
		out.request.params = options as RandomModulationParams | ModulationParams;
	}

	if (!out.request.params && options.modulation_preset !== undefined) {
		if (typeof options.modulation_preset !== 'string') {
			throw new Error('modulation_preset must be a string.');
		}
		out.request.modulation_preset = options.modulation_preset;
	}

	return out;
};

const resolveMusicTransition = (options: AudioPlayOptions | undefined, id?: asset_id): {
	request?: {
		to: asset_id;
		sync?: MusicTransitionSync;
		fade_ms?: number;
		crossfade_ms?: number;
		start_at_loop_start?: boolean;
		start_fresh?: boolean;
	};
} => {
	if (!options) {
		return {};
	}
	if (!isObject(options)) {
		throw new Error('music options must be a table.');
	}
	const hasTransition = options.sync !== undefined
		|| options.fade_ms !== undefined
		|| options.crossfade_ms !== undefined
		|| options.start_at_loop_start !== undefined
		|| options.start_fresh !== undefined
		|| options.audio_id !== undefined;
	if (!hasTransition) {
		return {};
	}
	const target = (id && id.length > 0) ? id : options.audio_id;
	if (!target || typeof target !== 'string') {
		throw new Error('music_transition.audio_id must be a string.');
	}
	if (options.fade_ms !== undefined && typeof options.fade_ms !== 'number') {
		throw new Error('music_transition.fade_ms must be a number.');
	}
	if (options.crossfade_ms !== undefined && typeof options.crossfade_ms !== 'number') {
		throw new Error('music_transition.crossfade_ms must be a number.');
	}
	if (options.fade_ms !== undefined && options.crossfade_ms !== undefined) {
		throw new Error('music_transition cannot specify both fade_ms and crossfade_ms.');
	}
	if (options.start_at_loop_start !== undefined && typeof options.start_at_loop_start !== 'boolean') {
		throw new Error('music_transition.start_at_loop_start must be a boolean.');
	}
	if (options.start_fresh !== undefined && typeof options.start_fresh !== 'boolean') {
		throw new Error('music_transition.start_fresh must be a boolean.');
	}
	if (options.sync !== undefined && typeof options.sync !== 'string' && !isObject(options.sync)) {
		throw new Error('music_transition.sync must be a string or table.');
	}
	const sync = options.sync as MusicTransitionSync | undefined;
	return {
		request: {
			to: target,
			sync: sync,
			fade_ms: options.fade_ms,
			crossfade_ms: options.crossfade_ms,
			start_at_loop_start: options.start_at_loop_start,
			start_fresh: options.start_fresh,
		},
	};
};

const playWithPolicy = (channel: AudioType, id: asset_id, options: ParsedAudioOptions): void => {
	const runtime = Runtime.instance;
	const entry = runtime.getAssetEntry(id);
	if (entry.type !== 'audio') {
		throw new Error(`Asset '${id}' is not an audio resource.`);
	}
	const audioMeta = runtime.getAudioMeta(id);
	const fallbackPriority = audioMeta.priority;
	const priority = options.request.priority ?? fallbackPriority;
	options.request.priority = priority;
	const policy = options.policy ?? 'replace';
	const maxVoices = options.maxVoices ?? 1;
	if (maxVoices < 1) {
		throw new Error('max_voices must be at least 1.');
	}
	if (policy === 'stop') {
		$.sndmaster.stop(channel, 'all');
		audioQueueByType[channel] = [];
		return;
	}
	const active = $.sndmaster.activeCountByType(channel);
	if (active >= maxVoices) {
		if (policy === 'ignore') {
			return;
		}
		if (policy === 'replace') {
			const infos = $.sndmaster.getActiveVoiceInfosByType(channel);
			if (infos.length === 0) {
				throw new Error('No active voices returned for audio channel.');
			}
			let minIdx = 0;
			let minPr = infos[0].priority;
			let oldest = infos[0].startedAt;
			for (let i = 1; i < infos.length; i += 1) {
				const info = infos[i];
				if (info.priority < minPr || (info.priority === minPr && info.startedAt < oldest)) {
					minIdx = i;
					minPr = info.priority;
					oldest = info.startedAt;
				}
			}
			if (priority < minPr) {
				return;
			}
			$.sndmaster.stop(channel, 'byvoice', infos[minIdx].voiceId);
		}
		if (policy === 'pause') {
			ensureAudioPolicyListeners();
			$.sndmaster.pause(channel);
			resumeOnNextEndByType[channel] = true;
		}
		if (policy === 'queue') {
			ensureAudioPolicyListeners();
			audioQueueByType[channel].push({ id, request: options.request, maxVoices });
			return;
		}
	}
	void $.sndmaster.play(id, options.request);
};

export class Api {
	private readonly playerindex: number;
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
		this.playerindex = 1;
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
		return $.input.getPlayerInput(this.playerindex).inputHandlers.keyboard;
	}

	public get_player_input(playerindex?: number): PlayerInput {
		const playerInput = Input.instance.getPlayerInput(playerindex ?? this.playerindex);
		if (!playerInput) {
			throw new Error(`Player input handler for index ${playerindex ?? this.playerindex} is not initialised.`);
		}
		return playerInput;
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
			color: Msx1Colors[colorindex],
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
			color: Msx1Colors[colorindex],
			font: renderFont,
		};
		this.renderBackend.glyphs(glyphs);
	}

	public action_triggered(actiondefinition: string, playerindex?: number): boolean {
		return $.action_triggered(playerindex ?? this.playerindex, actiondefinition)
	}

	public consume_action(actionToConsume: ActionState | string, playerindex?: number): void {
		$.consume_action(playerindex ?? this.playerindex, actionToConsume);
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
		return runtimeLuaPipeline.listLuaSourceRegistries(this._runtime)[0].registry.entry_path;
	}

	public get_lua_resource_source(path: string): string {
		const record = runtimeLuaPipeline.resolveLuaSourceRecord(this._runtime, path);
		const sourcePath = record.source_path;
		const dirtyPath = buildDirtyFilePath(sourcePath);
		const cached = getWorkspaceCachedSource(sourcePath) ?? getWorkspaceCachedSource(dirtyPath);
		return cached ?? record.src;
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
		const parsed = parseAudioOptions(options);
		const channel = parsed.channel ?? 'sfx';
		if (channel === 'music') {
			throw new Error('sfx does not support music channel.');
		}
		playWithPolicy(channel, id, parsed);
	}

	public stop_sfx(): void {
		$.sndmaster.stopEffect();
	}

	public music(id: string, options?: AudioPlayOptions): void {
		const transition = resolveMusicTransition(options, id);
		if (transition.request) {
			$.sndmaster.requestMusicTransition(transition.request);
			return;
		}
		if (!id) {
			$.sndmaster.stopMusic();
			return;
		}
		const parsed = parseAudioOptions(options);
		if (parsed.channel && parsed.channel !== 'music') {
			throw new Error('music does not support non-music channel.');
		}
		playWithPolicy('music', id, parsed);
	}

	public stop_music(): void {
		$.sndmaster.stopMusic();
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
		if (index < 0 || index >= Msx1Colors.length) {
			throw new Error(`Color index ${index} outside palette range 0-${Msx1Colors.length - 1}.`);
		}
		return Msx1Colors[index];
	}

	private resolve_color(value: number | color): color {
		return typeof value === 'number' ? this.palette_color(value) : value;
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

	private coerceVec3(value: vec3arr | number[], out: vec3arr, label: string): vec3arr {
		if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
			throw new Error(`set_camera ${label} must be a vec3 array.`);
		}
		const arr = value as ArrayLike<number>;
		if (arr.length < 3) {
			throw new Error(`set_camera ${label} must have 3 elements.`);
		}
		const x = arr[0];
		const y = arr[1];
		const z = arr[2];
		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
			throw new Error(`set_camera ${label} must contain finite numbers.`);
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
