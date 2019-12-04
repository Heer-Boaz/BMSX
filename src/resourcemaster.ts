import { AudioId, BitmapId } from "./resourceids";
import { Effect } from "../BoazEngineJS/effect";
import { Song } from "../BoazEngineJS/song";
// import { ResourceType, GameLoader } from '../BoazEngineJS/gameloader';
// import { images } from "../BoazEngineJS/engine";

export var img2src: Map<BitmapId, string> = new Map<BitmapId, string>();
export var snd2src: Map<AudioId, string> = new Map<AudioId, string>();

export class ResourceMaster {
	private static _instance: ResourceMaster;
	public static get _(): ResourceMaster {
		return ResourceMaster._instance != null ? ResourceMaster._instance : (ResourceMaster._instance = new ResourceMaster());
	}

	public static get Sound(): Map<AudioId, Effect> {
		return ResourceMaster._.SoundEffectList;
	}

	public static get Music(): Map<AudioId, Song> {
		return ResourceMaster._.MusicList;
	}

	public static AddImg(key: BitmapId, src: string): void {
		img2src.set(key, src);
	}

	public static AddSnd(key: AudioId, src: string): void {
		snd2src.set(key, src);
	}

	public static reloadImg(key: BitmapId, src: string): void {
		// let replacement = GameLoader.loadresource(src, ResourceType.Image);
		// img2src.set(key, src);
		// images[key] = replacement;
	}

	public SoundEffectList: Map<AudioId, Effect> = new Map<AudioId, Effect>();
	public MusicList: Map<AudioId, Song> = new Map<AudioId, Song>();

	constructor() {
	}

	public PrepareGameResources(): void {
		this.loadAudioResources();

	}
	private loadAudioResources(): void {
		this.SoundEffectList.set(AudioId.Init, { AudioId: AudioId.Init, Priority: -1 });
		this.SoundEffectList.set(AudioId.Fout, { AudioId: AudioId.Fout, Priority: 0 });
		this.SoundEffectList.set(AudioId.Selectie, { AudioId: AudioId.Selectie, Priority: 0 });
		this.SoundEffectList.set(AudioId.Heart, { AudioId: AudioId.Heart, Priority: 0 });
		this.SoundEffectList.set(AudioId.Hit, { AudioId: AudioId.Hit, Priority: 0 });
		this.SoundEffectList.set(AudioId.Chestopen, { AudioId: AudioId.Chestopen, Priority: 0 });
		this.SoundEffectList.set(AudioId.Item, { AudioId: AudioId.Item, Priority: 0 });
		this.SoundEffectList.set(AudioId.Key, { AudioId: AudioId.Key, Priority: 0 });
		this.SoundEffectList.set(AudioId.Knife, { AudioId: AudioId.Knife, Priority: 0 });
		this.SoundEffectList.set(AudioId.Land, { AudioId: AudioId.Land, Priority: 0 });
		// this.SoundEffectList.set(AudioId.Lightning, { AudioId: AudioId.Lightning, Priority: 0 });
		// this.SoundEffectList.set(AudioId.Munnies, { AudioId: AudioId.Munnies, Priority: 0 });
		this.SoundEffectList.set(AudioId.Au, { AudioId: AudioId.Au, Priority: 0 });
		// this.SoundEffectList.set(AudioId.Portal, { AudioId: AudioId.Portal, Priority: 0 });
		this.SoundEffectList.set(AudioId.WallBreak, { AudioId: AudioId.WallBreak, Priority: 0 });
		this.SoundEffectList.set(AudioId.Whip, { AudioId: AudioId.Whip, Priority: 0 });
		this.MusicList.set(AudioId.Pietula, { Music: AudioId.Pietula, Loop: true, NextSong: null });
		// this.MusicList.set(AudioId.Ending, { Music: AudioId.Ending, Loop: true, NextSong: null });
		this.MusicList.set(AudioId.Humiliation, { Music: AudioId.Humiliation, Loop: false, NextSong: null });
		// this.MusicList.set(AudioId.Huray, { Music: AudioId.Huray, Loop: false, NextSong: null });
		this.MusicList.set(AudioId.OHNOES, { Music: AudioId.OHNOES, Loop: false, NextSong: null });
		this.MusicList.set(AudioId.Prologue, { Music: AudioId.Prologue, Loop: false, NextSong: null });
		this.MusicList.set(AudioId.VampireKiller, { Music: AudioId.VampireKiller, Loop: true, NextSong: null });
	}
}