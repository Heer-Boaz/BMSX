import { AudioId, BitmapId } from "resourceids";
import { Effect } from "../BoazEngineJS/effect";
import { Song } from "../BoazEngineJS/song";

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
		img2src.set(key, src);
		throw new Error("Reloading nodig!");
	}

	public SoundEffectList: Map<AudioId, Effect> = new Map<AudioId, Effect>();
	public MusicList: Map<AudioId, Song> = new Map<AudioId, Song>();

	constructor() {
	}

	public LoadGameResources(): void {
		this.loadViewResources();
		this.loadAudioResources();

	}

	private loadViewResources(): void {
		ResourceMaster.AddImg(BitmapId.Titel, "./Resources/Graphics/Belmont/Belmont_l1.png");
		this.loadBelmontResources();
		this.loadFXResources();
		this.loadMiscResources();
		this.loadFontResources();
		this.loadItemResources();
		this.loadFoeResources();
		this.loadNPCResources();
		this.loadDecorResources();
	}

	private loadFXResources(): void {
		ResourceMaster.AddImg(BitmapId.FoeKill_1, "./Resources/Graphics/FX/Foekill_1.png");
		ResourceMaster.AddImg(BitmapId.FoeKill_2, "./Resources/Graphics/FX/Foekill_2.png");
	}

	private loadDecorResources(): void {
		ResourceMaster.AddImg(BitmapId.Candle_1, "./Resources/Graphics/Decor/Candle_1.png");
		ResourceMaster.AddImg(BitmapId.Candle_2, "./Resources/Graphics/Decor/Candle_2.png");
		ResourceMaster.AddImg(BitmapId.GCandle_1, "./Resources/Graphics/Decor/GCandle_1.png");
		ResourceMaster.AddImg(BitmapId.GCandle_2, "./Resources/Graphics/Decor/GCandle_2.png");
		ResourceMaster.AddImg(BitmapId.Door, "./Resources/Graphics/Decor/Door.png");
	}

	private loadBelmontResources(): void {
		ResourceMaster.AddImg(BitmapId.Belmont_l1, "./Resources/Graphics/Belmont/Belmont_l1.png");
		ResourceMaster.AddImg(BitmapId.Belmont_l2, "./Resources/Graphics/Belmont/Belmont_l2.png");
		ResourceMaster.AddImg(BitmapId.Belmont_l3, "./Resources/Graphics/Belmont/Belmont_l3.png");
		ResourceMaster.AddImg(BitmapId.Belmont_ld, "./Resources/Graphics/Belmont/Belmont_ld.png");
		ResourceMaster.AddImg(BitmapId.Belmont_lw1, "./Resources/Graphics/Belmont/Belmont_lw1.png");
		ResourceMaster.AddImg(BitmapId.Belmont_lw2, "./Resources/Graphics/Belmont/Belmont_lw2.png");
		ResourceMaster.AddImg(BitmapId.Belmont_lw3, "./Resources/Graphics/Belmont/Belmont_lw3.png");
		ResourceMaster.AddImg(BitmapId.Belmont_lwd1, "./Resources/Graphics/Belmont/Belmont_lwd1.png");
		ResourceMaster.AddImg(BitmapId.Belmont_lwd2, "./Resources/Graphics/Belmont/Belmont_lwd2.png");
		ResourceMaster.AddImg(BitmapId.Belmont_lwd3, "./Resources/Graphics/Belmont/Belmont_lwd3.png");
		ResourceMaster.AddImg(BitmapId.Belmont_ldead, "./Resources/Graphics/Belmont/Belmont_ldead.png");
		ResourceMaster.AddImg(BitmapId.Belmont_lhitdown, "./Resources/Graphics/Belmont/Belmont_lhitdown.png");
		ResourceMaster.AddImg(BitmapId.Belmont_lhitfly, "./Resources/Graphics/Belmont/Belmont_lhitfly.png");
		ResourceMaster.AddImg(BitmapId.Belmont_r1, "./Resources/Graphics/Belmont/Belmont_r1.png");
		ResourceMaster.AddImg(BitmapId.Belmont_r2, "./Resources/Graphics/Belmont/Belmont_r2.png");
		ResourceMaster.AddImg(BitmapId.Belmont_r3, "./Resources/Graphics/Belmont/Belmont_r3.png");
		ResourceMaster.AddImg(BitmapId.Belmont_rd, "./Resources/Graphics/Belmont/Belmont_rd.png");
		ResourceMaster.AddImg(BitmapId.Belmont_rw1, "./Resources/Graphics/Belmont/Belmont_rw1.png");
		ResourceMaster.AddImg(BitmapId.Belmont_rw2, "./Resources/Graphics/Belmont/Belmont_rw2.png");
		ResourceMaster.AddImg(BitmapId.Belmont_rw3, "./Resources/Graphics/Belmont/Belmont_rw3.png");
		ResourceMaster.AddImg(BitmapId.Belmont_rwd1, "./Resources/Graphics/Belmont/Belmont_rwd1.png");
		ResourceMaster.AddImg(BitmapId.Belmont_rwd2, "./Resources/Graphics/Belmont/Belmont_rwd2.png");
		ResourceMaster.AddImg(BitmapId.Belmont_rwd3, "./Resources/Graphics/Belmont/Belmont_rwd3.png");
		ResourceMaster.AddImg(BitmapId.Belmont_rdead, "./Resources/Graphics/Belmont/Belmont_rdead.png");
		ResourceMaster.AddImg(BitmapId.Belmont_rhitdown, "./Resources/Graphics/Belmont/Belmont_rhitdown.png");
		ResourceMaster.AddImg(BitmapId.Belmont_rhitfly, "./Resources/Graphics/Belmont/Belmont_rhitfly.png");
	}

	private loadMiscResources(): void {
		ResourceMaster.AddImg(BitmapId.HUD, "./Resources/Graphics/HUD/HUD.png");
		ResourceMaster.AddImg(BitmapId.HUD_EnergyStripe_belmont, "./Resources/Graphics/HUD/Energybarstripe_Belmont.png");
		ResourceMaster.AddImg(BitmapId.HUD_EnergyStripe_boss, "./Resources/Graphics/HUD/EnergybarStripe_Boss.png");
		ResourceMaster.AddImg(BitmapId.CurtainPart, "./Resources/Graphics/Misc/CurtainPart.png");
		ResourceMaster.AddImg(BitmapId.MenuCursor, "./Resources/Graphics/Menu/MenuCursor.png");
	}

	private loadFontResources(): void {
		ResourceMaster.AddImg(BitmapId.Font_A, "./Resources/Graphics/Font/Letter_A.png");
		ResourceMaster.AddImg(BitmapId.Font_B, "./Resources/Graphics/Font/Letter_B.png");
		ResourceMaster.AddImg(BitmapId.Font_C, "./Resources/Graphics/Font/Letter_C.png");
		ResourceMaster.AddImg(BitmapId.Font_D, "./Resources/Graphics/Font/Letter_D.png");
		ResourceMaster.AddImg(BitmapId.Font_E, "./Resources/Graphics/Font/Letter_E.png");
		ResourceMaster.AddImg(BitmapId.Font_F, "./Resources/Graphics/Font/Letter_F.png");
		ResourceMaster.AddImg(BitmapId.Font_G, "./Resources/Graphics/Font/Letter_G.png");
		ResourceMaster.AddImg(BitmapId.Font_H, "./Resources/Graphics/Font/Letter_H.png");
		ResourceMaster.AddImg(BitmapId.Font_I, "./Resources/Graphics/Font/Letter_I.png");
		ResourceMaster.AddImg(BitmapId.Font_J, "./Resources/Graphics/Font/Letter_J.png");
		ResourceMaster.AddImg(BitmapId.Font_K, "./Resources/Graphics/Font/Letter_K.png");
		ResourceMaster.AddImg(BitmapId.Font_L, "./Resources/Graphics/Font/Letter_L.png");
		ResourceMaster.AddImg(BitmapId.Font_M, "./Resources/Graphics/Font/Letter_M.png");
		ResourceMaster.AddImg(BitmapId.Font_N, "./Resources/Graphics/Font/Letter_N.png");
		ResourceMaster.AddImg(BitmapId.Font_O, "./Resources/Graphics/Font/Letter_O.png");
		ResourceMaster.AddImg(BitmapId.Font_P, "./Resources/Graphics/Font/Letter_P.png");
		ResourceMaster.AddImg(BitmapId.Font_Q, "./Resources/Graphics/Font/Letter_Q.png");
		ResourceMaster.AddImg(BitmapId.Font_R, "./Resources/Graphics/Font/Letter_R.png");
		ResourceMaster.AddImg(BitmapId.Font_S, "./Resources/Graphics/Font/Letter_S.png");
		ResourceMaster.AddImg(BitmapId.Font_T, "./Resources/Graphics/Font/Letter_T.png");
		ResourceMaster.AddImg(BitmapId.Font_U, "./Resources/Graphics/Font/Letter_U.png");
		ResourceMaster.AddImg(BitmapId.Font_V, "./Resources/Graphics/Font/Letter_V.png");
		ResourceMaster.AddImg(BitmapId.Font_W, "./Resources/Graphics/Font/Letter_W.png");
		ResourceMaster.AddImg(BitmapId.Font_X, "./Resources/Graphics/Font/Letter_X.png");
		ResourceMaster.AddImg(BitmapId.Font_IJ, "./Resources/Graphics/Font/Letter_IJ.png");
		ResourceMaster.AddImg(BitmapId.Font_Y, "./Resources/Graphics/Font/Letter_Y.png");
		ResourceMaster.AddImg(BitmapId.Font_Z, "./Resources/Graphics/Font/Letter_Z.png");
		ResourceMaster.AddImg(BitmapId.Font_0, "./Resources/Graphics/Font/Letter_0.png");
		ResourceMaster.AddImg(BitmapId.Font_1, "./Resources/Graphics/Font/Letter_1.png");
		ResourceMaster.AddImg(BitmapId.Font_2, "./Resources/Graphics/Font/Letter_2.png");
		ResourceMaster.AddImg(BitmapId.Font_3, "./Resources/Graphics/Font/Letter_3.png");
		ResourceMaster.AddImg(BitmapId.Font_4, "./Resources/Graphics/Font/Letter_4.png");
		ResourceMaster.AddImg(BitmapId.Font_5, "./Resources/Graphics/Font/Letter_5.png");
		ResourceMaster.AddImg(BitmapId.Font_6, "./Resources/Graphics/Font/Letter_6.png");
		ResourceMaster.AddImg(BitmapId.Font_7, "./Resources/Graphics/Font/Letter_7.png");
		ResourceMaster.AddImg(BitmapId.Font_8, "./Resources/Graphics/Font/Letter_8.png");
		ResourceMaster.AddImg(BitmapId.Font_9, "./Resources/Graphics/Font/Letter_9.png");
		ResourceMaster.AddImg(BitmapId.Font_Comma, "./Resources/Graphics/Font/Letter_Comma.png");
		ResourceMaster.AddImg(BitmapId.Font_Dot, "./Resources/Graphics/Font/Letter_Dot.png");
		ResourceMaster.AddImg(BitmapId.Font_Exclamation, "./Resources/Graphics/Font/Letter_Exclamation.png");
		ResourceMaster.AddImg(BitmapId.Font_QuestionMark, "./Resources/Graphics/Font/Letter_Question.png");
		ResourceMaster.AddImg(BitmapId.Font_Line, "./Resources/Graphics/Font/Letter_Line.png");
		ResourceMaster.AddImg(BitmapId.Font_Apostroph, "./Resources/Graphics/Font/Letter_Apostroph.png");
		ResourceMaster.AddImg(BitmapId.Font_Space, "./Resources/Graphics/Font/Letter_Space.png");
		ResourceMaster.AddImg(BitmapId.Font_Continue, "./Resources/Graphics/Font/Letter_Continue.png");
		ResourceMaster.AddImg(BitmapId.Font_Colon, "./Resources/Graphics/Font/Letter_Colon.png");
		ResourceMaster.AddImg(BitmapId.Font_Streep, "./Resources/Graphics/Font/Letter_Streep.png");
		ResourceMaster.AddImg(BitmapId.Font_Slash, "./Resources/Graphics/Font/Letter_Slash.png");
		ResourceMaster.AddImg(BitmapId.Font_Percent, "./Resources/Graphics/Font/Letter_Percent.png");
		ResourceMaster.AddImg(BitmapId.Font_SpeakStart, "./Resources/Graphics/Font/Letter_SpeakStart.png");
		ResourceMaster.AddImg(BitmapId.Font_SpeakEnd, "./Resources/Graphics/Font/Letter_SpeakEnd.png");
	}

	private loadItemResources(): void {
		ResourceMaster.AddImg(BitmapId.Chest, "./Resources/Graphics/Item/Chest.png");
		ResourceMaster.AddImg(BitmapId.Heart_big, "./Resources/Graphics/Item/Heart_big.png");
		ResourceMaster.AddImg(BitmapId.Heart_small, "./Resources/Graphics/Item/Heart_small.png");
		ResourceMaster.AddImg(BitmapId.Heart_fly, "./Resources/Graphics/Item/Heart_fly.png");
		ResourceMaster.AddImg(BitmapId.Key_big, "./Resources/Graphics/Item/Key_big.png");
		ResourceMaster.AddImg(BitmapId.Key_small, "./Resources/Graphics/Item/Key_small.png");
	}

	private loadFoeResources(): void {
		ResourceMaster.AddImg(BitmapId.ZakFoe_1, "./Resources/Graphics/Foe/ZakFoe1.png");
		ResourceMaster.AddImg(BitmapId.ZakFoe_2, "./Resources/Graphics/Foe/ZakFoe2.png");
		ResourceMaster.AddImg(BitmapId.ZakFoe_3, "./Resources/Graphics/Foe/ZakFoe3.png");
		ResourceMaster.AddImg(BitmapId.Chandelier_1, "./Resources/Graphics/Foe/chandelier.png");
		ResourceMaster.AddImg(BitmapId.Hag_1, "./Resources/Graphics/Foe/Hag_1.png");
		ResourceMaster.AddImg(BitmapId.Hag_2, "./Resources/Graphics/Foe/Hag_2.png");
	}

	private loadNPCResources(): void {
	}

	private loadAudioResources(): void {
		ResourceMaster.AddSnd(AudioId.Init, "./Resources/Sound/Init.wav");
		ResourceMaster.AddSnd(AudioId.Fout, "./Resources/Sound/Fout.wav");
		ResourceMaster.AddSnd(AudioId.Selectie, "./Resources/Sound/Selectie.wav");
		this.SoundEffectList.set(AudioId.Init, { AudioId: AudioId.Init, Priority: -1 });
		this.SoundEffectList.set(AudioId.Fout, { AudioId: AudioId.Fout, Priority: 0 });
		this.SoundEffectList.set(AudioId.Selectie, { AudioId: AudioId.Selectie, Priority: 0 });
		ResourceMaster.AddSnd(AudioId.Heart, "./Resources/Sound/Heart.wav");
		this.SoundEffectList.set(AudioId.Heart, { AudioId: AudioId.Heart, Priority: 0 });
		ResourceMaster.AddSnd(AudioId.Hit, "./Resources/Sound/Hit.wav");
		this.SoundEffectList.set(AudioId.Hit, { AudioId: AudioId.Hit, Priority: 0 });
		ResourceMaster.AddSnd(AudioId.ItemDrop, "./Resources/Sound/Item_drop.wav");
		this.SoundEffectList.set(AudioId.ItemDrop, { AudioId: AudioId.ItemDrop, Priority: 0 });
		ResourceMaster.AddSnd(AudioId.ItemPickup, "./Resources/Sound/Item_pickup.wav");
		this.SoundEffectList.set(AudioId.ItemPickup, { AudioId: AudioId.ItemPickup, Priority: 0 });
		ResourceMaster.AddSnd(AudioId.KeyGrab, "./Resources/Sound/Key_grab.wav");
		this.SoundEffectList.set(AudioId.KeyGrab, { AudioId: AudioId.KeyGrab, Priority: 0 });
		ResourceMaster.AddSnd(AudioId.Knife, "./Resources/Sound/Knife.wav");
		this.SoundEffectList.set(AudioId.Knife, { AudioId: AudioId.Knife, Priority: 0 });
		ResourceMaster.AddSnd(AudioId.Land, "./Resources/Sound/Land.wav");
		this.SoundEffectList.set(AudioId.Land, { AudioId: AudioId.Land, Priority: 0 });
		ResourceMaster.AddSnd(AudioId.Lightning, "./Resources/Sound/Lightning.wav");
		this.SoundEffectList.set(AudioId.Lightning, { AudioId: AudioId.Lightning, Priority: 0 });
		ResourceMaster.AddSnd(AudioId.Munnies, "./Resources/Sound/Munnies.wav");
		this.SoundEffectList.set(AudioId.Munnies, { AudioId: AudioId.Munnies, Priority: 0 });
		ResourceMaster.AddSnd(AudioId.PlayerDamage, "./Resources/Sound/Player_damage.wav");
		this.SoundEffectList.set(AudioId.PlayerDamage, { AudioId: AudioId.PlayerDamage, Priority: 0 });
		ResourceMaster.AddSnd(AudioId.Portal, "./Resources/Sound/Portal.wav");
		this.SoundEffectList.set(AudioId.Portal, { AudioId: AudioId.Portal, Priority: 0 });
		ResourceMaster.AddSnd(AudioId.Wall_break, "./Resources/Sound/Wall_break.wav");
		this.SoundEffectList.set(AudioId.Wall_break, { AudioId: AudioId.Wall_break, Priority: 0 });
		ResourceMaster.AddSnd(AudioId.Whip, "./Resources/Sound/Whip.wav");
		this.SoundEffectList.set(AudioId.Whip, { AudioId: AudioId.Whip, Priority: 0 });
		ResourceMaster.AddSnd(AudioId.Boss, "./Resources/Music/Boss.wav");
		this.MusicList.set(AudioId.Boss, { Music: AudioId.Boss, Loop: true, NextSong: null });
		ResourceMaster.AddSnd(AudioId.Ending, "./Resources/Music/Ending.wav");
		this.MusicList.set(AudioId.Ending, { Music: AudioId.Ending, Loop: true, NextSong: null });
		ResourceMaster.AddSnd(AudioId.Humiliation, "./Resources/Music/Humiliation.wav");
		this.MusicList.set(AudioId.Humiliation, { Music: AudioId.Humiliation, Loop: false, NextSong: null });
		ResourceMaster.AddSnd(AudioId.Huray, "./Resources/Music/Huray.wav");
		this.MusicList.set(AudioId.Huray, { Music: AudioId.Huray, Loop: false, NextSong: null });
		ResourceMaster.AddSnd(AudioId.Ohnoes, "./Resources/Music/Ohnoes.wav");
		this.MusicList.set(AudioId.Ohnoes, { Music: AudioId.Ohnoes, Loop: false, NextSong: null });
		ResourceMaster.AddSnd(AudioId.Prologue, "./Resources/Music/Prologue.wav");
		this.MusicList.set(AudioId.Prologue, { Music: AudioId.Prologue, Loop: false, NextSong: null });
		ResourceMaster.AddSnd(AudioId.Stage, "./Resources/Music/Stage.wav");
		this.MusicList.set(AudioId.Stage, { Music: AudioId.Stage, Loop: true, NextSong: null });
	}
}