import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

import { build } from 'esbuild';
import { glsl } from 'esbuild-plugin-glsl';

import { assertPlayerBundleBoundary } from '../analysis/product_bundle_boundary';
import { productNeedsRebuild } from './rebuild';
import { javascriptProductFilename } from './targets';

const MACHINE_RUNTIME_SOURCE_ROOTS = [
	'machine/ts',
	'scripts/products/browser_build.ts',
] as const;
const BROWSER_PLAYER_SOURCE_ROOTS = [
	'hosts/browser',
	'machine/ts',
	'runtime',
	'scripts/products/browser_build.ts',
] as const;
const BROWSER_STUDIO_SOURCE_ROOTS = [
	'hosts/browser',
	'ide',
	'machine/ts',
	'runtime',
	'scripts/products/browser_build.ts',
] as const;

const BROWSER_IMAGE_PATHS = [
	'./rom/bmsx.png',
	'./rom/d-pad-neutral.png',
	'./rom/d-pad-u.png',
	'./rom/d-pad-ru.png',
	'./rom/d-pad-r.png',
	'./rom/d-pad-rd.png',
	'./rom/d-pad-d.png',
	'./rom/d-pad-ld.png',
	'./rom/d-pad-l.png',
	'./rom/d-pad-lu.png',
] as const;

type BrowserProductBuildOptions = {
	debug: boolean;
	force: boolean;
};

type BrowserPackageOptions = {
	debug: boolean;
	romName: string;
	title: string;
	shortName: string;
};

async function buildBrowserBundle(
	entryPoint: string,
	outfile: string,
	debug: boolean,
	format: 'esm' | 'iife',
): Promise<Readonly<Record<string, unknown>>> {
	const result = await build({
		entryPoints: [entryPoint],
		bundle: true,
		metafile: true,
		platform: 'browser',
		format,
		target: 'es2020',
		outfile,
		keepNames: true,
		minify: !debug,
		sourcemap: debug ? 'inline' : false,
		sourcesContent: debug,
		define: {
			'process.env.NODE_ENV': debug ? '"development"' : '"production"',
			'BMSX_BROWSER_DEBUG': debug ? 'true' : 'false',
		},
		plugins: [
			glsl({ minify: !debug }),
		],
		loader: {
			'.png': 'dataurl',
			'.glsl': 'text',
			'.wgsl': 'text',
			'.json': 'json',
			'.html': 'text',
		},
	});
	return result.metafile.inputs;
}

async function ensureBrowserOutputDirectories(): Promise<void> {
	await mkdir('./rom', { recursive: true });
	await mkdir('./dist', { recursive: true });
}

export async function buildMachineRuntime(options: BrowserProductBuildOptions): Promise<void> {
	const filename = javascriptProductFilename('machine-runtime', options.debug);
	const distPath = `./dist/${filename}`;
	if (!options.force && !await productNeedsRebuild(distPath, MACHINE_RUNTIME_SOURCE_ROOTS)) {
		return;
	}

	await ensureBrowserOutputDirectories();
	const romPath = `./rom/${filename}`;
	await buildBrowserBundle('./machine/ts/index.ts', romPath, options.debug, 'esm');
	await copyFile(romPath, distPath);
}

export async function buildBrowserPlayer(options: BrowserProductBuildOptions): Promise<void> {
	const filename = javascriptProductFilename('browser-player', options.debug);
	const distPath = `./dist/${filename}`;
	if (!options.force && !await productNeedsRebuild(distPath, BROWSER_PLAYER_SOURCE_ROOTS)) {
		return;
	}

	await ensureBrowserOutputDirectories();
	const romPath = `./rom/${filename}`;
	const inputs = await buildBrowserBundle('./hosts/browser/player.ts', romPath, options.debug, 'iife');
	assertPlayerBundleBoundary('Browser player', inputs);
	await copyFile(romPath, distPath);
}

export async function buildBrowserStudio(options: BrowserProductBuildOptions): Promise<void> {
	const filename = javascriptProductFilename('browser-studio', options.debug);
	const distPath = `./dist/${filename}`;
	if (!options.force && !await productNeedsRebuild(distPath, BROWSER_STUDIO_SOURCE_ROOTS)) {
		return;
	}

	await ensureBrowserOutputDirectories();
	const romPath = `./rom/${filename}`;
	await buildBrowserBundle('./ide/browser/studio.ts', romPath, options.debug, 'iife');
	await copyFile(romPath, distPath);
}

function applyTemplateValues(template: string, values: Readonly<Record<string, string>>): string {
	let result = template;
	for (const [key, value] of Object.entries(values)) {
		result = result.split(key).join(value);
	}
	return result;
}

async function readBrowserImageData(): Promise<Readonly<Record<string, string>>> {
	const entries = await Promise.all(BROWSER_IMAGE_PATHS.map(async path => {
		const image = await readFile(path);
		return [path, image.toString('base64')] as const;
	}));
	return Object.fromEntries(entries);
}

async function minifiedBrowserCss(): Promise<string> {
	const { minify } = await import('@node-minify/core');
	const { cleanCss } = await import('@node-minify/clean-css');
	return minify({
		compressor: cleanCss,
		input: './gamebase.css',
		output: './rom/gamebase.min.css',
	});
}

async function loadBrowserPageInputs(): Promise<{
	html: string;
	css: string;
	images: Readonly<Record<string, string>>;
}> {
	await ensureBrowserOutputDirectories();
	const [html, css, images] = await Promise.all([
		readFile('./gamebase.html', 'utf8'),
		minifiedBrowserCss(),
		readBrowserImageData(),
	]);
	return { html, css, images };
}

function renderBrowserPage(
	inputs: {
		html: string;
		css: string;
		images: Readonly<Record<string, string>>;
	},
	title: string,
	scriptFilename: string,
	defaultRom: string,
): string {
	const imagePrefix = 'data:image/png;base64,';
	return applyTemplateValues(inputs.html, {
		'/*#css*/': inputs.css,
		'#title': title,
		'#browserhostjs': scriptFilename,
		'@@BMSX_DEFAULT_ROM@@': defaultRom,
		'@@BMSX_LOGO@@': `${imagePrefix}${inputs.images['./rom/bmsx.png']}`,
		'@@DPAD_D@@': `${imagePrefix}${inputs.images['./rom/d-pad-d.png']}`,
		'@@DPAD_L@@': `${imagePrefix}${inputs.images['./rom/d-pad-l.png']}`,
		'@@DPAD_LD@@': `${imagePrefix}${inputs.images['./rom/d-pad-ld.png']}`,
		'@@DPAD_LU@@': `${imagePrefix}${inputs.images['./rom/d-pad-lu.png']}`,
		'@@DPAD_NEUTRAL@@': `${imagePrefix}${inputs.images['./rom/d-pad-neutral.png']}`,
		'@@DPAD_R@@': `${imagePrefix}${inputs.images['./rom/d-pad-r.png']}`,
		'@@DPAD_RD@@': `${imagePrefix}${inputs.images['./rom/d-pad-rd.png']}`,
		'@@DPAD_RU@@': `${imagePrefix}${inputs.images['./rom/d-pad-ru.png']}`,
		'@@DPAD_U@@': `${imagePrefix}${inputs.images['./rom/d-pad-u.png']}`,
	});
}

async function writeBrowserManifest(title: string, shortName: string): Promise<void> {
	const manifestTemplate = await readFile('./rom/manifest.json', 'utf8');
	const manifest = manifestTemplate
		.replace('#title', title)
		.replace('#short_name', shortName);
	await writeFile('./dist/manifest.webmanifest', manifest);
}

export async function buildBrowserPlayerPackage(options: BrowserPackageOptions): Promise<void> {
	const inputs = await loadBrowserPageInputs();
	const defaultRom = options.romName
		? `${options.romName}.${options.debug ? 'debug.' : ''}rom`
		: '';
	const html = renderBrowserPage(
		inputs,
		options.title,
		javascriptProductFilename('browser-player', options.debug),
		defaultRom,
	);
	await writeFile('./dist/index.html', html);
	await writeBrowserManifest(options.title, options.shortName);
}

export async function buildBrowserStudioPackage(debug: boolean): Promise<void> {
	const inputs = await loadBrowserPageInputs();
	const pagePath = debug ? './dist/studio.debug.html' : './dist/studio.html';
	const html = renderBrowserPage(
		inputs,
		'BMSX',
		javascriptProductFilename('browser-studio', debug),
		'',
	);
	await Promise.all([
		writeFile(pagePath, html),
		writeBrowserManifest('BMSX', 'BMSX'),
	]);
}
