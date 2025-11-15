// IMPORTANT: IMPORTS TO `bmsx/blabla` ARE NOT ALLOWED!!!!!! THIS WILL CAUSE PROBLEMS WITH .GLSL FILES BEING INCLUDED AND THE ROMPACKER CANNOT HANDLE THIS!!!!!
import type { BootArgs, RomPack } from '../../src/bmsx/rompack/rompack';
import { constructPlatformFromViewHostHandle } from '../../src/bmsx_hostplatform/platform';
import { createAudioContext, startAudioOnIos } from './bootaudio';
import { getSubBufferFromBufferWithMeta, getZippedRomAndRomLabelFromBlob, loadAssetList, loadResources, parseMetaFromBuffer } from './bootresources';

const HAS_DOM_ENVIRONMENT = typeof document !== 'undefined' && document !== null;
declare const __BOOTROM_CASE_INSENSITIVE_LUA__: boolean;
const initialStartingGamepadIndex: number | null = null;

declare global {
	interface Window {
		getRomNameFromUrlParameter: () => string | null;
		getRomFromUrlParameter: () => string | null;
		bootrom: {
			rom: RomPack | null;
			engineRom: RomPack | null;
			cartRom: RomPack | null;
			debug: boolean;
			romname: string | undefined;
			sndcontext: AudioContext | null;
			snd_unlocked: boolean;
			gainnode: GainNode | null;
			theshowsover: boolean;
			startingGamepadIndex: number | null;
			enableOnscreenGamepad: boolean;
			set defusr(rom: RomPack);
			usr: (x: number) => number;
			bload: (url: string, mode?: 'auto' | 'engine' | 'cart') => Promise<RomPack | null>;
			loadEngineRom: (url: string) => Promise<RomPack | null>;
			loadCartRom: (url: string) => Promise<RomPack | null>;
			outputError: (errormsg: string) => void;
			resizeHandler: () => void;
		};
	}

	// Add globalThis augmentation so `globalThis.bootrom = ...` type checks
	var getRomNameFromUrlParameter: () => string | null;
	var getRomFromUrlParameter: () => string | null;
	var bootrom: Object;
}

/**
 * Function that initializes the boot ROM and starts the game.
 * @param {RomPack} rom - The boot ROM pack.
 * @param {AudioContext} sndcontext - The audio context for the boot ROM.
 * @param {GainNode} gainnode - The gain node for the boot ROM.
 * @returns {void}
 */
declare var h406A: (args: BootArgs) => Promise<void>;

function mergeRecords<T>(primary: Record<string, T> | undefined, fallback?: Record<string, T>): Record<string, T> {
	return {
		...(fallback ?? {}),
		...(primary ?? {}),
	};
}

function combineRompacks(engineRom: RomPack | null | undefined, cartRom: RomPack): RomPack {
	if (!engineRom) {
		return cartRom;
	}
	const combinedResourcePaths = (() => {
		const paths = [...(engineRom.resourcePaths ?? []), ...(cartRom.resourcePaths ?? [])];
		const seen = new Set<string>();
		const unique: typeof paths = [];
		for (const entry of paths) {
			const key = `${entry.type}:${entry.asset_id}:${entry.path}`;
			if (seen.has(key)) continue;
			seen.add(key);
			unique.push(entry);
		}
		return unique;
	})();

	const combined: RomPack = {
		...engineRom,
		...cartRom,
		rom: cartRom.rom,
		img: mergeRecords(cartRom.img, engineRom.img),
		audio: mergeRecords(cartRom.audio, engineRom.audio),
		model: mergeRecords(cartRom.model, engineRom.model),
		data: mergeRecords(cartRom.data, engineRom.data),
		audioevents: mergeRecords(cartRom.audioevents, engineRom.audioevents),
		lua: mergeRecords(cartRom.lua, engineRom.lua),
		luaSourcePaths: mergeRecords(cartRom.luaSourcePaths, engineRom.luaSourcePaths),
		resourcePaths: combinedResourcePaths,
		projectRootPath: cartRom.projectRootPath ?? engineRom.projectRootPath ?? null,
		code: cartRom.code ?? engineRom.code ?? null,
		caseInsensitiveLua: cartRom.caseInsensitiveLua ?? engineRom.caseInsensitiveLua,
	};
	return combined;
}

/**
 * Object representing the boot ROM.
 */
export const bootrom = {
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
	engineRom: null as RomPack | null,
	cartRom: null as RomPack | null,
	debug: false,
	romname: undefined as string | undefined, // Currently, used for fetching the megarom Javascript for debug mode
	sndcontext: null as AudioContext | null,
	snd_unlocked: false,
	gainnode: null as GainNode | null,
	theshowsover: false,
	startingGamepadIndex: initialStartingGamepadIndex as BootArgs['startingGamepadIndex'],
	enableOnscreenGamepad: false as BootArgs['enableOnscreenGamepad'],
	platform: null as BootArgs['platform'],
	viewHost: null as BootArgs['viewHost'],
	caseInsensitiveLua: __BOOTROM_CASE_INSENSITIVE_LUA__,

	/**
	 * Sets the boot ROM pack.
	 * @param {RomPack} rom - The boot ROM pack.
	 */
	set defusr(rom: RomPack) {
		bootrom.rom = rom;
		bootrom.cartRom = rom;
		bootrom.engineRom = null;
	},

	/**
	 * Loads the boot ROM and starts the game.
	 * @param x - The value to return after the game is started.
	 * @returns 255 after the game is started.
	 */
	usr(x: number): number {
		const remove = (selector: string) => {
			if (!HAS_DOM_ENVIRONMENT) return;
			const element = document.querySelector(selector);
			if (!element) return;
			const parent = element.parentElement;
			if (!parent) return;
			parent.removeChild(element);
		};

		if (HAS_DOM_ENVIRONMENT && bootrom.enableOnscreenGamepad !== true) {
			bootrom.enableOnscreenGamepad = shouldEnableOnscreenGamepad();
		}

		const wrapup = () => {
			if (!HAS_DOM_ENVIRONMENT) return;
			const loadingElement = document.querySelector('#loading') as HTMLElement | null;
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

		function showUnhandledRejectionError(err: Error | string) {
			console.error("Unhandled promise rejection:", err);
			if (HAS_DOM_ENVIRONMENT) {
				const gamescreen = document.getElementById('gamescreen');
				if (gamescreen instanceof HTMLElement) {
					gamescreen.hidden = true;
					gamescreen.style.display = 'none';
				}
			}
			throw new Error(`Error in usr(0): "${typeof err === 'string' ? err : err?.message ?? 'unknown error :-('}"`);
		}

		if (!h406A) throw new Error(`h406A(${x}) is not defined!`);
		if (HAS_DOM_ENVIRONMENT) {
			const gamescreen = document.getElementById('gamescreen');
			if (!(gamescreen instanceof HTMLElement)) {
				throw new Error('[bootrom] #gamescreen element not found; cannot bootstrap platform.');
			}
			gamescreen.hidden = false;
			gamescreen.style.display = 'block';
			if (!(gamescreen instanceof HTMLCanvasElement)) {
				throw new Error('[bootrom] #gamescreen must be a <canvas> to construct a Platform.');
			}
			const platform = constructPlatformFromViewHostHandle(gamescreen);
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
		h406A({
			rompack: bootrom.rom!,
			sndcontext: bootrom.sndcontext ?? undefined,
			gainnode: bootrom.gainnode ?? undefined,
			debug: this.debug,
			startingGamepadIndex: bootrom.startingGamepadIndex,
			enableOnscreenGamepad: bootrom.enableOnscreenGamepad,
			platform,
			viewHost: bootrom.viewHost ?? undefined,
			caseInsensitiveLua: __BOOTROM_CASE_INSENSITIVE_LUA__,
		} as BootArgs).then(() => {
			wrapup();
			bootrom.rom = undefined;
			delete bootrom.rom;
		}).catch(err => {
			showUnhandledRejectionError(err);
		});
		return 255;
	},

	/**
	 * Asynchronously loads a ROM pack from the specified URL.
	 * @param url - The URL of the ROM pack to load.
	 * @returns A Promise that resolves to the loaded ROM pack, or null if the loading failed.
	 */
	async bload(url: string, mode: 'auto' | 'engine' | 'cart' = 'auto'): Promise<RomPack | null> {
		const loadKind = mode === 'auto' ? 'cart' : mode;
		if (typeof window !== 'undefined') {
			window.onunhandledrejection = (event: PromiseRejectionEvent) => {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				const reason = event.reason?.message ?? event.reason ?? 'unkown error';
				const errormsg = `Unhandled rejection during "bload"-command: "${reason}".`;
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
				throw new Error(`Error while fetching ROM: "${err.message}"`);
			});
		};

		if (loadKind === 'engine') {
			try {
				const response_array = await fetchRom();
				const ziprom_and_label = await getZippedRomAndRomLabelFromBlob(response_array);
				// @ts-ignore
				const inflated = pako.inflate(ziprom_and_label.zipped_rom).buffer;
				const enginePack = await loadResources(inflated);
				enginePack.caseInsensitiveLua = __BOOTROM_CASE_INSENSITIVE_LUA__;
				bootrom.engineRom = enginePack;
				return enginePack;
			} catch (err) {
				console.error('[bootrom] Failed to load engine ROM:', err);
				throw err;
			}
		}

		return new Promise((resolve, reject) => {
			let loadedRomPack: RomPack | null = null;
			let romlabel_bloburl: string | null = null;

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
				.then((response_array: ArrayBuffer) => getZippedRomAndRomLabelFromBlob(response_array))
				.then((ziprom_and_label: { zipped_rom: ArrayBuffer, romlabel: string }) => {
					if (ziprom_and_label.romlabel) {
						romlabel_bloburl = ziprom_and_label.romlabel;
						replaceBMSXImgWithRomLabel();
					}
					// const compressed = new Uint8Array(ziprom_and_label.zipped_rom);
					// return BinaryCompressor.decompressBinary(compressed).buffer;
					// @ts-ignore
					return pako.inflate(ziprom_and_label.zipped_rom).buffer;
				})
				.then(rom => loadResources(rom))
				.then((loadResult: any) => {
					loadedRomPack = loadResult;
					loadedRomPack.caseInsensitiveLua = __BOOTROM_CASE_INSENSITIVE_LUA__;
					const combinedPack = combineRompacks(bootrom.engineRom, loadedRomPack);
					bootrom.cartRom = loadedRomPack;
					bootrom.rom = combinedPack;
					loadedRomPack = combinedPack;
					return awaitBootComplete().then(() => {  // Return the promise and chain the replace after animation ends
						replaceBMSXImgWithRomLabel();
					});
				})
				.then(() => loadScript(loadedRomPack!))
				.then(() => {
					setLoaderText('Press any key, button or touch screen to start...');
					return awaitPressedAnyKeyPromise();
				})
				.then(() => resolve(loadedRomPack))
				.catch(err => {
					console.error('[bload] Top-level error:', err);
					reject(err);
				});
		});
	},

	loadEngineRom(url: string) {
		return this.bload(url, 'engine');
	},

	loadCartRom(url: string) {
		return this.bload(url, 'cart');
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
	globalThis.bootrom = bootrom as typeof bootrom;
	globalThis.getRomFromUrlParameter = (): string | null => {
		const rom = getParameterByName('rom');
		return rom && rom !== '' ? rom : null;
	}

	globalThis.getRomNameFromUrlParameter = (): string | null => {
		const rom_name = getParameterByName('romname');
		return rom_name && rom_name !== '' ? rom_name : null;
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
 * Asynchronously loads the script from the given `RomPack` object and adds it to the document head.
 * @param rom - The `RomPack` object containing the script to load.
 * @param romname - The name of the ROM.
 * @returns A Promise that resolves when the script has been loaded and added to the document head.
 * If an error occurs during loading, the Promise is rejected with an error message.
 */
async function loadScript(rom: RomPack): Promise<void> {
	if (!HAS_DOM_ENVIRONMENT) {
		return;
	}
	if (!rom.code || rom.code.length === 0) {
		return;
	}
	try {
		const romcode = document.createElement('script');
		romcode.async = false;
		romcode.textContent = rom.code;
		document.head.appendChild(romcode);
	} catch (err) {
		throw new Error(`Error in loadScript: ${err.message}`);
	}
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

function shouldEnableOnscreenGamepad(): boolean {
	const nav = typeof navigator !== 'undefined' ? navigator : undefined;
	const hasTouch = typeof nav?.maxTouchPoints === 'number' && nav.maxTouchPoints > 0;
	const coarsePointer = typeof window !== 'undefined'
		&& typeof window.matchMedia === 'function'
		&& window.matchMedia('(pointer: coarse)').matches;
	return hasTouch || coarsePointer;
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

export { getSubBufferFromBufferWithMeta, getZippedRomAndRomLabelFromBlob, loadAssetList, loadResources, parseMetaFromBuffer };
