import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, appendFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { coverageTopics, loadChapter, publicationFailures, repositoryRoot, reviewKinds } from '../../scripts/manual/chapter.mjs';
import { chapterHtml, renderChapter } from '../../scripts/manual/render.mjs';

const sampleFigure = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 50" role="img"><title>Fixture figure</title><text x="10" y="25">Fixture</text></svg>';
const sampleChapter = `# Sample Unit

## Operation

This is a publication fixture, not a hardware specification.

![Fixture figure](figures/sample.svg)

<section class="register-entry">

### 8.7. MODE

| Address | Name | Access | Reset |
|---|---|---|---|
| 00000000H | MODE | R/W | 00000000H |

\`\`\`text
31:1 | 0
  R  | E
\`\`\`

</section>
`;

async function fixture(t, chapterSource = sampleChapter) {
	const root = await mkdtemp(join(tmpdir(), 'bmsx manual '));
	t.after(() => rm(root, { recursive: true, force: true }));
	await cp(resolve(repositoryRoot, 'docs/manual'), join(root, 'docs/manual'), { recursive: true });
	const entry = {
		book: 'II', label: 'SAMPLE', chapter: 'docs/book2/sample.md',
		facts: 'docs/book2/facts/sample.md', review: 'docs/book2/reviews/sample.json',
	};
	const review = JSON.parse(await readFile(join(root, 'docs/manual/review-template.json'), 'utf8'));
	for (const coverage of Object.values(review.coverage)) {
		coverage.resolution = 'Synthetic fixture coverage; no BMSX hardware claim.';
	}
	const files = {
		'docs/manual/catalog.json': JSON.stringify({ sample: entry }),
		[entry.chapter]: chapterSource,
		[entry.facts]: '# Fixture facts\n\nThe factual review is separate from printing.\n',
		[entry.review]: JSON.stringify(review),
		'docs/book2/figures/sample.svg': sampleFigure,
		'docs/book2/reviews/evidence.md': '# Synthetic review evidence\n\nOnly the test fixture is approved here.\n',
	};
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), content);
	}
	return root;
}

async function approveFixture(root) {
	const chapter = await loadChapter(root, 'sample');
	for (const kind of reviewKinds) {
		chapter.review.reviews[kind] = {
			passed: true,
			report: 'docs/book2/reviews/evidence.md',
		};
	}
	await writeFile(join(root, chapter.entry.review), JSON.stringify(chapter.review));
	return loadChapter(root, 'sample');
}

test('review template has every required contract topic and review pass', async () => {
	const review = JSON.parse(await readFile(resolve(repositoryRoot, 'docs/manual/review-template.json'), 'utf8'));
	assert.deepEqual(Object.keys(review.coverage), coverageTopics);
	assert.deepEqual(Object.keys(review.reviews), reviewKinds);
	assert.ok(Object.values(review.coverage).every(topic => topic.resolution === '' && topic.open.length === 0));
	assert.ok(Object.values(review.reviews).every(pass => pass.passed === false && pass.report === ''));
});

test('publication requires explicit coverage, closed questions, and passed reviews with evidence', async t => {
	const root = await fixture(t);
	let chapter = await loadChapter(root, 'sample');
	assert.deepEqual(await publicationFailures(root, chapter), reviewKinds.map(kind => `${kind} review: pending`));
	chapter = await approveFixture(root);
	assert.deepEqual(await publicationFailures(root, chapter), []);
	chapter.review.coverage.visibility.open.push('Exact latch edge is not established.');
	chapter.review.coverage.faults.resolution = '';
	assert.deepEqual(await publicationFailures(root, chapter), [
		'visibility: Exact latch edge is not established.',
		'faults: no coverage decision recorded',
	]);
	chapter.review.reviews.figures.passed = false;
	assert.ok((await publicationFailures(root, chapter)).includes('figures review: pending'));
	chapter.review.reviews.print.report = '';
	assert.ok((await publicationFailures(root, chapter)).includes('print review: no evidence report recorded'));
	chapter.review.reviews.print.report = 'docs/book2/reviews/missing.md';
	await assert.rejects(publicationFailures(root, chapter), { code: 'ENOENT' });
});

test('styling can reopen print review without invalidating facts or figure semantics', async t => {
	const root = await fixture(t);
	const chapter = await approveFixture(root);
	await appendFile(join(root, 'docs/manual/print.css'), '\nh1 { letter-spacing: .5pt; }\n');
	const changed = await loadChapter(root, 'sample');
	assert.match(changed.stylesheet, /letter-spacing: \.5pt/);
	assert.deepEqual(changed.review.reviews, chapter.review.reviews);
	changed.review.reviews.print.passed = false;
	await writeFile(join(root, changed.entry.review), JSON.stringify(changed.review));
	const reopened = await loadChapter(root, 'sample');
	assert.deepEqual(await publicationFailures(root, reopened), ['print review: pending']);
	assert.equal(reopened.review.reviews.facts.passed, true);
	assert.equal(reopened.review.reviews.figures.passed, true);
});

test('missing print assets fail instead of producing a partial chapter', async t => {
	const root = await fixture(t);
	await rm(join(root, 'docs/book2/figures/sample.svg'));
	await assert.rejects(loadChapter(root, 'sample'), { code: 'ENOENT' });
	await assert.rejects(loadChapter(root, 'not-a-chapter'), /Unknown manual chapter/);
});

test('HTML is self-contained, preserves author grouping at any heading number, and distinguishes previews', async t => {
	const root = await fixture(t);
	const chapter = await loadChapter(root, 'sample');
	const preview = chapterHtml(chapter, 'preview');
	assert.match(preview, /BMSX Book II — SAMPLE — DRAFT/);
	assert.match(preview, /<p class="draft-status">DRAFT — NOT FOR PUBLICATION<\/p>/);
	assert.match(preview, /SAMPLE — DRAFT \/ NOT FOR PUBLICATION/);
	assert.match(preview, /<section class="register-entry">\s*<h3>8\.7\. MODE<\/h3>/);
	assert.match(preview, /<svg xmlns=/);
	assert.match(preview, /data:font\/ttf;base64,/);
	assert.doesNotMatch(preview, /<img|file:\/\/|url\("fonts\//);
	const publication = chapterHtml(chapter, 'publish');
	assert.doesNotMatch(publication, /DRAFT|class="draft-status"/);
	assert.match(publication, /content: "SAMPLE"/);
});

test('Chromium prints a tagged/outlined portable PDF and a compact layout/engine receipt', async t => {
	const root = await fixture(t);
	const chapter = await approveFixture(root);
	assert.deepEqual(await publicationFailures(root, chapter), []);
	const output = await renderChapter(chapter, 'publish', join(root, 'build/manual'));
	const pdf = await readFile(output.pdf);
	assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
	const pdfText = pdf.toString('latin1');
	assert.ok(pdfText.includes('/StructTreeRoot'), 'PDF has accessibility tags');
	assert.ok(pdfText.includes('/Outlines'), 'PDF has a heading outline');
	const [, width, height] = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdfText);
	assert.ok(Math.abs(Number(width) - 210 * 72 / 25.4) < 1, 'A4 page width');
	assert.ok(Math.abs(Number(height) - 297 * 72 / 25.4) < 1, 'A4 page height');
	assert.deepEqual(output.layout, { figures: 1, registerEntries: 1, errors: [] });
	const receipt = JSON.parse(await readFile(output.receipt, 'utf8'));
	assert.deepEqual(Object.keys(receipt), ['chapter', 'mode', 'layout', 'engine']);
	assert.equal(receipt.mode, 'publish');
	assert.equal(receipt.engine.node, process.version);
	assert.match(receipt.engine.chromium, /^\d+\./);
	assert.doesNotMatch(await readFile(output.html, 'utf8'), /DRAFT/);
});

test('figures are not hardcoded to three and repeated figure uses remain valid', async t => {
	for (const [name, markdown, count] of [
		['no figures', '# No Figures\n\nOrdinary text.\n', 0],
		['reused figure', '# Two Figures\n\n![First](figures/sample.svg)\n\n![Again](figures/sample.svg)\n', 2],
	]) {
		await t.test(name, async t => {
			const root = await fixture(t, markdown);
			const chapter = await loadChapter(root, 'sample');
			const result = await renderChapter(chapter, 'preview', join(root, 'build/manual'));
			assert.equal(result.layout.figures, count);
		});
	}
});

test('layout errors prevent a PDF/receipt: overflow, oversized groups, and clipped labels', async t => {
	for (const [name, markdown, figure, expected] of [
		['wide bit layout', '# Overflow\n\n```text\n' + 'X'.repeat(160) + '\n```\n', sampleFigure, /Horizontal overflow: PRE/],
		['overheight register', '# Tall\n\n<section class="register-entry">\n\n' + 'Paragraph.\n\n'.repeat(100) + '</section>\n', sampleFigure, /Unbreakable block exceeds a page/],
		['clipped figure label', sampleChapter, sampleFigure.replace('x="10"', 'x="195"'), /Figure label outside viewBox/],
	]) {
		await t.test(name, async t => {
			const root = await fixture(t, markdown);
			await writeFile(join(root, 'docs/book2/figures/sample.svg'), figure);
			const chapter = await loadChapter(root, 'sample');
			const directory = join(root, 'build/manual');
			await assert.rejects(renderChapter(chapter, 'preview', directory), expected);
			await assert.rejects(access(join(directory, 'sample.preview.pdf')), { code: 'ENOENT' });
			await assert.rejects(access(join(directory, 'sample.preview.json')), { code: 'ENOENT' });
		});
	}
});

test('reviewed PCRTC uses the shared publisher with its hardware coverage closed', async t => {
	const chapter = await loadChapter(repositoryRoot, 'pcrtc');
	assert.equal(Object.values(chapter.review.coverage).flatMap(topic => topic.open).length, 0);
	assert.deepEqual(await publicationFailures(repositoryRoot, chapter), []);
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-pcrtc-preview-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const output = await renderChapter(chapter, 'preview', directory);
	assert.deepEqual(output.layout, { figures: 3, registerEntries: 13, errors: [] });

	// Inspect the browser's actual font use, not merely computed CSS family names.
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage();
	await page.setContent(await readFile(output.html, 'utf8'));
	await page.evaluate(() => document.fonts.ready);
	assert.equal(await page.locator('table.bit-fields').count(), 26, 'each PCRTC word has a real bit-field table');
	const session = await page.context().newCDPSession(page);
	await session.send('DOM.enable');
	await session.send('CSS.enable');
	const { root } = await session.send('DOM.getDocument');
	for (const selector of ['p', 'pre code', 'svg text']) {
		const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector });
		const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
		assert.ok(fonts.length > 0);
		assert.ok(fonts.every(font => font.isCustomFont), `${selector} must use bundled fonts`);
	}
});

test('CLI checks/publishes reviewed PCRTC from a different working directory', () => {
	for (const mode of ['check', 'publish']) {
		const result = spawnSync(process.execPath, [resolve(repositoryRoot, 'scripts/manual/build.mjs'), mode, 'pcrtc'], {
			cwd: tmpdir(), encoding: 'utf8',
		});
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /Fact sheet: docs\/book1\/facts\/pcrtc\.md/);
		assert.doesNotMatch(result.stderr, /Publication blocked:/);
		if (mode === 'publish') assert.match(result.stdout, /Published chapter:/);
	}
	const usage = spawnSync(process.execPath, [resolve(repositoryRoot, 'scripts/manual/build.mjs')], { encoding: 'utf8' });
	assert.equal(usage.status, 1);
	assert.match(usage.stderr, /Usage:/);
});

test('GTE draft renders through the shared pipeline without chapter-specific tooling', async t => {
	const chapter = await loadChapter(repositoryRoot, 'gte');
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-gte-publication-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const output = await renderChapter(chapter, 'preview', directory);
	assert.equal(output.layout.figures, 3);
	assert.match(await readFile(output.html, 'utf8'), /DRAFT/);
});
