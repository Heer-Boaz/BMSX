import { escapeAttribute } from 'entities';
import type { StudioConfiguration } from '../../ide/common/studio_configuration';

export const STUDIO_CONFIGURATION_ELEMENT = '<meta id="bmsx-studio-configuration" data-settings="{{STUDIO_CONFIGURATION}}">';
export const STANDALONE_STUDIO_CONFIGURATION: StudioConfiguration = { workspace: { kind: 'browser' } };

export const STUDIO_PAGES = [
	{ debug: false, page: 'studio.html', template: 'studio.template.html' },
	{ debug: true, page: 'studio.debug.html', template: 'studio.debug.template.html' },
] as const;

/** Only the product template contains this slot; values occupy a quoted HTML attribute. */
export function renderStudioPage(template: string, configuration: StudioConfiguration): string {
	return template.replace('{{STUDIO_CONFIGURATION}}', () => escapeAttribute(JSON.stringify(configuration)));
}
