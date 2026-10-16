import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { escapeAttribute, escapeText } from 'entities';
import { Marked } from 'marked';
import { chromium } from 'playwright';

export function chapterHtml(chapter, mode) {
	const parser = new Marked({
		renderer: {
			image({ href }) {
				// Manual figures are authored SVG. Inline them so body and figure
				// lettering use the same bundled fonts, without external resources.
				return `<span class="manual-figure">${chapter.files.get(chapter.figures.get(href)).toString('utf8')}</span>`;
			},
		},
	});
	const stylesheet = chapter.stylesheet.replace(/url\("([^"]+)"\)/g, (_, href) =>
		`url("data:font/ttf;base64,${chapter.files.get(chapter.fonts.get(href)).toString('base64')}")`);
	const preview = mode === 'preview';
	const title = `BMSX Book ${chapter.entry.book} — ${chapter.entry.label}${preview ? ' — DRAFT' : ''}`;
	const footer = chapter.entry.label + (preview ? ' — DRAFT / NOT FOR PUBLICATION' : '');
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="manual-input-fingerprint" content="${escapeAttribute(chapter.fingerprint)}">
<title>${escapeText(title)}</title>
<style>${stylesheet}
@page {
	@top-right { content: ${JSON.stringify(`BOOK ${chapter.entry.book} · HARDWARE REFERENCE`)}; }
	@bottom-left { content: ${JSON.stringify(footer)}; }
}
</style>
</head>
<body>
<main>
${preview ? '<p class="draft-status">DRAFT — NOT FOR PUBLICATION</p>' : ''}
${parser.parser(chapter.tokens)}
</main>
</body>
</html>
`;
}

export async function renderChapter(chapter, mode, outputDirectory) {
	const stem = resolve(outputDirectory, `${chapter.id}${mode === 'preview' ? '.preview' : ''}`);
	const html = chapterHtml(chapter, mode);
	await mkdir(outputDirectory, { recursive: true });
	await writeFile(`${stem}.html`, html);
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 800, height: 1100 } });
		await page.emulateMedia({ media: 'print' });
		await page.setContent(html, { waitUntil: 'load' });
		await page.evaluate(() => document.fonts.ready);
		const layout = await page.evaluate(() => {
			const errors = [];
			const area = document.querySelector('main').getBoundingClientRect();
			// A4 minus the 19 mm top and 18 mm bottom margins in print.css.
			const pageHeight = CSSNumericValue.parse('260mm').to('px').value;
			for (const element of document.querySelectorAll('main pre, main table, main p, main li, main h1, main h2, main h3, main h4, main svg')) {
				const bounds = element.getBoundingClientRect();
				if (bounds.left < area.left - 1 || bounds.right > area.right + 1 ||
					(element.tagName !== 'svg' && element.scrollWidth > element.clientWidth + 1)) {
					errors.push(`Horizontal overflow: ${element.tagName} ${element.textContent.trim().slice(0, 100)}`);
				}
			}
			for (const element of document.querySelectorAll('pre, table, .register-entry, .keep-together, .manual-figure')) {
				if (element.getBoundingClientRect().height > pageHeight + 1) {
					errors.push(`Unbreakable block exceeds a page: ${element.className || element.tagName}`);
				}
			}
			for (const svg of document.querySelectorAll('.manual-figure svg')) {
				const bounds = svg.getBoundingClientRect();
				for (const text of svg.querySelectorAll('text')) {
					const label = text.getBoundingClientRect();
					if (label.left < bounds.left - 1 || label.right > bounds.right + 1 ||
						label.top < bounds.top - 1 || label.bottom > bounds.bottom + 1) {
						errors.push(`Figure label outside viewBox: ${text.textContent}`);
					}
				}
			}
			return {
				figures: document.querySelectorAll('.manual-figure svg').length,
				registerEntries: document.querySelectorAll('.register-entry').length,
				errors,
			};
		});
		if (layout.errors.length !== 0) {
			throw new Error(`Manual layout failed:\n${layout.errors.join('\n')}`);
		}
		await page.pdf({
			path: `${stem}.pdf`,
			preferCSSPageSize: true,
			printBackground: true,
			tagged: true,
			outline: true,
		});
		const receipt = {
			chapter: chapter.id, mode, fingerprint: chapter.fingerprint,
			inputs: chapter.inputs, layout,
			engine: { chromium: browser.version(), node: process.version, platform: process.platform, arch: process.arch },
		};
		await writeFile(`${stem}.json`, JSON.stringify(receipt, null, '\t') + '\n');
		return { pdf: `${stem}.pdf`, html: `${stem}.html`, receipt: `${stem}.json`, layout };
	} finally {
		await browser.close();
	}
}
