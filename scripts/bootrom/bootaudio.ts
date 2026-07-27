export interface BootAudioState {
	sndcontext: AudioContext;
}

declare global {
	interface Window {
		webkitAudioContext?: typeof AudioContext;
	}
}

export async function resumeAudio(state: BootAudioState): Promise<void> {
	const context = state.sndcontext;
	const resumed = context.resume();
	const source = context.createBufferSource();
	source.buffer = context.createBuffer(1, 1, 44100);
	source.connect(context.destination);
	source.start(0, 0, 0);
	await resumed;
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
