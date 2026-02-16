// IMPORTANT: IMPORTS TO `bmsx/blabla` ARE NOT ALLOWED!!!!!! THIS WILL CAUSE PROBLEMS WITH .GLSL FILES BEING INCLUDED AND THE ROMPACKER CANNOT HANDLE THIS!!!!!
import type { BootArgs } from '../../src/bmsx/rompack/rompack';
import { constructPlatformFromViewHostHandle } from '../../src/bmsx_hostplatform/platform';
import { createAudioContext, startAudioOnIos } from './bootaudio';
import type * as _BMSX from '../../src/bmsx/index';

const HAS_DOM_ENVIRONMENT = typeof document !== 'undefined' && document !== null;
const initialStartingGamepadIndex: number = null;
type BMSX = typeof _BMSX;

declare global {
	interface Window {
		getRomFromUrlParameter: () => string;
		getRomNameFromUrlParameter: () => string;
		bootrom: {
			cartridge: Uint8Array;
			engineAssets: Uint8Array;
			debug: boolean;
			sndcontext: AudioContext;
			snd_unlocked: boolean;
			gainnode: GainNode;
			theshowsover: boolean;
			startingGamepadIndex: number;
			enableOnscreenGamepad: boolean;
			loadCart: (url: string) => Promise<Uint8Array>;
			loadEngineAssets: (url: string) => Promise<Uint8Array>;
			start: () => Promise<void>;
			outputError: (errormsg: string) => void;
			resizeHandler: () => void;
		};
		__bmsx_sourceMaps?: Map<string, unknown>;
	}

	// Add globalThis augmentation so `globalThis.bootrom = ...` type checks
	var getRomFromUrlParameter: () => string;
	var getRomNameFromUrlParameter: () => string;
	var bootrom: Object;
	var bmsx: BMSX;
	var __bmsx_sourceMaps: Map<string, unknown> | undefined;
}

/**
 * Function that initializes the boot ROM and starts the game.
 * @param {Uint8Array} rom - The cart ROM blob.
 * @param {AudioContext} sndcontext - The audio context for the boot ROM.
 * @param {GainNode} gainnode - The gain node for the boot ROM.
 * @returns {void}
 */

/**
 * Object representing the boot ROM.
 */
export const bootrom = {
	/**
	 * This section of code defines the boot ROM object and its properties and methods.
	 *
	 * @property {Uint8Array} cartridge - The cart ROM blob.
	 * @property {Uint8Array} engineAssets - The engine asset blob.
	 * @property {boolean} debug - A flag indicating whether debug mode is enabled.
	 * @property {AudioContext} sndcontext - The audio context for the boot ROM.
	 * @property {GainNode} gainnode - The gain node for the boot ROM.
	 * @property {boolean} theshowsover - A flag indicating whether the boot animation has ended.
	 * @property {boolean} snd_unlocked - A flag indicating whether the audio has been unlocked.
	 *
	 * @function loadCart - Asynchronously loads a cart ROM blob from the specified URL.
	 * @param {string} url - The URL of the ROM pack to load.
	 * @returns {Promise<Uint8Array>} A Promise that resolves to the loaded ROM blob, or null if the loading failed.
	 *
	 * @function loadEngineAssets - Asynchronously loads the engine asset blob.
	 * @param {string} url - The URL of the asset pack to load.
	 * @returns {Promise<Uint8Array>} A Promise that resolves to the loaded asset blob.
	 *
	 * @function start - Starts the game using the loaded cart and engine assets.
	 * @returns {Promise<void>} Resolves when startup finishes.
	 *
	 * @var {boolean} snd_unlocked - A flag indicating whether the audio has been unlocked.
	 */
	cartridge: null as Uint8Array,
	engineAssets: null as Uint8Array,
	debug: false,
	sndcontext: null as AudioContext,
	snd_unlocked: false,
	gainnode: null as GainNode,
	theshowsover: false,
	startingGamepadIndex: initialStartingGamepadIndex as BootArgs['startingGamepadIndex'],
	enableOnscreenGamepad: false as BootArgs['enableOnscreenGamepad'],
	platform: null as BootArgs['platform'],
	viewHost: null as BootArgs['viewHost'],

	/**
	 * Starts the game.
	 * @returns A Promise that resolves when startup finishes.
	 */
	start(): Promise<void> {
		try {
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
				remove('#pacojs');
				remove('#bload-script');
				document.body.classList.add('game-started'); // Change background color of body
			};

			const entry = globalThis.bmsx.startCart;
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
				const platform = constructPlatformFromViewHostHandle(gamescreen, { audioContext: bootrom.sndcontext });
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
				throw new Error('[bootrom] Platform not initialized before starting the game.');
			}
			return Promise.resolve(entry({
				cartridge: bootrom.cartridge,
				engineAssets: bootrom.engineAssets,
				sndcontext: bootrom.sndcontext,
				gainnode: bootrom.gainnode,
				debug: this.debug,
				startingGamepadIndex: bootrom.startingGamepadIndex,
				enableOnscreenGamepad: bootrom.enableOnscreenGamepad,
				platform,
				viewHost: bootrom.viewHost,
			} as BootArgs)).then(() => {
				wrapup();
				bootrom.cartridge = undefined;
				delete bootrom.cartridge;
			});
		} catch (err) {
			throw err;
		}
	},

	/**
	 * Asynchronously loads a ROM pack from the specified URL.
	 * @param url - The URL of the ROM pack to load.
	 * @returns A Promise that resolves to the loaded ROM pack, or null if the loading failed.
	 */
	async loadCart(url: string): Promise<Uint8Array> {
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

		if (HAS_DOM_ENVIRONMENT && typeof window !== 'undefined' && !window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches) {
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
				console.error(`Error while fetching ROM: "${err.message}"`);
				// We do not reject here, allowing the engine core to handle the missing cartridge by itself (showing a blank screen, like a retro-style computer with no cart inserted).
			});
		};

		return new Promise((resolve, reject) => {
			let loadedRomBlob: Uint8Array = null;
			let romlabel_bloburl: string = null;

			function replaceBMSXImgWithRomLabel() {
				if (!HAS_DOM_ENVIRONMENT || !romlabel_bloburl) return;
				const msx = document.querySelector('#msx') as HTMLImageElement;
				msx.src = romlabel_bloburl;

				// Unhide the image if it is hidden
				// msx.hidden = false;

				// Remove any previous animationend handler
				// msx.onanimationend = null;

				// Otherwise, fade out, then swap image and fade in while
				// keeping the image positioned off-screen via the 'hidden'
				// class to avoid a flash before the boot animation starts.
				// msx.onanimationend = (ev: AnimationEvent) => {
				// 	const img = ev.target as HTMLImageElement;
				// 	img.src = romlabel_bloburl;
				// 	img.classList.add('fade-in');
				// 	// img.onanimationend = null; // Clean up
				// };
			}

			fetchRom()
				.then((response_array: Uint8Array) => {
					if (response_array) {
						const split = splitRomLabel(response_array);
						if (split.romlabel) {
							romlabel_bloburl = getImageUrlFromBuffer(split.romlabel);
							replaceBMSXImgWithRomLabel();
						}
						loadedRomBlob = response_array;
						bootrom.cartridge = loadedRomBlob;
					} else {
						bootrom.cartridge = null;
					}
					return awaitBootComplete().then(() => {
						replaceBMSXImgWithRomLabel();
					});
				})
				.then(() => {
					setLoaderText('Press any key, button or touch screen to start...');
					return awaitPressedAnyKeyPromise();
				})
				.then(() => resolve(loadedRomBlob))
				.catch(err => {
					reject(err);
				});
		});
	},

	async loadEngineAssets(url: string): Promise<Uint8Array> {
		const response = await fetchBuffer(url).catch(err => {
			throw new Error(`Error while fetching engine assets: "${err.message}"`);
		});
		bootrom.engineAssets = response;
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
	globalThis.getRomFromUrlParameter = (): string => {
		const rom = getParameterByName('rom');
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

// TODO: DUPLICATE CODE WITH `romloader.ts`!!!
function splitPng(blob: Uint8Array): { png?: Uint8Array; rest: Uint8Array } {
	if (
		blob[0] !== 0x89 || blob[1] !== 0x50 || blob[2] !== 0x4E || blob[3] !== 0x47 ||
		blob[4] !== 0x0D || blob[5] !== 0x0A || blob[6] !== 0x1A || blob[7] !== 0x0A
	) {
		return { rest: blob };
	}
	let p = 8;
	while (p + 8 <= blob.length) {
		const len = (blob[p] << 24) | (blob[p + 1] << 16) | (blob[p + 2] << 8) | blob[p + 3];
		p += 4;
		const type = (blob[p] << 24) | (blob[p + 1] << 16) | (blob[p + 2] << 8) | blob[p + 3];
		p += 4;
		const end = p + len + 4;
		if (type === 0x49454E44) {
			const png = blob.slice(0, end);
			const rest = blob.slice(end);
			return { png, rest };
		}
		p = end;
	}
	throw new Error('PNG IEND chunk not found');
}

function splitRomLabel(blob: Uint8Array): { zipped_rom: Uint8Array; romlabel?: Uint8Array } {
	const { png, rest } = splitPng(blob);
	if (png) {
		return { zipped_rom: rest, romlabel: png };
	}
	return { zipped_rom: blob, romlabel: undefined };
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
		const msx = <HTMLElement>document.querySelector('#msx');
		msx.onanimationend = _ev => {
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
