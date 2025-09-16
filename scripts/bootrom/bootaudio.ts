export interface BootAudioState {
	sndcontext: AudioContext | null;
	snd_unlocked: boolean;
}

export function removeEventListeners(): void {
	document.removeEventListener('keyup', onStart, true);
	document.removeEventListener('touchend', onStart, true);
}

export function startAudioOnIos(state: BootAudioState): void {
	if (!state.sndcontext) return;
	if (state.snd_unlocked) {
		removeEventListeners();
		return;
	}
	const source = state.sndcontext.createBufferSource();
	source.buffer = state.sndcontext.createBuffer(1, 1, 44100);
	source.connect(state.sndcontext.destination);
	source.start(0, 0, 0);

	if (state.sndcontext.state === 'running') {
		removeEventListeners();
		state.snd_unlocked = true;
	}
}

export function createAudioContext(state: BootAudioState): void {
	if (state.sndcontext) return;
	const AContext: any = window.AudioContext || (global as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
	let context: AudioContext = new AContext({ latencyHint: 'interactive', sampleRate: 44100 }) as AudioContext;
	if (/(iPhone|iPad)/i.test(navigator.userAgent) && context.sampleRate !== 44100) {
		const buffer = context.createBuffer(1, 1, 44100), dummy = context.createBufferSource();
		dummy.buffer = buffer;
		dummy.connect(context.destination);
		dummy.start(0);
		dummy.disconnect();
		context.close();
		context = new AContext();
	}
	state.sndcontext = context;
}

function onStart(_e: Event) {
	/* placeholder to satisfy removeEventListeners references */
}
