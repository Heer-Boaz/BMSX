import { runGate } from '../../../core/taskgate';
import { consoleCore } from '../../../core/console';
import {
	color,
} from '../../../render/shared/submissions';
import { Font } from '../../../render/shared/bmsx_font';
import { BFont, GlyphMap, RomPackageBitmapFontSource } from '../../../render/shared/bitmap_font';
import { RuntimeStorage } from '../cart_storage';
import { taskGate, GateGroup } from '../../../core/taskgate';
import { Runtime } from '../../runtime/runtime';
import { applyActiveMachineTiming } from '../../runtime/timing/config';
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
	private defaultFont: BFont | null = null;
	private readonly runtimeFonts: BFont[] = [];
	private readonly fontIds = new WeakMap<BFont, number>();
	private readonly fontDescriptors = new WeakMap<BFont, FirmwareFontDescriptor>();
	private _runtime: Runtime;

	constructor(options: ApiOptions) {
		this.storage = options.storage;
		this._runtime = options.runtime;
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

	public resolve_font(id: number): BFont {
		return this.runtimeFonts[id];
	}

	private getDefaultFont(): BFont {
		if (this.defaultFont === null) {
			this.defaultFont = new Font();
			this.registerFont(this.defaultFont);
		}
		return this.defaultFont;
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
		return consoleCore.view.viewportSize.x;
	}

	public display_height(): number {
		return consoleCore.view.viewportSize.y;
	}

	public cartdata(namespace: string): void {
		this.storage.setNamespace(namespace);
	}

	public get_cpu_freq_hz(): number {
		return this._runtime.timing.cpuHz;
	}

	public set_cpu_freq_hz(cpuHz: number): void {
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
		const glyphMap: GlyphMap = {};
		const glyphEntries = Object.entries(definition.glyphs);
		for (let index = 0; index < glyphEntries.length; index += 1) {
			const entry = glyphEntries[index];
			const glyphKey = entry[0];
			const glyphValue = entry[1];
			glyphMap[glyphKey] = glyphValue;
		}
		const font = new BFont(new RomPackageBitmapFontSource(this._runtime.activePackage, this._runtime.systemPackage), glyphMap, definition.advance_padding);
		return this.buildFontDescriptor(font);
	}

	public get_default_font(): FirmwareFontDescriptor {
		return this.buildFontDescriptor(this.getDefaultFont());
	}

	public dset(index: number, value: number): void {
		this.storage.setValue(index, value);
	}

	public dget(index: number): number {
		return this.storage.getValue(index);
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
		this.runtime.rebootToBootRom();
	}

	public palette_color(index: number): color {
		return BmsxColors[index];
	}
}
