import { RomLoadResult, RomResource, RomMeta } from "./rompack";
export { };

declare var pako: any;
declare var h406A: (rom: RomLoadResult) => void;

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
document.addEventListener('touchmove', e => {
	e.preventDefault();
});
document.addEventListener('touchend', e => {
	e.preventDefault();
});
document.addEventListener('touchmove', e => {
	e.preventDefault();
});
document.addEventListener('touchend', e => {
	e.preventDefault();
});

var basic = {
	rom: null as RomLoadResult,
	debug: false,

	set defusr(rom: RomLoadResult) {
		basic.rom = rom;
		if (basic.debug !== true) {
			let romcode = document.createElement('script');
			romcode.async = false;
			romcode.innerText = rom.source;
			document.head.appendChild(romcode);
		}
	},

	usr(x: number): number {
		document.body.style.backgroundColor = "#000000";
		h406A(basic.rom);
		basic.rom = null;
		return 255;
	},

	async bload(url: string): Promise<RomLoadResult> {
		let bootCompletePromise = awaitBootComplete();
		let rom = await loadRompack(url);
		let result = await loadResources(rom);
		setLoaderText("Press any key to start...");
		setClassForLoader("");

		await bootCompletePromise;
		let pressedAnyKey = awaitPressedAnyKey();
		await pressedAnyKey;
		let remove = (id: string) => {
			let element = document.querySelector(id);
			if (element) element.parentElement.removeChild(element);
		};

		remove('#loading');
		remove('#msx');
		remove('#hidor');
		remove('#romjs');
		return result;
	},
};

async function loadRompack(url: string): Promise<ArrayBuffer> {
	return fetch(url)
		.then(response => response.arrayBuffer())
		.then(buffer => {
			let result = pako.inflate(buffer).buffer;
			return result;
		})
		.catch(e => {
			setLoaderText("Failed to load rompack");
			setClassForLoader("");
			new Error(`Failed to load rompack`);
			return null;
		});
}

async function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		let img = new Image();
		img.onload = e => resolve(img);
		img.onerror = e => {
			throw new Error(`Failed to load image's URL: ${url}`);
		};
		img.src = url;
	});
}

//

async function loadResourceList(rom: ArrayBuffer): Promise<RomResource[]> {
	let bytearray = new Uint8Array(rom);
	let sliced = bytearray.slice(bytearray.length - 100);
	let metaJsonStr = decodeuint8arr(sliced);
	let metaJson: RomMeta = JSON.parse(metaJsonStr);

	sliced = bytearray.slice(metaJson.start, metaJson.end);
	let resJsonStr = decodeuint8arr(sliced);
	let resJson: RomResource[] = JSON.parse(resJsonStr);

	return resJson;
}

async function loadResources(rom: ArrayBuffer): Promise<RomLoadResult> {
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

async function load(rom: ArrayBuffer, res: RomResource, romResult: RomLoadResult): Promise<void> {
	switch (res.type) {
		case 'image':
			let mime: string;
			let blub: Blob;
			let url: string;
			let sliced = new Uint8Array(rom.slice(res.start, res.end));
			// let sliced = bytearray.slice(res.start, res.end);

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
				throw e;
			}
			break;
		case 'audio':
			break;
		default:
			// mime = 'audio/wav';
			// blub = new Blob([sliced], { type: mime });
			// url = URL.createObjectURL(blub);

			// let snd = await loadAudio(url);
			// romResult.audio.set(res.resid, snd);
			// romResult.audioTracks[res.resid] = rom.slice(res.start, res.end);
			throw Error(`Unrecognised resource type in rom: ${res.type}, while processing rompack`);
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

async function awaitPressedAnyKey(): Promise<void> {
	let remove = (id: string) => {
		let element = document.querySelector(id);
		if (element) element.parentElement.removeChild(element);
	};

	let result: Promise<void> = new Promise((resolve, reject) => {
		document.body.addEventListener('keyup', ev => {
			remove('#loading');
			remove('#msx');
			remove('#hidor');
			remove('#romjs');
			resolve();
		});
	});
	return result;
}

function setLoaderText(txt: string) {
	let loading = <HTMLElement>document.querySelector('#loading');
	loading.innerText = txt;
}

function setClassForLoader(cls: string) {
	let loading = <HTMLElement>document.querySelector('#loading');
	loading.className = "";
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
 * Convert a string into a Uint8Array.
 * https://ourcodeworld.com/articles/read/164/how-to-convert-an-uint8array-to-string-in-javascript
 * @returns {Uint8Array}
 */
// function encodeuint8arr(to_encode: string): Uint8Array {
// 	return new TextEncoder().encode(to_encode);
// }

// async function loadAudio(url: string): Promise<HTMLAudioElement> {
// 	return new Promise((resolve, reject) => {
// 		let snd = new Audio();
// 		snd.onloadeddata = e => resolve(snd);
// 		snd.preload = 'auto';
// 		snd.loop = false;
// 		snd.controls = false;
// 		snd.onerror = (e => {
// 			throw new Error(`Failed to load audio's URL: ${url}`);
// 		});
// 		snd.src = url;
// 		snd.load();
// 	});
// }