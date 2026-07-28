// IMPORTANT: IMPORTS TO `bmsx/blabla` ARE NOT ALLOWED!!!!!! THIS WILL CAUSE PROBLEMS WITH .GLSL FILES BEING INCLUDED AND THE ROMPACKER CANNOT HANDLE THIS!!!!!
import type { MachineInitializationOptions } from '../../machine/ts/core/machine_manager';
import { parseCartHeader } from '../../machine/ts/rompack/format';
import { decodeRomToc } from '../../machine/ts/rompack/toc';
import { BrowserPlatform } from './platform';
import { createAudioContext, resumeAudio, type BootAudioState } from './boot_audio';

const audioState: BootAudioState = {
	sndcontext: null,
};

let bootAnimationComplete = false;
let startingGamepadIndex: number;
let enableOnscreenGamepad = false;

export async function prepareBrowserStartup(
	debug: boolean,
	systemRomPath: string,
	defaultRom: string,
): Promise<MachineInitializationOptions> {
	const romUrl = getRomFromUrlParameter() || defaultRom;
	if (!romUrl) {
		throw new Error('Missing required URL parameter: ?rom=<path-to-rom>');
	}
	const systemRom = await fetchBuffer(systemRomPath);
	const slot1Url = getRomFromUrlParameter(1);
	const [slot0Rom, slot1Rom] = await Promise.all([
		loadCart(`./${romUrl}`, 0, debug),
		slot1Url ? loadCart(`./${slot1Url}`, 1, debug) : Promise.resolve(null),
	]);
	createAudioContext(audioState);
	const gamescreen = document.getElementById('gamescreen');
	if (!(gamescreen instanceof HTMLCanvasElement)) {
		throw new Error('#gamescreen must be a <canvas> to construct the browser host.');
	}
	gamescreen.hidden = false;
	gamescreen.style.display = 'block';
	const platform = new BrowserPlatform(gamescreen, {
		audioContext: audioState.sndcontext,
		debug,
		enableOnscreenGamepad,
	});
	return {
		cartridgeSlots: [slot0Rom, slot1Rom],
		systemRom,
		debug,
		startingGamepadIndex,
		enableOnscreenGamepad,
		platform,
	};
}

export function completeBrowserBoot(): void {
	window.removeEventListener('resize', resizeLoaderMessage);
	document.getElementById('msx').remove();
	document.getElementById('hidor').remove();
	document.getElementById('loading').remove();
	document.getElementById('extra-message').remove();
	document.body.classList.add('game-started');
}

async function loadCart(url: string, slot: 0 | 1, debug: boolean): Promise<Uint8Array> {
	createAudioContext(audioState);
	if (slot === 0 && !window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches) {
		const extraMessageElement = document.getElementById('extra-message');
		const loadingElement = document.getElementById('loading');
		loadingElement.style.display = 'block';
		resizeLoaderMessage();
		extraMessageElement.innerText = 'Please add this page to your home screen to get the full experience of this game!';
		extraMessageElement.hidden = false;
		window.addEventListener('resize', resizeLoaderMessage);
	}

	const loadedRom = await fetchBuffer(url);
	if (slot === 1) {
		return loadedRom;
	}

	const header = parseCartHeader(loadedRom);
	const toc = decodeRomToc(loadedRom.subarray(
		header.tocOffset,
		header.tocOffset + header.tocLength,
	));
	let romLabelUrl = '';
	for (let index = 0; index < toc.entries.length; index += 1) {
		const entry = toc.entries[index];
		if (entry.type === 'romlabel') {
			romLabelUrl = getImageUrlFromBuffer(loadedRom.subarray(entry.start, entry.end));
			break;
		}
	}
	replaceBmsxImageWithRomLabel(romLabelUrl);
	await awaitBootComplete(debug);
	replaceBmsxImageWithRomLabel(romLabelUrl);
	if (debug) {
		armAudioUnlock();
		return loadedRom;
	}
	setLoaderText('Press any key, button or touch screen to start...');
	await awaitPressedAnyKey();
	return loadedRom;
}

function replaceBmsxImageWithRomLabel(romLabelUrl: string): void {
	if (!romLabelUrl) {
		return;
	}
	document.querySelector<HTMLImageElement>('#msx').src = romLabelUrl;
}

export function showBrowserBootError(error: unknown): void {
	console.error(error);
	bootAnimationComplete = true;
	document.getElementById('loading').hidden = false;
	document.getElementById('hidor').className = 'showsover';
	document.getElementById('gamescreen').style.display = 'none';
	document.body.className = 'showsover';
	setLoaderText(error instanceof Error ? error.message : String(error));
}

function resizeLoaderMessage(): void {
	const loadingRect = document.getElementById('loading').getBoundingClientRect();
	document.getElementById('extra-message').style.top = `${(loadingRect.bottom / window.innerHeight) * 100}vh`;
}

function getRomFromUrlParameter(slot: 0 | 1 = 0): string | null {
	const parameter = slot === 0 ? 'rom' : 'slot1';
	return new URL(window.location.href).searchParams.get(parameter);
}

function getImageUrlFromBuffer(buffer: Uint8Array): string {
	return URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: 'image/png' }));
}

async function awaitBootComplete(debug: boolean): Promise<void> {
	const msx = document.getElementById('msx');
	msx.className = 'enter';
	msx.hidden = false;
	if (debug) {
		bootAnimationComplete = true;
		return;
	}
	await new Promise<void>((resolve) => {
		msx.addEventListener('animationend', () => {
			bootAnimationComplete = true;
			resolve();
		}, { once: true });
	});
}

async function awaitPressedAnyKey(): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		let animationFrameId = 0;

		const cleanup = (): void => {
			document.body.removeEventListener('keyup', onUserInteraction);
			document.body.removeEventListener('touchend', onUserInteraction);
			window.cancelAnimationFrame(animationFrameId);
		};
		const startGame = (): void => {
			cleanup();
			resolve();
		};
		const pollGamepads = (): void => {
			try {
				if (!bootAnimationComplete) {
					animationFrameId = window.requestAnimationFrame(pollGamepads);
					return;
				}
				const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
				for (const gamepad of gamepads) {
					if (!gamepad) {
						continue;
					}
					if (gamepad.buttons.some(button => button.pressed)
						|| gamepad.axes.some(axis => Math.abs(axis) > 0.5)) {
						startingGamepadIndex = gamepad.index;
						armAudioUnlock();
						startGame();
						return;
					}
				}
				animationFrameId = window.requestAnimationFrame(pollGamepads);
			} catch (error) {
				cleanup();
				reject(error);
			}
		};
		const onUserInteraction = (event: UIEvent): void => {
			if (!bootAnimationComplete) {
				return;
			}
			cleanup();
			void resumeAudio(audioState).then(() => {
				if (event.type === 'touchend') {
					document.documentElement.style.touchAction = 'none';
					enableOnscreenGamepad = true;
				}
				resolve();
			}, reject);
		};

		document.body.addEventListener('keyup', onUserInteraction, { passive: false });
		document.body.addEventListener('touchend', onUserInteraction, { passive: false });
		if (navigator.getGamepads) {
			animationFrameId = window.requestAnimationFrame(pollGamepads);
		}
	});
}

function armAudioUnlock(): void {
	const cleanup = (): void => {
		document.removeEventListener('keyup', unlockAudio, true);
		document.removeEventListener('touchend', unlockAudio, true);
		document.removeEventListener('click', unlockAudio, true);
	};
	const unlockAudio = (): void => {
		cleanup();
		void resumeAudio(audioState);
	};
	document.addEventListener('keyup', unlockAudio, true);
	document.addEventListener('touchend', unlockAudio, true);
	document.addEventListener('click', unlockAudio, true);
}

function setLoaderText(text: string): void {
	document.getElementById('loading').innerText = text;
}

async function fetchBuffer(url: string): Promise<Uint8Array> {
	const response = await fetch(url, {
		headers: {
			'Cache-Control': 'no-cache',
		},
	});
	if (!response.ok) {
		throw new Error(`Failed to fetch ROM from "${url}".`);
	}
	return new Uint8Array(await response.arrayBuffer());
}
