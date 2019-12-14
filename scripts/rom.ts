import { RomLoadResult, RomResource, RomMeta } from '../src/bmsx/rompack';

declare var pako: any;
declare var h406A: (rom: RomLoadResult, sndcontext: AudioContext, gainnode: GainNode) => void;

// Only implement if no native implementation is available
// https://stackoverflow.com/questions/4775722/how-to-check-if-an-object-is-an-array
if (typeof Array.isArray === 'undefined') {
	Array.isArray = function (obj): obj is Array<any> {
		return Object.prototype.toString.call(obj) === '[object Array]';
	};
};

// Make sure that iOS doesn't scroll, even if overflow = hidden!
// Maar ontouchend eruit halen zorgt ervoor dat niets meer reageert :(
// Touch move vind ik te eng om erin te zetten
// https://medium.com/jsdownunder/locking-body-scroll-for-all-devices-22def9615177
// document.addEventListener('touchmove', e => {
// 	e.preventDefault();
// });
// document.addEventListener('touchend', e => {
// 	e.preventDefault();
// });
// document.addEventListener('touchmove', e => {
// 	e.preventDefault();
// });
// document.addEventListener('touchend', e => {
// 	e.preventDefault();
// });

var basic = {
	rom: null as RomLoadResult,
	debug: false,
	localfetch: false,
	sndcontext: <AudioContext>null,
	snd_unlocked: false,
	gainnode: <GainNode>null,

	set defusr(rom: RomLoadResult) {
		basic.rom = rom;
	},

	usr(x: number): number {
		document.body.style.backgroundColor = "#000000";
		loadScript(basic.rom).then(() => {
			try {
				h406A(basic.rom, basic.sndcontext, basic.gainnode);
				basic.rom = null;
			}
			catch (e) {
				setClassForLoader("");
				setLoaderText(e.message);
			}
			return x;
		});
		return 255;
	},

	async bload(url: string): Promise<RomLoadResult> {
		createAudioContext();
		let bootCompletePromise = awaitBootComplete();
		let rom = await loadRompack(url);
		let result = await loadResources(rom);
		setLoaderText("Press any key to start...");
		setClassForLoader("");

		await bootCompletePromise;
		let pressedAnyKey = awaitPressedAnyKey();
		await pressedAnyKey;
		return result;
	},
};

async function loadRompack(url: string): Promise<ArrayBuffer> {
	if (basic.localfetch) {
		return fetchLocal(url)
			.then(response_array => {
				let result = pako.inflate(response_array).buffer;
				return result;
			})
			.catch(e => {
				setLoaderText(`Failed to load rompack local storage: ${e.message}`);
				setClassForLoader("");
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
				setClassForLoader("");
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
			images: new Map<number, HTMLImageElement>(),
			rom: rom,
			resources: {},
			source: null
		};

		let list = await loadResourceList(rom);
		for (let i = 0; i < list.length; i++) {
			await load(rom, list[i], result);
			result.resources[list[i].resid] = list[i];
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
			let mime: string;
			let blub: Blob;
			let url: string;
			let sliced = new Uint8Array(rom.slice(res.start, res.end));

			mime = 'image/png';
			blub = new Blob([sliced], { type: mime });
			url = URL.createObjectURL(blub);

			let img = await loadImage(url);
			romResult.images.set(res.resid, img);
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
			loading.style.visibility = 'visible';
			resolve();
		});
		msx.className = "enter";
		if (basic.debug) resolve(); // Resolve immediately in debug-mode
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
		if (!basic.debug) {
			romcode.innerText = rom.source;
			document.head.appendChild(romcode);
			resolve();
		}
		else {
			romcode.src = "../rom/megarom.js";
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
		// remove('#loading');
		setClassForLoader("invisible");
		remove('#msx');
		remove('#hidor');
		remove('#romjs');
	};

	let result: Promise<void> = new Promise((resolve, reject) => {
		let onuserinteraction = () => {
			if (!basic.snd_unlocked) { return; }
			document.body.removeEventListener('keyup', onuserinteraction);
			document.body.removeEventListener('click', onuserinteraction);
			wrapup();
			resolve();
		};

		// if ("ontouchstart" in window && basic.sndcontext.state != "running") {
		document.addEventListener('click', startAudioOnIos, true);
		document.addEventListener('keyup', startAudioOnIos, true);
		document.addEventListener('mousedown', startAudioOnIos, true);
		document.addEventListener('touchstart', startAudioOnIos, true);
		document.addEventListener('touchend', startAudioOnIos, true);
		// }
		document.body.addEventListener('keyup', onuserinteraction);
		document.body.addEventListener('click', onuserinteraction); // Touchend want anders geen geluid: https://html.spec.whatwg.org/multipage/interaction.html#triggered-by-user-activation
		// document.body.addEventListener('keyup', bla);
		// document.body.addEventListener('click', bla); // Touchend want anders geen geluid: https://html.spec.whatwg.org/multipage/interaction.html#triggered-by-user-activation
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
	if (!basic.sndcontext) { return; }
	if (basic.snd_unlocked) { return; }
	var source = basic.sndcontext.createBufferSource();
	source.buffer = basic.sndcontext.createBuffer(1, 1, 44100);
	source.connect(basic.sndcontext.destination);
	source.start(0, 0, 0);

	if (basic.sndcontext.state == "running") {
		document.removeEventListener('keyup', startAudioOnIos);
		document.removeEventListener('click', startAudioOnIos);
		document.removeEventListener('mousedown', startAudioOnIos, true);
		document.removeEventListener('touchend', startAudioOnIos, true);
		document.removeEventListener('touchstart', startAudioOnIos, true);
		basic.snd_unlocked = true;
	}
}

function createAudioContext(): void {
	if (basic.sndcontext) return;

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

	basic.sndcontext = context;
}
