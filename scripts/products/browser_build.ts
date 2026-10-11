import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

import { build } from 'esbuild';
import { glsl } from 'esbuild-plugin-glsl';

import { assertPlayerBundleBoundary, assertStudioBundleBoundary } from '../analysis/product_bundle_boundary';
import { PLAYER_CARTRIDGE_SLOT, PLAYER_MANIFEST, PLAYER_SYSTEM_ROM_SLOT, PLAYER_TITLE_SLOT } from './player_page';
import { productNeedsRebuild } from './rebuild';
import { javascriptProductFilename } from './targets';
import { renderStudioPage, STANDALONE_STUDIO_CONFIGURATION, STUDIO_CONFIGURATION_ELEMENT, STUDIO_PAGES } from './studio_page';

const MACHINE_RUNTIME_SOURCE_ROOTS = [
	'machine/ts',
	'scripts/products/browser_build.ts',
] as const;
const BROWSER_PLAYER_SOURCE_ROOTS = [
	'hosts/browser',
	'hosts/common',
	'machine/ts',
	'runtime',
	'scripts/products/browser_build.ts',
] as const;
const BROWSER_STUDIO_SOURCE_ROOTS = [
	'hosts/browser',
	'hosts/common',
	'ide',
	'machine/ts',
	'runtime',
	'scripts/products/browser_build.ts',
	'toolchain/ts',
	'package-lock.json',
] as const;

const BROWSER_IMAGE_PATHS = [
	'./rom/bmsx.png',
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
	const workerPath = './dist/graph-layout.worker.js';
	if (!options.force && !await productNeedsRebuild(distPath, BROWSER_STUDIO_SOURCE_ROOTS)
		&& !await productNeedsRebuild(workerPath, BROWSER_STUDIO_SOURCE_ROOTS)) {
		return;
	}

	await ensureBrowserOutputDirectories();
	const romPath = `./rom/${filename}`;
	const inputs = await buildBrowserBundle('./ide/browser/studio.ts', romPath, options.debug, 'iife');
	assertStudioBundleBoundary('Browser Studio UI', inputs);
	await copyFile(romPath, distPath);
	// Standalone worker asset: the layout engine must not enter the Studio UI bundle.
	await copyFile('./node_modules/elkjs/lib/elk-worker.min.js', './rom/graph-layout.worker.js');
	await copyFile('./rom/graph-layout.worker.js', workerPath);
	for (const directory of ['./rom', './dist']) {
		await copyFile('./node_modules/elkjs/LICENSE.md', `${directory}/elkjs.LICENSE.txt`);
		await copyFile('./ide/common/third_party_notices.md', `${directory}/studio.THIRD_PARTY_NOTICES.txt`);
	}
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
	manifest: string,
	scriptFilename: string,
	defaultRom: string,
	systemRom: string,
	configuration: string,
): string {
	const imagePrefix = 'data:image/png;base64,';
	return applyTemplateValues(inputs.html, {
		'@@BMSX_PRODUCT_CONFIGURATION@@': configuration,
		'/*#css*/': inputs.css,
		'#title': title,
		'@@BMSX_MANIFEST@@': manifest,
		'#browserhostjs': scriptFilename,
		'@@BMSX_DEFAULT_ROM@@': defaultRom,
		'@@BMSX_SYSTEM_ROM@@': systemRom,
		'@@BMSX_LOGO@@': `${imagePrefix}${inputs.images['./rom/bmsx.png']}`,
	});
}

/** Each installable page owns its manifest; start_url is relative to the manifest, so a package works in any folder. */
async function writeBrowserManifest(file: string, title: string, shortName: string, startUrl: string): Promise<void> {
	const manifestTemplate = await readFile('./rom/manifest.json', 'utf8');
	const manifest = manifestTemplate
		.replace('#title', title)
		.replace('#short_name', shortName)
		.replace('#start_url', startUrl);
	await writeFile(`./dist/${file}`, manifest);
}

export async function buildBrowserPlayerPackage(options: BrowserPackageOptions): Promise<void> {
	const inputs = await loadBrowserPageInputs();
	const defaultRom = options.romName
		? `${options.romName}.${options.debug ? 'debug.' : ''}rom`
		: '';
	const html = renderBrowserPage(
		inputs,
		options.title,
		PLAYER_MANIFEST,
		javascriptProductFilename('browser-player', options.debug),
		defaultRom,
		`system/bmsx-bios${options.debug ? '.debug' : ''}.rom`,
		'',
	);
	await writeFile('./dist/index.html', html);
	// A host product supplies its own ready-to-package page; deployment never rebuilds the host.
	// The package names it after its cartridge, so the template keeps the title as a slot.
	await writeFile(`./dist/player${options.debug ? '.debug' : ''}.template.html`, renderBrowserPage(
		inputs, PLAYER_TITLE_SLOT, PLAYER_MANIFEST, javascriptProductFilename('browser-player', options.debug), PLAYER_CARTRIDGE_SLOT, PLAYER_SYSTEM_ROM_SLOT, '',
	));
	await copyFile('./rom/bmsx.png', './dist/bmsx_icon.png');
	await writeBrowserManifest(PLAYER_MANIFEST, options.title, options.shortName, './');
}

export async function buildBrowserStudioPackage(debug: boolean): Promise<void> {
	const inputs = await loadBrowserPageInputs();
	const product = STUDIO_PAGES.find(page => page.debug === debug)!;
	const template = renderBrowserPage(
		inputs,
		'BMSX',
		product.manifest,
		javascriptProductFilename('browser-studio', debug),
		'',
		`system/bmsx-bios${debug ? '.debug' : ''}.rom`,
		STUDIO_CONFIGURATION_ELEMENT,
	);
	await Promise.all([
		writeFile(`./dist/${product.template}`, template),
		writeFile(`./dist/${product.page}`, renderStudioPage(template, STANDALONE_STUDIO_CONFIGURATION)),
		writeBrowserManifest(product.manifest, 'BMSX Studio', 'Studio', product.page),
	]);
}
