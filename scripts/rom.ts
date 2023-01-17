import { RomPack, RomAsset, RomMeta } from '../src/bmsx/rompack';

declare var pako: any;
declare var h406A: (rom: RomPack, sndcontext: AudioContext, gainnode: GainNode) => void;

var bootrom = {
	rom: null as RomPack | null,
	debug: false,
	localfetch: false,
	sndcontext: null as AudioContext | null,
	snd_unlocked: false,
	gainnode: null as GainNode | null,
	theshowsover: false,

	set defusr(rom: RomPack) {
		bootrom.rom = rom;
	},

	usr(x: number): number {
		document.body.classList.add('game-started'); // Change background color of body
		document.getElementById('gamescreen')!.hidden = false;
		loadScript(bootrom.rom!).then(() => {
			h406A(bootrom.rom!, bootrom.sndcontext!, bootrom.gainnode!);
			bootrom.rom = null;
			return x;
		})
			.catch(err => {
				throw err ?? 'usr(x) failed with unknown error!';
			});
		return 255;
	},

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

function parseMetaFromBuffer(to_parse: ArrayBuffer): RomMeta {
	let bytearray = new Uint8Array(to_parse);
	let sliced = bytearray.slice(bytearray.length - 100);
	let metaJsonStr = decodeuint8arr(sliced);
	return JSON.parse(metaJsonStr);
}

function getSubBufferAsPerMeta(buffer: ArrayBuffer, meta: RomMeta): ArrayBuffer {
	return buffer.slice(meta.start, meta.end);
}

function getSubBufferFromBufferWithMeta(buffer: ArrayBuffer): ArrayBuffer {
	let buffer_meta: RomMeta = parseMetaFromBuffer(buffer);
	return getSubBufferAsPerMeta(buffer, buffer_meta);
}

async function getZippedRomAndRomLabelFromBlob(blob_buffer: ArrayBuffer): Promise<{ zipped_rom: ArrayBuffer, romlabel: string }> {
	// let blob_meta = parseMetaFromBuffer(blob_buffer);
	// let romlabel_htmlimg: string = undefined;
	// if (blob_meta.start > 0) {
	// 	romlabel_htmlimg = getImageURL(blob_buffer.slice(0, blob_meta.start));
	// }

	// return Promise.resolve({ zipped_rom: getSubBufferAsPerMeta(blob_buffer, blob_meta), romlabel: romlabel_htmlimg });
	return Promise.resolve({ zipped_rom: getSubBufferFromBufferWithMeta(blob_buffer), romlabel: undefined });
}

async function loadResourceList(rom: ArrayBuffer): Promise<RomAsset[]> {
	let sliced = new Uint8Array(getSubBufferFromBufferWithMeta(rom));

	let resJsonStr = decodeuint8arr(sliced);
	let resJson: RomAsset[] = JSON.parse(resJsonStr);

	return Promise.resolve<RomAsset[]>(resJson);
}

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

function getImageURL(buffer: ArrayBuffer): string {
	let mime: string;
	let blub: Blob;

	mime = 'image/png';
	blub = new Blob([new Uint8Array(buffer)], { type: mime });
	return URL.createObjectURL(blub);
}

async function getImageFromBuffer(buffer: ArrayBuffer): Promise<HTMLImageElement> {
	let url = getImageURL(buffer);
	return loadImage(url);
}

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

async function loadScript(rom: RomPack): Promise<void> {
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
			romcode.src = '../megarom.js';
			romcode.onload = () => resolve();
			document.head.appendChild(romcode);
		}
	});
	return result;
}

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

function setLoaderText(txt: string) {
	let loading = <HTMLElement>document.querySelector('#loading');
	loading.innerText = txt;
}

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
