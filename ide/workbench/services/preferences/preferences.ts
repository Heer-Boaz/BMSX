import type { FontVariant } from '../../../../machine/ts/render/shared/bmsx_font';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { WorkspaceUiScale } from '../../common/display_scale';
import type { FontSampling } from '../../../../machine/ts/render/shared/bitmap_font';

const UI_SCALE_KEY = 'bmsx.studio.uiScale';
const FONT_VARIANT_KEY = 'bmsx.studio.fontVariant';
const FONT_SAMPLING_KEY = 'bmsx.studio.fontSampling';

/** User display preferences belong to this frontend's storage, not a project's
 * recovery records. Browser roots use device storage; isolated hosts use window storage. */
export class WorkbenchPreferences {
	private uiScaleValue: WorkspaceUiScale;
	private fontVariantValue: FontVariant;
	private fontSamplingValue: FontSampling;
	private readonly listeners = new Set<() => void>();
	public constructor(private readonly storage: KeyValueStorage) {
		const saved = storage.getItem(UI_SCALE_KEY);
		this.uiScaleValue = saved === null ? 1 : JSON.parse(saved);
		const fontVariant = storage.getItem(FONT_VARIANT_KEY);
		this.fontVariantValue = fontVariant === null ? 'mono' : JSON.parse(fontVariant);
		const fontSampling = storage.getItem(FONT_SAMPLING_KEY);
		this.fontSamplingValue = fontSampling === null ? 'linear' : JSON.parse(fontSampling);
	}
	public get uiScale(): WorkspaceUiScale { return this.uiScaleValue; }
	public set uiScale(value: WorkspaceUiScale) {
		if (this.uiScaleValue === value) return;
		this.uiScaleValue = value;
		this.storage.setItem(UI_SCALE_KEY, JSON.stringify(value));
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
		this.storage.setItem(FONT_VARIANT_KEY, JSON.stringify(value));
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
