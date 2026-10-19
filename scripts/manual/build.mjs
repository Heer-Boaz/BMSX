import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { developmentGuide, loadChapter, loadDevelopmentGuide, publicationFailures, repositoryRoot } from './chapter.mjs';
import { chapterHtml, renderChapter } from './render.mjs';

const [mode, id, ...extra] = process.argv.slice(2);
if (!['check', 'preview', 'publish'].includes(mode) || !id || extra.length !== 0) {
	console.error('Usage: node scripts/manual/build.mjs <check|preview|publish> <document-id>');
	process.exitCode = 1;
} else {
	try {
		if (id === developmentGuide.id) {
			const guide = await loadDevelopmentGuide(repositoryRoot);
			if (mode === 'check') {
				console.log('Development companion source and assets loaded; no reference-chapter approval is implied.');
			} else {
				const directory = resolve(repositoryRoot, 'build/manual');
				await mkdir(directory, { recursive: true });
				const html = resolve(directory, `${guide.id}${mode === 'preview' ? '.preview' : ''}.html`);
				await writeFile(html, chapterHtml(guide, mode));
				console.log(`Development companion HTML: ${html}`);
			}
		} else {
			const chapter = await loadChapter(repositoryRoot, id);
			const failures = await publicationFailures(repositoryRoot, chapter);
			console.log(`${id}: ${chapter.entry.chapter}\nFact sheet: ${chapter.entry.facts}`);
			if (failures.length !== 0) {
				console.error(`Publication blocked:\n${failures.map(failure => `- ${failure}`).join('\n')}`);
			}
			if (mode !== 'preview' && failures.length !== 0) {
				process.exitCode = 1;
			} else if (mode === 'check') {
				console.log('Coverage and recorded reviews permit publication. No PDF was built.');
			} else {
				const result = await renderChapter(chapter, mode, resolve(repositoryRoot, 'build/manual'));
				console.log(`${mode === 'preview' ? 'DRAFT preview' : 'Published chapter'}: ${result.pdf}`);
				console.log(`Build receipt: ${result.receipt}`);
			}
		}
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
