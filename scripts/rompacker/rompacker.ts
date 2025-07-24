import { BOOTROM_TS_FILENAME, buildBootromScriptIfNewer, buildGameHtmlAndManifest, buildResourceList, createAtlasses, deployToServer, esbuild, finalizeRompack, generateRomAssets, getResMetaList, getResourcesList, getRomManifest, isRebuildRequired } from './rompacker-core';
import type { RomManifest, RomPackerOptions } from './rompacker.rompack';
const term = require('terminal-kit').terminal;
const _colors = require('colors');

// Command line parameter for texture atlas usage
let GENERATE_AND_USE_TEXTURE_ATLAS = true;

type logentryType = undefined | 'error' | 'warning';

function getParamOrEnv(args: string[], flag: string, envVar: string, fallback: string): string {
	const idx = args.indexOf(flag);
	if (idx !== -1 && args[idx + 1]) return args[idx + 1];
	if (process.env[envVar]) return process.env[envVar]!;
	return fallback;
}

function parseOptions(args: string[]): RomPackerOptions {
	// Check for unrecognized arguments
	const knownArgs = ['-romname', '-title', '-bootloaderpath', '-respath', '--debug', '--force', '--buildreslist', '--nodeploy', '--textureatlas'];
	const unrecognizedArgs = args.filter(arg => arg.startsWith('-') && !knownArgs.includes(arg));
	if (unrecognizedArgs.length > 0) {
		throw new Error(`Unrecognized argument(s): ${unrecognizedArgs.join(', ')}`);
	}

	// Handle the case for -h or --help
	if (args.includes('-h') || args.includes('--help')) {
		writeOut(`Usage: <command> [options]`, 'warning');
		writeOut(`Options:`, 'warning');
		writeOut(`  -romname <name>        Name of the ROM`, 'warning');
		writeOut(`  -title <title>         Title of the ROM`, 'warning');
		writeOut(`  -bootloaderpath <path> Path to the bootloader`, 'warning');
		writeOut(`  -respath <path>        Resource path`, 'warning');
		writeOut(`  --debug                Show this help message`, 'warning');
		writeOut(`  --force                Force the compilation and build of the rompack`, 'warning');
		writeOut(`  --buildreslist         Build resource list`, 'warning');
		writeOut(`  --nodeploy             Skip deployment`, 'warning');
		writeOut(`  --textureatlas <yes|no>  Enable or disable texture atlas (default: yes)`, 'warning');
		process.exit(0);
	}

	// Parse options
	const useTextureAtlasArgIdx = args.indexOf('--textureatlas');
	let useTextureAtlas = true;
	if (useTextureAtlasArgIdx !== -1 && args[useTextureAtlasArgIdx + 1]) {
		const val = args[useTextureAtlasArgIdx + 1].toLowerCase();
		useTextureAtlas = val === 'yes' || val === 'true' || val === '1';
	}

	const rom_name = getParamOrEnv(args, '-romname', 'ROM_NAME', null);
	const title = getParamOrEnv(args, '-title', 'TITLE', rom_name);
	const bootloader_path = getParamOrEnv(args, '-bootloaderpath', 'BOOTLOADER_PATH', rom_name ? `./src/${rom_name}` : null);
	const respath = getParamOrEnv(args, '-respath', 'RES_PATH', rom_name ? `./src/${rom_name}/res` : null);
	const force = args.includes('--force');
	const debug = args.includes('--debug');
	const buildreslist = args.includes('--buildreslist');
	const deploy = !args.includes('--nodeploy');

	return {
		rom_name,
		title,
		bootloader_path,
		respath,
		force,
		debug,
		buildreslist,
		deploy,
		useTextureAtlas
	};
}

function writeOut(_tolog: string, type?: logentryType): void {
	let tolog: string;
	switch (type) {
		case 'error': tolog = _colors.red(_tolog); break;
		case 'warning': tolog = _colors.yellow(_tolog); break;
		default: tolog = _tolog; break;
	}
	term(tolog);
}

function timer(ms: number) {
	return new Promise(res => setTimeout(res, ms));
}

class ProgressReporter {
	private gauge: any;
	private tasks: string[];
	private totalTasks: number;
	private completedTasks: number = 0;

	constructor(tasks: string[]) {
		const Gauge = require('gauge');
		this.gauge = new Gauge(process.stdout, {
			updateInterval: 20,
			cleanupOnExit: false,
			autoSize: false,
		});
		this.gauge.setTemplate([
			{ type: 'progressbar', length: 50 },
			{ type: 'section', kerning: 1, default: '' },
			{ type: 'subsection', kerning: 1, default: '' },
		]);
		this.tasks = [...tasks];
		this.totalTasks = tasks.length;
	}

	public async taskCompleted() {
		this.completedTasks++;
		const progressPercentage = this.completedTasks / this.totalTasks;
		if (this.tasks.length) {
			const currentTask = this.tasks.shift()!;
			this.gauge.show(currentTask, progressPercentage);
			await this.pulse();
		} else {
			await this.showDone();
		}
	}

	public showInitial() {
		if (this.tasks.length) {
			this.gauge.show(this.tasks[0], 0);
			this.gauge.pulse();
		}
	}

	public skipTasks(count: number) {
		for (let i = 0; i < count && this.tasks.length; i++) {
			this.tasks.shift();
			this.completedTasks++;
		}
	}

	public removeTask(task: string) {
		const index = this.tasks.indexOf(task);
		if (index !== -1) {
			this.tasks.splice(index, 1);
			this.totalTasks--;
		}
	}

	public async showDone() {
		this.gauge.show('ROM PACKING GE-DONUT!! :-)', 1);
		await this.pulse();
	}

	public async pulse() {
		this.gauge.pulse();
		await timer(10);
	}
}

async function main() {
	const outputError = (e: any) => writeOut(`\n[GEFAALD] ${e?.stack ?? e?.message ?? e ?? 'Geen melding en/of stacktrace beschikbaar :-('} \n`, 'error');
	const taskList = [
		'Rom manifest zoekeren en parseren',
		'Game compileren+bundleren',
		'Resource lijst bouwen',
		'Resources laden en metadata genereren',
		'Atlassen puzellen (indien nodig)',
		'Rom-assets genereren',
		'Rompakket finaliseren',
		`"${BOOTROM_TS_FILENAME}" compileren(als nodig)`,
		'"game.html" en "game_debug.html" bouwen',
		'Deployeren',
		'ROM PACKING GE-DONUT!! :-)',
	];
	const progress = new ProgressReporter(taskList);
	try {
		// #region stuff
		term.clear();
		writeOut(_colors.brightGreen.bold('┏————————————————————————————————————————————————————————————————————————————————┓\n'));
		writeOut(_colors.brightGreen.bold('|                          BMSX ROMPACKER DOOR BOAZ©®™                           |\n'));
		writeOut(_colors.brightGreen.bold('┗————————————————————————————————————————————————————————————————————————————————┛\n'));
		const args = process.argv.slice(2);
		let { title, rom_name, bootloader_path, respath, force, debug, buildreslist, deploy, useTextureAtlas } = parseOptions(args);
		GENERATE_AND_USE_TEXTURE_ATLAS = useTextureAtlas;

		// Define common assets path
		const commonResPath = `./src/bmsx/res`

		if (buildreslist) {
			if (!respath) {
				throw new Error("Missing parameter for location of the resource folder ('respath', e.g. './src/testrom/res'.");
			}
			if (!commonResPath) {
				throw new Error("Cannot determine common resource path; 'rom_name' is required.");
			}
			writeOut(`Building resource list from "${respath}" and "${commonResPath}"...\n`);
			writeOut('Note: ROM packing and deployment are skipped.\n');
			if (rom_name) {
				writeOut(`Note: ROM name is set to "${rom_name}" (not used for resource list building).\n`);
			}
			await buildResourceList([respath, commonResPath]);
			writeOut(`\n${_colors.brightWhite.bold('[Resource list bouwen ge-DONUT]')} \n`);
			return;
		} else {
			// Check for required arguments
			if (!rom_name) {
				throw new Error('Missing required argument: --romname or ROM_NAME environment variable, or --buildreslist (to build resource list only).');
			}

			if (rom_name.includes('.')) {
				throw new Error(`'-romname' should not contain any extensions! The given romname was ${rom_name}. Example of good '-romname': 'testrom'.`);
			}
			rom_name = rom_name.toLowerCase();
		}

		if (!title) throw new Error("Missing parameter for title ('title', e.g. 'Sintervania'.");
		if (!bootloader_path) throw new Error("Missing parameter for location of the bootloader.ts-file ('bootloader_path', e.g. 'src/testrom'.");
		if (!respath) throw new Error("Missing parameter for location of the resource folder ('respath', e.g. './src/testrom/res'.");
		if (!commonResPath) throw new Error("Cannot determine common resource path; 'rom_name' is required.");

		let rebuildRequired = true;
		if (force) {
			writeOut(`Note: Recompilation and building forced via ${_colors.yellow.bold('--force')} \n`);
		}
		else {
			writeOut(`Note: Recompilation and building only if required (based on file modification times).\n`);
		}
		if (useTextureAtlas) {
			writeOut(`Note: Texture atlas generation enabled via ${_colors.brightGreen.bold('--textureatlas yes')} \n`);
		}
		else {
			writeOut(`Note: Texture atlas generation disabled via ${_colors.brightRed.bold('--textureatlas no')} \n`);
		}
		if (!deploy) writeOut(`Note: Deploy to FTP server disabled via ${_colors.brightRed.bold('--nodeploy')} \n`);
		writeOut(`Starting ROM packing and deployment process for ROM ${_colors.brightBlue.bold(`${rom_name}`)}...\n`);
		writeOut(`Using resources from "${respath}" and common resources from "${commonResPath}"...\n`);
		if (debug) {
			writeOut(`${_colors.cyan.bold('Building DEBUG version of rompack.')}.\n`);
		}
		else {
			writeOut(`${_colors.cyan.bold('Building NON-DEBUG version of rompack.')}.\n`);
		}
		progress.showInitial();
		await progress.taskCompleted(); // Need to complete the initial task as it will be triggered twice or so

		try {
			let romManifest: RomManifest;
			let short_name: string = 'BMSX';
			romManifest = await getRomManifest(respath);
			await progress.taskCompleted();
			if (!romManifest) throw new Error(`Rom manifest not found at "${respath}"!`);
			rom_name = romManifest?.rom_name ?? rom_name;
			title = romManifest?.title ?? title;
			short_name = romManifest?.short_name ?? short_name;

			if (!force) {
				rebuildRequired = await isRebuildRequired(rom_name, bootloader_path, respath);
				if (!rebuildRequired) {
					const commonRebuildRequired = await isRebuildRequired(rom_name, bootloader_path, commonResPath);
					rebuildRequired = rebuildRequired || commonRebuildRequired;
					if (!rebuildRequired) {
						writeOut('Rebuild skipped: game rom was newer than code/assets (use --force option to ignore this check).\n');
					}
				}
			} else rebuildRequired = true;

			if (!deploy) progress.removeTask('Deployeren');
			if (!rebuildRequired) {
				progress.skipTasks(6);
			}

			// #endregion
			if (rebuildRequired) {
				await esbuild(rom_name, bootloader_path, debug);
				await progress?.taskCompleted();
				const romResMetaList = await getResMetaList([respath, commonResPath], rom_name);
				await progress?.taskCompleted();
				const resources = await getResourcesList(romResMetaList, rom_name);
				await progress?.taskCompleted();

				if (GENERATE_AND_USE_TEXTURE_ATLAS) {
					await createAtlasses(resources);
				}
				await progress?.taskCompleted();

				const romAssets = generateRomAssets(resources);
				await progress?.taskCompleted();

				await finalizeRompack(romAssets, rom_name, debug);
				await progress?.taskCompleted();
			}
			await buildBootromScriptIfNewer(force, debug);
			await progress?.taskCompleted();
			await buildGameHtmlAndManifest(rom_name, title, short_name, debug);
			await progress?.taskCompleted();
			if (deploy) {
				await deployToServer(rom_name, title);
				await progress?.taskCompleted();
			}
			await progress.showDone();
			writeOut(`\n`);
		} catch (e) {
			await progress.pulse();
			writeOut(`\n`);
			throw e;
		}
	} catch (e) {
		outputError(e);
	}
}

main();