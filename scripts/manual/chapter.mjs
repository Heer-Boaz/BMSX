import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { marked } from 'marked';

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export const coverageTopics = [
	'boundary', 'registers', 'datapath', 'visibility', 'timing',
	'interrupts', 'faults', 'reset', 'programming',
];
export const reviewKinds = ['facts', 'figures', 'print'];

// These are publication inputs, not device facts. Review approvals themselves
// are excluded so that signing an input fingerprint does not change it.
const publicationFiles = [
	'docs/manual/README.md',
	'docs/manual/review-template.json',
	'docs/manual/print.css',
	'docs/manual/fonts/LICENSE',
	'scripts/manual/chapter.mjs',
	'scripts/manual/render.mjs',
	'scripts/manual/build.mjs',
	'package-lock.json',
];

export async function loadChapter(root, id) {
	const catalog = JSON.parse(await readFile(resolve(root, 'docs/manual/catalog.json'), 'utf8'));
	if (!Object.hasOwn(catalog, id)) {
		throw new Error(`Unknown manual chapter ${id}. Available: ${Object.keys(catalog).join(', ')}`);
	}
	const entry = catalog[id];
	const review = JSON.parse(await readFile(resolve(root, entry.review), 'utf8'));
	const files = new Map();
	for (const path of [entry.chapter, entry.facts, 'docs/manual/print.css']) {
		files.set(path, await readFile(resolve(root, path)));
	}
	const markdown = files.get(entry.chapter).toString('utf8');
	const tokens = marked.lexer(markdown);
	const factTokens = marked.lexer(files.get(entry.facts).toString('utf8'));
	const stylesheet = files.get('docs/manual/print.css').toString('utf8');
	const chapterURL = pathToFileURL(resolve(root, entry.chapter));
	const factsURL = pathToFileURL(resolve(root, entry.facts));
	const stylesheetURL = pathToFileURL(resolve(root, 'docs/manual/print.css'));
	const figures = new Map();
	const fonts = new Map();
	const sources = new Set();

	marked.walkTokens(tokens, token => {
		if (token.type === 'image') {
			figures.set(token.href, relative(root, fileURLToPath(new URL(token.href, chapterURL))));
		}
	});
	// Include reference definitions as well as inline links, even when a source
	// reference is not currently used by the prose. Native URLs own resolution.
	for (const link of Object.values(factTokens.links)) {
		sources.add(relative(root, fileURLToPath(new URL(link.href, factsURL))));
	}
	marked.walkTokens(factTokens, token => {
		if (token.type === 'link') {
			sources.add(relative(root, fileURLToPath(new URL(token.href, factsURL))));
		}
	});
	for (const [, href] of stylesheet.matchAll(/url\("([^"]+)"\)/g)) {
		fonts.set(href, relative(root, fileURLToPath(new URL(href, stylesheetURL))));
	}

	const paths = [...new Set([
		...publicationFiles, entry.chapter, entry.facts,
		...figures.values(), ...fonts.values(), ...sources,
	])].sort();
	await Promise.all(paths.filter(path => !files.has(path)).map(async path => {
		files.set(path, await readFile(resolve(root, path)));
	}));
	const inputs = paths.map(path => ({
		path,
		sha256: createHash('sha256').update(files.get(path)).digest('hex'),
	}));
	const fingerprint = createHash('sha256')
		.update(JSON.stringify({ id, entry, coverage: review.coverage, inputs }))
		.digest('hex');
	return { id, entry, review, markdown, tokens, stylesheet, files, figures, fonts, inputs, fingerprint };
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
		if (review.fingerprint !== chapter.fingerprint) {
			failures.push(`${kind} review: missing or for different inputs`);
		}
		if (review.report === '') {
			failures.push(`${kind} review: no evidence report recorded`);
		} else {
			// A missing report is a build error, not an implicit approval.
			await readFile(resolve(root, review.report));
		}
	}
	return failures;
}
