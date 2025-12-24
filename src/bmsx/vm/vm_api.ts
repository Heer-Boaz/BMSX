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
import { Msx1Colors } from '../systems/msx';
import { VMFont } from './font';
import { BmsxVMStorage } from './storage';
import type { RandomModulationParams, ModulationParams, SoundMasterPlayRequest } from '../audio/soundmaster';
import type { Polygon, vec3arr } from '../rompack/rompack';
import { taskGate, GateGroup } from '../core/taskgate';
import { VMRenderFacade } from './vm_render_facade';
import { BmsxVMRuntime } from './vm_tooling_runtime';

type AudioPlayOptions = RandomModulationParams | ModulationParams | SoundMasterPlayRequest;

export type BmsxVMApiOptions = {
	storage: BmsxVMStorage;
	runtime: BmsxVMRuntime;
};

const VM_TAB_SPACES = 2;

export class BmsxVMApi {
	private readonly playerindex: number;
	private readonly storage: BmsxVMStorage;
	private readonly font: VMFont;
	private readonly defaultPrintColorIndex = 15;
	private textCursorX = 0;
	private textCursorY = 0;
	private textCursorHomeX = 0;
	private textCursorColorIndex = 0;
	private renderBackend: VMRenderFacade = new VMRenderFacade();
	private _runtime: BmsxVMRuntime;

	constructor(options: BmsxVMApiOptions) {
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
		this.font = new VMFont();
		this.reset_print_cursor();
	}

	public display_width(): number {
		return $.view.viewportSize.x;
	}

	public display_height(): number {
		return $.view.viewportSize.y;
	}

	public get keyboard() {
		return $.input.getPlayerInput(1).inputHandlers.keyboard;
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

	public rect(x0: number, y0: number, x1: number, y1: number, z: number, colorindex: number): void {
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

	public rectfill(x0: number, y0: number, x1: number, y1: number, z: number, colorindex: number): void {
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

	public rectfill_color(x0: number, y0: number, x1: number, y1: number, z: number, colorvalue: number | color): void {
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
		};
		this.renderBackend.rect(rect);
	}

	public sprite(img_id: string, x: number, y: number, z: number, options?: { scale?: number | { x: number; y: number }; flip_h?: boolean; flip_v?: boolean; colorize?: color, }): void {
		const scaleValue = options?.scale ?? 1;
		const scale = typeof scaleValue === 'number' ? { x: scaleValue, y: scaleValue } : scaleValue;
		const submission: ImgRenderSubmission = {
			imgid: img_id,
			pos: { x, y, z },
			scale,
			flip: options?.flip_h || options?.flip_v ? { flip_h: options?.flip_h === true, flip_v: options?.flip_v === true } : undefined,
			colorize: options?.colorize,
		};
		this.renderBackend.sprite(submission);
	}

	public poly(points: Polygon, z: number, colorindex: number, thickness?: number, layer?: RenderLayer): void {
		const submission: PolyRenderSubmission = {
			points,
			z,
			color: this.palette_color(colorindex),
			thickness,
			layer,
		};
		this.renderBackend.poly(submission);
	}

	public mesh(mesh: MeshRenderSubmission['mesh'], matrix: MeshRenderSubmission['matrix'], options?: Omit<MeshRenderSubmission, 'mesh' | 'matrix'>): void {
		const submission: MeshRenderSubmission = {
			mesh,
			matrix,
			joint_matrices: options?.joint_matrices,
			morph_weights: options?.morph_weights,
			receive_shadow: options?.receive_shadow,
		};
		this.renderBackend.mesh(submission);
	}

	public particle(position: vec3arr, size: number, colorvalue: number | color, options?: Omit<ParticleRenderSubmission, 'position' | 'size' | 'color'>): void {
		const submission: ParticleRenderSubmission = {
			position,
			size,
			color: this.resolve_color(colorvalue),
			texture: options?.texture,
			ambient_mode: options?.ambient_mode,
			ambient_factor: options?.ambient_factor,
		};
		this.renderBackend.particle(submission);
	}

	public write(text: string, x?: number, y?: number, z?: number, colorindex?: number): void {
		const { baseX, baseY, color, font, autoAdvance } = this.resolve_write_context(this.font, x, y, z, colorindex);
		this.draw_multiline_text(text, baseX, baseY, z, color, font);
		if (autoAdvance) {
			this.advance_print_cursor(font.lineHeight);
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

	public write_with_font(text: string, x?: number, y?: number, z?: number, colorindex?: number, font?: VMFont): void {
		const renderFont = font ?? this.font;
		const { baseX, baseY, color, autoAdvance } = this.resolve_write_context(renderFont, x, y, z, colorindex);
		this.draw_multiline_text(text, baseX, baseY, z, color, renderFont);
		if (autoAdvance) {
			this.advance_print_cursor(renderFont.lineHeight);
		}
	}

	public write_inline_with_font(text: string, x: number, y: number, z: number, colorindex: number, font?: VMFont): void {
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

	public write_inline_span_with_font(text: string, start: number, end: number, x: number, y: number, z: number, colorindex: number, font?: VMFont): void {
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

	public cartdata(namespace: string): void {
		this.storage.setNamespace(namespace);
	}

	public dset(index: number, value: number): void {
		this.storage.setValue(index, value);
	}

	public dget(index: number): number {
		return this.storage.getValue(index);
	}

	public sfx(id: string, options?: AudioPlayOptions): void {
		$.playaudio(id, options);
	}

	public stop_sfx(): void {
		$.sndmaster.stopEffect();
	}

	public music(id: string, options?: AudioPlayOptions): void {
		if (!id) {
			$.sndmaster.stopMusic();
			return;
		}
		$.sndmaster.stopMusic();
		void $.sndmaster.play(id, options as SoundMasterPlayRequest | ModulationParams | RandomModulationParams);
	}

	public stop_music(): void {
		$.sndmaster.stopMusic();
	}

	public set_master_volume(volume: number): void {
		$.sndmaster.volume = volume;
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

	public get runtime(): BmsxVMRuntime {
		return this._runtime;
	}

	public reboot(): void {
		console.log('[BMSX VM API] Reboot requested.');
		this.runtime.reloadProgramAndResetWorld(); // Reboot to initial state
		console.log('[BMSX VM API] Reboot completed.');
	}

	private expand_tabs(text: string): string {
		if (text.indexOf('\t') === -1) {
			return text;
		}
		let result = '';
		for (let i = 0; i < text.length; i++) {
			const ch = text.charAt(i);
			if (ch === '\t') {
				for (let j = 0; j < VM_TAB_SPACES; j++) {
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

	private resolve_write_context(font: VMFont, x: number, y: number, z: number, colorindex: number) {
		const hasExplicitPosition = x !== undefined && y !== undefined;
		if (hasExplicitPosition) {
			this.textCursorHomeX = x;
			this.textCursorX = this.textCursorHomeX;
			this.textCursorY = y;
		}
		if (colorindex) {
			this.textCursorColorIndex = colorindex;
		}
		const baseX = this.textCursorX;
		const baseY = this.textCursorY;
		const color = this.palette_color(this.textCursorColorIndex);
		return { baseX, baseY, color, autoAdvance: true, font, z };
	}

	private draw_multiline_text(text: string, x: number, y: number, z: number, color: color, font: VMFont): number {
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
