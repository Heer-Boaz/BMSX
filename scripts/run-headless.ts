// import path from 'node:path';
// import fs from 'node:fs/promises';

// import { getZippedRomAndRomLabelFromBlob, loadResources } from './bootrom/bootresources';
// import pako from 'pako';
// import type { BootArgs } from '../src/bmsx/rompack/rompack';

// interface CliOptions {
// 	rom: string;
// 	frameIntervalMs: number;
// 	debug?: boolean;
// 	bundle?: string;
// }

// function parseArgs(argv: string[]): CliOptions {
// 	let romName: string | undefined;
// 	let frameIntervalMs = 20;
// 	let debug = false;

// 	let optionsBundle: string | undefined;

// 	for (let i = 0; i < argv.length; i++) {
// 		const arg = argv[i];
// 		if ((arg === '--rom' || arg === '-r') && argv[i + 1]) {
// 			romName = argv[++i];
// 			continue;
// 		}
// 		if (arg === '--frame-interval' && argv[i + 1]) {
// 			const parsed = Number(argv[++i]);
// 			if (!Number.isFinite(parsed) || parsed <= 0) {
// 				throw new Error(`Invalid frame interval: ${argv[i]}`);
// 			}
// 			frameIntervalMs = parsed;
// 			continue;
// 		}
// 		if (arg === '--debug') {
// 			debug = true;
// 			continue;
// 		}
// 		if ((arg === '--bundle' || arg === '-b') && argv[i + 1]) {
// 			optionsBundle = argv[++i];
// 			continue;
// 		}
// 		if (arg === '--help' || arg === '-h') {
// 			printHelp();
// 			process.exit(0);
// 		}
// 	}

// 	if (!romName) {
// 		throw new Error('Missing --rom <romname> argument.');
// 	}

// 	return { rom: romName, frameIntervalMs, debug, bundle: optionsBundle };
// }

// function printHelp(): void {
// 	console.log(`Run a ROM in headless mode.\n`);
// 	console.log(`Usage: npx tsx scripts/run-headless.ts --rom <romname> [--frame-interval ms] [--bundle path] [--debug]\n`);
// 	console.log(`Options:`);
// 	console.log(`  --rom, -r              Name of the ROM (expects dist/<rom>.rom and rom/<rom>.js)`);
// 	console.log(`  --frame-interval <ms>  Frame loop interval in milliseconds (default 20)`);
// 	console.log(`  --bundle, -b <path>    Optional path to a compiled bootloader bundle (defaults to rom/<rom>.js when present)`);
// 	console.log(`  --debug                Pass debug=true to the bootloader`);
// }

// async function loadRomPack(arrayBuffer: ArrayBuffer): Promise<ReturnType<typeof loadResources>> {
// 	const { zipped_rom } = await getZippedRomAndRomLabelFromBlob(arrayBuffer);
// 	const inflated = pako.inflate(new Uint8Array(zipped_rom)).buffer;
// 	return loadResources(inflated);
// }

// function executeRomCode(source: string, _label: string): void {
// 	if (typeof source !== 'string' || source.length === 0) {
// 		throw new Error('[headless] ROM pack does not contain executable code.');
// 	}
// 	// const wrapped = `${source}\n//# sourceURL=${label}`;
// 	const executor = new Function('globalThis', source);
// 	executor(globalThis);
// }

// async function main(): Promise<void> {
// 	const options = parseArgs(process.argv.slice(2));
// 	const romName = options.rom.toLowerCase();

// 	console.log(`[headless] Bootstrapping platform (frameIntervalMs=${options.frameIntervalMs})`);
// 	const headlessHandle = bootstrapHeadlessPlatform({ frameIntervalMs: options.frameIntervalMs, viewportSize: { x: 256, y: 192 } });
// 	(globalThis as Record<string, unknown>).postHeadlessInput = headlessHandle.postInput;

// 	const romFile = path.resolve('dist', `${romName}.rom`);
// 	console.log(`[headless] Loading ROM file: ${romFile}`);
// 	const romBuffer = await fs.readFile(romFile);
// 	const romArrayBuffer = romBuffer.buffer.slice(romBuffer.byteOffset, romBuffer.byteOffset + romBuffer.byteLength);
// 	const rompack = await loadRomPack(romArrayBuffer as ArrayBuffer);

// 	console.log(`[headless] Executing ROM code inline.`);
// 	executeRomCode(rompack.code, `${romName}.headless.js`);

// 	const h406A = (globalThis as Record<string, unknown>)['h406A'] as ((args: BootArgs) => Promise<void>) | undefined;
// 	if (typeof h406A !== 'function') {
// 		throw new Error(`[headless] Bootloader did not register global h406A handler.`);
// 	}

// 	console.log(`[headless] Starting game...`);
// 	const bootArgs: BootArgs = {
// 		rompack,
// 		sndcontext: undefined,
// 		gainnode: undefined,
// 		platform: Platform.instance,
// 		viewHostHandle: headlessHandle.viewHost,
// 	};
// 	if (options.debug) bootArgs.debug = true;
// 	await h406A(bootArgs);

// 	console.log(`[headless] Game is running. Sprite logs (and other headless passes) will emit below.`);
// 	console.log(`[headless] Use postHeadlessInput(...) to inject synthetic input events. Press Ctrl+C to exit.`);

// 	await new Promise(() => { /* keep process alive */ });
// }

// main().catch(err => {
// 	console.error('[headless] Fatal error:', err);
// 	process.exitCode = 1;
// });
