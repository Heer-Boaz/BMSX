import { escapeAttribute, escapeText } from 'entities';

import { BrowserKeyboardAction, BROWSER_KEYBOARD_KEY_LABELS, BROWSER_KEYBOARD_PAGES } from '../../hosts/browser/onscreen_keyboard_layout';
import { ON_SCREEN_KEY_DEFINITIONS } from '../../hosts/common/input/on_screen_keyboard_keys';
import { applyTemplateValues } from './html_template';

/** Expands gamebase.html's authored fragments at package time, never in the browser. */
export function expandBrowserKeyboardTemplate(html: string): string {
	const fragments: Record<string, string> = {};
	const shell = html.replace(/<template data-bmsx-keyboard="([^"]+)">([\s\S]*?)<\/template>/g,
		(_match, name: string, content: string) => {
			fragments[name] = content.trim();
			return '';
		});
	const pages: string[] = [];
	for (let pageIndex = 0; pageIndex < BROWSER_KEYBOARD_PAGES.length; pageIndex += 1) {
		const page = BROWSER_KEYBOARD_PAGES[pageIndex];
		const nextPage = BROWSER_KEYBOARD_PAGES[(pageIndex + 1) % BROWSER_KEYBOARD_PAGES.length];
		const rows: string[] = [];
		let units = 0;
		for (const row of page.rows) {
			units = Math.max(units, row.units);
			const slots: { start: number; html: string }[] = [];
			for (let column = 0; column < row.keys.length; column += 1) {
				const key = row.keys[column];
				const definition = ON_SCREEN_KEY_DEFINITIONS[key];
				const label = BROWSER_KEYBOARD_KEY_LABELS[key];
				slots.push({ start: row.starts[column], html: applyTemplateValues(fragments.key, {
					'@@START@@': String(row.starts[column]),
					'@@SPAN@@': String(row.spans[column]),
					'@@KEY@@': String(key),
					'@@PAGE@@': String(pageIndex),
					'@@CODE@@': escapeAttribute(definition.code),
					'@@DESCRIPTION@@': escapeAttribute(definition.label),
					'@@WIDE@@': String(label.length > 1),
					'@@LABEL@@': escapeText(label),
				}) });
			}
			for (const control of row.controls) {
				const fragment = control.action === BrowserKeyboardAction.NextPage ? fragments.mode : fragments.close;
				slots.push({ start: control.start, html: applyTemplateValues(fragment, {
					'@@START@@': String(control.start),
					'@@SPAN@@': String(control.span),
					'@@ACTION@@': String(control.action),
					'@@DESCRIPTION@@': escapeAttribute(nextPage.description),
					'@@LABEL@@': escapeText(nextPage.label),
				}) });
			}
			// Reading order follows the visual row, including non-key command slots.
			slots.sort((a, b) => a.start - b.start);
			rows.push(applyTemplateValues(fragments.row, {
				'@@UNITS@@': String(row.units),
				'@@SLOTS@@': slots.map(slot => slot.html).join('\n'),
			}));
		}
		pages.push(applyTemplateValues(fragments.page, {
			'@@PAGE@@': String(pageIndex),
			'@@UNITS@@': String(units),
			'@@ROWS@@': rows.join('\n'),
		}));
	}
	return applyTemplateValues(shell, { '@@BMSX_TOUCH_KEYBOARD_PAGES@@': pages.join('\n') });
}
