import { createOptimizedAtlas } from './atlasbuilder';
import { readdirSync, statSync, readFileSync, writeFileSync, copyFile, copyFileSync, existsSync, exists, createWriteStream, rmSync } from 'fs';
import { join, parse } from 'path';
import { AudioMeta, AudioType, RomAsset, RomMeta, ImgMeta } from '../src/bmsx/rompack';
import * as browserify from 'browserify';
const tsify = require('tsify');

import * as terser from 'terser';
import * as term from 'terminal-kit';
import { readdir } from 'fs/promises';
const _colors = require('colors');
const pako = require('pako');
const minify = require('@node-minify/core');
const cleanCSS = require('@node-minify/clean-css');
const FtpDeploy = require('ftp-deploy');
const { loadImage } = require('canvas');
const yaml = require('js-yaml');

const GENERATE_AND_USE_TEXTURE_ATLAS = true;
const DONT_PACK_IMAGES_WHEN_USING_ATLAS = true;

const BOILERPLATE_RESOURCE_ID_BITMAP = `export enum BitmapId {
	None = 'None',
`;

const BOILERPLATE_RESOURCE_ID_AUDIO = `export enum AudioId {
	None = 'None',
`;

export interface ILoadedResource extends ResourceMeta {
	buffer: Buffer;
	img?: any;
	imgmeta?: ImgMeta;
}

export interface ResourceMeta {
	filepath?: string;
	name: string;
	ext?: string;
	type: string;
	id: number;
}

type logentryType = undefined | 'error' | 'warning';

function writeOut(_tolog: string, type?: logentryType): void {
	let d = new Date();
	let tolog: string;
	switch (type) {
		case 'error': tolog = _colors.red(_tolog); break;
		case 'warning': tolog = _colors.yellow(_tolog); break;
		default: tolog = _tolog; break;
	}
	term.terminal(`${tolog}`);
}

function log(_tolog: string, type?: logentryType): void {
	let d = new Date();
	let tolog: string;
	switch (type) {
		case 'error':
			tolog = _colors.red(_tolog);
			term.terminal(`${_colors.cyan(d.toTimeString().split(' ')[0])}:${_colors.cyan(d.getMilliseconds().toString().substring(0, 3))} ${tolog}`);
			break;
		case 'warning': tolog = _colors.yellow(_tolog);
			term.terminal(`${_colors.cyan(d.toTimeString().split(' ')[0])}:${_colors.cyan(d.getMilliseconds().toString().substring(0, 3))} ${tolog}`);
			break;
		default:
			tolog = _tolog;
			break;
	}
}

function appendLogEntry(_toappend: string, type?: logentryType): void {
	let toappend: string;
	switch (type) {
		case 'error':
			toappend = _colors.red(_toappend);
			term.terminal(toappend);
			break;
		case 'warning':
			toappend = _colors.yellow(_toappend);
			term.terminal(toappend);
			break;
		default: toappend = _toappend; break;
	}
}

function timer(ms: number) {
	return new Promise(res => setTimeout(res, ms));
}

/**
 * Convert a string into a Uint8Array.
 * https://ourcodeworld.com/articles/read/164/how-to-convert-an-uint8array-to-string-in-javascript
 * @returns {Uint8Array}
 */
function encodeuint8arr(myString: string): Uint8Array {
	return new TextEncoder().encode(myString);
}

function addFile(dirPath: string, filePath: string, arrayOfFiles: string[]): void {
	arrayOfFiles.push(join(dirPath, "/", filePath));
}

function getFiles(dirPath: string, arrayOfFiles?: string[], filterExtension?: string): string[] {
	return getAllNonRootDirs(dirPath, arrayOfFiles, filterExtension);
}

function getAllNonRootDirs(dirPath: string, arrayOfFiles?: string[], filterExtension?: string): string[] {
	let entries = readdirSync(dirPath);
	arrayOfFiles = arrayOfFiles || [];
	entries.filter(entry => statSync(`${dirPath}/${entry}`).isDirectory() && `${dirPath}/${entry}`.indexOf("_ignore") === -1).forEach(entry => arrayOfFiles = getAllFiles(`${dirPath}/${entry}`, arrayOfFiles, filterExtension));
	return arrayOfFiles;
}

function getAllFiles(dirPath: string, _arrayOfFiles?: string[], filterExtension?: string): string[] {
	let files = readdirSync(dirPath);

	let arrayOfFiles = _arrayOfFiles || [];

	files.filter(f => f.indexOf("_ignore") === -1).forEach(function (file) {
		let fullpath = `${dirPath}/${file}`;
		if (statSync(fullpath).isDirectory()) {
			arrayOfFiles = getAllFiles(fullpath, arrayOfFiles, filterExtension);
		} else {
			let ext = parse(file).ext;
			if (filterExtension) {
				if (ext === filterExtension) {
					arrayOfFiles.push(fullpath);
				}
			}
			else if (ext != ".rom" && ext != ".js" && ext != ".ts" && ext != ".map" && ext != ".tsbuildinfo") {
				arrayOfFiles.push(fullpath);
			}
		}
	});

	return arrayOfFiles;
}

function yaml2Json(): Promise<void> {
	return new Promise((resolve, reject) => {
		try {
			log("YAML bestanden omzetten in JSON voor importatie...  ");
			let yamlfiles = getAllFiles('./src', [], '.yaml');
			for (let file of yamlfiles) {
				let doc = yaml.load(readFileSync(file, 'utf8'));
				let outfilename = file.replace('.yaml', '.json');
				writeFileSync(outfilename, Buffer.from(encodeuint8arr(JSON.stringify(doc))));
			}
			appendLogEntry(`${_colors.grey('[Donut]')}\n`);
		}
		catch (err) {
			reject(err);
		}
		resolve();
	});
}

async function buildAndBundleRomSource(romname: string, bootloader_path: string): Promise<any> {
	log("Game compileren en bundleren...  ");
	const bootloader_ts_path = `${bootloader_path}/bootloader.ts`;
	return new Promise((resolve, reject) => {
		try {
			let writeOutput = createWriteStream(`./rom/${romname}.js`);
			browserify({
				debug: true,
				basedir: '.',
				project: true,
				cache: {},
				packageCache: {},
				exposeAll: true,
				exclude: [],
				ignore: ['node_modules', 'dist', 'rom'],
			})
				.add(bootloader_ts_path)
				.plugin(tsify, {
					noImplicitAny: false,
					files: [bootloader_ts_path],
				})
				.bundle()
				.on('error', e => {
					reject(e);
				})
				.pipe(writeOutput);
			writeOutput.on('finish', () => {
				appendLogEntry(`${_colors.grey('[Donut]')}\n`);
				resolve(null);
			});
			writeOutput.on('error', e => {
				appendLogEntry(`${_colors.red('[Urgh]')}\n`);
				reject(e);
			});
		} catch (err) {
			reject(err);
		}
	});
}

async function minifyGamecode(infile: string): Promise<terser.MinifyOutput> {
	try {
		let options = <terser.MinifyOptions>{
			ecma: 2017,
			sourceMap: {
				content: 'inline',
				url: 'inline',
			},
			keep_fnames: /^_/,
			keep_classnames: true,
			compress: <terser.CompressOptions>{
				passes: 3, // The maximum number of times to run compress. In some cases more than one pass leads to further compressed code. Keep in mind more passes will take more time
				ecma: 2017,
				collapse_vars: true,
				join_vars: true,
				loops: true,
				sequences: true,
			},
			mangle: <terser.MangleOptions>{
				reserved:
					[
						"exports",
						"global",
						"factory",
						"__extends",
						"__assign",
						"__rest",
						"__decorate",
						"__param",
						"__metadata",
						"__awaiter",
						"__generator",
						"__exportStar",
						"__values",
						"__read",
						"__spread",
						"__spreadArrays",
						"__await",
						"__asyncGenerator",
						"__asyncDelegator",
						"__asyncValues",
						"__makeTemplateObject",
						"__importStar",
						"__importDefault",
					],
				properties: false,
			},
			output: <terser.FormatOptions>{
				ecma: 2017,
				safari10: false,
				webkit: true,
				max_line_len: 80,
				semicolons: true, // Must be true for Safari support (on iOS)! Otherwise, only black screen shows
				keep_quoted_props: true,
				beautify: false,
				source_map: {
					content: 'inline',
				},
				comments: false,
				indent_level: 0,
				braces: false,
			},
		};

		let gamejs = readFileSync(infile, 'utf8');
		let gamejsMinifiedResult = terser.minify(gamejs, options);
		return gamejsMinifiedResult;
	}
	catch (err) {
		return err;
	}
}

async function buildGameHtmlAndManifest(romname: string, title: string): Promise<any> {
	log("game.html en game_debug.html bouwen...\n");
	let html = readFileSync("./gamebase.html", 'utf8');
	let romjs = readFileSync("./rom/rom.js", 'utf8').replace('Object.defineProperty(exports, "__esModule", { value: true });', '');
	let zipjs = readFileSync("./scripts/pako_inflate.min.js", 'utf8');
	let options = {
		compress: {
			arrows: false
		},
		mangle: {
			toplevel: false,
			reserved: ["bootrom", "h406A", "rom"],
			safari10: true,
		},
		output: {
			safari10: true,
			webkit: true,
		}
	};
	let romjsMinified = (await terser.minify(romjs, options)).code!;
	let bmsx = readFileSync("./rom/bmsx.png");
	let bmsx_base64ed = bmsx.toString('base64');

	return new Promise<any>((resolve, reject) => {
		minify({
			compressor: cleanCSS,
			input: "./gamebase.css",
			output: "./gamebase.min.css",
			callback: (err, cssMinified: string) => {
				if (!cssMinified) {
					log(`Minifyen van CSS faalde :-(\n`);
					reject(err);
				}

				let transformHtml = (htmlToTransform: string, debug: boolean): string => {
					return htmlToTransform.replace('//#romjs', debug ? romjs : romjsMinified)
						.replace('//#zipjs', zipjs)
						.replace('/*css*/', cssMinified)
						.replace(/#title/g, title) // https://stackoverflow.com/questions/44324892/how-can-i-replace-multiple-characters-in-a-string
						.replace('#romname', `${romname}`)
						.replace('#outfile', `${romname}.rom`)
						.replace('#bmsxurl', "data:image/png;base64," + bmsx_base64ed)
						.replace('//#debug', `bootrom.debug = ${debug};\n`)
						.replace('//#localfetch', `bootrom.localfetch = ${debug};\n`);
				};
				writeFileSync("./dist/game.html", transformHtml(html, false));
				writeFileSync("./dist/game_debug.html", transformHtml(html, true));

				// Update the manifest.json-file that is used for app-versions of the webpage
				let manifest = readFileSync("./rom/manifest.json", 'utf8').replace('#title', title);

				// Write updated manifest to dist-folder
				writeFileSync("./dist/manifest.webmanifest", manifest);

				resolve(null);
			}
		});
	});
}

function parseAudioMeta(filename: string): { sanitizedName: string, meta: AudioMeta; } {
	let priorityregex = /@p\=\d+/;
	let priorityresult = priorityregex.exec(filename);
	let prioritystr = priorityresult ? priorityresult[0] : undefined;
	let priority = prioritystr ? parseInt(prioritystr.slice(3)) : 0;

	let loopregex = /@l\=\d+(,\d+)?/;
	let loopresult = loopregex.exec(filename);
	let loopstr = loopresult ? loopresult[0] : undefined;
	let loop = loopstr ? parseFloat(loopstr.replace(',', '.').slice(3)) : null;

	let sanitized = filename.replace(priorityregex, '').replace(loopregex, '').replace('@m', '');
	return {
		sanitizedName: sanitized,
		meta:
		{
			audiotype: filename.indexOf('@m') >= 0 ? AudioType.music : AudioType.effect,
			priority: priority,
			loop: loop!
		}
	};
}

function zip(content: Buffer): Uint8Array {
	let toCompress = new Uint8Array(content);
	return pako.deflate(toCompress);
}

async function deploy(romname: string, title: string): Promise<any> {
	return new Promise<any>((resolve, reject) => {
		log("Deployeren... ");
		const outfile = romname.concat('.rom');
		const ftpDeploy = new FtpDeploy();

		ftpDeploy.on("upload-error", function (data) {
			// Error already handled through catch.
			// This handler will remove default handler that outputs error message
			// reject(data.err); // data will also include filename, relativePath, and other goodies
		});

		let config = {
			user: "boazpat_el@ziggo.nl",
			password: "lars18th",
			host: "homedrive.ziggo.nl",
			port: 21,
			localRoot: "./dist",
			remoteRoot: `/${title.toLowerCase()}/`,
			// include: ["*", "**/*"],      // this would upload everything except dot files
			include: [outfile, "*.html", "manifest.*"],
			// e.g. exclude sourcemaps, and ALL files in node_modules (including dot files)
			exclude: [],//"dist/**/*.map", "node_modules/**", "node_modules/**/.*", ".git/**"],
			// delete ALL existing files at destination before uploading, if true
			deleteRemote: false,
			// Passive mode is forced (EPSV command is not sent)
			forcePasv: true
		};

		ftpDeploy
			.deploy(config)
			.then(res => { appendLogEntry(`${res}. ${_colors.grey('[Donut]')}\n`); resolve(null); })
			.catch(err => {
				reject(err);
			});
	});
}

function getResMetaByFilename(filepath: string): { name: string, ext: string, type: string; } {
	let name = parse(filepath).name.replace(' ', '').toLowerCase();
	let ext = parse(filepath).ext.toLowerCase();
	let type: string;

	switch (name) {
		case 'romlabel':
			if (ext === '.png')
				return { name: name, ext: ext, type: 'romlabel' };
	}

	switch (ext) {
		case '.wav':
			type = 'audio';
			break;
		case '.js':
			type = 'source';
			break;
		case '.png':
		default:
			type = 'image';
			break;
	}
	return { name: name, ext: ext, type: type };
}

function getResMetaList(respath: string, romname: string): ResourceMeta[] {
	let arrayOfFiles = getFiles(respath) ?? []; // Also handle corner case where we don't have any resources by adding "?? []"
	const megarom_filename = `${romname}.min.js`;
	addFile("./rom", megarom_filename, arrayOfFiles); // Add source at the end

	let result: Array<ResourceMeta> = [];

	let imgid = 1;
	let sndid = 1;
	for (let i = 0; i < arrayOfFiles.length; i++) {
		let filepath = arrayOfFiles[i];
		let meta = getResMetaByFilename(filepath);

		let type = meta.type;
		let name = meta.name;
		let ext = meta.ext;
		switch (type) {
			case 'image':
				result.push({ filepath: filepath, name: name, ext: ext, type: type, id: imgid });
				++imgid;
				break;
			case 'audio':
				let parsedMeta = parseAudioMeta(name);
				name = parsedMeta.sanitizedName;
				result.push({ filepath: filepath, name: name, ext: ext, type: type, id: sndid });
				++sndid;
				break;
			case 'romlabel':
				result.push({ filepath: filepath, name: name, ext: ext, type: type, id: undefined });
				break;
		}
	}
	if (GENERATE_AND_USE_TEXTURE_ATLAS) {
		result.push({ filepath: undefined, name: '_atlas', ext: undefined, type: 'atlas', id: imgid }); // Note that 'atlas' is an internal type, used only for this script
	}

	return result;
}

async function load_img(_meta: ResourceMeta) {
	const base64Encoded = readFileSync(_meta.filepath!, 'base64');
	const dataURL = `data:image/png;base64,${base64Encoded}`;
	return await loadImage(dataURL);
}

async function getLoadedResourcesList(respath: string, buffers: Array<Buffer>, romname: string): Promise<ILoadedResource[]> {
	let resMetaList = getResMetaList(respath, romname);
	let loadedResources: Array<ILoadedResource> = [];
	for (let i = 0; i < resMetaList.length; i++) {
		let meta = resMetaList[i];

		let name = meta.name;
		let ext = meta.ext;
		let type = meta.type;
		let id = meta.id;
		let buffer = meta.filepath ? readFileSync(meta.filepath) : null;

		let img: any = undefined;

		switch (type) {
			case 'romlabel':
				break;
			case 'image':
				if (GENERATE_AND_USE_TEXTURE_ATLAS) {
					// We only load the actual image when we need to place it in an atlas. Otherwise, we already have the buffer loaded from the resource URI
					img = await load_img(meta);
				}
				break;
		}

		loadedResources.push({ buffer: buffer!, filepath: meta.filepath, name: name, ext: ext, type: type, img: img, id: id });
	}

	const megarom_filename = `${romname}.min.js`;
	const filepath = `./rom/${megarom_filename}`;
	// Manually add the ROM source code to the list
	loadedResources.push({
		buffer: readFileSync(filepath),
		filepath: filepath,
		name: megarom_filename,
		ext: '.js',
		type: 'source',
		id: 1
	});

	if (GENERATE_AND_USE_TEXTURE_ATLAS) {
		// Sort the files on buffer size for atlassing
		// Also: place the atlas in the back, so that we can correctly use the bufferpointer to point to the atlas
		loadedResources = loadedResources.sort((b1, b2) => ((b1.type === 'atlas' ? 1 : 0) - (b2.type === 'atlas' ? 1 : 0)));
		// Also: place the romlabel in front, so that it is put at the start of the rom and will be recognized as a proper image
		loadedResources = loadedResources.sort((b1, b2) => ((b1.type === 'romlabel' ? 0 : 1) - (b2.type === 'romlabel' ? 0 : 1)));
	}
	if (GENERATE_AND_USE_TEXTURE_ATLAS && DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
		loadedResources.filter(x => x.type !== 'image' && x.type !== 'atlas' && x.type !== 'romlabel').forEach(x => buffers.push(x.buffer));
	}
	else {
		loadedResources.filter(x => x.type !== 'romlabel').forEach(x => buffers.push(x.buffer));
	}
	return loadedResources;
}

function buildResourceList(respath: string, romname: string): void {
	log("resourceids.ts knutselen...  ");
	let tsimgout = new Array<string>();
	let tssndout = new Array<string>();

	let metalist = getResMetaList(respath, romname);

	tsimgout.push(BOILERPLATE_RESOURCE_ID_BITMAP);
	tssndout.push(BOILERPLATE_RESOURCE_ID_AUDIO);

	for (let i = 0; i < metalist.length; i++) {
		let current = metalist[i];

		let type = current.type;
		let name = current.name;
		switch (type) {
			case 'image':
			case 'atlas':
				let property_to_add = `\t${name} = '${name}',`;
				tsimgout.push(`${property_to_add}`);
				break;
			case 'audio':
				let enummember_to_add = `\t${name} = '${name}',`;
				tssndout.push(`${enummember_to_add}`);
				break;
		}
	}

	tsimgout.push("}\n");
	tssndout.push("}\n");

	let total_output: string = tsimgout.concat(tssndout).join('\n');

	let targetPath = respath.replace('/res', '/resourceids.ts');
	log(`resourceids.ts wegschrijven naar "${targetPath}"... `);
	writeFileSync(targetPath, total_output);
	appendLogEntry(`${_colors.grey('[Donut]')}\n`);
}

async function buildRompack(romname: string, respath: string): Promise<any> {
	return new Promise<any>(async (resolve, reject) => {
		log("Minifyen... ");
		const outfile = romname.concat('.rom');
		const megarom_filename = `${romname}.js`;
		const megarom_min_filename = `${romname}.min.js`;
		const megarom_min_map_filename = `${romname}.min.map`;
		const megarom_filepath = `./rom/${megarom_filename}`;
		const megarom_min_filepath = `./rom/${megarom_min_filename}`;
		const megarom_min_map_filepath = `./rom/${megarom_min_map_filename}`;

		const minifyGamecodeResult = await minifyGamecode(megarom_filepath);
		writeFileSync(megarom_min_filepath, minifyGamecodeResult.code!);
		if (minifyGamecodeResult.map) {
			writeFileSync(megarom_min_map_filepath, minifyGamecodeResult.map as string);
		}

		copyFileSync(megarom_filepath, `./${megarom_filename}`);
		rmSync(megarom_filepath);

		const buffers = new Array<Buffer>();
		log("Resource bestanden inladen en bufferen...  ");
		const loadedResources: ILoadedResource[] = await getLoadedResourcesList(respath, buffers, romname).catch(err => reject(err)) as ILoadedResource[];
		let generated_atlas: HTMLCanvasElement = undefined;
		if (GENERATE_AND_USE_TEXTURE_ATLAS) {
			// Use algorithm to optimize atlas
			generated_atlas = createOptimizedAtlas(loadedResources);
		}

		appendLogEntry(`${_colors.grey('[Donut]')}\n`);

		log("romresources.json knutselen...  ");

		let jsonout = new Array<RomAsset>();
		let bufferPointer = 0;
		let romlabel_buffer: Buffer = undefined;
		for (let i = 0; i < loadedResources.length; i++) {
			let res: ILoadedResource = loadedResources[i];
			let type = res.type;
			let name = res.name;
			let resid = res.id;
			switch (type) {
				case 'romlabel':
					if (i > 0) throw '"romlabel.png" must appear at start of the ResourceMeta-list, while building the rompack ("romresources.json")! Thus, this is a bug and a fix is required!';
					// Ignore this part. Don't even increase the buffer pointer (all other buffers will be zipped)!
					romlabel_buffer = res.buffer;
					break;
				case 'image':
					let img = res.img;
					let imgmeta: ImgMeta;
					if (GENERATE_AND_USE_TEXTURE_ATLAS) {
						// imgmeta = addToAtlas(img);
						imgmeta = res.imgmeta;
						if (DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
							jsonout.push({ resid: resid, resname: name, type: type, start: 0, end: 0, imgmeta: { atlassed: imgmeta.atlassed, width: imgmeta.width, height: imgmeta.height, texcoords: imgmeta.texcoords, texcoords_fliph: imgmeta.texcoords_fliph, texcoords_flipv: imgmeta.texcoords_flipv, texcoords_fliphv: imgmeta.texcoords_fliphv }, audiometa: undefined, });
						}
						else {
							jsonout.push({ resid: resid, resname: name, type: type, start: bufferPointer, end: bufferPointer + res.buffer.length, imgmeta: { atlassed: imgmeta.atlassed, width: imgmeta.width, height: imgmeta.height, texcoords: imgmeta.texcoords, texcoords_fliph: imgmeta.texcoords_fliph, texcoords_flipv: imgmeta.texcoords_flipv, texcoords_fliphv: imgmeta.texcoords_fliphv }, audiometa: undefined, });
							bufferPointer += res.buffer.length;
						}
					}
					else {
						jsonout.push({ resid: resid, resname: name, type: type, start: bufferPointer, end: bufferPointer + res.buffer.length, imgmeta: { atlassed: false, width: img.width, height: img.height, }, audiometa: undefined, });
						bufferPointer += res.buffer.length;
					}
					break;
				case 'audio':
					{
						let parsedMeta = parseAudioMeta(res.filepath);

						// name = parsedMeta.sanitizedName;
						jsonout.push({ resid: resid, resname: name, type: type, start: bufferPointer, end: bufferPointer + res.buffer.length, imgmeta: undefined, audiometa: parsedMeta.meta });
					}
					bufferPointer += res.buffer.length;
					break;
				case 'source':
					name = name.replace('.min', '');
					jsonout.push({ resid: resid, resname: name, type: type, start: bufferPointer, end: bufferPointer + res.buffer.length, imgmeta: undefined, audiometa: undefined });
					bufferPointer += res.buffer.length;
					break;
				case 'atlas':
					break;
			}
		}

		if (GENERATE_AND_USE_TEXTURE_ATLAS) {
			let i = loadedResources.findIndex(x => x.type === 'atlas');
			const atlasSize = { x: generated_atlas.width, y: generated_atlas.height };
			const atlasbuffer: Buffer = (<any>generated_atlas).toBuffer('image/png');
			buffers.push(atlasbuffer);

			jsonout.push({ resid: loadedResources[i].id, resname: loadedResources[i].name, type: 'image', start: bufferPointer, end: bufferPointer + atlasbuffer.length, imgmeta: { atlassed: false, width: atlasSize.x, height: atlasSize.y }, audiometa: undefined });
			bufferPointer += atlasbuffer.length;
			writeFileSync("./rom/_ignore/atlas.png", atlasbuffer);
		}

		const jsonbuffer = Buffer.from(encodeuint8arr(JSON.stringify(jsonout)));
		buffers.push(jsonbuffer);

		const rommeta = <RomMeta>{
			start: bufferPointer,
			end: bufferPointer + jsonbuffer.length
		};
		const rom_meta_string = JSON.stringify(rommeta).padStart(100, ' ');
		buffers.push(Buffer.from(encodeuint8arr(rom_meta_string)));
		appendLogEntry(`${_colors.grey('[Donut]')}\n`);
		log(`\t#images: ${loadedResources.filter(r => r.type == 'image').length}\n`);
		log(`\t#audio: ${loadedResources.filter(r => r.type == 'audio').length}\n`);

		log("Alles nu zippen... ");
		const all_buffers = Buffer.concat(buffers);
		const zipped = zip(all_buffers);
		const blobmeta = <RomMeta>{
			start: romlabel_buffer?.length ?? 0,
			end: zipped.length + (romlabel_buffer?.length ?? 0)
		};
		const blob_meta_string = JSON.stringify(blobmeta).padStart(100, ' ');
		const blob_meta_as_buffer = Buffer.from(encodeuint8arr(blob_meta_string));
		appendLogEntry(`${_colors.grey('[Donut]')}\n`);
		log(`\tSize: ${_colors.red(`${(Buffer.concat(buffers).length / (1024 * 1024)).toFixed(2)} mB`)} ⇒  Deflated: ${_colors.blue(`${(zipped.length / (1024 * 1024)).toFixed(2)} mB (${((zipped.length / Buffer.concat(buffers).length) * 100).toFixed(0)}%)`)}\n`);

		log(`"${_colors.green(romname)}" wegschrijven naar ${_colors.green(`\"./dist/${outfile}\"`)}...`);
		writeFileSync(`./dist/${outfile}`, Buffer.concat([romlabel_buffer ?? Buffer.alloc(0), zipped, blob_meta_as_buffer]));
		writeFileSync("./rom/_ignore/romresources.json", jsonbuffer);
		appendLogEntry(`${_colors.grey('[Donut]')}\n`);

		resolve(null);
	});
}


const outputError = (e: any) => writeOut(`\n[GEFAALD]\nEr ging iets niet goed:\n${e?.message ?? e ?? 'Geen error message'};\n${e?.stack ?? 'Geen stacktrace.'}\n`, 'error');

async function isRebuildRequired(romname: string, bootloaderPath: string, resPath: string): Promise<boolean> {
	const distPath = `./dist/${romname}.rom`;
	const distPath2 = `./rom/${romname}.min.js`; // TODO: LELIJK! PROBLEEM IS DAT NORMALE .JS WORDT VERPLAATST NAAR ROOT-FOLDER (EN DAT IS OOK LELIJK!)

	if (!existsSync(distPath) || !existsSync(distPath2)) {
		return true;
	}

	const romStats = statSync(distPath);
	const romMtime = romStats.mtime;

	const shouldRebuild = async (dir: string, checkTsFiles: boolean, checkAssets: boolean): Promise<boolean> => {
		if (!existsSync(dir)) {
			throw new Error(`Directory "${dir}" bestaat niet!`);
		}
		const entries = await readdir(dir, { withFileTypes: true });

		for (const entry of entries) {
			const entryPath = join(dir, entry.name);

			if (entry.isDirectory()) {
				if (entry.name === '_ignore') {
					continue;
				}
				const rebuild = await shouldRebuild(entryPath, checkTsFiles, checkAssets);
				if (rebuild) {
					return true;
				}
			} else {
				if (
					(checkTsFiles && entry.name.endsWith('.ts')) ||
					(checkAssets && existsSync(entryPath))
				) {
					const entryStats = statSync(entryPath);
					const entryMtime = entryStats.mtime;

					if (entryMtime > romMtime) {
						return true;
					}
				}
			}
		}

		return false;
	};

	const shouldCheckTsFiles = dir => dir.startsWith(bootloaderPath);
	const shouldCheckAssets = dir => dir.startsWith(resPath);

    return await shouldRebuild(bootloaderPath, shouldCheckTsFiles(bootloaderPath), shouldCheckAssets(bootloaderPath)) ||
        await shouldRebuild(resPath, shouldCheckTsFiles(resPath), shouldCheckAssets(resPath)) ||
        await shouldRebuild('src/bmsx', true, false);
}

async function main() {
	try {
		// #region stuff
		term.terminal.clear();
		writeOut(_colors.brightGreen('┏————————————————————————————————————————————————————————————————————————————————┓\n'));
		writeOut(_colors.brightGreen('|                          BMSX ROMPACKER DOOR BOAZ©®™                           |\n'));
		writeOut(_colors.brightGreen('┗————————————————————————————————————————————————————————————————————————————————┛\n'));
		const args = process.argv.slice(2);
		let romname: string = 'not-parsed!';
		let title: string = 'not-parsed!';
		let bootloader_path: string = 'not-parsed!';
		let respath: string = 'not-parsed!';
		let force: boolean = false;
		let unrecognizedParam: boolean = false;
		let buildreslist: boolean = false;
		let deployToFtp: boolean = true;

		for (let i = 0; i < args.length; i++) {
			switch (args[i]) {
				case '-title':
					title = args[++i];
					break;
				case '-romname':
					romname = args[++i].toLowerCase();
					if (romname.includes('.')) {
						throw new Error(`'-romname' should not contain any extensions! The given romname was ${romname}. Example of good '-romname': 'testrom'.`);
					}
					break;
				case '-bootloaderpath':
					bootloader_path = args[++i];
					break;
				case '-respath':
					respath = args[++i];
					break;
				case '--force':
					force = true;
					break;
				case '--buildreslist':
					buildreslist = true;
					break;
				case '--nodeploy':
					deployToFtp = false;
					break;
				default:
					writeOut(_colors.red(`Unrecognized argument: ${args[i]}.\n`));
					unrecognizedParam = true;
					break;
			}
		}
		if (unrecognizedParam) throw new Error("Unrecognized parameter(s) passed. Exiting rompacker...");

		if (buildreslist) {
			writeOut('Building resource list and writing output to "./src/bmsx/resourceids.ts"...\n');
			writeOut('  Note: ROM packing and deployement are skipped.\n');
			await buildResourceList(respath, romname);
			writeOut(`\n${_colors.brightWhite.bold('[Resource list bouwen ge-DONUT]')}\n`);
		}
		else {
			if (!title) throw new Error("Missing parameter for title ('title', e.g. 'Sintervania'.");
			if (!romname) throw new Error("Missing parameter for output file ('outfile', e.g. 'sintervania.rom'.");
			if (!bootloader_path) throw new Error("Missing parameter for location of the bootloader.ts-file ('bootloader_path', e.g. 'src/testrom'.");
			if (!respath) throw new Error("Missing parameter for location of the resource folder ('respath', e.g. './src/testrom/res'.");

			let rebuildRequired = true;

			if (!force) {
				rebuildRequired = await isRebuildRequired(romname, bootloader_path, respath);
				if (!rebuildRequired) {
					writeOut('Rebuild skipped: game rom was newer than code/assets (use --force option to ignore this check).');
				}
			}
			else writeOut('  Note: Recompilation and Building forced via --force\n');
			if (!deployToFtp) writeOut('  Note: Deploy to FTP server disabled via --nodeploy\n');

			writeOut(`Starting ROM packing and deployment process for ROM ${_colors.brightBlue.bold(`${romname}`)}...\n`);

			const takenlijst = ['Game compileren en bundleren', 'YAML bestanden omzetten in JSON voor importatie', 'Minifying + Resource bestanden inladen en bufferen', 'game.html en game_debug.html bouwen', 'Deployeren'];
			if (!deployToFtp) takenlijst.pop();
			if (!rebuildRequired) {
				takenlijst.shift();
				takenlijst.shift();
				takenlijst.shift();
			}

			let poptions: term.Terminal.ProgressBarOptions = {
				title: 'Beunen:',
				barChar: '█',
				barHeadChar: '█',
				eta: false,
				percent: false,
				items: takenlijst.length,
				itemStyle: term.terminal.dim,
				syncMode: true,
				maxRefreshTime: 10,
				minRefreshTime: 10,
			};

			let progress = term.terminal.progressBar(poptions);

			let huidigeTaak = takenlijst.shift()!;
			let taakAfgevinkt = () => {
				progress.itemDone(huidigeTaak);

				if (!takenlijst.length) return;
				huidigeTaak = takenlijst.shift()!;
				progress.startItem(huidigeTaak);
			};

			progress.startItem(huidigeTaak);
			// #endregion
			try {
				await timer(200);
				if (rebuildRequired) {
					await buildAndBundleRomSource(romname, bootloader_path);
					taakAfgevinkt();
					await yaml2Json();
					taakAfgevinkt();
					await buildRompack(romname, respath);
					taakAfgevinkt();
				}
				await buildGameHtmlAndManifest(romname, title);
				taakAfgevinkt();
				if (deployToFtp) {
					await deploy(romname, title);
					taakAfgevinkt();
				}
				progress.stop();
				writeOut(`\n${_colors.brightWhite.bold('[ALLES DONUT]')}\n`);
			} catch (e) {
				outputError(e);
				progress.stop();
				process.exit(-1);
			}
		}
	} catch (e) {
		outputError(e);
		process.exit(-1);
	}
}

main();