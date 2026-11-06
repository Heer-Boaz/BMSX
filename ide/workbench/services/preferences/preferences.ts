import type { FontVariant } from '../../../../machine/ts/render/shared/bmsx_font';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { FontSampling } from '../../../../machine/ts/render/shared/bitmap_font';

const FONT_VARIANT_KEY = 'bmsx.studio.fontVariant';
const FONT_SAMPLING_KEY = 'bmsx.studio.fontSampling';
const FONT_SIZE_KEY = 'bmsx.studio.fontSize';
const THEME_KEY = 'bmsx.studio.theme';

export const DEFAULT_WORKBENCH_FONT_SIZE = 14;
export type WorkbenchTheme = 'light' | 'dark';
export const WORKBENCH_PREFERENCE_DEFAULTS: Readonly<{ fontSize: number; theme: WorkbenchTheme; fontVariant: FontVariant; fontSampling: FontSampling }> = {
	fontSize: DEFAULT_WORKBENCH_FONT_SIZE, theme: 'light', fontVariant: 'mono', fontSampling: 'linear',
};

/** User display preferences belong to this frontend's storage, not a project's
 * recovery records. Browser roots use device storage; isolated hosts use window storage. */
export class WorkbenchPreferences {
	private fontSizeValue: number;
	private themeValue: WorkbenchTheme;
	private fontVariantValue: FontVariant;
	private fontSamplingValue: FontSampling;
	private readonly configured = new Set<keyof typeof WORKBENCH_PREFERENCE_DEFAULTS>();
	private readonly listeners = new Set<() => void>();
	public constructor(private readonly storage: KeyValueStorage) {
		const size = storage.getItem(FONT_SIZE_KEY);
		if (size !== null) this.configured.add('fontSize');
		this.fontSizeValue = size === null ? WORKBENCH_PREFERENCE_DEFAULTS.fontSize : JSON.parse(size);
		const theme = storage.getItem(THEME_KEY);
		if (theme !== null) this.configured.add('theme');
		this.themeValue = theme === null ? WORKBENCH_PREFERENCE_DEFAULTS.theme : JSON.parse(theme);
		const fontVariant = storage.getItem(FONT_VARIANT_KEY);
		if (fontVariant !== null) this.configured.add('fontVariant');
		this.fontVariantValue = fontVariant === null ? WORKBENCH_PREFERENCE_DEFAULTS.fontVariant : JSON.parse(fontVariant);
		const fontSampling = storage.getItem(FONT_SAMPLING_KEY);
		if (fontSampling !== null) this.configured.add('fontSampling');
		this.fontSamplingValue = fontSampling === null ? WORKBENCH_PREFERENCE_DEFAULTS.fontSampling : JSON.parse(fontSampling);
	}
	public isConfigured(key: keyof typeof WORKBENCH_PREFERENCE_DEFAULTS): boolean { return this.configured.has(key); }
	/** Reset removes the user override rather than persisting today's default as a user choice. */
	public reset(key: keyof typeof WORKBENCH_PREFERENCE_DEFAULTS): void {
		if (!this.configured.delete(key)) return;
		switch (key) {
			case 'fontSize': this.fontSizeValue = WORKBENCH_PREFERENCE_DEFAULTS.fontSize; this.storage.removeItem(FONT_SIZE_KEY); break;
			case 'fontVariant': this.fontVariantValue = WORKBENCH_PREFERENCE_DEFAULTS.fontVariant; this.storage.removeItem(FONT_VARIANT_KEY); break;
			case 'fontSampling': this.fontSamplingValue = WORKBENCH_PREFERENCE_DEFAULTS.fontSampling; this.storage.removeItem(FONT_SAMPLING_KEY); break;
			case 'theme': this.themeValue = WORKBENCH_PREFERENCE_DEFAULTS.theme; this.storage.removeItem(THEME_KEY); break;
		}
		for (const listener of this.listeners) listener();
	}
	public onDidChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	public get fontVariant(): FontVariant { return this.fontVariantValue; }
	public set fontVariant(value: FontVariant) {
		if (value === this.fontVariantValue) return;
		this.fontVariantValue = value;
		this.configured.add('fontVariant');
		this.storage.setItem(FONT_VARIANT_KEY, JSON.stringify(value));
		for (const listener of this.listeners) listener();
	}
	/** Nominal font size in CSS pixels, shared by font families, independent of DPR. */
	public get fontSize(): number { return this.fontSizeValue; }
	public set fontSize(value: number) {
		if (value === this.fontSizeValue) return;
		this.fontSizeValue = value;
		this.configured.add('fontSize');
		this.storage.setItem(FONT_SIZE_KEY, JSON.stringify(value));
		for (const listener of this.listeners) listener();
	}
	public get theme(): WorkbenchTheme { return this.themeValue; }
	public set theme(value: WorkbenchTheme) {
		if (value === this.themeValue) return;
		this.themeValue = value;
		this.configured.add('theme');
		this.storage.setItem(THEME_KEY, JSON.stringify(value));
		for (const listener of this.listeners) listener();
	}
	public get fontSampling(): FontSampling { return this.fontSamplingValue; }
	public set fontSampling(value: FontSampling) {
		if (value === this.fontSamplingValue) return;
		this.fontSamplingValue = value;
		this.configured.add('fontSampling');
		this.storage.setItem(FONT_SAMPLING_KEY, JSON.stringify(value));
		for (const listener of this.listeners) listener();
	}
}
