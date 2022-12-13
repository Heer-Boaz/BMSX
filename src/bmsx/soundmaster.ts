import { id2res, AudioMeta, AudioType } from "./rompack";

export class SM {
	private static limitToOneEffect: boolean = true;

	private static tracks: id2res;
	private static sndContext: AudioContext;

	private static currentMusicNode: AudioBufferSourceNode;
	private static currentEffectNode: AudioBufferSourceNode;
	public static currentEffectAudio: AudioMeta;
	public static currentMusicAudio: AudioMeta;
	private static gainNode: GainNode;

	public static init(_audioResources: id2res, sndcontext?: AudioContext, gainnode?: GainNode) {
		SM.sndContext = sndcontext;
		SM.currentEffectAudio = null;
		SM.currentMusicAudio = null;

		SM.sndContext.resume().then(() => {
			if (!gainnode) {
				SM.gainNode = SM.sndContext.createGain();
				SM.gainNode.connect(SM.sndContext.destination);
				SM.setVolume(0);
			}
		});

		SM.tracks = _audioResources;
	}

	private static async decode(audioData: ArrayBuffer): Promise<AudioBuffer> {
		if (SM.sndContext.decodeAudioData.length === 2) { // Safari
			return new Promise(resolve => {
				SM.sndContext.decodeAudioData(audioData, buffer => {
					resolve(buffer);
				});
			});
		} else { return SM.sndContext.decodeAudioData(audioData); }
	}

	private static async createNode(id: string): Promise<AudioBufferSourceNode> {
		let srcnode = SM.sndContext.createBufferSource();
		return new Promise<AudioBufferSourceNode>((resolve, reject) => {
			SM.decode(global.game.rom['rom'].slice(SM.tracks[id]['start'], SM.tracks[id]['end'])).then(buffer => srcnode.buffer = buffer).then(() => resolve(srcnode))
				.catch(e => reject(e));
		});
	}

	private static playNode(_track: AudioMeta, node: AudioBufferSourceNode): void {
		try {
			node.connect(SM.gainNode);
			if (_track['loop'] !== null) {
				node.loop = true;
				node.loopStart = _track['loop'];
			}
			else node.loop = false;
			node.start(0);
			_track['audiotype'] === AudioType.effect ?
				node.addEventListener('ended', (ev) => SM.currentEffectAudio = null) :
				node.addEventListener('ended', (ev) => SM.currentMusicAudio = null);
		} catch {
		}
	}

	public static play(id: string): void {
		let track = SM.tracks[id]?.['audiometa'];
		if (!track) return;

		switch (track['audiotype']) {
			case AudioType.effect:
				if (SM.limitToOneEffect && SM.currentEffectAudio && track['priority'] < SM.currentEffectAudio['priority']) return;
				SM.stopEffect();
				SM.createNode(id).then(node => {
					SM.currentEffectNode = node;
					SM.currentEffectAudio = track;
					SM.playNode(track, node);
				})
					.catch(e => console.error(e.message));
				break;
			case AudioType.music:
				SM.stopMusic();
				SM.createNode(id).then(node => {
					SM.currentMusicNode = node;
					SM.currentMusicAudio = track;
					SM.playNode(track, node);
				})
					.catch(e => console.error(e.message));
				break;
		}
	}

	private static stop(id: string): void {
		switch (SM.tracks[id]?.['audiometa']['audiotype']) {
			case AudioType.effect: SM.stopEffect(); break;
			case AudioType.music: SM.stopMusic(); break;
		}
	}

	public static stopEffect(): void {
		try {
			if (SM.currentEffectAudio) SM.currentEffectNode?.stop();
		} catch { }
		SM.currentEffectNode?.disconnect();
		SM.currentEffectNode = null;
	}

	public static stopMusic(): void {
		try {
			if (SM.currentMusicAudio) SM.currentMusicNode?.stop();
		} catch { }
		SM.currentMusicNode?.disconnect();
		SM.currentMusicNode = null;
	}

	public static pause(): void {
		if (SM.sndContext.state === 'running') {
			SM.sndContext.suspend(); // Let op, async!!
		}
	}

	public static resume(): void {
		if (SM.sndContext.state === 'suspended') {
			SM.sndContext.resume(); // Let op, async!!
		}
	}

	public static setVolume(volume: number): void {
		SM.gainNode.gain.setValueAtTime(SM.gainNode.gain.defaultValue * volume, SM.sndContext.currentTime + .1);
	}
}