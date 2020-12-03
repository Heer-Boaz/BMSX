import { RomLoadResult, RomResource, RomMeta } from '../src/bmsx/rompack';

declare var pako: any;
declare var h406A: (rom: RomLoadResult, sndcontext: AudioContext, gainnode: GainNode) => void;

// Only implement if no native implementation is available
// https://stackoverflow.com/questions/4775722/how-to-check-if-an-object-is-an-array
// if (typeof Array.isArray === 'undefined') {
// 	Array.isArray = function (obj): obj is Array<any> {
// 		return Object.prototype.toString.call(obj) === '[object Array]';
// 	};
// };

var bootrom = {
	rom: null as RomLoadResult,
	debug: false,
	localfetch: false,
	sndcontext: <AudioContext>null,
	snd_unlocked: false,
	gainnode: <GainNode>null,

	set defusr(rom: RomLoadResult) {
		bootrom.rom = rom;
	},

	usr(x: number): number {
		document.body.style.backgroundColor = "#000000";
		document.getElementById('gamescreen').hidden = false;
		loadScript(bootrom.rom).then(() => {
			// try {
			h406A(bootrom.rom, bootrom.sndcontext, bootrom.gainnode);
			bootrom.rom = null;
			// }
			// catch (e) {
			// setClassForLoader("");
			// (document.querySelector('#loading') as HTMLElement).hidden = false;
			// setLoaderText(e.message);
			// }
			return x;
		});
		return 255;
	},

	async bload(url: string): Promise<RomLoadResult> {
		createAudioContext();
		let bootCompletePromise = awaitBootComplete();
		let rom = await loadRompack(url);
		let result = await loadResources(rom);

		await bootCompletePromise;
		setLoaderText('Press any key or touch screen to start...');
		setClassForLoader('');
		let pressedAnyKey = awaitPressedAnyKey();
		await pressedAnyKey;
		return result;
	},
};

async function loadRompack(url: string): Promise<ArrayBuffer> {
	if (bootrom.localfetch) {
		return fetchLocal(url)
			.then(response_array => {
				let result = pako.inflate(response_array).buffer;
				return result;
			})
			.catch(e => {
				setLoaderText(`Failed to load rompack local storage: ${e.message}`);
				setClassForLoader('');
				console.error(`Failed to load rompack from local storage: ${e.message}`);
				Promise.reject(e);
			});
	}
	else {
		return fetch(url)
			.then(response => response.arrayBuffer())
			.then(buffer => {
				let result = pako.inflate(buffer).buffer;
				return result;
			})
			.catch(e => {
				setLoaderText(`Failed to load rompack: ${e.message}`);
				setClassForLoader('');
				console.error(`Failed to load rompack: ${e.message}`);
				Promise.reject(e);
			});
	}
}

async function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		let img = new Image();
		img.onload = e => resolve(img);
		img.onerror = e => {
			let msg = `Failed to load image's URL: ${url}`;
			console.error(msg);
			reject(msg);
		};
		img.src = url;
	});
}

async function loadResourceList(rom: ArrayBuffer): Promise<RomResource[]> {
	try {
		let bytearray = new Uint8Array(rom);
		let sliced = bytearray.slice(bytearray.length - 100);
		let metaJsonStr = decodeuint8arr(sliced);
		let metaJson: RomMeta = JSON.parse(metaJsonStr);

		sliced = bytearray.slice(metaJson.start, metaJson.end);
		let resJsonStr = decodeuint8arr(sliced);
		let resJson: RomResource[] = JSON.parse(resJsonStr);

		return resJson;
	}
	catch (e) {
		console.error(e.message);
		return Promise.reject(e.message);
	}
}

async function loadResources(rom: ArrayBuffer): Promise<RomLoadResult> {
	try {
		let result: RomLoadResult = {
			images: {},
			rom: rom,
			imgresources: {},
			sndresources: {},
			source: null
		};

		let list = await loadResourceList(rom);
		for (let i = 0; i < list.length; i++) {
			await load(rom, list[i], result);
		}
		return result;
	}
	catch (e) {
		console.error(e.message);
		return Promise.reject(e.message);
	}
}

async function load(rom: ArrayBuffer, res: RomResource, romResult: RomLoadResult): Promise<void> {
	switch (res.type) {
		case 'image':
			if (!res.imgmeta.atlassed) {
				let mime: string;
				let blub: Blob;
				let url: string;
				let sliced = new Uint8Array(rom.slice(res.start, res.end));

				mime = 'image/png';
				blub = new Blob([sliced], { type: mime });
				url = URL.createObjectURL(blub);

				let img = await loadImage(url);
				romResult.images[res.resid] = img;
				romResult.images[res.resname] = img;
			}
			romResult.imgresources[res.resid] = res;
			romResult.imgresources[res.resname] = res;
			break;
		case 'source':
			try {
				let bytearray = new Uint8Array(rom);
				let sliced = bytearray.slice(res.start, res.end);
				romResult.source = decodeuint8arr(sliced);
			} catch (e) {
				let msg = `Unrecognised resource type in rom: ${res.type}, while processing rompack!`;
				console.error(msg);
				return Promise.reject(msg);
			}
			break;
		case 'audio':
			romResult.sndresources[res.resid] = res;
			romResult.sndresources[res.resname] = res;
			break;
		default:
			let msg = `Unrecognised resource type in rom: ${res.type}, while processing rompack!`;
			console.error(msg);
			return Promise.reject(msg);
	}
}

async function awaitBootComplete(): Promise<void> {
	let result: Promise<void> = new Promise((resolve, reject) => {
		let msx = <HTMLElement>document.querySelector('#msx');
		msx.addEventListener('animationend', ev => {
			let loading = <HTMLElement>document.querySelector('#loading');
			loading.hidden = false;
			resolve();
		});
		msx.className = "enter";
		msx.hidden = false;
		if (bootrom.debug) resolve(); // Resolve immediately in debug-mode
	});
	return result;
}

async function loadScript(rom: RomLoadResult): Promise<void> {
	let result: Promise<void> = new Promise((resolve, reject) => {
		let romcode = document.createElement('script');
		romcode.async = false;
		romcode.onerror = (event: Event | string, source?: string, lineno?: number, colno?: number, error?: Error) => {
			setLoaderText(`SError: ${(<Event>event)?.type ?? ""} ${source ?? ""} ${lineno ?? ""} ${colno ?? ""} ${error?.message ?? ""}`);
			reject(error);
		};
		window.onerror = (event: Event | string, source?: string, lineno?: number, colno?: number, error?: Error) => {
			setLoaderText(`WError: ${event} ${source ?? ""} ${lineno ?? ""} ${colno ?? ""} ${error?.message ?? ""}`);
			reject(error);
		};
		if (!bootrom.debug) {
			romcode.innerText = rom.source;
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
		if (element) element.parentElement.removeChild(element);
	};
	let wrapup = () => {
		(document.querySelector('#loading') as HTMLElement).hidden = true;
		remove('#msx');
		remove('#hidor');
		remove('#romjs');
	};

	let result: Promise<void> = new Promise((resolve, reject) => {
		let onuserinteraction = (e: UIEvent) => {
			if (!bootrom.snd_unlocked) { return; }
			if (e.type == 'touchend') {
				let controls = document.getElementById("controls");
				controls.hidden = false;
				document.documentElement.setAttribute("style", "touch-action: none;");
				document.documentElement.setAttribute("style", "pointer-events: none;");
			}
			document.body.removeEventListener('keyup', onuserinteraction);
			document.body.removeEventListener('touchend', onuserinteraction);
			wrapup();
			resolve();
		};

		document.addEventListener('keyup', startAudioOnIos, true);
		document.addEventListener('touchend', startAudioOnIos, true);
		document.body.addEventListener('keyup', onuserinteraction);
		document.body.addEventListener('touchend', onuserinteraction, true);
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
			return resolve(xhr.response);
		};
		xhr.onerror = function () {
			return reject(new TypeError('Local request failed'));
		};
		xhr.open('GET', url);
		xhr.send(null);
	});
}

function startAudioOnIos(): void {
	if (!bootrom.sndcontext) { return; }
	if (bootrom.snd_unlocked) { return; }
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
	});
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
