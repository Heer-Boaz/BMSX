import { escapeAttribute, escapeText } from 'entities';

import { BROWSER_KEYBOARD_KEY_LABELS, BROWSER_KEYBOARD_PAGES } from '../../hosts/browser/onscreen_keyboard_layout';
import { ON_SCREEN_KEY_DEFINITIONS } from '../../hosts/common/input/on_screen_keyboard_keys';

/** Package-time presentation of the same authored rows consumed by controller navigation. */
export function renderBrowserKeyboardPages(): string {
	const markup: string[] = [];
	for (let pageIndex = 0; pageIndex < BROWSER_KEYBOARD_PAGES.length; pageIndex += 1) {
		const page = BROWSER_KEYBOARD_PAGES[pageIndex];
		let units = 0;
		for (const row of page.rows) units = Math.max(units, row.units);
		markup.push(`<div class="bmsx-touch-keyboard-page" data-page="${pageIndex}" style="--page-units:${units}" hidden>`);
		for (const row of page.rows) {
			markup.push(`<div class="bmsx-touch-keyboard-row" style="--row-units:${row.units}">`);
			for (let column = 0; column < row.keys.length; column += 1) {
				const key = row.keys[column];
				const definition = ON_SCREEN_KEY_DEFINITIONS[key];
				const label = BROWSER_KEYBOARD_KEY_LABELS[key];
				markup.push(`<div class="bmsx-touch-keyboard-slot" style="--key-span:${row.spans[column]}">`
					+ `<button type="button" tabindex="-1" class="bmsx-touch-key" data-key="${key}" data-page="${pageIndex}"`
					+ ` data-code="${escapeAttribute(definition.code)}" aria-label="${escapeAttribute(definition.label)}"`
					+ ` aria-pressed="false" data-selected="false" data-highlighted="false" data-wide-label="${label.length > 1 ? 'true' : 'false'}">`
					+ `${escapeText(label)}</button></div>`);
			}
			markup.push('</div>');
		}
		markup.push('</div>');
	}
	return markup.join('\n');
}
