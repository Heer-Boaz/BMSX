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
	const diagnostics = path.join(output, 'ios-diagnostics');
	await mkdir(diagnostics);
	await buildBrowserPlayer({ debug: false, force: true });
	await copyFile('dist/engine.js', path.join(diagnostics, 'engine.js'));
	await build({
		entryPoints: ['scripts/render/diagnostics/browser_gpu.mjs'],
		outfile: path.join(diagnostics, 'gpu-diagnostics.js'),
		bundle: true, platform: 'browser', format: 'iife', target: 'es2020', minify: true,
	});
	for (const game of ['nemesis_s', '2025']) {
		const gameSource = path.join(source, game);
		const gameOutput = path.join(diagnostics, game);
		await mkdir(gameOutput);
		const html = (await readFile(path.join(gameSource, 'index.html'), 'utf8'))
			.replace('<script src="engine.js">', '<script src="../gpu-diagnostics.js"></script><script src="../engine.js">');
		await writeFile(path.join(gameOutput, 'index.html'), html);
		await copyFile(path.join(gameSource, 'bmsx_icon.png'), path.join(gameOutput, 'bmsx_icon.png'));
		const manifest = JSON.parse(await readFile(path.join(gameSource, 'manifest.webmanifest'), 'utf8'));
		manifest.name += ' — iOS-diagnose';
		manifest.short_name += ' diag';
		manifest.start_url = './?renderer=auto';
		await writeFile(path.join(gameOutput, 'manifest.webmanifest'), JSON.stringify(manifest));
	}
	console.log(`Diagnostic site: ${output}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
