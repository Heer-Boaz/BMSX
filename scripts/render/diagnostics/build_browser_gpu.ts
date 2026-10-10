// Add an isolated diagnostic subtree to an exact snapshot of the published site.
// Existing pages/media references are copied verbatim, never regenerated.
import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { buildBrowserPlayer } from '../../products/browser_build';

async function main(): Promise<void> {
	const { values } = parseArgs({ options: { site: { type: 'string' }, out: { type: 'string' } } });
	if (!values.site || !values.out) throw new Error('Usage: tsx scripts/render/diagnostics/build_browser_gpu.ts --site <published-site> --out <new-site>');
	const source = path.resolve(values.site);
	const output = path.resolve(values.out);
	if (source === output) throw new Error('The diagnostic output must be separate from the published-site snapshot.');
	await cp(source, output, { recursive: true, force: false, errorOnExist: true });
	const diagnostics = path.join(output, 'ios');
	await mkdir(diagnostics);
	await buildBrowserPlayer({ debug: false, force: true });
	await copyFile('dist/engine.js', path.join(diagnostics, 'engine.js'));
	await build({
		entryPoints: ['scripts/render/diagnostics/browser_gpu.mjs'],
		outfile: path.join(diagnostics, 'gpu-diagnostics.js'),
		bundle: true, platform: 'browser', format: 'iife', target: 'es2020', minify: true,
	});
	for (const [game, root] of [['nemesis_s', 'ios'], ['2025', 'ios/piet']]) {
		const gameSource = path.join(source, game);
		const sourceHtml = await readFile(path.join(gameSource, 'index.html'), 'utf8');
		const sourceManifest = await readFile(path.join(gameSource, 'manifest.webmanifest'), 'utf8');
		for (const renderer of ['auto', 'webgpu', 'webgl2']) {
			const gameOutput = path.join(output, root, renderer === 'auto' ? '' : renderer);
			await mkdir(gameOutput, { recursive: true });
			const html = sourceHtml
				.replace('<canvas id="gamescreen"', `<canvas id="gamescreen" data-renderer="${renderer}" data-diagnostics-root="/${root}/"`)
				// Ordered modules keep WebKit exceptions unmuted. The page itself
				// selects its renderer; there are no query parameters or redirects.
				.replace('<script src="engine.js">', '<script type="module" crossorigin="anonymous" src="/ios/gpu-diagnostics.js"></script><script type="module" crossorigin="anonymous" src="/ios/engine.js">');
			await writeFile(path.join(gameOutput, 'index.html'), html);
			await copyFile(path.join(gameSource, 'bmsx_icon.png'), path.join(gameOutput, 'bmsx_icon.png'));
			const manifest = JSON.parse(sourceManifest);
			manifest.name += ` — iOS-diagnose ${renderer}`;
			manifest.short_name += ' diag';
			manifest.start_url = './';
			await writeFile(path.join(gameOutput, 'manifest.webmanifest'), JSON.stringify(manifest));
		}
	}
	console.log(`Diagnostic site: ${output}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
