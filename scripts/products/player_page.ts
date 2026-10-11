import { escapeUTF8 } from 'entities';

export const PLAYER_MANIFEST = 'manifest.webmanifest';
export const PLAYER_INPUT_TRACE_SCRIPT = 'input-trace.js';
/** Only the player template contains this slot; packaging fills it from the cartridge title. */
export const PLAYER_TITLE_SLOT = '{{BMSX_TITLE}}';
export const PLAYER_CARTRIDGE_SLOT = '{{BMSX_CARTRIDGE}}';
export const PLAYER_SYSTEM_ROM_SLOT = '{{BMSX_SYSTEM_ROM}}';

/** Titles and media URLs occupy HTML text or quoted attributes, never executable JavaScript. */
export function renderPlayerPage(template: string, title: string, cartridgeUrl: string, systemRomUrl: string): string {
	const values: Readonly<Record<string, string>> = {
		[PLAYER_TITLE_SLOT]: title,
		[PLAYER_CARTRIDGE_SLOT]: cartridgeUrl,
		[PLAYER_SYSTEM_ROM_SLOT]: systemRomUrl,
	};
	return template.replace(/\{\{BMSX_(?:TITLE|CARTRIDGE|SYSTEM_ROM)\}\}/g, slot => escapeUTF8(values[slot]));
}

/** HTML title and manifest name come from the same cartridge title. */
export function renderPlayerManifest(manifest: string, title: string): string {
	return JSON.stringify({ ...JSON.parse(manifest), name: title, short_name: title }, null, '\t');
}
