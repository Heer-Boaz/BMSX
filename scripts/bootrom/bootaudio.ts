export interface BootAudioState {
	sndcontext: AudioContext;
	snd_unlocked: boolean;
}

declare global {
	interface Window {
		webkitAudioContext?: typeof AudioContext;
	}
}

export function startAudioOnIos(state: BootAudioState): void {
	if (state.snd_unlocked) {
		return;
	}
	const source = state.sndcontext.createBufferSource();
	source.buffer = state.sndcontext.createBuffer(1, 1, 44100);
	source.connect(state.sndcontext.destination);
	source.start(0, 0, 0);

	if (state.sndcontext.state === 'running') {
		state.snd_unlocked = true;
	}
}

export function createAudioContext(state: BootAudioState): void {
	if (state.sndcontext) return;
	const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
	let context = new AudioContextConstructor({ latencyHint: 0.005, sampleRate: 44100 });
	if (/(iPhone|iPad)/i.test(navigator.userAgent) && context.sampleRate !== 44100) {
		const buffer = context.createBuffer(1, 1, 44100), dummy = context.createBufferSource();
		dummy.buffer = buffer;
		dummy.connect(context.destination);
		dummy.start(0);
		dummy.disconnect();
		context.close();
		context = new AudioContextConstructor();
	}
	state.sndcontext = context;
}
