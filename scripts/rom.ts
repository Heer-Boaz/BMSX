import { RomPack, RomAsset, RomMeta } from '../src/bmsx/rompack';

/**
 * Pako is a high-speed zlib port to JavaScript, which is used to compress and decompress data.
 */
declare var pako: any;
/**
 * Function that initializes the boot ROM and starts the game.
 * @param {RomPack} rom - The boot ROM pack.
 * @param {AudioContext} sndcontext - The audio context for the boot ROM.
 * @param {GainNode} gainnode - The gain node for the boot ROM.
 * @returns {void}
 */
declare var h406A: (rom: RomPack, sndcontext: AudioContext, gainnode: GainNode) => void;

/**
 * Object representing the boot ROM.
 */
var bootrom = {
	/**
	 * This section of code defines the boot ROM object and its properties and methods.
	 *
	 * @property {RomPack | null} rom - The boot ROM pack.
	 * @property {boolean} debug - A flag indicating whether debug mode is enabled.
	 * @property {string | undefined} romname - The name of the boot ROM pack.
	 * @property {boolean} localfetch - A flag indicating whether the boot ROM pack should be fetched locally.
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
	localfetch: false,
	sndcontext: null as AudioContext | null,
	snd_unlocked: false,
	gainnode: null as GainNode | null,
	theshowsover: false,

	/**
	 * Sets the boot ROM pack.
	 * @param {RomPack} rom - The boot ROM pack.
	 * @returns {void}
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
		document.body.classList.add('game-started'); // Change background color of body
		document.getElementById('gamescreen')!.hidden = false;
		document.getElementById('gamescreen')!.style.display = 'block';
		if (this.debug) {
			document.getElementById('debugPanel')!.hidden = false;
			document.getElementById('debugPanel')!.style.display = 'block';
		}
		loadScript(bootrom.rom!, bootrom.romname).then(() => {
			h406A(bootrom.rom!, bootrom.sndcontext!, bootrom.gainnode!);
			bootrom.rom = null;
			return x;
		})
			.catch(err => {
				throw err ?? 'usr(x) failed with unknown error!';
			});
		return 255;
	},

	/**
	 * Asynchronously loads a ROM pack from the specified URL.
	 * @param url - The URL of the ROM pack to load.
	 * @returns A Promise that resolves to the loaded ROM pack, or null if the loading failed.
	 */
	async bload(url: string): Promise<RomPack | null> {
		window.onunhandledrejection = event => {
			console.log(event.cancelable, event.reason, "unhandled rejection??");
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();

			return false;
		};

		createAudioContext();

		let fetchRom = () => new Promise<ArrayBuffer>(async (resolve, reject) => {
			if (bootrom.localfetch) {
				fetchLocal(url).then(response_array => resolve(response_array)).catch(err => reject(err));
			}
			else {
				fetch(url).then(response => response.arrayBuffer()).then(response_array => resolve(response_array)).catch(err => reject(err));
			}
		});


		return new Promise(async (resolve, reject) => {
			let bootCompletePromise = awaitBootComplete();
			let result: RomPack | null = null;
			let romlabel_bloburl: string = undefined;
			fetchRom()
				.then((response_array: ArrayBuffer) => getZippedRomAndRomLabelFromBlob(response_array))
				.then((ziprom_and_label: { zipped_rom: ArrayBuffer, romlabel: string }) => { romlabel_bloburl = ziprom_and_label.romlabel; return pako.inflate(ziprom_and_label.zipped_rom).buffer; })
				.then(rom => loadResources(rom))
				.then((loadResult: any) => result = loadResult)
				.catch(err => reject(err));

			await bootCompletePromise;
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
			setLoaderText('Press any key or touch screen to start...');
			setClassForLoader('');
			let pressedAnyKey = awaitPressedAnyKey();
			await pressedAnyKey;

			resolve(result);
		});
	},

	outputError(errormsg: string) {
		setClassForLoader('');
		setLoaderText(errormsg);
		console.error(errormsg);
	}
};


/**
 * Asynchronously loads an image from the specified URL.
 * @param url - The URL of the image to load.
 * @returns A Promise that resolves to the loaded image, or rejects with an error message if the loading failed.
 */
async function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		let img = new Image();
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
function parseMetaFromBuffer(to_parse: ArrayBuffer): RomMeta {
	let bytearray = new Uint8Array(to_parse);
	let sliced = bytearray.slice(bytearray.length - 100);
	let metaJsonStr = decodeuint8arr(sliced);
	return JSON.parse(metaJsonStr);
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
function getSubBufferFromBufferWithMeta(buffer: ArrayBuffer): ArrayBuffer {
	let buffer_meta: RomMeta = parseMetaFromBuffer(buffer);
	return getSubBufferAsPerMeta(buffer, buffer_meta);
}

/**
 * Extracts the zipped ROM and the ROM label from the given blob buffer.
 * @param blob_buffer - The buffer containing the blob data.
 * @returns A Promise that resolves to an object containing the zipped ROM and the ROM label.
 */
async function getZippedRomAndRomLabelFromBlob(blob_buffer: ArrayBuffer): Promise<{ zipped_rom: ArrayBuffer, romlabel: string }> {
	// let blob_meta = parseMetaFromBuffer(blob_buffer);
	// let romlabel_htmlimg: string = undefined;
	// if (blob_meta.start > 0) {
	// 	romlabel_htmlimg = getImageURL(blob_buffer.slice(0, blob_meta.start));
	// }

	// return Promise.resolve({ zipped_rom: getSubBufferAsPerMeta(blob_buffer, blob_meta), romlabel: romlabel_htmlimg });
	return Promise.resolve({ zipped_rom: getSubBufferFromBufferWithMeta(blob_buffer), romlabel: undefined });
}

/**
 * Parses the resource list from the given ROM buffer and returns it as an array of `RomAsset` objects.
 * @param rom - The buffer containing the ROM data.
 * @returns A Promise that resolves to an array of `RomAsset` objects representing the resources in the ROM.
 */
async function loadResourceList(rom: ArrayBuffer): Promise<RomAsset[]> {
	let sliced = new Uint8Array(getSubBufferFromBufferWithMeta(rom));

	let resJsonStr = decodeuint8arr(sliced);
	let resJson: RomAsset[] = JSON.parse(resJsonStr);

	return Promise.resolve<RomAsset[]>(resJson);
}

/**
 * Asynchronously loads all resources from the given ROM buffer and returns a `RomPack` object containing the loaded resources.
 * @param rom - The buffer containing the ROM data.
 * @returns A Promise that resolves to a `RomPack` object containing the loaded resources.
 */
async function loadResources(rom: ArrayBuffer): Promise<RomPack> {
	let result: RomPack = {
		images: {},
		rom: rom,
		img_assets: {},
		snd_assets: {},
		code: null
	};

	let list = await loadResourceList(rom);
	for (let i = 0; i < list.length; i++) {
		await load(rom, list[i], result);
	}
	return Promise.resolve<RomPack>(result);
}

/**
 * Returns a URL for the given buffer as a PNG image.
 * @param buffer - The buffer to convert to a PNG image URL.
 * @returns A URL for the given buffer as a PNG image.
 */
function getImageURL(buffer: ArrayBuffer): string {
	let mime: string;
	let blub: Blob;

	mime = 'image/png';
	blub = new Blob([new Uint8Array(buffer)], { type: mime });
	return URL.createObjectURL(blub);
}

/**
 * Asynchronously creates an HTMLImageElement from the given buffer.
 * @param buffer - The buffer to create the image from.
 * @returns A Promise that resolves to an HTMLImageElement created from the given buffer.
 */
async function getImageFromBuffer(buffer: ArrayBuffer): Promise<HTMLImageElement> {
	let url = getImageURL(buffer);
	return loadImage(url);
}

/**
 * Asynchronously loads the given resource from the ROM buffer and adds it to the given `RomPack` object.
 * @param rom - The buffer containing the ROM data.
 * @param res - The `RomAsset` object representing the resource to load.
 * @param romResult - The `RomPack` object to add the loaded resource to.
 * @returns A Promise that resolves when the resource has been loaded and added to the `RomPack` object.
 * If an error occurs during loading, the Promise is rejected with an error message.
 */
async function load(rom: ArrayBuffer, res: RomAsset, romResult: RomPack): Promise<void> {
	switch (res.type) {
		case 'image':
			if (!res.imgmeta!.atlassed) {
				let img = await getImageFromBuffer(rom.slice(res.start, res.end));

				romResult.images[res.resid] = img;
				romResult.images[res.resname] = img;
			}
			romResult.img_assets[res.resid] = res;
			romResult.img_assets[res.resname] = res;
			break;
		case 'source':
			try {
				let bytearray = new Uint8Array(rom);
				let sliced = bytearray.slice(res.start, res.end);
				romResult.code = decodeuint8arr(sliced);
			} catch (err) {
				return Promise.reject(err);
			}
			break;
		case 'audio':
			romResult.snd_assets[res.resid] = res;
			romResult.snd_assets[res.resname] = res;
			break;
		default:
			let msg = `Unrecognised resource type in rom: ${res.type}, while processing rompack!`;
			return Promise.reject(msg);
	}
}

/**
 * Waits for the boot animation to complete before resolving the Promise.
 * @returns A Promise that resolves when the boot animation is complete.
 */
async function awaitBootComplete(): Promise<void> {
	let result: Promise<void> = new Promise((resolve, reject) => {
		let msx = <HTMLElement>document.querySelector('#msx');
		msx.onanimationend = ev => {
			let loading = <HTMLElement>document.querySelector('#loading');
			loading.hidden = false;
			bootrom.theshowsover = true;
			resolve();
		};
		msx.className = "enter";
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
	let result: Promise<void> = new Promise((resolve, reject) => {
		let romcode = document.createElement('script');
		romcode.async = false;
		romcode.onerror = (event: Event | string, source?: string, lineno?: number, colno?: number, error?: Error) => {
			reject('urgh');
		};
		window.onerror = (event: Event | string, source?: string, lineno?: number, colno?: number, error?: Error) => {
			reject('urgh');
		};
		if (!bootrom.debug) {
			romcode.innerText = rom.code;
			document.head.appendChild(romcode);
			resolve();
		}
		else {
			romcode.src = `../${romname}.js`;
			romcode.onload = () => resolve();
			document.head.appendChild(romcode);
		}
	});
	return result;
}

/**
 * Waits for the user to press any key before resolving the Promise.
 * @returns A Promise that resolves when the user presses any key.
 */
async function awaitPressedAnyKey(): Promise<void> {
	let remove = (id: string) => {
		let element = document.querySelector(id);
		if (element) element.parentElement!.removeChild(element);
	};
	let wrapup = () => {
		(document.querySelector('#loading') as HTMLElement).hidden = true;
		remove('#msx');
		remove('#hidor');
		remove('#romjs');
	};

	let result: Promise<void> = new Promise((resolve, reject) => {
		let onuserinteraction = (e: UIEvent) => {
			try {
				if (!bootrom.snd_unlocked || !bootrom.theshowsover) { return; }
				if (e.type == 'touchend') {
					let controls = document.getElementById("controls");
					controls!.hidden = false;
					document.documentElement.setAttribute("style", "touch-action: none;");
					document.documentElement.setAttribute("style", "pointer-events: none;");
				}
				document.body.removeEventListener('keyup', onuserinteraction);
				document.body.removeEventListener('touchend', onuserinteraction);
				wrapup();
				resolve();
			}
			catch (err) {
				reject(err);
			}
		};

		document.addEventListener('keyup', startAudioOnIos, true);
		document.addEventListener('touchend', startAudioOnIos, true);
		document.body.addEventListener('keyup', onuserinteraction, { passive: false, once: true, capture: false });
		document.body.addEventListener('touchend', onuserinteraction, { passive: false, once: true, capture: false });
	});
	return result;
}

/**
 * Sets the text content of the loader element with the given string.
 * @param txt - The string to set as the text content of the loader element.
 */
function setLoaderText(txt: string) {
	let loading = <HTMLElement>document.querySelector('#loading');
	loading.innerText = txt;
}

/**
 * Sets the class name of the loader element to the given string.
 * @param cls - The class name to set for the loader element.
 */
function setClassForLoader(cls: string) {
	let loading = <HTMLElement>document.querySelector('#loading');
	loading.className = cls;
}

/**
 * Convert an Uint8Array into a string.
 * https://ourcodeworld.com/articles/read/164/how-to-convert-an-uint8array-to-string-in-javascript
 * @returns {string}
 */
function decodeuint8arr(to_decode: Uint8Array): string {
	return new TextDecoder("utf-8").decode(to_decode);
}

/**
 * Asynchronously fetches an ArrayBuffer from the given URL using XMLHttpRequest.
 * @param url - The URL to fetch the ArrayBuffer from.
 * @returns A Promise that resolves with the fetched ArrayBuffer.
 * If an error occurs during fetching, the Promise is rejected with an error message.
 */
async function fetchLocal(url: string): Promise<ArrayBuffer> {
	return new Promise(function (resolve, reject) {
		var xhr = new XMLHttpRequest;
		xhr.responseType = "arraybuffer";
		xhr.onload = function () {
			resolve(xhr.response);
		};
		xhr.onabort = xhr.ontimeout = xhr.onerror = function (ev: ProgressEvent) {
			// On error, [ev.target.statusText] is empty :-(
			reject(`Failed to download rompack from "${url}" :-(`);
		};
		xhr.open('GET', url);
		xhr.send(null);
	});
}

/**
 * Starts audio on iOS devices by creating a dummy audio buffer source and playing it.
 * If the audio context is already running, removes the event listeners for keyup and touchend.
 * @returns void
 */
function startAudioOnIos(): void {
	if (!bootrom.sndcontext) { return; }
	if (bootrom.snd_unlocked) {
		// Remove event listener if it wasn't removed already
		document.removeEventListener('keyup', startAudioOnIos);
		document.removeEventListener('touchend', startAudioOnIos, true);
		return;
	}
	var source = bootrom.sndcontext.createBufferSource();
	source.buffer = bootrom.sndcontext.createBuffer(1, 1, 44100);
	source.connect(bootrom.sndcontext.destination);
	source.start(0, 0, 0);

	if (bootrom.sndcontext.state == 'running') {
		document.removeEventListener('keyup', startAudioOnIos);
		document.removeEventListener('touchend', startAudioOnIos, true);
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
		var buffer = context.createBuffer(1, 1, 44100),
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
