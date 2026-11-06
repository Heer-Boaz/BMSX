import type { FontVariant } from '../../../../machine/ts/render/shared/bmsx_font';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { FontSampling } from '../../../../machine/ts/render/shared/bitmap_font';

const FONT_VARIANT_KEY = 'bmsx.studio.fontVariant';
const FONT_SAMPLING_KEY = 'bmsx.studio.fontSampling';
const FONT_SIZE_KEY = 'bmsx.studio.fontSize';
const THEME_KEY = 'bmsx.studio.theme';

export const DEFAULT_WORKBENCH_FONT_SIZE = 14;
export type WorkbenchTheme = 'light' | 'dark';

/** User display preferences belong to this frontend's storage, not a project's
 * recovery records. Browser roots use device storage; isolated hosts use window storage. */
export class WorkbenchPreferences {
	private fontSizeValue: number;
	private themeValue: WorkbenchTheme;
	private fontVariantValue: FontVariant;
	private fontSamplingValue: FontSampling;
	private readonly listeners = new Set<() => void>();
	public constructor(private readonly storage: KeyValueStorage) {
		const size = storage.getItem(FONT_SIZE_KEY);
		this.fontSizeValue = size === null ? DEFAULT_WORKBENCH_FONT_SIZE : JSON.parse(size);
		const theme = storage.getItem(THEME_KEY);
		this.themeValue = theme === null ? 'light' : JSON.parse(theme);
		const fontVariant = storage.getItem(FONT_VARIANT_KEY);
		this.fontVariantValue = fontVariant === null ? 'mono' : JSON.parse(fontVariant);
		const fontSampling = storage.getItem(FONT_SAMPLING_KEY);
		this.fontSamplingValue = fontSampling === null ? 'linear' : JSON.parse(fontSampling);
	}
	public onDidChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	public get fontVariant(): FontVariant { return this.fontVariantValue; }
	public set fontVariant(value: FontVariant) {
		if (value === this.fontVariantValue) return;
		this.fontVariantValue = value;
		this.storage.setItem(FONT_VARIANT_KEY, JSON.stringify(value));
		for (const listener of this.listeners) listener();
	}
	/** Nominal font size in CSS pixels, shared by font families, independent of DPR. */
	public get fontSize(): number { return this.fontSizeValue; }
	public set fontSize(value: number) {
		if (value === this.fontSizeValue) return;
		this.fontSizeValue = value;
		this.storage.setItem(FONT_SIZE_KEY, JSON.stringify(value));
		for (const listener of this.listeners) listener();
	}
	public get theme(): WorkbenchTheme { return this.themeValue; }
	public set theme(value: WorkbenchTheme) {
		if (value === this.themeValue) return;
		this.themeValue = value;
		this.storage.setItem(THEME_KEY, JSON.stringify(value));
		for (const listener of this.listeners) listener();
	}
	public get fontSampling(): FontSampling { return this.fontSamplingValue; }
	public set fontSampling(value: FontSampling) {
		if (value === this.fontSamplingValue) return;
		this.fontSamplingValue = value;
		this.storage.setItem(FONT_SAMPLING_KEY, JSON.stringify(value));
		for (const listener of this.listeners) listener();
	}
}
