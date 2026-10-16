import { resolve } from 'node:path';
import { loadChapter, publicationFailures, repositoryRoot } from './chapter.mjs';
import { renderChapter } from './render.mjs';

const [mode, id, ...extra] = process.argv.slice(2);
if (!['check', 'preview', 'publish'].includes(mode) || !id || extra.length !== 0) {
	console.error('Usage: node scripts/manual/build.mjs <check|preview|publish> <chapter-id>');
	process.exitCode = 1;
} else {
	try {
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
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
