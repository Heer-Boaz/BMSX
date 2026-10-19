import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeHTML, decodeHTMLAttribute, escapeAttribute, escapeText } from 'entities';
import GithubSlugger from 'github-slugger';
import { Marked } from 'marked';
import { chromium } from 'playwright';
import { finishManualPdf, manualLinkBase } from './pdf.mjs';

function headingText(tokens, renderer) {
	let text = '';
	for (const token of tokens) {
		switch (token.type) {
			case 'link':
			case 'image':
			case 'strong':
			case 'em':
			case 'del':
				text += headingText(token.tokens, renderer);
				break;
			case 'text':
				text += token.tokens ? headingText(token.tokens, renderer) : decodeHTML(renderer.text(token));
				break;
			case 'codespan':
			case 'escape':
				text += token.text;
				break;
		}
	}
	return text;
}

export function chapterHtml(chapter, mode) {
	const preview = mode === 'preview';
	const slugger = new GithubSlugger();
	const authoredTargets = new Set();
	const parser = new Marked({
		renderer: {
			heading({ tokens, depth }) {
				const id = slugger.slug(headingText(tokens, this).trim());
				// Preserve explicit source targets without shifting duplicate-heading suffixes.
				const target = authoredTargets.has(id) ? '' : ` id="${escapeAttribute(id)}"`;
				return `<h${depth}${target}>${this.parser.parseInline(tokens)}</h${depth}>\n`;
			},
			image({ href, tokens }) {
				if (href.endsWith('.png')) {
					const alt = escapeAttribute(decodeHTML(this.parser.parseInline(tokens, this.parser.textRenderer)));
					return `<span class="manual-figure"><img src="data:image/png;base64,${chapter.figures.get(href).toString('base64')}" alt="${alt}"></span>`;
				}
				// Inline authored SVG so body and figure
				// lettering use the same bundled fonts, without external resources.
				return `<span class="manual-figure">${chapter.figures.get(href).toString('utf8')}</span>`;
			},
			link({ href, title, tokens }) {
				let documentFormat = '';
				if (!href.startsWith('#')) {
					const target = new URL(href, chapter.sourceURL);
					if (target.protocol === 'file:') {
						const fragment = target.hash;
						const query = target.search;
						target.hash = '';
						target.search = '';
						const document = chapter.documents.get(target.href);
						href = `${document.id}${preview ? '.preview' : ''}.html${query}${fragment}`;
						documentFormat = ` data-manual-format="${document.format}"`;
					}
				}
				const titleAttribute = title === null ? '' : ` title="${escapeAttribute(title)}"`;
				return `<a href="${escapeAttribute(href)}"${titleAttribute}${documentFormat}>${this.parser.parseInline(tokens)}</a>`;
			},
		},
	});
	parser.walkTokens(chapter.tokens, token => {
		if (token.type === 'html') {
			const anchor = /^<a id="([^"]+)">$/.exec(token.text);
			if (anchor) authoredTargets.add(decodeHTMLAttribute(anchor[1]));
		}
	});
	const stylesheet = chapter.stylesheet.replace(/url\("([^"]+)"\)/g, (_, href) =>
		`url("data:font/ttf;base64,${chapter.fonts.get(href).toString('base64')}")`);
	const volume = chapter.runningTitle;
	const title = `BMSX ${volume} — ${chapter.entry.label}${preview ? ' — DRAFT' : ''}`;
	const footer = chapter.entry.label + (preview ? ' — DRAFT / NOT FOR PUBLICATION' : '');
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeText(title)}</title>
<style>${stylesheet}
@page {
	@top-right { content: ${JSON.stringify(volume.toUpperCase())}; }
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
			for (const element of document.querySelectorAll('main pre, main table, main p, main li, main h1, main h2, main h3, main h4, main svg, main img')) {
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
				figures: document.querySelectorAll('.manual-figure svg, .manual-figure img').length,
				registerEntries: document.querySelectorAll('.register-entry').length,
				errors,
			};
		});
		if (layout.errors.length !== 0) {
			throw new Error(`Manual layout failed:\n${layout.errors.join('\n')}`);
		}
		const headingTargets = await page.evaluate(base => {
			const headings = new Map([...document.querySelectorAll('main h1, main h2, main h3, main h4, main h5, main h6')]
				.map(heading => [heading, heading.id === '' ? [] : [heading.id]]));
			for (const anchor of document.querySelectorAll('main a[id]')) {
				const paragraph = anchor.parentElement;
				const marker = paragraph.tagName === 'P' && paragraph.textContent.trim() === '' ? paragraph : anchor;
				if (anchor.textContent === '' && headings.has(marker.nextElementSibling)) {
					headings.get(marker.nextElementSibling).push(anchor.id);
				}
			}
			for (const link of document.querySelectorAll('main a[data-manual-format]')) {
				const target = new URL(link.getAttribute('href'), base);
				if (link.dataset.manualFormat === 'pdf') {
					target.pathname = target.pathname.replace(/\.html$/, '.pdf');
					if (target.hash !== '') target.hash = `nameddest=${target.hash.slice(1)}`;
				}
				link.href = target.href;
			}
			return [...headings.values()];
		}, manualLinkBase);
		const pdf = await page.pdf({
			preferCSSPageSize: true,
			printBackground: true,
			tagged: true,
			outline: true,
		});
		await writeFile(`${stem}.pdf`, await finishManualPdf(pdf, headingTargets));
		const receipt = {
			chapter: chapter.id, mode, layout,
			engine: { chromium: browser.version(), node: process.version, platform: process.platform, arch: process.arch },
		};
		await writeFile(`${stem}.json`, JSON.stringify(receipt, null, '\t') + '\n');
		return { pdf: `${stem}.pdf`, html: `${stem}.html`, receipt: `${stem}.json`, layout };
	} finally {
		await browser.close();
	}
}
