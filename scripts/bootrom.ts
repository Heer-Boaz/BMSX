import type { Area, AudioMeta, BootArgs, ImgMeta, Polygon, RomAsset, RomImgAsset, RomMeta, RomPack } from '../src/bmsx/rompack/rompack';
import { decodeBinary } from '../src/bmsx/serializer/binencoder';

declare global {
	interface Window {
		getRomNameFromUrlParameter: () => string;
		getRomFromUrlParameter: () => string;
		bootrom: {
			rom: RomPack | null;
			debug: boolean;
			romname: string | undefined;
			sndcontext: AudioContext | null;
			snd_unlocked: boolean;
			gainnode: GainNode | null;
			theshowsover: boolean;
			startingGamepadIndex: number | null;
			set defusr(rom: RomPack);
			usr: (x: number) => number;
			bload: (url: string) => Promise<RomPack | null>;
			outputError: (errormsg: string) => void;
			resizeHandler: () => void;
		};
	}
}

/**
 * Pako is a high-speed zlib port to JavaScript, which is used to compress and decompress data.
 */
declare const pako: any;
/**
 * Function that initializes the boot ROM and starts the game.
 * @param {RomPack} rom - The boot ROM pack.
 * @param {AudioContext} sndcontext - The audio context for the boot ROM.
 * @param {GainNode} gainnode - The gain node for the boot ROM.
 * @returns {void}
 */
declare var h406A: (args: BootArgs) => Promise<void>;

/**
 * Object representing the boot ROM.
 */
const bootrom = {
	/**
	 * This section of code defines the boot ROM object and its properties and methods.
	 *
	 * @property {RomPack | null} rom - The boot ROM pack.
	 * @property {boolean} debug - A flag indicating whether debug mode is enabled.
	 * @property {string | undefined} romname - The name of the boot ROM pack.
	 * @property {AudioContext | null} sndcontext - The audio context for the boot ROM.
	 * @property {GainNode | null} gainnode - The gain node for the boot ROM.
	 * @property {boolean} theshowsover - A flag indicating whether the boot animation has ended.
	 * @property {boolean} snd_unlocked - A flag indicating whether the audio has been unlocked.
	 *
	 * @function defusr - Sets the boot ROM pack.
	 * @param {RomPack} rom - The boot ROM pack.
	 *
	 * @function usr - Loads the boot ROM and starts the game.
	 * @param {number} x - The value to return after the game is started.
	 * @returns {number} 255 after the game is started.
	 *
	 * @function bload - Asynchronously loads a ROM pack from the specified URL.
	 * @param {string} url - The URL of the ROM pack to load.
	 * @returns {Promise<RomPack | null>} A Promise that resolves to the loaded ROM pack, or null if the loading failed.
	 *
	 * @var {boolean} snd_unlocked - A flag indicating whether the audio has been unlocked.
	 */
	rom: null as RomPack | null,
	debug: false,
	romname: undefined, // Currently, used for fetching the megarom Javascript for debug mode
	sndcontext: null as AudioContext | null,
	snd_unlocked: false,
	gainnode: null as GainNode | null,
	theshowsover: false,
	startingGamepadIndex: null as number | null,

	/**
	 * Sets the boot ROM pack.
	 * @param {RomPack} rom - The boot ROM pack.
	 */
	set defusr(rom: RomPack) {
		bootrom.rom = rom;
	},

	/**
	 * Loads the boot ROM and starts the game.
	 * @param x - The value to return after the game is started.
	 * @returns 255 after the game is started.
	 */
	usr(x: number): number {
		const remove = (id: string) => {
			const element = document.querySelector(id);
			element.parentElement!.removeChild(element);
		};

		const wrapup = () => {
			(document.querySelector('#loading') as HTMLElement).hidden = true;
			window.removeEventListener('resize', bootrom.resizeHandler);
			remove('#msx');
			remove('#hidor');
			remove('#bootrom');
			remove('#loading');
			remove('#extra-message');
			remove('#pacojs');
			remove('#bload-script');
			document.body.classList.add('game-started'); // Change background color of body
		};

		try {
			if (!h406A) throw new Error(`h406A(${x}) is not defined!`);
			document.getElementById('gamescreen')!.hidden = false;
			document.getElementById('gamescreen')!.style.display = 'block';
			h406A({
				rom: bootrom.rom!,
				sndcontext: bootrom.sndcontext!,
				gainnode: bootrom.gainnode!,
				debug: this.debug,
				startingGamepadIndex: bootrom.startingGamepadIndex
			});
			wrapup();
			bootrom.rom = undefined;
			return 255;
		} catch (err) {
			console.error(err);
			document.getElementById('gamescreen')!.hidden = true;
			document.getElementById('gamescreen')!.style.display = 'none';
			throw new Error(`Error in usr(0): "${err?.message ?? err ?? 'unknown error :-('}"`);
		}
	},

	/**
	 * Asynchronously loads a ROM pack from the specified URL.
	 * @param url - The URL of the ROM pack to load.
	 * @returns A Promise that resolves to the loaded ROM pack, or null if the loading failed.
	 */
	async bload(url: string): Promise<RomPack | null> {
		window.onunhandledrejection = (event: PromiseRejectionEvent) => {
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			const reason = event.reason?.message ?? event.reason ?? 'unkown error';
			const errormsg = `Unhandled rejection during "bload"-command: "${reason}".`;
			throw new Error(errormsg);
		};

		createAudioContext();

		if (!window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches) {
			const extraMessageElement = document.querySelector<HTMLElement>('#extra-message');
			const loadingElement = document.getElementById('loading');

			if (loadingElement && extraMessageElement) {
				loadingElement.style.display = "block";
				const loadingRect = loadingElement.getBoundingClientRect();
				const topInVh = (loadingRect.bottom / window.innerHeight) * 100;
				extraMessageElement.style.top = topInVh + 'vh';
				extraMessageElement.innerText = 'Please add this page to your home screen to get the full experience of this game!';
				extraMessageElement.hidden = false;
			}

			window.addEventListener('resize', bootrom.resizeHandler);
		}

		const fetchRom = () => {
			return fetchBuffer(url).catch(err => {
				throw new Error(`Error while fetching ROM: "${err.message}"`);
			});
		};

		return new Promise((resolve, reject) => {
			let loadedRomPack: RomPack | null = null;
			let romlabel_bloburl: string = undefined;

			fetchRom()
				.then((response_array: ArrayBuffer) => getZippedRomAndRomLabelFromBlob(response_array))
				.then((ziprom_and_label: { zipped_rom: ArrayBuffer, romlabel: string }) => {
					romlabel_bloburl = ziprom_and_label.romlabel;
					return pako.inflate(ziprom_and_label.zipped_rom).buffer;
					// return decompress(ziprom_and_label.zipped_rom);
					// return pako.inflate(ziprom_and_label.zipped_rom).buffer;
				})
				.then(rom => loadResources(rom))
				.then((loadResult: any) => {
					loadedRomPack = loadResult;
					awaitBootComplete();
				})
				.then(() => loadScript(loadedRomPack, bootrom.romname))
				.then(() => {
					setLoaderText('Press any key, button or touch screen to start...');
					// setClassForLoader('');
					return awaitPressedAnyKeyPromise();
				})
				.then(() => resolve(loadedRomPack))
				.catch(err => {
					console.error('[bload] Top-level error:', err);
					reject(err);
				});
		});
		// if (romlabel_bloburl) {
		// 	let msx = document.querySelector('#msx') as HTMLElement;
		// 	debugger;
		// 	delete msx.onanimationend;
		// 	msx.className = 'fade-out';
		// 	msx.onanimationend = (ev: AnimationEvent) => {
		// 		let msx = ev.target as HTMLImageElement;
		// 		msx.src = romlabel_bloburl;
		// 		msx.className = 'fade-in';
		// 	};
		// }
	},

	outputError(errormsg: string) {
		console.error(errormsg);
		bootrom.theshowsover = true;
		const loadingElement = document.querySelector<HTMLElement>('#loading')
		if (loadingElement) loadingElement.hidden = false;
		const msxElement = document.querySelector<HTMLElement>('#msx');
		if (msxElement) msxElement.onanimationend = undefined;
		const hidorElement = document.querySelector<HTMLElement>('#hidor');
		if (hidorElement) hidorElement.className = 'showsover';
		document.body.className = "showsover";
		setClassForLoader('');
		setLoaderText(errormsg);
	},

	resizeHandler() {
		const loadingElement = document.querySelector<HTMLElement>('#loading');
		const loadingRect = loadingElement.getBoundingClientRect();
		const topInVh = (loadingRect.bottom / window.innerHeight) * 100;
		const extraMessageElement = document.querySelector<HTMLElement>('#extra-message');
		extraMessageElement.style.top = topInVh + 'vh';
	},
};

if (typeof globalThis !== 'undefined') {
	globalThis.bootrom = bootrom;
	globalThis.getRomFromUrlParameter = (): string => {
		const rom = getParameterByName('rom');
		return rom && rom !== '' ? rom : null;
	}

	globalThis.getRomNameFromUrlParameter = (): string => {
		const rom_name = getParameterByName('romname');
		return rom_name && rom_name !== '' ? rom_name : null;
	}
}

function getParameterByName(name, url = window.location.href) {
	name = name.replace(/[\[\]]/g, '\\$&');
	const regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
		results = regex.exec(url);
	if (!results) return null;
	if (!results[2]) return '';
	return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

/**
 * Asynchronously loads an image from the specified URL.
 * @param url - The URL of the image to load.
 * @returns A Promise that resolves to the loaded image, or rejects with an error message if the loading failed.
 */
async function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = e => resolve(img);
		img.onerror = e => {
			reject(`Failed to load image's URL: ${url}`);
		};
		img.src = url;
	});
}

/**
 * Parses the metadata of a ROM pack from the end of the given buffer.
 * @param to_parse - The buffer to parse the metadata from.
 * @returns The metadata of the ROM pack.
 */
export function parseMetaFromBuffer(to_parse: ArrayBuffer): RomMeta {
	const bytearray = new Uint8Array(to_parse);
	const footerOffset = bytearray.length - 16;
	if (footerOffset < 0) throw new Error('ROM file too small for footer');
	let metaOffset = -1;
	let metaLength = -1;
	if (footerOffset < 16) {
		throw new Error('ROM file too small for metadata footer');
	}
	try {
		const dv = new DataView(to_parse, footerOffset, 16);
		metaOffset = Number(dv.getBigUint64(0, true)); // little-endian
		metaLength = Number(dv.getBigUint64(8, true)); // little-endian
		if (metaOffset < 0 || metaLength <= 0 || metaOffset + metaLength > bytearray.length)
			throw new Error('Invalid ROM metadata footer');
		return { start: metaOffset, end: metaOffset + metaLength };
	} catch (error) {
		throw new Error(`Failed to parse ROM metadata: ${error.message}\n${to_parse.byteLength} bytes, footerOffset: ${footerOffset}, metaOffset: ${metaOffset === -1 ? '<unknown>' : metaOffset}, metaLength: ${metaLength === -1 ? '<unknown>' : metaLength}.`);
	}
}

/**
 * Returns a sub-buffer of the given buffer as per the start and end positions specified in the given metadata.
 * @param buffer - The buffer to extract the sub-buffer from.
 * @param meta - The metadata containing the start and end positions of the sub-buffer.
 * @returns The sub-buffer of the given buffer as per the start and end positions specified in the given metadata.
 */
function getSubBufferAsPerMeta(buffer: ArrayBuffer, meta: RomMeta): ArrayBuffer {
	return buffer.slice(meta.start, meta.end);
}

/**
 * Returns a sub-buffer of the given buffer as per the start and end positions specified in the metadata of the buffer.
 * @param buffer - The buffer to extract the sub-buffer from.
 * @returns The sub-buffer of the given buffer as per the start and end positions specified in the metadata of the buffer.
 */
export function getSubBufferFromBufferWithMeta(buffer: ArrayBuffer): ArrayBuffer {
	let buffer_meta: RomMeta = parseMetaFromBuffer(buffer);
	return getSubBufferAsPerMeta(buffer, buffer_meta);
}

/**
 * Extracts the zipped ROM and the ROM label from the given blob buffer.
 * @param blob_buffer - The buffer containing the blob data.
 * @returns A Promise that resolves to an object containing the zipped ROM and the ROM label.
 */
export async function getZippedRomAndRomLabelFromBlob(blob_buffer: ArrayBuffer): Promise<{ zipped_rom: ArrayBuffer, romlabel: string }> {
	const u8 = new Uint8Array(blob_buffer);
	// Check PNG-header
	if (
		u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47 &&
		u8[4] === 0x0D && u8[5] === 0x0A && u8[6] === 0x1A && u8[7] === 0x0A
	) {
		// Find IEND-chunk (last PNG-chunk)
		const IEND = [0x49, 0x45, 0x4E, 0x44];
		let idx = 8;
		while (idx < u8.length - 12) {
			if (
				u8[idx + 4] === IEND[0] &&
				u8[idx + 5] === IEND[1] &&
				u8[idx + 6] === IEND[2] &&
				u8[idx + 7] === IEND[3]
			) {
				// PNG-chunk: 4 bytes length, 4 bytes type, ... , 4 bytes CRC
				const chunkLen = (u8[idx] << 24) | (u8[idx + 1] << 16) | (u8[idx + 2] << 8) | u8[idx + 3];
				idx += 8 + chunkLen + 4; // type+data+crc
				// The zipped ROM starts here
				return {
					zipped_rom: blob_buffer.slice(idx),
					romlabel: getImageURL(blob_buffer.slice(0, idx))
				};
			}
			idx++;
		}
		throw new Error('Could not find end of PNG header!');
	}
	// No PNG header
	return { zipped_rom: blob_buffer, romlabel: undefined };
}

/**
 * Parses the asset list from the given ROM buffer and returns it as an array of `RomAsset` objects.
 * @param rom - The buffer containing the ROM data.
 * @returns A Promise that resolves to an array of `RomAsset` objects representing the resources in the ROM.
 */
export async function loadAssetList(rom: ArrayBuffer): Promise<RomAsset[]> {
	const sliced = new Uint8Array(getSubBufferFromBufferWithMeta(rom));
	// Use decodeBinary to decode the binary-encoded asset list
	let assetList: RomAsset[];
	try {
		assetList = decodeBinary(sliced) as RomAsset[];
	} catch (e: any) {
		console.error('[loadAssetList] decodeBinary error:', e);
		throw e;
	}


	// Generate flipped variants for polygons
	function flipPolygons(polys: Polygon[], flipH: boolean, flipV: boolean, imgW: number, imgH: number): Polygon[] {
		return polys.map(poly => {
			const res: number[] = [];
			for (let i = 0; i < poly.length; i += 2) {
				const x = poly[i];
				const y = poly[i + 1];
				res.push(flipH ? imgW - 1 - x : x, flipV ? imgH - 1 - y : y);
			}
			return res;
		});
	}

	function flipBoundingBoxHorizontally(box: Area, width: number): Area {
		return {
			start: { x: width - box.end.x, y: box.start.y },
			end: { x: width - box.start.x, y: box.end.y }
		};
	}

	function flipBoundingBoxVertically(box: Area, height: number): Area {
		return {
			start: { x: box.start.x, y: height - box.end.y },
			end: { x: box.end.x, y: height - box.start.y }
		};
	}

	function generateFlippedBoundingBox(extractedBoundingBox: Area, imgW: number, imgH: number) {
		const originalBoundingBox = extractedBoundingBox;
		const horizontalFlipped = flipBoundingBoxHorizontally(originalBoundingBox, imgW);
		const verticalFlipped = flipBoundingBoxVertically(originalBoundingBox, imgH);
		const bothFlipped = flipBoundingBoxHorizontally(flipBoundingBoxVertically(originalBoundingBox, imgH), imgW);
		return {
			original: originalBoundingBox,
			fliph: horizontalFlipped,
			flipv: verticalFlipped,
			fliphv: bothFlipped
		};
	}

	function generateFlippedTexCoords(texcoords: number[]): {
		original: number[],
		fliph: number[],
		flipv: number[],
		fliphv: number[]
	} {
		const result = {
			original: [...texcoords],
			fliph: [],
			flipv: [],
			fliphv: []
		};

		// left, top, right, top, left, bottom, left, bottom, right, top, right, bottom
		const [left, top, right, , , bottom] = texcoords;

		result.fliph.push(right, top, left, top, right, bottom, right, bottom, left, top, left, bottom);
		result.flipv.push(left, bottom, right, bottom, left, top, left, top, right, bottom, right, top);
		result.fliphv.push(right, bottom, left, bottom, right, top, right, top, left, bottom, left, top);

		return result;
	}

	// For each asset, if it has per-asset metabuffer, decode and assign metadata
	for (const asset of assetList) {
		if (asset.metabuffer_start != null && asset.metabuffer_end != null) {
			const metaSlice = rom.slice(asset.metabuffer_start, asset.metabuffer_end);
			const decodedMeta = decodeBinary(new Uint8Array(metaSlice));
			// Assign per-asset metadata based on resource type
			switch (asset.type) {
				case 'image':
				case 'atlas':
					asset.imgmeta = decodedMeta as ImgMeta;
					if (asset.imgmeta.atlassed) {
						// Generate flipped variants for hitpolygons
						if (asset.imgmeta.width && asset.imgmeta.height) {
							if (asset.imgmeta.hitpolygons?.original) {
								const extracted_hitpolygon = asset.imgmeta.hitpolygons.original;
								asset.imgmeta.hitpolygons = {
									original: extracted_hitpolygon,
									fliph: flipPolygons(extracted_hitpolygon, true, false, asset.imgmeta.width, asset.imgmeta.height),
									flipv: flipPolygons(extracted_hitpolygon, false, true, asset.imgmeta.width, asset.imgmeta.height),
									fliphv: flipPolygons(extracted_hitpolygon, true, true, asset.imgmeta.width, asset.imgmeta.height)
								};
							}
							// Generate flipped variants for bounding boxes
							if (asset.imgmeta.boundingbox) {
								// Generate flipped bounding boxes
								asset.imgmeta.boundingbox = generateFlippedBoundingBox(asset.imgmeta.boundingbox.original, asset.imgmeta.width, asset.imgmeta.height);
							}
							// Generate flipped variants of the texcoords
							if (asset.imgmeta.texcoords) {
								const { original, fliph, flipv, fliphv } = generateFlippedTexCoords(asset.imgmeta.texcoords);
								asset.imgmeta.texcoords = original;
								asset.imgmeta.texcoords_fliph = fliph;
								asset.imgmeta.texcoords_flipv = flipv;
								asset.imgmeta.texcoords_fliphv = fliphv;
							}
						}
					}
					break;
				case 'audio':
					asset.audiometa = decodedMeta as AudioMeta;
					break;
				case 'code':
					// No specific metadata for code type, but we can still assign the decoded metadata
					break;
				case 'data':
					// No specific metadata for data type, but we can still assign the decoded metadata
					break;
				default:
					// unsupported metadata type
					break;
			}
		}
	}
	return Promise.resolve<RomAsset[]>(assetList);
}

/**
 * Asynchronously loads all resources from the given ROM buffer and returns a `RomPack` object containing the loaded resources.
 * @param rom - The buffer containing the ROM data.
 * @returns A Promise that resolves to a `RomPack` object containing the loaded resources.
 */
export async function loadResources(rom: ArrayBuffer, opts?: { loadImageFromBuffer?: (buffer: ArrayBuffer) => Promise<any>, loadSourceFromBuffer?: (buffer: ArrayBuffer) => Promise<any>, loadAudioFromBuffer?: (buffer: ArrayBuffer) => Promise<any> }): Promise<RomPack> {
	const result: RomPack = {
		rom: rom,
		img: {},
		audio: {},
		data: {},
		code: null
	};

	const assetList = await loadAssetList(rom);
	await Promise.all(assetList.map(a => load(rom, a, result, opts)));
	return Promise.resolve<RomPack>(result);
}

/**
 * Returns a URL for the given buffer as a PNG image.
 * @param buffer - The buffer to convert to a PNG image URL.
 * @returns A URL for the given buffer as a PNG image.
 */
function getImageURL(buffer: ArrayBuffer): string {
	return URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: 'image/png' }));
}

/**
 * Asynchronously creates an HTMLImageElement from the given buffer.
 * @param buffer - The buffer to create the image from.
 * @returns A Promise that resolves to an HTMLImageElement created from the given buffer.
 */
async function getImageFromBuffer(buffer: ArrayBuffer): Promise<HTMLImageElement> {
	return loadImage(getImageURL(buffer));
}

async function loadDataFromBuffer(buffer: ArrayBuffer): Promise<any> {
	// return decodeuint8arr(new Uint8Array(buffer));
	return decodeBinary(new Uint8Array(buffer));
}

/**
 * Asynchronously loads the given resource from the ROM buffer and adds it to the given `RomPack` object.
 * @param rom - The buffer containing the ROM data.
 * @param res - The `RomAsset` object representing the resource to load.
 * @param romResult - The `RomPack` object to add the loaded resource to.
 * @returns A Promise that resolves when the resource has been loaded and added to the `RomPack` object.
 * If an error occurs during loading, the Promise is rejected with an error message.
 */
async function load(rom: ArrayBuffer, res: RomAsset, romResult: RomPack, opts?: { loadImageFromBuffer?: (buffer: ArrayBuffer) => Promise<any>, loadSourceFromBuffer?: (buffer: ArrayBuffer) => Promise<any>, loadAudioFromBuffer?: (buffer: ArrayBuffer) => Promise<any>, loadDataFromBuffer?: (buffer: ArrayBuffer) => Promise<any> }): Promise<void> {
	switch (res.type) {
		case 'image':
		case 'atlas':
			let img: HTMLImageElement = undefined;
			if (!res.imgmeta?.atlassed) {
				if (opts && opts.loadImageFromBuffer) {
					img = await opts.loadImageFromBuffer(rom.slice(res.start, res.end));
				} else {
					img = await getImageFromBuffer(rom.slice(res.start, res.end));
				}
			}
			const imgAsset: RomImgAsset = {
				...res,
				imgbin: img
			};
			romResult.img[res.resid] = imgAsset;
			romResult.img[res.resname] = imgAsset;
			break;
		case 'audio':
			try {
				if (opts && opts.loadAudioFromBuffer) {
					romResult.audio[res.resid] = await opts.loadAudioFromBuffer(rom.slice(res.start, res.end));
				} else {
					// By default we do not load the audio, but load it later in the SoundMaster
					romResult.audio[res.resid] = res;
					romResult.audio[res.resname] = res;
				}
			} catch (err) {
				throw new Error(`Failed to load 'audio' from rom: ${err.message}.`);
			}
			break;
		case 'code':
			try {
				if (opts && opts.loadSourceFromBuffer) {
					romResult.code = await opts.loadSourceFromBuffer(rom.slice(res.start, res.end));
				} else {
					const sliced = new Uint8Array(rom, res.start, res.end - res.start);
					romResult.code = decodeuint8arr(sliced);
				}
			} catch (err) {
				throw new Error(`Failed to load 'source' from rom: ${err.message}.`);
			}
			break;
		case 'data':
			try {
				if (opts && opts.loadDataFromBuffer) {
					romResult.data[res.resid] = await opts.loadDataFromBuffer(rom.slice(res.start, res.end));
				} else {
					const data = await loadDataFromBuffer(rom.slice(res.start, res.end));
					romResult.data[res.resid] = data;
					romResult.data[res.resname] = data;
				}
			} catch (err) {
				throw new Error(`Failed to load 'data' from rom: ${err.message}.`);
			}
			break;
		default:
			throw new Error(`Unrecognised resource type in rom: ${res.type}, while processing rompack!`);
	}
}

/**
 * Waits for the boot animation to complete before resolving the Promise.
 * @returns A Promise that resolves when the boot animation is complete.
 */
async function awaitBootComplete(): Promise<void> {
	const result: Promise<void> = new Promise((resolve, reject) => {
		const msx = <HTMLElement>document.querySelector('#msx');
		msx.onanimationend = ev => {
			// let loading = <HTMLElement>document.querySelector('#loading');
			// loading.hidden = false;
			bootrom.theshowsover = true;
			resolve();
		};
		msx.className = 'enter';
		msx.hidden = false;
		if (bootrom.debug) resolve(); // Resolve immediately in debug-mode
	});
	return result;
}

/**
 * Asynchronously loads the script from the given `RomPack` object and adds it to the document head.
 * @param rom - The `RomPack` object containing the script to load.
 * @param romname - The name of the ROM.
 * @returns A Promise that resolves when the script has been loaded and added to the document head.
 * If an error occurs during loading, the Promise is rejected with an error message.
 */
async function loadScript(rom: RomPack, romname: string): Promise<void> {
	try {
		let scriptText: string;
		scriptText = rom.code;

		const romcode = document.createElement('script');
		romcode.async = false;
		romcode.textContent = scriptText;
		document.head.appendChild(romcode); // Add the script to the document head
	} catch (err) {
		throw new Error(`Error in loadScript: ${err.message}`);
	}
}

/**
 * Waits for the user to press any key before resolving the Promise.
 * @returns A Promise that resolves when the user presses any key.
 */
async function awaitPressedAnyKeyPromise(): Promise<void> {
	const result: Promise<void> = new Promise((resolve, reject) => {
		let rafId: number;

		const cleanup = () => {
			document.body.removeEventListener('keyup', onuserinteraction);
			document.body.removeEventListener('touchend', onuserinteraction);
			cancelAnimationFrame(rafId);
		};

		const startGame = () => {
			startAudioOnIos();
			cleanup();
			resolve();
		};

		const pollGamepads = () => {
			try {
				if (!bootrom.theshowsover) {
					rafId = window.requestAnimationFrame(pollGamepads);
					return;
				}

				const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
				for (const gp of gamepads) {
					if (!gp) continue;
					if (gp.buttons?.some(btn => btn.pressed) || gp.axes?.some(ax => Math.abs(ax) > 0.5)) {
						bootrom.startingGamepadIndex = gp.index;
						startGame();
						return;
					}
				}
				rafId = window.requestAnimationFrame(pollGamepads);
			} catch (err) {
				cancelAnimationFrame(rafId);
				reject(err);
			}
		};

		const onuserinteraction = (e: UIEvent) => {
			try {
				if (!bootrom.snd_unlocked || !bootrom.theshowsover) {
					if (bootrom.debug) {
						console.info(`Did not start game on user interaction because either the sound was not unlocked (bootrom.snd_unlocked=${bootrom.snd_unlocked}) or the boot animation had not ended (bootrom.theshowsover=${bootrom.theshowsover}).`);
					}
					return;
				}
				if (e.type == 'touchend') {
					document.getElementById("d-pad-controls")!.hidden = false;
					document.getElementById("button-controls")!.hidden = false;
					document.documentElement.setAttribute("style", "touch-action: none;");
					document.documentElement.setAttribute("style", "pointer-events: none;");
				}
				startGame();
			}
			catch (err) {
				cleanup();
				reject(err);
			}
		};

		document.addEventListener('keyup', startAudioOnIos, true);
		document.addEventListener('touchend', startAudioOnIos, true);
		document.body.addEventListener('keyup', onuserinteraction, { passive: false, once: false, capture: false });
		document.body.addEventListener('touchend', onuserinteraction, { passive: false, once: false, capture: false });
		if (navigator.getGamepads) {
			rafId = window.requestAnimationFrame(pollGamepads);
		}
	});
	return result;
}

/**
 * Sets the text content of the loader element with the given string.
 * @param txt - The string to set as the text content of the loader element.
 */
function setLoaderText(txt: string) {
	const loading = <HTMLElement>document.querySelector('#loading');
	loading.innerText = txt;
}

/**
 * Sets the class name of the loader element to the given string.
 * @param cls - The class name to set for the loader element.
 */
function setClassForLoader(cls: string) {
	const loading = <HTMLElement>document.querySelector('#loading');
	loading.className = cls;
}

/**
 * Convert an Uint8Array into a string.
 * https://ourcodeworld.com/articles/read/164/how-to-convert-an-uint8array-to-string-in-javascript
 * @returns {string}
 */
function decodeuint8arr(to_decode: Uint8Array): string {
	const decoder = new TextDecoder("utf-8", { fatal: true });
	try {
		return decoder.decode(to_decode);
	} catch (err) {
		throw err;
	}
}

/**
 * Fetches the text content from the specified URL.
 * @param url The URL to fetch the text from.
 * @returns A promise that resolves to the fetched text content.
 * @throws If there is an error while fetching the text.
 */
export async function fetchText(url: string): Promise<string> {
	try {
		const response = await fetch(url, {
			headers: {
				'Cache-Control': 'no-cache'
			}
		});
		if (!response.ok) {
			throw new Error(`Failed @fetchText for URL "${url}"`);
		}
		const decoder = new TextDecoder('utf-8');
		const data = await response.arrayBuffer();
		return decoder.decode(data);
	} catch (err) {
		throw new Error(`Error @fetchText for URL "${url}": ${err.message}`);
	}
}

/**
 * Asynchronously fetches an ArrayBuffer from the given URL using XMLHttpRequest.
 * @param url - The URL to fetch the ArrayBuffer from.
 * @returns A Promise that resolves with the fetched ArrayBuffer.
 * If an error occurs during fetching, the Promise is rejected with an error message.
 */
async function fetchBuffer(url: string): Promise<ArrayBuffer> {
	try {
		const response = await fetch(url, {
			headers: {
				'Cache-Control': 'no-cache'
			}
		});
		if (!response.ok) {
			throw new Error(`Failed @fetchBuffer for URL "${url}"`);
		}
		return await response.arrayBuffer();
	} catch (err) {
		throw new Error(`Error @fetchBuffer for URL "${url}": ${err.message}`);
	}
}

function removeEventListeners() {
	// Remove event listener if it wasn't removed already
	document.removeEventListener('keyup', startAudioOnIos, true);
	document.removeEventListener('touchend', startAudioOnIos, true);
}

/**
 * Starts audio on iOS devices by creating a dummy audio buffer source and playing it.
 * If the audio context is already running, removes the event listeners for keyup and touchend.
 * @returns void
 */
function startAudioOnIos(): void {
	if (!bootrom.sndcontext) return;
	if (bootrom.snd_unlocked) {
		// Remove event listener if it wasn't removed already
		removeEventListeners();
		return;
	}
	const source = bootrom.sndcontext.createBufferSource();
	source.buffer = bootrom.sndcontext.createBuffer(1, 1, 44100);
	source.connect(bootrom.sndcontext.destination);
	source.start(0, 0, 0);

	if (bootrom.sndcontext.state == 'running') {
		removeEventListeners();
		bootrom.snd_unlocked = true;
	}
}

/**
 * Creates an AudioContext object and sets it to the `bootrom.sndcontext` property if it doesn't exist.
 * If the AudioContext object already exists, this function does nothing.
 * This function also fixes the iOS Audio Context by creating a dummy audio buffer source and playing it.
 * If the audio context is already running, removes the event listeners for keyup and touchend.
 * @returns void
 */
function createAudioContext(): void {
	if (bootrom.sndcontext) return;

	// Fix iOS Audio Context by Blake Kus https://gist.github.com/kus/3f01d60569eeadefe3a1
	// MIT license
	const AContext: any = 					// https://github.com/amaneureka/T-Rex/issues/5
		window.AudioContext ||				// Default
		(<any>window).webkitAudioContext;	// Safari and old versions of Chrome

	let context: AudioContext = new AContext({
		latencyHint: 'interactive',
		sampleRate: 44100,
	}) as AudioContext;
	// https://createjs.com/docs/soundjs/files/soundjs_webaudio_WebAudioPlugin.js.html#l355
	// Check if hack is necessary. Only occurs in iOS6+ devices
	// and only when you first boot the iPhone, or play a audio/video
	// with a different sample rate
	if (/(iPhone|iPad)/i.test(navigator.userAgent) && context.sampleRate !== 44100) {
		const buffer = context.createBuffer(1, 1, 44100),
			dummy = context.createBufferSource();
		dummy.buffer = buffer;
		dummy.connect(context.destination);
		dummy.start(0);
		dummy.disconnect();
		context.close(); // dispose old context

		context = new AContext();
	}

	bootrom.sndcontext = context;
}
