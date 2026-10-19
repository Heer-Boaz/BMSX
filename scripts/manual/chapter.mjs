import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { marked } from 'marked';

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export const reviewKinds = ['facts', 'figures', 'print'];
export const developmentGuide = {
	id: 'getting-started',
	entry: { chapter: 'docs/programming/getting-started.md', label: 'GETTING STARTED' },
};

export async function loadChapter(root, id) {
	const catalog = JSON.parse(await readFile(resolve(root, 'docs/manual/catalog.json'), 'utf8'));
	if (!Object.hasOwn(catalog, id)) {
		throw new Error(`Unknown manual chapter ${id}. Available: ${Object.keys(catalog).join(', ')}`);
	}
	const entry = catalog[id];
	const [document, volumes] = await Promise.all([
		loadDocument(root, id, entry, catalog),
		readFile(resolve(root, 'docs/manual/volumes.json'), 'utf8'),
	]);
	const volumeTitle = JSON.parse(volumes)[entry.book];
	return { ...document, volumeTitle, runningTitle: `Book ${entry.book} · ${volumeTitle}`, review: entry.review };
}

export async function loadDevelopmentGuide(root) {
	const catalog = JSON.parse(await readFile(resolve(root, 'docs/manual/catalog.json'), 'utf8'));
	const document = await loadDocument(root, developmentGuide.id, developmentGuide.entry, catalog);
	return { ...document, runningTitle: 'Development companion' };
}

export async function loadContents(root) {
	const [catalog, volumes] = await Promise.all([
		readFile(resolve(root, 'docs/manual/catalog.json'), 'utf8').then(JSON.parse),
		readFile(resolve(root, 'docs/manual/volumes.json'), 'utf8').then(JSON.parse),
	]);
	const titles = new Map(await Promise.all([...Object.values(catalog), developmentGuide.entry].map(async entry => {
		const tokens = marked.lexer(await readFile(resolve(root, entry.chapter), 'utf8'));
		return [entry.chapter, tokens.find(token => token.type === 'heading' && token.depth === 1).text];
	})));
	let markdown = '# BMSX Developer References\n\n';
	for (const [book, title] of Object.entries(volumes)) {
		markdown += `## Book ${book} · ${title}\n\n`;
		for (const entry of Object.values(catalog)) {
			if (entry.book === book) {
				markdown += `- [${titles.get(entry.chapter)}](${pathToFileURL(resolve(root, entry.chapter)).href})\n`;
			}
		}
		markdown += '\n';
	}
	markdown += `## Development companion\n\n- [${titles.get(developmentGuide.entry.chapter)}](${pathToFileURL(resolve(root, developmentGuide.entry.chapter)).href})\n`;
	const document = await loadDocument(root, 'contents', {
		chapter: 'docs/manual/catalog.json', label: 'CONTENTS',
	}, catalog, markdown);
	return { ...document, runningTitle: 'Developer References' };
}

async function loadDocument(root, id, entry, catalog, source = readFile(resolve(root, entry.chapter), 'utf8')) {
	const [markdown, stylesheet] = await Promise.all([
		source,
		readFile(resolve(root, 'docs/manual/print.css'), 'utf8'),
	]);
	const tokens = marked.lexer(markdown);
	const chapterURL = pathToFileURL(resolve(root, entry.chapter));
	const documents = new Map(Object.entries(catalog).map(([id, entry]) =>
		[pathToFileURL(resolve(root, entry.chapter)).href, { id, format: 'pdf' }]));
	documents.set(pathToFileURL(resolve(root, developmentGuide.entry.chapter)).href,
		{ id: developmentGuide.id, format: 'html' });
	const stylesheetURL = pathToFileURL(resolve(root, 'docs/manual/print.css'));
	const figureHrefs = new Set();
	marked.walkTokens(tokens, token => {
		if (token.type === 'image') {
			figureHrefs.add(token.href);
		}
	});
	const fontHrefs = new Set([...stylesheet.matchAll(/url\("([^"]+)"\)/g)].map(([, href]) => href));
	const [figures, fonts] = await Promise.all([
		Promise.all([...figureHrefs].map(async href => [href, await readFile(new URL(href, chapterURL))])),
		Promise.all([...fontHrefs].map(async href => [href, await readFile(new URL(href, stylesheetURL))])),
	]);
	return { id, entry, sourceURL: chapterURL, documents, tokens, stylesheet, figures: new Map(figures), fonts: new Map(fonts) };
}

export function publicationFailures(chapter) {
	const failures = [...chapter.review.open];
	for (const kind of reviewKinds) {
		const review = chapter.review.reviews[kind];
		if (!review.passed) {
			failures.push(`${kind} review: pending`);
		} else if (review.evidence === '') {
			failures.push(`${kind} review: no evidence recorded`);
		}
	}
	return failures;
}
