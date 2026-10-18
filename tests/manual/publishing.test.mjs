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
const samplePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAE0lEQVR4nGP4z8DAAMZAwICTAwBC8hHvOAjORwAAAABJRU5ErkJggg==', 'base64');
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
		'docs/book2/figures/sample.png': samplePng,
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
	assert.match(preview, /BMSX Book II · BLua32 and BIOS Reference — SAMPLE — DRAFT/);
	assert.match(preview, /<p class="draft-status">DRAFT — NOT FOR PUBLICATION<\/p>/);
	assert.match(preview, /SAMPLE — DRAFT \/ NOT FOR PUBLICATION/);
	assert.match(preview, /<section class="register-entry">\s*<h3 id="87-mode">8\.7\. MODE<\/h3>/);
	assert.match(preview, /<svg xmlns=/);
	assert.match(preview, /data:font\/ttf;base64,/);
	assert.doesNotMatch(preview, /<img|file:\/\/|url\("fonts\//);
	const publication = chapterHtml(chapter, 'publish');
	assert.doesNotMatch(publication, /DRAFT|class="draft-status"/);
	assert.match(publication, /content: "SAMPLE"/);
});

test('heading targets use inline label text, preserving literal code and escaped characters', async t => {
	const source = `# Targets

## Plain &amp; word

## **Outer [Link](https://example.test/hidden)** _em_ ~~gone~~

## \`&amp;\` &amp;\\* &lt;x&gt;

## <kbd>A &amp; B</kbd> \`a<b\` \\<tag\\>

## **![Fixture *label*](figures/sample.png)**

## Één 日本語

## &copy &notable

## <kbd>&copy &notable</kbd>

## &copycat;
`;
	const chapter = await loadChapter(await fixture(t, source), 'sample');
	const html = chapterHtml(chapter, 'publish');
	assert.deepEqual([...html.matchAll(/<h\d id="([^"]*)">/g)].map(match => match[1]), [
		'targets', 'plain--word', 'outer-link-em-gone', 'amp--x',
		'a--b-ab-tag', 'fixture-label', 'één-日本語', 'copy-notable', '-able', 'cat',
	]);
	assert.match(html, /<h2 id="amp--x"><code>&amp;amp;<\/code> &amp;\* &lt;x&gt;<\/h2>/);
	assert.match(html, /<h2 id="a--b-ab-tag"><kbd>A &amp; B<\/kbd> <code>a&lt;b<\/code> &lt;tag&gt;<\/h2>/);
	assert.match(html, /<h2 id="copy-notable">&amp;copy &amp;notable<\/h2>/);
	assert.match(html, /<h2 id="-able"><kbd>&copy &notable<\/kbd><\/h2>/);
});

test('heading suffixes reserve generated IDs and restart for every chapter rendering', async t => {
	const chapter = await loadChapter(await fixture(t, '# Foo\n\n## Foo\n\n## Foo-1\n\n## Foo\n'), 'sample');
	for (const mode of ['preview', 'publish', 'preview']) {
		const html = chapterHtml(chapter, mode);
		assert.deepEqual([...html.matchAll(/<h\d id="([^"]*)">/g)].map(match => match[1]),
			['foo', 'foo-1', 'foo-1-1', 'foo-2']);
	}
});

test('authored anchors stay unique without shifting heading suffixes or treating code as HTML', async t => {
	const source = `<a id="stable-alias"></a>

# Different title

<a id="foo"></a>

## Foo

## Foo

\`<a id="not-an-anchor">\`

## Not an anchor

<!-- <a id="commented"> -->

## Commented

<a data-id="attribute"></a>

## Attribute

<a id="&aacutex"></a>

## áx

<a id="&#98;ar"></a>

## Bar

## Bar
`;
	const chapter = await loadChapter(await fixture(t, source), 'sample');
	const html = chapterHtml(chapter, 'publish');
	assert.match(html, /<a id="stable-alias"><\/a>/);
	assert.match(html, /<h1 id="different-title">Different title<\/h1>/);
	assert.equal([...html.matchAll(/\bid="foo"/g)].length, 1);
	assert.match(html, /<h2>Foo<\/h2>\s*<h2 id="foo-1">Foo<\/h2>/);
	for (const id of ['not-an-anchor', 'commented', 'attribute']) {
		assert.ok(html.includes(`<h2 id="${id}">`));
	}
	assert.match(html, /<a id="&aacutex"><\/a>/);
	assert.match(html, /<h2 id="áx">áx<\/h2>/);
	assert.match(html, /<a id="&#98;ar"><\/a>/);
	assert.match(html, /<h2>Bar<\/h2>\s*<h2 id="bar-1">Bar<\/h2>/);
});

test('current chapter heading references have targets and existing Memory anchors are not duplicated', async () => {
	const system = chapterHtml(await loadChapter(repositoryRoot, 'system'), 'preview');
	assert.match(system, /<h2 id="device-boundaries-during-supervisor-service">/);
	const memory = chapterHtml(await loadChapter(repositoryRoot, 'memory'), 'preview');
	assert.match(memory, /<h3 id="prepare-publish-and-reuse-two-surfaces">/);
	assert.equal([...memory.matchAll(/\bid="firmware-reservation-in-vram"/g)].length, 1);
	assert.match(memory, /<a href="#firmware-reservation-in-vram">/);
});

test('shared volume titles identify every book in document and running titles', async t => {
	const root = await fixture(t);
	const catalogPath = join(root, 'docs/manual/catalog.json');
	const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
	for (const [book, title] of [
		['I', 'System and Hardware Reference'],
		['II', 'BLua32 and BIOS Reference'],
		['III', 'Cartridge and Expansion Reference'],
	]) {
		catalog.sample.book = book;
		await writeFile(catalogPath, JSON.stringify(catalog));
		const chapter = await loadChapter(root, 'sample');
		assert.equal(chapter.volumeTitle, title);
		const html = chapterHtml(chapter, 'publish');
		assert.ok(html.includes(`<title>BMSX Book ${book} · ${title} — SAMPLE</title>`));
		assert.ok(html.includes(`content: ${JSON.stringify(`Book ${book} · ${title}`.toUpperCase())}`));
	}
});

test('current source-language, BIOS and coroutine chapters belong to software, not hardware', async () => {
	const catalog = JSON.parse(await readFile(resolve(repositoryRoot, 'docs/manual/catalog.json'), 'utf8'));
	assert.deepEqual(Object.entries(catalog).filter(([, entry]) => entry.book === 'II').map(([id]) => id),
		['blua-programs', 'bios-base', 'bios-math', 'bios-os', 'bios-loader', 'bios-table', 'bios-string', 'coroutines']);
	assert.deepEqual(Object.entries(catalog).filter(([, entry]) => entry.book === 'I').map(([id]) => id),
		['console', 'cpu', 'memory', 'pcrtc', 'gte', 'gpu', 'irq', 'dma', 'apu', 'geo', 'imgdec', 'input', 'system']);
	assert.deepEqual(Object.entries(catalog).filter(([, entry]) => entry.book === 'III').map(([id]) => id),
		['cartridge']);
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

test('Chromium retains a local PDF link and named destination for an implicit heading target', async t => {
	const root = await fixture(t, `# Synthetic navigation fixture

[Go to the implicit heading](#implicit-target)

<div style="break-before: page"></div>

## Implicit target

Synthetic destination, not a hardware specification.
`);
	const output = await renderChapter(await loadChapter(root, 'sample'), 'preview', join(root, 'build/manual'));
	const pdf = (await readFile(output.pdf)).toString('latin1');
	assert.match(pdf, /\/Dest \/implicit-target\b/);
	assert.match(pdf, /\/implicit-target \[\d+ 0 R \/XYZ /);
});

test('PNG figures retain binary pixels, authored alt text, print sizing, and PDF embedding beside SVG', async t => {
	const alt = 'A red triangle & black "background"';
	const root = await fixture(t, sampleChapter + '\n![A *red* triangle &amp; `black` "background"](figures/sample.png)\n');
	const chapter = await loadChapter(root, 'sample');
	assert.deepEqual(chapter.figures.get('figures/sample.png'), samplePng);
	const output = await renderChapter(chapter, 'preview', join(root, 'build/manual'));
	assert.deepEqual(output.layout, { figures: 2, registerEntries: 1, errors: [] });
	const html = await readFile(output.html, 'utf8');
	assert.match(html, /<img src="data:image\/png;base64,[^"]+" alt="A red triangle &amp; black &quot;background&quot;">/);
	assert.match(html, /<svg xmlns=/);
	assert.doesNotMatch(html, /<image[ >]|file:\/\//);
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage();
	await page.setContent(html, { waitUntil: 'load' });
	const image = await page.locator('.manual-figure img').evaluate(img => ({
		complete: img.complete, width: img.naturalWidth, height: img.naturalHeight, alt: img.alt,
		printedWidth: img.getBoundingClientRect().width, printedHeight: img.getBoundingClientRect().height,
		rendering: getComputedStyle(img).imageRendering,
	}));
	assert.deepEqual({ complete: image.complete, width: image.width, height: image.height, alt: image.alt },
		{ complete: true, width: 4, height: 3, alt });
	assert.ok(Math.abs(image.printedWidth - 128 * 96 / 25.4) < 1);
	assert.ok(Math.abs(image.printedHeight / image.printedWidth - 3 / 4) < .001);
	assert.equal(image.rendering, 'pixelated');
	const pdf = (await readFile(output.pdf)).toString('latin1');
	assert.match(pdf, /\/Subtype \/Image\s*\/Width 4\s*\/Height 3/);
	chapter.stylesheet += '\n.manual-figure img { width: 200mm; max-width: none; }\n';
	await assert.rejects(renderChapter(chapter, 'preview', join(root, 'build/overflow')), /Horizontal overflow: IMG/);
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
	assert.deepEqual(output.layout, { figures: 10, registerEntries: 13, errors: [] });

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
	assert.equal(output.layout.figures, 10);
	assert.match(await readFile(output.html, 'utf8'), /DRAFT/);
});
