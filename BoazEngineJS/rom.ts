import { View } from "./view";
import { SoundMaster } from "./soundmaster";

export interface RomResource {
	resid: number;
	resname: string;
	type: string;
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
	return fetch("http://192.168.0.117:8887/rom/packed.rom")
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

async function loadResourceList(): Promise<RomResource[]> {
	return fetch("http://192.168.0.117:8887/rom/romtable.json")
		.then(response => response.json())
		.then(json => json)
		.catch(e => {
			throw new Error(`Failed to load romtable.`);
		});
}

async function loadResources(rom: ArrayBuffer): Promise<void> {
	let list = await loadResourceList();
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
