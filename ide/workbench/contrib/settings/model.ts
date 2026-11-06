import type { FontVariant } from '../../../../machine/ts/render/shared/bmsx_font';
import type { WORKBENCH_PREFERENCE_DEFAULTS, WorkbenchPreferences, WorkbenchTheme } from '../../services/preferences/preferences';
import type { ValueInputResult } from '../../../editor/ui/inline/value_input';

export const SETTINGS_CATEGORIES = [
	{ id: 'all', label: 'All' }, { id: 'appearance', label: 'Appearance' }, { id: 'typography', label: 'Typography' },
] as const;
export type SettingsCategory = typeof SETTINGS_CATEGORIES[number]['id'];
type SettingBase = { readonly id: keyof typeof WORKBENCH_PREFERENCE_DEFAULTS; readonly category: Exclude<SettingsCategory, 'all'>;
	readonly label: string; readonly description: string; enabled?(preferences: WorkbenchPreferences): boolean };
export type NumberSetting = SettingBase & { readonly kind: 'number';
	read(preferences: WorkbenchPreferences): number; write(preferences: WorkbenchPreferences, value: number): void;
	parse(text: string): ValueInputResult<number> };
export type ChoiceSetting = SettingBase & { readonly kind: 'choice';
	readonly choices: readonly { readonly value: string; readonly label: string }[];
	read(preferences: WorkbenchPreferences): string; write(preferences: WorkbenchPreferences, value: string): void };
export type BooleanSetting = SettingBase & { readonly kind: 'boolean';
	read(preferences: WorkbenchPreferences): boolean; write(preferences: WorkbenchPreferences, value: boolean): void };
export type Setting = NumberSetting | ChoiceSetting | BooleanSetting;

/** User text is parsed at the field boundary. Preferences receive an actual pixel size. */
export function parseFontSize(text: string): ValueInputResult<number> {
	const value = Number(text);
	return /^\d+(\.\d+)?$/.test(text.trim()) && value >= 6 && value <= 72
		? { value } : { error: 'Enter a font size from 6 to 72 pixels.' };
}

/** Declared preferences, not inferred from values or duplicated in menu commands. */
export const SETTINGS: readonly Setting[] = [
	{ id: 'theme', category: 'appearance', kind: 'choice', label: 'Color theme',
		description: 'Colors used by Studio and the IDE. Game colors are unchanged.',
		choices: [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
		read: p => p.theme, write: (p, value) => { p.theme = value as WorkbenchTheme; } },
	{ id: 'fontVariant', category: 'typography', kind: 'choice', label: 'Font family',
		description: 'JetBrains Mono is scalable. Tiny and MSX retain the pixel-font appearance.',
		choices: [{ value: 'mono', label: 'JetBrains Mono' }, { value: 'tiny', label: 'Tiny' }, { value: 'msx', label: 'MSX' }],
		read: p => p.fontVariant, write: (p, value) => { p.fontVariant = value as FontVariant; } },
	{ id: 'fontSize', category: 'typography', kind: 'number', label: 'Font size (px)',
		description: 'Text size in CSS pixels. Rows and controls adapt to the text. Applies to Studio and the IDE, not the game.',
		read: p => p.fontSize, write: (p, value) => { p.fontSize = value; }, parse: parseFontSize },
	{ id: 'fontSampling', category: 'typography', kind: 'boolean', label: 'Smooth pixel fonts',
		description: 'Soften Tiny and MSX edges. JetBrains Mono always uses anti-aliasing. Game pixels are unchanged.',
		enabled: p => p.fontVariant !== 'mono',
		read: p => p.fontVariant === 'mono' || p.fontSampling === 'linear', write: (p, value) => { p.fontSampling = value ? 'linear' : 'nearest'; } },
];

const SEARCH_TEXT = SETTINGS.map(setting => `${setting.category} ${setting.label} ${setting.description}`.toLowerCase());

/** The input retains only browsing state; preferences own persistence and notifications. */
export class SettingsModel {
	public query = '';
	public category: SettingsCategory = 'all';
	public revision = 0;
	public readonly visible: Setting[] = [...SETTINGS];
	public filter(query: string, category: SettingsCategory): void {
		if (this.query === query && this.category === category) return;
		this.query = query; this.category = category;
		const words = query.toLowerCase().trim().split(/\s+/);
		this.visible.length = 0;
		for (let index = 0; index < SETTINGS.length; index++) {
			const setting = SETTINGS[index];
			if ((category === 'all' || category === setting.category) && words.every(word => SEARCH_TEXT[index].includes(word))) this.visible.push(setting);
		}
		this.revision++;
	}
}
