import { glsl } from "esbuild-plugin-glsl";
import type { Stats } from 'fs';
import type { AudioMeta, ImgMeta, RomAsset, vec2arr, Polygon } from '../src/bmsx/rompack/rompack';
import { createOptimizedAtlas, generateAtlasName } from './atlasbuilder';
import { BoundingBoxExtractor } from './boundingbox_extractor';
import type { Resource, RomManifest, resourcetype } from './rompacker.rompack';
const { build } = require('esbuild');
const { join, parse } = require('path');

const { access, readdir, readFile, stat, writeFile } = require('fs/promises');
const { encodeBinary } = require('../src/bmsx/serializer/binencoder');
const pako = require('pako');
const minify = require('@node-minify/core');
const cleanCSS = require('@node-minify/clean-css');
const { loadImage } = require('canvas');
const yaml = require('js-yaml');

// Command line parameter for texture atlas usage
let GENERATE_AND_USE_TEXTURE_ATLAS = true;
export const DONT_PACK_IMAGES_WHEN_USING_ATLAS = true;
export const BOOTROM_TS_FILENAME = 'bootrom.ts';
export const BOOTROM_JS_FILENAME = 'bootrom.js';
export const ROM_TS_RELATIVE_PATH = `../scripts/${BOOTROM_TS_FILENAME}`;
export const ROM_JS_RELATIVE_PATH = `../rom/${BOOTROM_JS_FILENAME}`;

const BOILERPLATE_RESOURCE_ID_BITMAP = `export enum BitmapId {
	none = 'none',`; // Note: cannot use const enums here, because BFont uses BitmapId as a type (and const enums are not available at runtime)

const BOILERPLATE_RESOURCE_ID_AUDIO = `export enum AudioId {
	none = 'none',`;

const BOILERPLATE_RESOURCE_ID_DATA = `export enum DataId {
	none = 'none',`;

/**
* Adds a file to an array of files.
* @param {string} dirPath - The path of the directory containing the file.
* @param {string} filePath - The path of the file to add.
* @param {string[]} arrayOfFiles - The array of files to append to.
* @returns {void}
*/
export function addFile(dirPath: string, filePath: string, arrayOfFiles: string[]): void {
    arrayOfFiles.push(join(dirPath, "/", filePath));
}

/**
 * Recursively gets all files in a directory and its subdirectories, optionally filtered by file extension.
 * @param {string} dirPath - The path of the directory to search.
 * @param {string[]} [_arrayOfFiles] - An optional array of files to append to.
 * @param {string} [filterExtension] - An optional file extension to filter by.
 * @returns {string[]} An array of file paths.
 */
export async function getFiles(dirPath: string, arrayOfFiles?: string[], filterExtension?: string): Promise<string[]> {
    const files = await readdir(dirPath);
    let array = arrayOfFiles || [];
    for (let file of files) {
        if (file.indexOf('_ignore') > -1) continue;

        let fullpath = `${dirPath}/${file}`;
        let stats = await stat(fullpath);
        if (stats.isDirectory()) {
            array = await getFiles(fullpath, array, filterExtension);
        } else {
            let ext = parse(file).ext;
            if (filterExtension) {
                if (ext === filterExtension) {
                    array.push(fullpath);
                }
            }
            else if (ext !== ".rom" && ext !== ".js" && ext !== ".ts" && ext !== ".map" && ext !== ".tsbuildinfo" && ext !== ".rommanifest") {
                array.push(fullpath);
            }
        }
    }
    return array;
}

export async function getRomManifest(dirPath: string): Promise<RomManifest> {
    const files = await getFiles(dirPath, [], '.rommanifest');

    if (files.length > 1) {
        throw new Error(`More than one rommanifest found in ${dirPath}.`);
    }
    else if (files.length === 1) {
        const res = await readFile(files[0]);
        // Read and return the rommanifest file
        return JSON.parse(res.toString()) as RomManifest;
    }
    else return null;
}

/**
 * Builds and bundles the source code for a ROM using esbuild.
 * @param {string} romname - The name of the ROM.
 * @param {string} bootloader_path - The path to the bootloader file.
 * @returns {Promise<any>} A promise that resolves when the ROM source code has been built and bundled.
 */
export async function esbuild(romname: string, bootloader_path: string): Promise<void> {
    const bootloader_ts_path = `${bootloader_path}/bootloader.ts`;
    try {
        await build({
            entryPoints: [bootloader_ts_path], // Entry point for the rompack
            bundle: true, // Bundle all dependencies into a single file
            sourcemap: 'inline', // Include inline source maps for debugging
            sourcesContent: false,
            outfile: `./rom/${romname}.js`, // Output file for the bundled code
            platform: 'browser', // Target platform for the bundle
            target: 'es2020', // Specify the ECMAScript version to target
            // Specify the ECMAScript version to target
            loader: { '.glsl': 'text' }, // Handles GLSL files as text
            plugins: [glsl({
                minify: true
            })],
            define: { 'process.env.NODE_ENV': '"production"' },
            minify: true,
            keepNames: true,
            external: ['node_modules', 'dist', 'rom', 'ts-key-enum'],
            treeShaking: true,
        });
        return null;
    } catch (err) {
        throw err;
    }
}

/**
 * Applies a set of replacements to a given string.
 *
 * @param str - The string to apply replacements to.
 * @param replacements - An object mapping placeholders to their replacement values.
 * @returns The string with replacements applied.
 */
export function applyStringReplacements(str: string, replacements: { [key: string]: string }): string {
    let result = str;
    for (const [key, value] of Object.entries(replacements)) {
        result = result.replace(new RegExp(key, 'g'), value);
    }
    return result;
}

/**
 * Builds the game HTML and manifest files for the specified ROM.
 * @param {string} rom_name - The name of the ROM.
 * @param {string} title - The title of the game.
 * @param {string} short_name - The short name of the game.
 * @returns {Promise<any>} A promise that resolves when the game HTML and manifest files have been built.
 */
export async function buildGameHtmlAndManifest(rom_name: string, title: string, short_name: string): Promise<any> {
    const IMAGE_PATHS = [
        './rom/bmsx.png',
        './rom/d-pad-neutral.png',
        './rom/d-pad-u.png',
        './rom/d-pad-ru.png',
        './rom/d-pad-r.png',
        './rom/d-pad-rd.png',
        './rom/d-pad-d.png',
        './rom/d-pad-ld.png',
        './rom/d-pad-l.png',
        './rom/d-pad-lu.png'
    ];

    /**
     * Loads an image from the specified file path and converts it to a base64 string.
     *
     * @param filepath - The path of the image file to load.
     * @returns A promise that resolves to the base64 string representation of the image.
     * @throws An error if there is an issue reading the file.
     */
    async function loadImgAndConvertToBase64String(filepath: string): Promise<string> {
        try {
            const image = await readFile(filepath);
            return image.toString('base64');
        } catch (error) {
            throw new Error(`Error reading file "${__dirname}${filepath}": ${error.message}`);
        }
    }

    /**
     * Loads multiple images and converts them to base64 strings.
     *
     * @param paths - An array of image file paths to load.
     * @returns A promise that resolves to an object mapping file paths to base64 strings.
     */
    async function loadImages(paths: string[]): Promise<{ [key: string]: string }> {
        const images: { [key: string]: string } = {};
        const results = await Promise.all(paths.map(async (path) => {
            return [path, await loadImgAndConvertToBase64String(path)] as [string, string];
        }));
        for (const [path, base64] of results) {
            images[path] = base64;
        }
        return images;
    }

    /**
     * Transforms the HTML template by replacing placeholders with actual values.
     *
     * @param htmlToTransform - The HTML template to transform.
     * @param cssMinified - The minified CSS string.
     * @param debug - A boolean indicating whether to include debug information.
     * @returns A promise that resolves to the transformed HTML string.
     */
    async function transformHtml(htmlToTransform: string, cssMinified: string, debug: boolean): Promise<string> {
        const imgPrefix = 'data:image/png;base64,';
        const replacements = {
            '//#romjs': romjs,
            '//#zipjs': zipjs,
            '/\\*#css\\*/': cssMinified,
            '#title': title,
            '//#debug': `bootrom.debug = ${debug};\n\t\tbootrom.romname = getRomNameFromUrlParameter() ?? '${rom_name}';\n`,
            '#romname': rom_name,
            '#outfile': `${rom_name}.rom`,
            '#bmsxurl': `${imgPrefix}${images['./rom/bmsx.png']}`,
            '#d-pad-d_': `${imgPrefix}${images['./rom/d-pad-d.png']}`, // Note: the trailing underscore is used to prevent the replacement of other placeholders
            '#d-pad-l_': `${imgPrefix}${images['./rom/d-pad-l.png']}`, // Note: the trailing underscore is used to prevent the replacement of other placeholders
            '#d-pad-ld': `${imgPrefix}${images['./rom/d-pad-ld.png']}`,
            '#d-pad-lu': `${imgPrefix}${images['./rom/d-pad-lu.png']}`,
            '#d-pad-neutral': `${imgPrefix}${images['./rom/d-pad-neutral.png']}`,
            '#d-pad-r_': `${imgPrefix}${images['./rom/d-pad-r.png']}`, // Note: the trailing underscore is used to prevent the replacement of other placeholders
            '#d-pad-rd': `${imgPrefix}${images['./rom/d-pad-rd.png']}`,
            '#d-pad-ru': `${imgPrefix}${images['./rom/d-pad-ru.png']}`,
            '#d-pad-u_': `${imgPrefix}${images['./rom/d-pad-u.png']}`, // Note: the trailing underscore is used to prevent the replacement of other placeholders
        };

        return applyStringReplacements(htmlToTransform, replacements);
    }

    let html: string, romjs: string, zipjs: string;
    try {
        html = await readFile("./gamebase.html", 'utf8');
        romjs = (await readFile(`./rom/${BOOTROM_JS_FILENAME}`, 'utf8')).replace('Object.defineProperty(exports, "__esModule", { value: true });', '');
        zipjs = await readFile("./scripts/pako_inflate.min.js", 'utf8');
    } catch (error) {
        throw new Error(`Error reading files while building HTML and Manifest files: ${error.message}`);
    }

    const images = await loadImages(IMAGE_PATHS);

    return new Promise<any>((resolve, reject) => {
        minify({
            compressor: cleanCSS,
            input: "./gamebase.css",
            output: "./rom/gamebase.min.css",
            callback: async (err: any, cssMinified: string) => {
                if (!cssMinified) {
                    return reject(err);
                }

                try {
                    const transformedHtml = await transformHtml(html, cssMinified, false);
                    const transformedDebugHtml = await transformHtml(html, cssMinified, true);

                    await writeFile("./dist/game.html", transformedHtml);
                    await writeFile("./dist/game_debug.html", transformedDebugHtml);

                    // Update the manifest.json-file that is used for app-versions of the webpage
                    const manifest = (await readFile("./rom/manifest.json", 'utf8')).replace('#title', title).replace('#short_name', short_name);

                    // Write updated manifest to dist-folder
                    await writeFile("./dist/manifest.webmanifest", manifest);

                    resolve(null);
                } catch (error) {
                    reject(error);
                }
            }
        });
    });
}

/**
 * Parses the metadata of an audio file from its filename.
 * @param {string} filename - The name of the audio file.
 * @returns {Object} An object containing the sanitized name of the audio file and its metadata.
 */
export function parseAudioMeta(filename: string) {
    const priorityregex = /@p\=\d+/;
    const priorityresult = priorityregex.exec(filename);
    const prioritystr = priorityresult ? priorityresult[0] : undefined;
    const priority = prioritystr ? parseInt(prioritystr.slice(3)) : 0;

    const loopregex = /@l\=\d+(,\d+)?/;
    const loopresult = loopregex.exec(filename);
    const loopstr = loopresult ? loopresult[0] : undefined;
    const loop = loopstr ? parseFloat(loopstr.replace(',', '.').slice(3)) : null;

    const sanitizedName = filename.replace(priorityregex, '').replace(loopregex, '').replace('@m', '');
    const audiometa: AudioMeta =
    {
        audiotype: filename.indexOf('@m') >= 0 ? 'music' : 'sfx',
        priority: priority,
        loop: loop !== null ? loop : undefined
    };
    return { sanitizedName, audiometa };
}

// --- Image filename collision-type suffix parser ---
export function parseImageMeta(filenameWithoutExt: string): { sanitizedName: string, collisionType: 'concave' | 'convex' | 'aabb', targetAtlas?: number } {
    // Match @cc or @cx for collision type, and @atlas=n for atlas assignment (order-insensitive)
    const collisionMatch = filenameWithoutExt.match(/@(cc|cx)/i);
    let collisionType: 'concave' | 'convex' | 'aabb' = 'aabb';
    if (collisionMatch) {
        const code = collisionMatch[1].toLowerCase();
        collisionType = code === 'cc' ? 'concave' : code === 'cx' ? 'convex' : 'aabb';
    }
    let targetAtlas = undefined;
    if (GENERATE_AND_USE_TEXTURE_ATLAS && DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
        const atlasMatch = filenameWithoutExt.match(/@atlas=(\d+)/i);
        targetAtlas = atlasMatch ? parseInt(atlasMatch[1], 10) : undefined;
        if (targetAtlas === undefined) {
            // If no atlas is specified, we use the default atlas 0
            targetAtlas = 0;
        }
    }

    // Remove all @cc, @cx, and @atlas=n (in any order)
    const sanitizedName = filenameWithoutExt
        .replace(/@(cc|cx)/ig, '')
        .replace(/@atlas=\d+/ig, '');

    return { sanitizedName, collisionType, targetAtlas };
}

/**
 * Compresses the given content using the zip algorithm and returns the compressed content as a Uint8Array.
 *
 * @param content - The content to be compressed.
 * @returns The compressed content as a Uint8Array.
 */
export function zip(content: Buffer): Uint8Array {
    const toCompress = new Uint8Array(content);
    return pako.deflate(toCompress);
}

/**
 * Returns an object containing the name, extension, and type of a resource file based on its filepath.
 * @param filepath The path of the resource file.
 * @returns An object containing the name, extension, and type of the resource file.
 */
export function getResMetaByFilename(filepath: string): { name: string, ext: string, type: resourcetype, collisionType?: 'concave' | 'convex' | 'aabb' | undefined, datatype?: 'json' | 'yaml' | 'bin' | undefined } {
    let name = parse(filepath).name.replace(' ', '').toLowerCase();
    const ext = parse(filepath).ext.toLowerCase();
    let type: resourcetype;
    let collisionType: 'concave' | 'convex' | 'aabb' | undefined = undefined;
    let datatype: 'json' | 'yaml' | 'bin' | undefined = undefined;

    switch (ext) {
        case '.wav':
            type = 'audio';
            break;
        case '.js':
            type = 'code';
            break;
        case '.rommanifest':
            type = 'rommanifest';
            break;
        case '.atlas': // `.atlas`-files don't exist. We use this to add the atlas to the resource list
            type = 'atlas';
            break;
        case '.png':
            if (name === 'romlabel') {
                // Special case for romlabel, which is a PNG file with a specific name
                type = 'romlabel';
            }
            else {
                type = 'image';
            }
            break;
        case '.json':
            datatype = 'json';
            type = 'data';
            break;
        case '.yaml':
            datatype = 'yaml';
            type = 'data';
            break;
        case '.bin':
            datatype = 'bin';
            type = 'data';
            break;
    }
    return { name: name, ext, type, collisionType, datatype };
}

/**
 * Builds a list of resource objects located at `respath` for the specified `romname`.
 * @param respath The path to the resources to include in the list.
 * @param romname The name of the ROM pack to build the list for.
 * @returns An array of resources with basic metadata.
 */
export async function getResMetaList(respath: string, romname?: string): Promise<Resource[]> {
    const arrayOfFiles = await getFiles(respath) ?? []; // Also handle corner case where we don't have any resources by adding "?? []"
    const megarom_filename = `${romname}.js`;
    // Note that romname can be undefined when building the resource enum file, so we only add the file if romname is defined
    if (romname) {
        addFile("./rom", megarom_filename, arrayOfFiles); // Add source at the end
    }

    const result: Array<Resource> = [];
    const targetAtlasIdSet = new Set<number>();

    let imgid = 1;
    let sndid = 1;
    let dataid = 1;
    for (let i = 0; i < arrayOfFiles.length; i++) {
        const filepath = arrayOfFiles[i];
        const meta = getResMetaByFilename(filepath);

        const type = meta.type;
        let name = meta.name;
        const ext = meta.ext;
        switch (type) {
            case 'image':
                const imgMeta = parseImageMeta(name);
                name = imgMeta.sanitizedName; // Remove metadata from the name
                // If we are generating and using texture atlases, we need to add the image to the atlas
                if (GENERATE_AND_USE_TEXTURE_ATLAS && DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
                    if (imgMeta.targetAtlas !== undefined) targetAtlasIdSet.add(imgMeta.targetAtlas);
                }
                result.push({ filepath: filepath, name: name, ext: ext, type: type, id: imgid, collisionType: imgMeta.collisionType, targetAtlasIndex: imgMeta.targetAtlas });
                ++imgid;
                break;
            case 'audio':
                const parsedMeta = parseAudioMeta(name);
                name = parsedMeta.sanitizedName; // Remove metadata from the name
                result.push({ filepath: filepath, name: name, ext: ext, type: type, id: sndid });
                ++sndid;
                break;
            case 'romlabel':
                result.push({ filepath: filepath, name: name, ext: ext, type: type, id: undefined });
                break;
            case 'rommanifest':
                result.push({ filepath: filepath, name: name, ext: ext, type: type, id: undefined });
                break;
            case 'code':
                // For code files, we use the romname as the name
                break;
            case 'data':
                // For data files, we use the name as is
                result.push({ filepath: filepath, name: name, ext: ext, type: type, id: dataid, datatype: meta.datatype });
                ++dataid;
                break;
            case 'atlas':
                // Atlas files are not real files, but we add them to the resource list in the next step
                break;
        }
    }

    // If we are generating and using texture atlases, we need to add the atlasses to the resource list
    // @ts-ignore
    for (const id of targetAtlasIdSet) {
        const name = generateAtlasName(id);
        result.push({ filepath: undefined, name, ext: '.atlas', type: 'atlas', id: imgid++, collisionType: undefined, targetAtlasIndex: undefined, atlasid: id });
    }

    // Validation: ensure no duplicate IDs within the same resource type (image or audio)
    const checkDuplicateIds = (type: string) => {
        const filtered = result.filter(r => r.type === type && typeof r.id === 'number');
        const idMap = new Map<number, string[]>();
        for (const r of filtered) {
            if (!idMap.has(r.id)) idMap.set(r.id, []);
            idMap.get(r.id)!.push(r.name);
        }
        const dups = Array.from(idMap.entries()).filter(([id, names]) => names.length > 1);
        if (dups.length > 0) {
            const msg = dups.map(([id, names]) => `ID ${id} used by: ${names.join(', ')}`).join('\n');
            throw new Error(`Duplicate ${type} resource IDs found!\n${msg}`);
        }
    };

    const checkDuplicateNames = (type: string) => {
        const filtered = result.filter(r => r.type === type && typeof r.name === 'string');
        const nameMap = new Map<string, string[]>();
        for (const r of filtered) {
            // Only consider exact matches for names
            const key = r.name;
            if (!nameMap.has(key)) nameMap.set(key, []);
            nameMap.get(key)!.push(r.filepath);
        }
        const dups = Array.from(nameMap.entries()).filter(([name, paths]) => paths.length > 1);
        if (dups.length > 0) {
            const msg = dups.map(([name, paths]) => `Name "${name}" used by: ${paths.join(', ')}`).join('\n');
            throw new Error(`Duplicate ${type} resource names found!\n${msg}`);
        }
    };

    checkDuplicateIds('image');
    checkDuplicateIds('audio');
    checkDuplicateNames('data');
    checkDuplicateNames('image');
    checkDuplicateNames('audio');
    checkDuplicateNames('data');

    return result;
}

/**
 * Builds a list of resources located at `respath` for the specified `romname`.
 * @param rom_name The name of the ROM pack to build the list for.
 * @returns An array of resources.
 */
export async function getResourcesList(resMetaList: Resource[], rom_name: string): Promise<Resource[]> {
    let resources: Array<Resource> = [];

    /**
     * Loads an image from the specified resource object.
     * @param _meta The resource object containing information about the image to load.
 * @returns A Promise that resolves with the loaded image.
 */
    async function getImageFromBuffer(buffer: Buffer) {
        const base64Encoded = buffer.toString('base64');
        const dataURL = `data:images/png;base64,${base64Encoded}`;
        return await loadImage(dataURL);
    }

    // Parallelize buffer and image loading
    const resourcePromises = resMetaList.map(async (meta) => {
        const type = meta.type;
        const buffer = meta.filepath ? await readFile(meta.filepath) : null;
        let img: any = undefined;
        if (type === 'image') img = await getImageFromBuffer(buffer);
        const toAdd: Resource = {
            ...meta,
            buffer: buffer,
            img: img,
        };

        return toAdd;
    });
    resourcePromises.push((async () => {
        const megarom_filename = `${rom_name}.js`;
        const filepath = `./rom/${megarom_filename}`;
        // Manually add the ROM source code to the list
        return {
            buffer: await readFile(filepath),
            filepath: filepath,
            name: megarom_filename,
            ext: '.js',
            type: 'code',
            img: undefined, // Add missing fields to match Resource
            id: 1,
            collisionType: undefined // Add missing fields to match Resource
        };
    })());

    resources = await Promise.all(resourcePromises);

    return resources;
}

/**
 * Builds a list of resources located at `respath` for the specified `romname`.
 * @param respath The path to the resources to include in the list.
 * @param rom_name The name of the ROM pack to build the list for.
 */
export async function buildResourceList(respath: string, rom_name?: string) {
    const tsimgout = new Array<string>();
    const tssndout = new Array<string>();
    const tsdataout = new Array<string>();
    const metalist = await getResMetaList(respath, rom_name);

    tsimgout.push(BOILERPLATE_RESOURCE_ID_BITMAP);
    tssndout.push(BOILERPLATE_RESOURCE_ID_AUDIO);
    tsdataout.push(BOILERPLATE_RESOURCE_ID_DATA);

    for (let i = 0; i < metalist.length; i++) {
        const current = metalist[i];

        const type = current.type;
        const name = current.name;
        const enum_member_to_add = `\t${name} = '${name}', `;
        switch (type) {
            case 'image':
            case 'atlas': // Atlas is also an image and thus is added to the image enum
                tsimgout.push(`${enum_member_to_add} `);
                break;
            case 'audio':
                tssndout.push(`${enum_member_to_add} `);
                break;
            case 'data':
                tsdataout.push(`${enum_member_to_add} `);
                break;
            case 'romlabel':
                // Ignore this part
                break;
            default:
                throw new Error(`Unknown resource type "${type}" for resource "${name}"`);
        }
    }

    tsimgout.push("}\n");
    tssndout.push("}\n");
    tsdataout.push("}\n");

    const total_output: string = tsimgout.concat(tssndout, tsdataout).join('\n');

    const targetPath = respath.replace('/res', '/resourceids.ts');
    await writeFile(targetPath, total_output);
}

/**
 * Processes an array of resources to produce asset metadata and allocate buffer ranges.
 *
 * This function processes each loaded resource, extracting relevant metadata and buffer data,
 * and constructs a RomAsset for each. It handles different resource types such as images,
 * audio, code, atlases, and romlabels, and attaches the appropriate metadata to each asset.
 * For images and atlases, it generates image metadata; for audio, it parses audio metadata.
 * The resulting RomAsset array is used for ROM packing and serialization.
 *
 * @param resources - The array of resources to process.
 * @returns An object with three properties:
 * - `assetList` - The array of generated asset metadata objects (to be binary-encoded).
 * - `romlabel_buffer` - The buffer data for the "romlabel.png" resource if present.
 */
export function generateRomAssets(resources: Resource[]) {
    const romAssets: RomAsset[] = [];
    let romlabel_buffer: Buffer | undefined;

    for (const res of resources) {
        const type = res.type;
        let resname = res.name;
        const resid = res.id;
        let buffer = res.buffer; // NOTE that we will remove the buffer during the finalization of the ROM pack. To do proper finalization, we need to store the buffer here right now. N.B. the bootrom will also add the buffer to the RomAsset, so that's why the property is relevant in the first place and we are now using it to temporarily hold the buffer per asset.

        switch (type) {
            case 'romlabel':
                romlabel_buffer = res.buffer;
                romAssets.push({ resid, resname, type, imgmeta: undefined, buffer: romlabel_buffer });
                break;
            case 'image': {
                const imgmeta = buildImgMeta(res);
                let baseAsset: RomAsset;
                if (GENERATE_AND_USE_TEXTURE_ATLAS && DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
                    baseAsset = { resid, resname, type, imgmeta, buffer: undefined, };
                } else {
                    baseAsset = { resid, resname, type, imgmeta, buffer };
                }
                romAssets.push({ ...baseAsset, });
            }
                break;
            case 'audio':
                // Note that the name has already been sanitized in the `getResMetaList` function
                const { audiometa } = parseAudioMeta(res.filepath);
                romAssets.push({ resid, resname, type, audiometa, buffer });
                break;
            case 'code':
                resname = resname.replace('.min', '');
                romAssets.push({ resid, resname, type, buffer });
                break;
            case 'data':
                // Encode the JSON-data via the binencoder
                // Convert the buffer to a JSON string and then encode it
                switch (res.datatype) {
                    case 'yaml':
                        // If the data is a YAML file, we need to convert it to JSON first
                        const yamlContent = res.buffer.toString('utf8');
                        const jsonContent = yaml.load(yamlContent);
                        // res.buffer = jsonContent;
                        const encodedYamlData = encodeBinary(jsonContent);
                        buffer = encodedYamlData;
                        break;
                    case 'json':
                        // If the data is a JSON file, we need to convert it to a string first
                        const json = JSON.parse(res.buffer.toString('utf8'));
                        const encodedData = encodeBinary(json);

                        buffer = encodedData;
                        break;
                    case 'bin':
                        // If the data is a binary file, we can use it as is
                        break;
                    default:
                        throw new Error(`Unknown data type "${res.datatype}" for resource "${resname}"`);
                }
                romAssets.push({ resid, resname, type, buffer });
                break;
            case 'atlas': {
                // Atlas resources are handled similarly to images but with a twist
                const imgmeta = buildImgMetaForAtlas(res);
                const baseAsset = { resid, resname, type, imgmeta, buffer };
                romAssets.push({ ...baseAsset, });
            }
                break;
            case 'rommanifest':
                break;
            default:
                throw new Error(`Unknown resource type "${type}" for resource "${resname}"`);
        }
    }
    return romAssets;
}

/**
 * Generates metadata for an image resource, optionally integrating texture atlas data.
 *
 * @param res - The resource containing the image and any existing metadata.
 * @param generated_atlas - An optional canvas element where an atlas has been generated.
 * @returns An object containing image dimensions, bounding boxes, center point, and (if atlas usage is enabled) texture coordinates.
 */
export function buildImgMeta(res: Resource): ImgMeta {
    const img = res.img;
    const img_boundingbox = BoundingBoxExtractor.extractBoundingBox(img);
    let extracted_hitpolygon: Polygon[] = undefined;
    let hitpolygons: {
        original: Polygon[],
        fliph: Polygon[],
        flipv: Polygon[],
        fliphv: Polygon[]
    } = undefined;
    switch (res.collisionType) {
        case 'concave':
            extracted_hitpolygon = BoundingBoxExtractor.extractConcaveHull(img) as Polygon[];
            hitpolygons = {
                original: extracted_hitpolygon,
                fliph: null,
                flipv: null,
                fliphv: null
            };
            break;
        case 'convex':
            extracted_hitpolygon = [BoundingBoxExtractor.extractConvexHull(img) as Polygon];
            hitpolygons = {
                original: extracted_hitpolygon,
                fliph: null,
                flipv: null,
                fliphv: null
            };
            break;
        case 'aabb':
            // No hit polygon, use bounding box instead
            break;
    }
    // const img_boundingbox_precalc = BoundingBoxExtractor.generateFlippedBoundingBox(img, img_boundingbox);
    const img_centerpoint = BoundingBoxExtractor.calculateCenterPoint(img_boundingbox);

    let imgmeta: ImgMeta = {
        atlassed: false,
        atlasid: null,
        width: img.width,
        height: img.height,
        boundingbox: { original: img_boundingbox, fliph: null, flipv: null, fliphv: null },
        centerpoint: img_centerpoint,
        hitpolygons: hitpolygons
    };
    if (GENERATE_AND_USE_TEXTURE_ATLAS) {
        imgmeta = {
            ...imgmeta,
            atlassed: res.targetAtlasIndex !== undefined,
            atlasid: res.targetAtlasIndex,
            texcoords: res.imgmeta.texcoords,
        };
    }
    return imgmeta;
}

export function buildImgMetaForAtlas(res: Resource): ImgMeta {
    return {
        atlassed: false,
        atlasid: res.atlasid, // Use the atlas ID from the base resource
        width: res.img.width,
        height: res.img.height,
    };
}

/**
 * Generates texture atlases from the loaded image resources and updates the corresponding atlas resources.
 *
 * @param resources - An array of resources, including the atlas to be processed.
 * @param generated_atlas - The HTMLCanvasElement representing the generated atlas image.
 * @param assetList - An array of RomAsset objects to be updated with image metadata.
 * @param bufferPointer - The starting position where atlas data should be written in the output buffers.
 * @param buffers - An array of Buffers where the atlas image data will be appended.
 * @returns A Promise that resolves once the atlas image is written to disk and metadata is updated.
 */
export async function createAtlasses(resources: Resource[]) {
    if (GENERATE_AND_USE_TEXTURE_ATLAS) {
        const atlasses = resources.filter(res => res.type === 'atlas');
        if (atlasses.length === 0) throw new Error('No atlas resources found in the "resources"-list. The process of preparing the list of all resources (assets) should also add any atlasses that are to be generated. Thus, this is a bug in the code that prepares the list of resources :-(');
        // Determine the indexes of atlasses to be generated
        for (const atlas of atlasses) {
            const image_assets = resources.filter(resource => resource.type === 'image');
            const filteredImages = image_assets.filter(resource => resource.targetAtlasIndex === atlas.atlasid);
            const atlasCanvas = createOptimizedAtlas(filteredImages);
            if (!atlasCanvas) throw new Error(`Failed to create texture atlas for ${atlas.name}.`);
            atlas.img = atlasCanvas; // Store the canvas in the resource (to extract the image properties later during `processResources`)
            atlas.buffer = (atlasCanvas as any).toBuffer('image/png'); // Convert canvas to PNG buffer
            await writeFile(`./rom/_ignore/${generateAtlasName(atlas.atlasid)}.png`, atlas.buffer);
        }
    }
    else {
        throw new Error('No images found to generate texture atlas from. Please ensure you have images in your resource directory.');
    }
}

/**
 * Finalizes the ROM pack by concatenating all asset buffers, encoding metadata, and writing the packed ROM file.
 *
 * This function processes the provided asset list, removes per-asset metadata and buffers,
 * encodes the global asset metadata, and writes the final ROM file to disk. If a "romlabel" image is present,
 * it is prepended to the ROM file to allow the ROM to be recognized as a PNG image.
 * The function also writes a JSON file with the asset list for debugging purposes.
 *
 * @param assetList - The list of ROM assets to include in the pack.
 * @param rom_name - The name of the ROM, used for output file naming.
 * @returns A Promise that resolves when the ROM file and metadata have been written.
 */
export async function finalizeRompack(
    assetList: RomAsset[],
    rom_name: string,
) {
    // Capture resource buffers in the order as given by the assetList
    const buffers: Buffer[] = [];
    const outfile = `${rom_name}.rom`; // Use the provided rom_name as the output file name
    let offset = 0; // Offset for the next buffer to be added

    // First write the romlabel buffer if it exists and remove it from the assetList
    // Note that we will use the romlabel buffer to prepend the ROM label to the final output
    // This is useful when changing the extension of the ROM file to .PNG, which will then be recognized as a PNG file by the browser.
    let romlabel_buffer: Buffer | undefined = undefined;
    let romlabel_index = assetList.findIndex(asset => asset.type === 'romlabel');
    if (romlabel_index >= 0) {
        romlabel_buffer = assetList[romlabel_index].buffer;
        // Remove the romlabel from the assetList
        assetList.splice(romlabel_index, 1);
    }

    for (const asset of assetList) {
        // Main buffer (if nonzero length)
        const hasBuffer = asset.buffer !== undefined && asset.buffer.length > 0;
        if (hasBuffer) {
            // Copy the buffer to avoid modifying the original
            const resBuf = Buffer.from(asset.buffer);
            // Update asset offsets
            asset.start = offset;
            asset.end = offset + resBuf.length;
            buffers.push(resBuf);
            offset += resBuf.length;
        }
        // Per-asset metadata
        const perMeta = asset.imgmeta ?? asset.audiometa;
        if (perMeta) {
            const metaBuf = Buffer.from(encodeBinary(perMeta));
            asset.metabuffer_start = offset;
            asset.metabuffer_end = offset + metaBuf.length;
            buffers.push(metaBuf);
            offset += metaBuf.length;
        }
        // Remove per-asset fields
        delete asset.imgmeta;
        delete asset.audiometa;
        // Remove the buffer from the asset, so that it is not included in the final JSON output
        delete asset.buffer;
    }

    // Global metadata
    const binaryAssetListBuffer = Buffer.from(encodeBinary(assetList));
    const globalMetadataOffset = offset;
    const globalMetadataLength = binaryAssetListBuffer.length;
    buffers.push(binaryAssetListBuffer);

    // Footer
    const rompackFooter = Buffer.alloc(16);
    rompackFooter.writeBigUInt64LE(BigInt(globalMetadataOffset), 0);
    rompackFooter.writeBigUInt64LE(BigInt(globalMetadataLength), 8);
    buffers.push(rompackFooter);

    // Write final output
    const all = Buffer.concat(buffers);
    const zipped = zip(all);
    await writeFile(`./dist/${outfile}`, Buffer.concat([romlabel_buffer ?? Buffer.alloc(0), zipped]));
    await writeFile("./rom/_ignore/romresources.json", JSON.stringify(assetList, null, 2));
}

export async function deployToServer(rom_name: string, title: string) {
    throw new Error('Deploy is not implemented yet!');
}

/**
 * Checks if the TypeScript file for the ROM loader is newer than its compiled output
 * and compiles it if needed. This function ensures that the output is always up to date.
 *
 * @throws {Error} Will throw if the romloader file does not exist or if compilation fails.
 * @returns {Promise<void>} A promise that resolves once the compilation process is complete
 *                         or if no action is needed.
 */
export async function buildBootromScriptIfNewer(): Promise<void> {
    const romTsPath = join(__dirname, ROM_TS_RELATIVE_PATH);
    const romJsPath = join(__dirname, ROM_JS_RELATIVE_PATH);

    try {
        await access(romTsPath);
    } catch {
        throw new Error(`"${BOOTROM_TS_FILENAME}" could not be found at "${romTsPath}"`);
    }

    const romTsStats = await stat(romTsPath);
    let romJsStats: Stats | undefined;

    try {
        await access(romJsPath);
        romJsStats = await stat(romJsPath);
    }
    catch { } // Ignore error if rom.js does not exist yet

    if (!romJsStats || romTsStats.mtime > romJsStats.mtime) {
        try {
            await build({
                entryPoints: [romTsPath],
                bundle: true,
                minify: true,
                sourcemap: false,
                platform: 'browser',
                target: 'es2020',
                format: 'iife',
                outfile: romJsPath,
            });
        } catch (e) {
            throw new Error(`Error while compiling "${BOOTROM_TS_FILENAME}" with esbuild: ${e?.message ?? e} `);
        }
        return;
    }
    // rom.js is newer or up to date. No need to compile
}

export const codeFileExtensions = ['.ts', '.glsl', '.js', '.jsx', '.tsx', '.html', '.css', '.json', '.xml'];

export const isCodeFile = (filename: string) => codeFileExtensions.some(extension => filename.endsWith(extension));
export const shouldCheckFile = (filename: string, checkCodeFiles: boolean, checkAssets: boolean) => (checkCodeFiles && isCodeFile(filename)) || checkAssets;

/**
 * Determines whether a rebuild of the ROM is required based on the modification times of the bootloader and resource files.
 * @param {string} romname - The name of the ROM.
 * @param {string} bootloaderPath - The path to the bootloader files.
 * @param {string} resPath - The path to the resource files.
 * @returns {Promise<boolean>} A Promise that resolves with a boolean indicating whether a rebuild is required.
 */
export async function isRebuildRequired(romname: string, bootloaderPath: string, resPath: string): Promise<boolean> {
    const romFilePath = `./dist/${romname}.rom`;
    const minifiedJsFilePath = `./rom/${romname}.js`;

    async function checkPaths() {
        try {
            await access(romFilePath);
            await access(minifiedJsFilePath);
            return false;
        } catch {
            return true;
        }
    }
    if (await checkPaths()) {
        return true;
    }

    const romStats = await stat(romFilePath);
    const romMtime = romStats.mtime;

    const shouldRebuild = async (dir: string, checkCodeFiles: boolean, checkAssets: boolean): Promise<boolean> => {
        try {
            await access(dir);
        } catch {
            throw new Error(`Directory "${dir}" can't be accessed!`);
        }
        const entries = await readdir(dir, { withFileTypes: true });

        for (let entry of entries) {
            const entryPath = join(dir, entry.name);

            if (entry.isDirectory()) {
                if (entry.name === '_ignore') {
                    continue;
                }
                const rebuild = await shouldRebuild(entryPath, checkCodeFiles, checkAssets);
                if (rebuild) {
                    return true;
                }
            } else {
                if (shouldCheckFile(entry.name, checkCodeFiles, checkAssets)) {
                    try {
                        await access(entryPath);
                        const entryStats = await stat(entryPath);
                        const entryMtime = entryStats.mtime;

                        if (entryMtime > romMtime) {
                            return true;
                        }
                    } catch {
                        // File does not exist, ignore
                    }
                }
            }
        }

        return false;
    };

    const shouldCheckCodeFiles = dir => dir.startsWith(bootloaderPath);
    const shouldCheckAssets = dir => dir.startsWith(resPath);

    return await shouldRebuild(bootloaderPath, shouldCheckCodeFiles(bootloaderPath), shouldCheckAssets(bootloaderPath)) ||
        await shouldRebuild(resPath, shouldCheckCodeFiles(resPath), shouldCheckAssets(resPath)) ||
        await shouldRebuild('src/bmsx', true, false);
}
