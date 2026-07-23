// IMPORTANT: IMPORTS TO `bmsx/blabla` ARE NOT ALLOWED!!!!!! THIS WILL CAUSE PROBLEMS WITH .GLSL FILES BEING INCLUDED AND THE ROMPACKER CANNOT HANDLE THIS!!!!!
import type { MachineBootOptions } from '../../machine/ts/core/machine_manager';
import { parseCartHeader } from '../../machine/ts/rompack/format';
import { decodeRomToc } from '../../machine/ts/rompack/toc';
import { createAudioContext, startAudioOnIos } from './bootaudio';

const HAS_DOM_ENVIRONMENT = typeof document !== 'undefined' && document !== null;
const initialStartingGamepadIndex: number = null;
type BMSX = {
	constructPlatformFromViewHostHandle: (handle: HTMLCanvasElement, options: { audioContext: AudioContext; debug: boolean }) => MachineBootOptions['platform'];
	machineManager: typeof import('../../machine/ts/core/machine_manager').machineManager;
};

declare global {
	interface Window {
		getRomFromUrlParameter: (slot?: 0 | 1) => string | null;
		getRomNameFromUrlParameter: () => string;
		bootrom: {
			cartridgeSlots: [Uint8Array | null, Uint8Array | null];
			systemRom: Uint8Array;
			debug: boolean;
			sndcontext: AudioContext;
			snd_unlocked: boolean;
			gainnode: GainNode;
			theshowsover: boolean;
			startingGamepadIndex: number;
			enableOnscreenGamepad: boolean;
			loadCart: (url: string, slot?: 0 | 1) => Promise<Uint8Array | null>;
			loadSystemRom: (url: string) => Promise<Uint8Array>;
			start: () => Promise<void>;
			outputError: (errormsg: string) => void;
			resizeHandler: () => void;
		};
		__bmsx_sourceMaps?: Map<string, unknown>;
	}

	// Add globalThis augmentation so `globalThis.bootrom = ...` type checks
	var getRomFromUrlParameter: (slot?: 0 | 1) => string | null;
	var getRomNameFromUrlParameter: () => string;
	var bootrom: Object;
	var bmsx: BMSX;
	var __bmsx_sourceMaps: Map<string, unknown> | undefined;
}

/**
 * Object representing the boot ROM.
 */
export const bootrom = {
	/**
	 * This section of code defines the boot ROM object and its properties and methods.
	 *
	 * @property {[Uint8Array | null, Uint8Array | null]} cartridgeSlots - The two physical cartridge inputs.
	 * @property {Uint8Array} systemRom - The system ROM blob.
	 * @property {boolean} debug - A flag indicating whether debug mode is enabled.
	 * @property {AudioContext} sndcontext - The audio context for the boot ROM.
	 * @property {GainNode} gainnode - The gain node for the boot ROM.
	 * @property {boolean} theshowsover - A flag indicating whether the boot animation has ended.
	 * @property {boolean} snd_unlocked - A flag indicating whether the audio has been unlocked.
	 *
	 * @function loadCart - Asynchronously loads a cart ROM blob from the specified URL.
	 * @param {string} url - The URL of the ROM pack to load.
	 * @returns {Promise<Uint8Array | null>} A Promise that resolves to the loaded ROM blob, or null if the loading failed.
	 *
	 * @function loadSystemRom - Asynchronously loads the system ROM blob.
	 * @param {string} url - The URL of the system ROM to load.
	 * @returns {Promise<Uint8Array>} A Promise that resolves to the loaded system ROM.
	 *
	 * @function start - Starts the game using the loaded cart and system ROM.
	 * @returns {Promise<void>} Resolves when startup finishes.
	 *
	 * @var {boolean} snd_unlocked - A flag indicating whether the audio has been unlocked.
	 */
	cartridgeSlots: [null, null] as [Uint8Array | null, Uint8Array | null],
	systemRom: null as Uint8Array,
	debug: false,
	sndcontext: null as AudioContext,
	snd_unlocked: false,
	gainnode: null as GainNode,
	theshowsover: false,
	startingGamepadIndex: initialStartingGamepadIndex as MachineBootOptions['startingGamepadIndex'],
	enableOnscreenGamepad: false as MachineBootOptions['enableOnscreenGamepad'],
	platform: null as MachineBootOptions['platform'],
	viewHost: null as MachineBootOptions['viewHost'],

	/**
	 * Starts the game.
	 * @returns A Promise that resolves when startup finishes.
	 */
	async start(): Promise<void> {
		const remove = (selector: string) => {
			if (!HAS_DOM_ENVIRONMENT) return;
			const element = document.querySelector(selector);
			if (!element) return;
			const parent = element.parentElement;
			if (!parent) return;
			parent.removeChild(element);
		};

		const wrapup = () => {
			if (!HAS_DOM_ENVIRONMENT) return;
			const loadingElement = document.querySelector('#loading') as HTMLElement;
			if (loadingElement) loadingElement.hidden = true;
			window.removeEventListener('resize', bootrom.resizeHandler);
			remove('#msx');
			remove('#hidor');
			remove('#bootrom');
			remove('#loading');
			remove('#extra-message');
			remove('#bload-script');
			document.body.classList.add('game-started'); // Change background color of body
		};

		const machineManager = globalThis.bmsx.machineManager;
		if (HAS_DOM_ENVIRONMENT) {
			createAudioContext(bootrom);
			const gamescreen = document.getElementById('gamescreen');
			if (!(gamescreen instanceof HTMLElement)) {
				throw new Error('#gamescreen element not found; cannot bootstrap platform.');
			}
			gamescreen.hidden = false;
			gamescreen.style.display = 'block';
			if (!(gamescreen instanceof HTMLCanvasElement)) {
				throw new Error('#gamescreen must be a <canvas> to construct a Platform.');
			}
			const platform = globalThis.bmsx.constructPlatformFromViewHostHandle(gamescreen, { audioContext: bootrom.sndcontext, debug: this.debug });
			bootrom.platform = platform;
			bootrom.viewHost = platform.gameviewHost;
		}

		if (typeof window !== 'undefined') {
			// Remove the global error handler to prevent useless stack traces
			window.onunhandledrejection = null;
			// Remove the global error handler to prevent useless stack traces
			window.onerror = null;
		}

		const platform = bootrom.platform;
		if (!platform) {
			throw new Error('Platform not initialized before starting the game.');
		}
		await machineManager.boot({
			cartridgeSlots: bootrom.cartridgeSlots,
			systemRom: bootrom.systemRom,
			sndcontext: bootrom.sndcontext,
			gainnode: bootrom.gainnode,
			debug: this.debug,
			startingGamepadIndex: bootrom.startingGamepadIndex,
			enableOnscreenGamepad: bootrom.enableOnscreenGamepad,
			platform,
			viewHost: bootrom.viewHost,
		} as MachineBootOptions);
		wrapup();
		bootrom.cartridgeSlots[0] = null;
		bootrom.cartridgeSlots[1] = null;
	},

	/**
	 * Asynchronously loads a ROM pack from the specified URL.
	 * @param url - The URL of the ROM pack to load.
	 * @returns A Promise that resolves to the loaded ROM pack, or null if the loading failed.
	 */
	async loadCart(url: string, slot: 0 | 1 = 0): Promise<Uint8Array | null> {
		if (typeof window !== 'undefined') {
			window.onunhandledrejection = (event: PromiseRejectionEvent) => {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				const reason = event.reason?.message ?? event.reason ?? 'unkown error';
				const errormsg = `Unhandled rejection: ${reason}".`;
				throw new Error(errormsg);
			};
		}

		if (typeof window !== 'undefined') {
			createAudioContext(bootrom);
		}

		if (slot === 0
				&& HAS_DOM_ENVIRONMENT
				&& typeof window !== 'undefined'
				&& !window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches) {
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

		const loadedRomBlob = await fetchBuffer(url).catch(err => {
			console.error(`Error while fetching ROM: "${err.message}"`);
			return null;
		});
		let romLabelUrl: string | null = null;
		if (loadedRomBlob !== null && slot === 0) {
			const header = parseCartHeader(loadedRomBlob);
			const toc = decodeRomToc(loadedRomBlob.subarray(header.tocOffset, header.tocOffset + header.tocLength));
			for (let index = 0; index < toc.entries.length; index += 1) {
				const entry = toc.entries[index];
				if (entry.type === 'romlabel') {
					romLabelUrl = getImageUrlFromBuffer(loadedRomBlob.subarray(entry.start!, entry.end!));
					break;
				}
			}
		}
		bootrom.cartridgeSlots[slot] = loadedRomBlob;
		if (slot === 1) {
			return loadedRomBlob;
		}

		const replaceBmsxImageWithRomLabel = () => {
			if (!HAS_DOM_ENVIRONMENT || romLabelUrl === null) return;
			const msx = document.querySelector('#msx') as HTMLImageElement;
			msx.src = romLabelUrl;
		};
		replaceBmsxImageWithRomLabel();
		await awaitBootComplete();
		replaceBmsxImageWithRomLabel();
		if (bootrom.debug) {
			startAudioOnIos(bootrom);
			return loadedRomBlob;
		}
		setLoaderText('Press any key, button or touch screen to start...');
		await awaitPressedAnyKeyPromise();
		return loadedRomBlob;
	},

	async loadSystemRom(url: string): Promise<Uint8Array> {
		const response = await fetchBuffer(url).catch(err => {
			throw new Error(`Error while fetching system ROM: "${err.message}"`);
		});
		bootrom.systemRom = response;
		return response;
	},

	outputError(error: Error | string) {
		console.error(error);
		bootrom.theshowsover = true;
		const loadingElement = document.querySelector<HTMLElement>('#loading')
		if (loadingElement) loadingElement.hidden = false;
		const msxElement = document.querySelector<HTMLElement>('#msx');
		if (msxElement) msxElement.onanimationend = undefined;
		const hidorElement = document.querySelector<HTMLElement>('#hidor');
		if (hidorElement) hidorElement.className = 'showsover';
		const gamescreen = document.getElementById('gamescreen');
		if (gamescreen) gamescreen.style.display = 'none';
		document.body.className = "showsover";
		setClassForLoader('');
		setLoaderText(error instanceof Error ? error.message : error);
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
	globalThis.bootrom = bootrom as typeof bootrom;
	globalThis.getRomFromUrlParameter = (slot: 0 | 1 = 0): string | null => {
		const rom = getParameterByName(slot === 0 ? 'rom' : 'slot1');
		return rom && rom !== '' ? rom : null;
	}
	globalThis.getRomNameFromUrlParameter = (): string => {
		const romName = getParameterByName('romname');
		if (romName && romName !== '') {
			return romName;
		}
		const rom = getParameterByName('rom');
		if (!rom || rom.length === 0) {
			return null;
		}
		const basename = rom.split('/').pop();
		if (!basename || basename.length === 0) {
			return null;
		}
		return basename.replace(/\.debug\.rom$/i, '').replace(/\.rom$/i, '');
	}
}

function getParameterByName(name: string, url: string = window.location.href) {
	name = name.replace(/[\[\]]/g, '\\$&');
	const regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
		results = regex.exec(url);
	if (!results) return null;
	if (!results[2]) return '';
	return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

function getImageUrlFromBuffer(buffer: Uint8Array): string {
	return URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: 'image/png' }));
}

/**
 * Waits for the boot animation to complete before resolving the Promise.
 * @returns A Promise that resolves when the boot animation is complete.
 */
async function awaitBootComplete(): Promise<void> {
	const result: Promise<void> = new Promise((resolve) => {
		const msx = document.querySelector<HTMLElement>('#msx');
		msx.onanimationend = _ev => {
			// let loading = <HTMLElement>document.querySelector('#loading');
			// loading.hidden = false;
			bootrom.theshowsover = true;
			resolve();
		};
		msx.className = 'enter';
		msx.hidden = false;
		if (bootrom.debug) {
			bootrom.theshowsover = true;
			resolve();
		}
	});
	return result;
}

/**
 * Waits for the user to press any key before resolving the Promise.
 * @returns A Promise that resolves when the user presses any key.
 */
async function awaitPressedAnyKeyPromise(): Promise<void> {
	if (!HAS_DOM_ENVIRONMENT) {
		return;
	}
	const result: Promise<void> = new Promise((resolve, reject) => {
		let rafId: number;

		const cleanup = () => {
			document.body.removeEventListener('keyup', onuserinteraction);
			document.body.removeEventListener('touchend', onuserinteraction);
			cancelAnimationFrame(rafId);
		};

		const startGame = () => {
			startAudioOnIos(bootrom);
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
				if (e.type === 'touchend') {
					document.documentElement.style.touchAction = 'none';
					bootrom.enableOnscreenGamepad = true;
				}
				startGame();
			}
			catch (err) {
				cleanup();
				reject(err);
			}
		};

		document.addEventListener('keyup', () => startAudioOnIos(bootrom), true);
		document.addEventListener('touchend', () => startAudioOnIos(bootrom), true);
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
	if (!HAS_DOM_ENVIRONMENT) return;
	const loading = document.querySelector<HTMLElement>('#loading');
	if (loading) loading.innerText = txt;
}

/**
 * Sets the class name of the loader element to the given string.
 * @param cls - The class name to set for the loader element.
 */
function setClassForLoader(cls: string) {
	if (!HAS_DOM_ENVIRONMENT) return;
	const loading = document.querySelector<HTMLElement>('#loading');
	if (loading) loading.className = cls;
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
		throw new Error(`Failed @fetchText for URL "${url}": ${err.message}`);
	}
}

/**
 * Asynchronously fetches an Uint8Array from the given URL using XMLHttpRequest.
 * @param url - The URL to fetch the Uint8Array from.
 * @returns A Promise that resolves with the fetched Uint8Array.
 * If an error occurs during fetching, the Promise is rejected with an error message.
 */
async function fetchBuffer(url: string): Promise<Uint8Array> {
	try {
		const response = await fetch(url, {
			headers: {
				'Cache-Control': 'no-cache'
			}
		});
		if (!response.ok) {
			throw new Error(`Failed @fetchBuffer for URL "${url}"`);
		}
		return new Uint8Array(await response.arrayBuffer());
	} catch (err) {
		throw new Error(`Failed @fetchBuffer for URL "${url}": ${err.message}`);
	}
}
