import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { marked } from 'marked';

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export const coverageTopics = [
	'boundary', 'registers', 'datapath', 'visibility', 'timing',
	'interrupts', 'faults', 'reset', 'programming',
];
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
	const [document, review, volumes] = await Promise.all([
		loadDocument(root, id, entry, catalog),
		readFile(resolve(root, entry.review), 'utf8'),
		readFile(resolve(root, 'docs/manual/volumes.json'), 'utf8'),
	]);
	const volumeTitle = JSON.parse(volumes)[entry.book];
	return { ...document, volumeTitle, runningTitle: `Book ${entry.book} · ${volumeTitle}`, review: JSON.parse(review) };
}

export async function loadDevelopmentGuide(root) {
	const catalog = JSON.parse(await readFile(resolve(root, 'docs/manual/catalog.json'), 'utf8'));
	const document = await loadDocument(root, developmentGuide.id, developmentGuide.entry, catalog);
	return { ...document, runningTitle: 'Development companion' };
}

async function loadDocument(root, id, entry, catalog) {
	const [markdown, stylesheet] = await Promise.all([
		readFile(resolve(root, entry.chapter), 'utf8'),
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

export async function publicationFailures(root, chapter) {
	const failures = [];
	for (const topic of coverageTopics) {
		const coverage = chapter.review.coverage[topic];
		if (coverage.resolution === '') {
			failures.push(`${topic}: no coverage decision recorded`);
		}
		for (const gap of coverage.open) {
			failures.push(`${topic}: ${gap}`);
		}
	}
	for (const kind of reviewKinds) {
		const review = chapter.review.reviews[kind];
		if (!review.passed) {
			failures.push(`${kind} review: pending`);
		} else if (review.report === '') {
			failures.push(`${kind} review: no evidence report recorded`);
		} else {
			// A missing report is a build error, not an implicit approval.
			await access(resolve(root, review.report));
		}
	}
	return failures;
}
