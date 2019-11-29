import { View } from "./view";
import { SoundMaster } from "./soundmaster";

interface RomResource {
	resid: number;
	resname: string;
	type: string;
	start: number;
	end: number;
}

interface RomMeta {
	start: number;
	end: number;
}

export async function loadRom(): Promise<void> {
	View.images = new Map<number, HTMLImageElement>();
	SoundMaster.audio = new Map<number, HTMLAudioElement>();
	let rom = await loadRompack();
	await loadResources(rom);
}

async function loadRompack(): Promise<ArrayBuffer> {
	// return fetch("http://192.168.0.117:8887/rom/packed.rom")
	return fetch("http://127.0.0.1:8887/rom/packed.rom")
		.then(response => response.arrayBuffer())
		.then(buffer => buffer)
		.catch(e => {
			new Error(`Failed to load rompack.`);
			return null;
		});
}

async function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		let img = new Image();
		img.onload = (e => resolve(img));
		img.onerror = (e => {
			throw new Error(`Failed to load image's URL: ${url}`);
		});
		img.src = url;
	});
}

async function loadAudio(url: string): Promise<HTMLAudioElement> {
	return new Promise((resolve, reject) => {
		let snd = new Audio();
		snd.onloadeddata = (e => resolve(snd));
		snd.preload = 'auto';
		snd.loop = false;
		snd.controls = false;
		snd.onerror = (e => {
			throw new Error(`Failed to load audio's URL: ${url}`);
		});
		snd.src = url;
		snd.load();
	});
}

async function loadResourceList(rom: ArrayBuffer): Promise<RomResource[]> {
	let bytearray = new Uint8Array(rom);
	let sliced = bytearray.slice(bytearray.length - 100);
	let metaJsonStr = decodeuint8arr(sliced);
	let metaJson: RomMeta = JSON.parse(metaJsonStr);

	sliced = bytearray.slice(metaJson.start, metaJson.end);
	let resJsonStr = decodeuint8arr(sliced);
	let resJson: RomResource[] = JSON.parse(resJsonStr);

	return resJson;

	// return fetch("http://192.168.0.117:8887/rom/romtable.json")
	// 	.then(response => response.json())
	// 	.then(json => json)
	// 	.catch(e => {
	// 		throw new Error(`Failed to load romtable.`);
	// 	});
}

async function loadResources(rom: ArrayBuffer): Promise<void> {
	let list = await loadResourceList(rom);
	for (let i = 0; i < list.length; i++)
		await load(rom, list[i]);
}

async function load(rom: ArrayBuffer, res: RomResource): Promise<void> {
	let bytearray = new Uint8Array(rom);
	let sliced = bytearray.slice(res.start, res.end);

	let mime: string = res.type === 'image' ? 'image/png' : 'audio/wav';

	let blub = new Blob([sliced], { type: mime });
	let url = URL.createObjectURL(blub);
	switch (res.type) {
		case 'image':
			let img = await loadImage(url);
			View.images.set(res.resid, img);
			// console.log(`Ik doe dit ${res.resid}, ${img}`);
			break;
		case 'audio':
			let snd = await loadAudio(url);
			SoundMaster.audio.set(res.resid, snd);
			// console.log(`Ik doe dit ${res.resid}, ${snd}`);
			break;
		default:
			throw Error(`Unrecognised resource type in rom: ${res.type}, while processing rompack`);
	}
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
function encodeuint8arr(to_encode: string): Uint8Array {
	return new TextEncoder().encode(to_encode);
}