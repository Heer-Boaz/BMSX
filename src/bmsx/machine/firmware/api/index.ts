import { $, runGate } from '../../../core/engine';
import {
	color,
	MeshRenderSubmission,
	ParticleRenderSubmission,
} from '../../../render/shared/submissions';
import { Font } from '../../../render/shared/bmsx_font';
import { BFont, GlyphMap } from '../../../render/shared/bitmap_font';
import { RuntimeStorage } from '../cart_storage';
import type { vec3arr } from '../../../rompack/format';
import { taskGate, GateGroup } from '../../../core/taskgate';
import { Runtime } from '../../runtime/runtime';
import { applyActiveMachineTiming } from '../../runtime/timing/config';
import { setHardwareCamera } from '../../../render/shared/hardware/camera';
import { putHardwareAmbientLight, putHardwareDirectionalLight, putHardwarePointLight } from '../../../render/shared/hardware/lighting';
import { setSpriteParallaxRig, submitMesh, submit_particle } from '../../../render/shared/queues';
import { DEFAULT_LUA_BUILTIN_NAMES } from '../builtin_descriptors';
import { createLuaTable, type LuaTable } from '../../../lua/value';
import { BmsxColors } from '../../devices/vdp/vdp';

export type ApiOptions = {
	storage: RuntimeStorage;
	runtime: Runtime;
};

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

export class Api {
	private readonly storage: RuntimeStorage;
	private readonly font: BFont;
	private readonly runtimeFonts: BFont[] = [];
	private readonly fontIds = new WeakMap<BFont, number>();
	private readonly fontDescriptors = new WeakMap<BFont, FirmwareFontDescriptor>();
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
	}

	// start normalized-body-acceptable -- Font ids and compiler slots share a cache-insert shape but not ownership.
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
	// end normalized-body-acceptable

	public resolveFontId(id: number): BFont {
		const font = this.runtimeFonts[id];
		if (font === undefined) {
			throw new Error(`[FirmwareApi] Unknown font id ${id}.`);
		}
		return font;
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
		const tabGlyph = font.getGlyph('\t');
		glyphs['\t'] = {
			imgid: tabGlyph.imgid,
			width: tabGlyph.width,
			height: tabGlyph.height,
			advance: tabGlyph.advance,
		};
		const descriptor: FirmwareFontDescriptor = {
			id: this.registerFont(font),
			line_height: font.lineHeight,
			advance_padding: font.glyphAdvancePadding,
			glyphs,
		};
		this.fontDescriptors.set(font, descriptor);
		return descriptor;
	}

	public display_width(): number {
		return this.runtime.gameViewState.viewportSize.x;
	}

	public display_height(): number {
		return this.runtime.gameViewState.viewportSize.y;
	}

	public put_mesh(mesh: MeshRenderSubmission['mesh'], matrix: MeshRenderSubmission['matrix'], options?: Omit<MeshRenderSubmission, 'mesh' | 'matrix'>): void {
		const submission: MeshRenderSubmission = {
			mesh,
			matrix,
			joint_matrices: options?.joint_matrices,
			morph_weights: options?.morph_weights,
			receive_shadow: options?.receive_shadow !== false,
		};
		submitMesh(submission);
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
		submit_particle(submission);
	}

	public set_camera(view: Float32Array | number[], proj: Float32Array | number[], eye: vec3arr | number[]): void {
		const viewMat = this.coerceMat4(view, this.cameraViewScratch, 'view');
		const projMat = this.coerceMat4(proj, this.cameraProjScratch, 'proj');
		const eyeVec = this.coerceVec3(eye, this.cameraEyeScratch, 'eye');
		setHardwareCamera(viewMat, projMat, eyeVec[0], eyeVec[1], eyeVec[2]);
	}

	public skybox(posx: string, negx: string, posy: string, negy: string, posz: string, negz: string): void {
		this.runtime.machine.vdp.setSkyboxImages({ posx, negx, posy, negy, posz, negz });
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

	public cartdata(namespace: string): void {
		this.storage.setNamespace(namespace);
	}

	public get_cpu_freq_hz(): number {
		return this._runtime.timing.cpuHz;
	}

	public set_cpu_freq_hz(cpuHz: number): void {
		if (!Number.isSafeInteger(cpuHz) || cpuHz <= 0) {
			throw new Error('[api.set_cpu_freq_hz] cpuHz must be a positive safe integer.');
		}
		applyActiveMachineTiming(this._runtime, cpuHz);
	}

	public list_builtins(): LuaTable {
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

	public set_sprite_parallax_rig(vy: number, scale: number, impact: number, impact_t: number, bias_px: number, parallax_strength: number, scale_strength: number, flip_strength: number, flip_window: number): void {
		if (arguments.length !== 9) {
			throw new Error('set_sprite_parallax_rig(vy, scale, impact, impact_t, bias_px, parallax_strength, scale_strength, flip_strength, flip_window) requires exactly 9 arguments.');
		}
		setSpriteParallaxRig(vy, scale, impact, impact_t, bias_px, parallax_strength, scale_strength, flip_strength, flip_window);
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
}
