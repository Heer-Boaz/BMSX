import { AudioId, BitmapId } from "./resourceids";
import { Effect } from "../BoazEngineJS/effect";
import { Song } from "../BoazEngineJS/song";

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
	public SoundEffectList: Map<AudioId, Effect> = new Map<AudioId, Effect>();
	public MusicList: Map<AudioId, Song> = new Map<AudioId, Song>();
	constructor() {

	}
	public LoadGameResources(): void {
		this.loadViewResources();
		this.loadAudioResources();
	}
	private loadViewResources(): void {
		GameResources.Add(<number>BitmapId.Titel, new XBitmap("./Resources/Graphics/Belmont/Belmont_l1.png"));
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
		GameResources.Add(<number>BitmapId.FoeKill_1, new XBitmap("./Resources/Graphics/FX/Foekill_1.png"));
		GameResources.Add(<number>BitmapId.FoeKill_2, new XBitmap("./Resources/Graphics/FX/Foekill_2.png"));
	}
	private loadDecorResources(): void {
		GameResources.Add(<number>BitmapId.Candle_1, new XBitmap("./Resources/Graphics/Decor/Candle_1.png"));
		GameResources.Add(<number>BitmapId.Candle_2, new XBitmap("./Resources/Graphics/Decor/Candle_2.png"));
		GameResources.Add(<number>BitmapId.GCandle_1, new XBitmap("./Resources/Graphics/Decor/GCandle_1.png"));
		GameResources.Add(<number>BitmapId.GCandle_2, new XBitmap("./Resources/Graphics/Decor/GCandle_2.png"));
		GameResources.Add(<number>BitmapId.Door, new XBitmap("./Resources/Graphics/Decor/Door.png"));
	}
	private loadBelmontResources(): void {
		GameResources.Add(<number>BitmapId.Belmont_l1, new XBitmap("./Resources/Graphics/Belmont/Belmont_l1.png"));
		GameResources.Add(<number>BitmapId.Belmont_l2, new XBitmap("./Resources/Graphics/Belmont/Belmont_l2.png"));
		GameResources.Add(<number>BitmapId.Belmont_l3, new XBitmap("./Resources/Graphics/Belmont/Belmont_l3.png"));
		GameResources.Add(<number>BitmapId.Belmont_ld, new XBitmap("./Resources/Graphics/Belmont/Belmont_ld.png"));
		GameResources.Add(<number>BitmapId.Belmont_lw1, new XBitmap("./Resources/Graphics/Belmont/Belmont_lw1.png"));
		GameResources.Add(<number>BitmapId.Belmont_lw2, new XBitmap("./Resources/Graphics/Belmont/Belmont_lw2.png"));
		GameResources.Add(<number>BitmapId.Belmont_lw3, new XBitmap("./Resources/Graphics/Belmont/Belmont_lw3.png"));
		GameResources.Add(<number>BitmapId.Belmont_lwd1, new XBitmap("./Resources/Graphics/Belmont/Belmont_lwd1.png"));
		GameResources.Add(<number>BitmapId.Belmont_lwd2, new XBitmap("./Resources/Graphics/Belmont/Belmont_lwd2.png"));
		GameResources.Add(<number>BitmapId.Belmont_lwd3, new XBitmap("./Resources/Graphics/Belmont/Belmont_lwd3.png"));
		GameResources.Add(<number>BitmapId.Belmont_ldead, new XBitmap("./Resources/Graphics/Belmont/Belmont_ldead.png"));
		GameResources.Add(<number>BitmapId.Belmont_lhitdown, new XBitmap("./Resources/Graphics/Belmont/Belmont_lhitdown.png"));
		GameResources.Add(<number>BitmapId.Belmont_lhitfly, new XBitmap("./Resources/Graphics/Belmont/Belmont_lhitfly.png"));
		GameResources.Add(<number>BitmapId.Belmont_r1, new XBitmap("./Resources/Graphics/Belmont/Belmont_r1.png"));
		GameResources.Add(<number>BitmapId.Belmont_r2, new XBitmap("./Resources/Graphics/Belmont/Belmont_r2.png"));
		GameResources.Add(<number>BitmapId.Belmont_r3, new XBitmap("./Resources/Graphics/Belmont/Belmont_r3.png"));
		GameResources.Add(<number>BitmapId.Belmont_rd, new XBitmap("./Resources/Graphics/Belmont/Belmont_rd.png"));
		GameResources.Add(<number>BitmapId.Belmont_rw1, new XBitmap("./Resources/Graphics/Belmont/Belmont_rw1.png"));
		GameResources.Add(<number>BitmapId.Belmont_rw2, new XBitmap("./Resources/Graphics/Belmont/Belmont_rw2.png"));
		GameResources.Add(<number>BitmapId.Belmont_rw3, new XBitmap("./Resources/Graphics/Belmont/Belmont_rw3.png"));
		GameResources.Add(<number>BitmapId.Belmont_rwd1, new XBitmap("./Resources/Graphics/Belmont/Belmont_rwd1.png"));
		GameResources.Add(<number>BitmapId.Belmont_rwd2, new XBitmap("./Resources/Graphics/Belmont/Belmont_rwd2.png"));
		GameResources.Add(<number>BitmapId.Belmont_rwd3, new XBitmap("./Resources/Graphics/Belmont/Belmont_rwd3.png"));
		GameResources.Add(<number>BitmapId.Belmont_rdead, new XBitmap("./Resources/Graphics/Belmont/Belmont_rdead.png"));
		GameResources.Add(<number>BitmapId.Belmont_rhitdown, new XBitmap("./Resources/Graphics/Belmont/Belmont_rhitdown.png"));
		GameResources.Add(<number>BitmapId.Belmont_rhitfly, new XBitmap("./Resources/Graphics/Belmont/Belmont_rhitfly.png"));
	}
	private loadMiscResources(): void {
		GameResources.Add(<number>BitmapId.HUD, new XBitmap("./Resources/Graphics/HUD/HUD.png"));
		GameResources.Add(<number>BitmapId.HUD_EnergyStripe_belmont, new XBitmap("./Resources/Graphics/HUD/Energybarstripe_Belmont.png"));
		GameResources.Add(<number>BitmapId.HUD_EnergyStripe_boss, new XBitmap("./Resources/Graphics/HUD/EnergybarStripe_Boss.png"));
		GameResources.Add(<number>BitmapId.CurtainPart, new XBitmap("./Resources/Graphics/Misc/CurtainPart.png"));
		GameResources.Add(<number>BitmapId.MenuCursor, new XBitmap("./Resources/Graphics/Menu/MenuCursor.png"));
	}
	private loadFontResources(): void {
		GameResources.Add(<number>BitmapId.Font_A, new XBitmap("./Resources/Graphics/Font/Letter_A.png"));
		GameResources.Add(<number>BitmapId.Font_B, new XBitmap("./Resources/Graphics/Font/Letter_B.png"));
		GameResources.Add(<number>BitmapId.Font_C, new XBitmap("./Resources/Graphics/Font/Letter_C.png"));
		GameResources.Add(<number>BitmapId.Font_D, new XBitmap("./Resources/Graphics/Font/Letter_D.png"));
		GameResources.Add(<number>BitmapId.Font_E, new XBitmap("./Resources/Graphics/Font/Letter_E.png"));
		GameResources.Add(<number>BitmapId.Font_F, new XBitmap("./Resources/Graphics/Font/Letter_F.png"));
		GameResources.Add(<number>BitmapId.Font_G, new XBitmap("./Resources/Graphics/Font/Letter_G.png"));
		GameResources.Add(<number>BitmapId.Font_H, new XBitmap("./Resources/Graphics/Font/Letter_H.png"));
		GameResources.Add(<number>BitmapId.Font_I, new XBitmap("./Resources/Graphics/Font/Letter_I.png"));
		GameResources.Add(<number>BitmapId.Font_J, new XBitmap("./Resources/Graphics/Font/Letter_J.png"));
		GameResources.Add(<number>BitmapId.Font_K, new XBitmap("./Resources/Graphics/Font/Letter_K.png"));
		GameResources.Add(<number>BitmapId.Font_L, new XBitmap("./Resources/Graphics/Font/Letter_L.png"));
		GameResources.Add(<number>BitmapId.Font_M, new XBitmap("./Resources/Graphics/Font/Letter_M.png"));
		GameResources.Add(<number>BitmapId.Font_N, new XBitmap("./Resources/Graphics/Font/Letter_N.png"));
		GameResources.Add(<number>BitmapId.Font_O, new XBitmap("./Resources/Graphics/Font/Letter_O.png"));
		GameResources.Add(<number>BitmapId.Font_P, new XBitmap("./Resources/Graphics/Font/Letter_P.png"));
		GameResources.Add(<number>BitmapId.Font_Q, new XBitmap("./Resources/Graphics/Font/Letter_Q.png"));
		GameResources.Add(<number>BitmapId.Font_R, new XBitmap("./Resources/Graphics/Font/Letter_R.png"));
		GameResources.Add(<number>BitmapId.Font_S, new XBitmap("./Resources/Graphics/Font/Letter_S.png"));
		GameResources.Add(<number>BitmapId.Font_T, new XBitmap("./Resources/Graphics/Font/Letter_T.png"));
		GameResources.Add(<number>BitmapId.Font_U, new XBitmap("./Resources/Graphics/Font/Letter_U.png"));
		GameResources.Add(<number>BitmapId.Font_V, new XBitmap("./Resources/Graphics/Font/Letter_V.png"));
		GameResources.Add(<number>BitmapId.Font_W, new XBitmap("./Resources/Graphics/Font/Letter_W.png"));
		GameResources.Add(<number>BitmapId.Font_X, new XBitmap("./Resources/Graphics/Font/Letter_X.png"));
		GameResources.Add(<number>BitmapId.Font_IJ, new XBitmap("./Resources/Graphics/Font/Letter_IJ.png"));
		GameResources.Add(<number>BitmapId.Font_Y, new XBitmap("./Resources/Graphics/Font/Letter_Y.png"));
		GameResources.Add(<number>BitmapId.Font_Z, new XBitmap("./Resources/Graphics/Font/Letter_Z.png"));
		GameResources.Add(<number>BitmapId.Font_0, new XBitmap("./Resources/Graphics/Font/Letter_0.png"));
		GameResources.Add(<number>BitmapId.Font_1, new XBitmap("./Resources/Graphics/Font/Letter_1.png"));
		GameResources.Add(<number>BitmapId.Font_2, new XBitmap("./Resources/Graphics/Font/Letter_2.png"));
		GameResources.Add(<number>BitmapId.Font_3, new XBitmap("./Resources/Graphics/Font/Letter_3.png"));
		GameResources.Add(<number>BitmapId.Font_4, new XBitmap("./Resources/Graphics/Font/Letter_4.png"));
		GameResources.Add(<number>BitmapId.Font_5, new XBitmap("./Resources/Graphics/Font/Letter_5.png"));
		GameResources.Add(<number>BitmapId.Font_6, new XBitmap("./Resources/Graphics/Font/Letter_6.png"));
		GameResources.Add(<number>BitmapId.Font_7, new XBitmap("./Resources/Graphics/Font/Letter_7.png"));
		GameResources.Add(<number>BitmapId.Font_8, new XBitmap("./Resources/Graphics/Font/Letter_8.png"));
		GameResources.Add(<number>BitmapId.Font_9, new XBitmap("./Resources/Graphics/Font/Letter_9.png"));
		GameResources.Add(<number>BitmapId.Font_Comma, new XBitmap("./Resources/Graphics/Font/Letter_Comma.png"));
		GameResources.Add(<number>BitmapId.Font_Dot, new XBitmap("./Resources/Graphics/Font/Letter_Dot.png"));
		GameResources.Add(<number>BitmapId.Font_Exclamation, new XBitmap("./Resources/Graphics/Font/Letter_Exclamation.png"));
		GameResources.Add(<number>BitmapId.Font_QuestionMark, new XBitmap("./Resources/Graphics/Font/Letter_Question.png"));
		GameResources.Add(<number>BitmapId.Font_Line, new XBitmap("./Resources/Graphics/Font/Letter_Line.png"));
		GameResources.Add(<number>BitmapId.Font_Apostroph, new XBitmap("./Resources/Graphics/Font/Letter_Apostroph.png"));
		GameResources.Add(<number>BitmapId.Font_Space, new XBitmap("./Resources/Graphics/Font/Letter_Space.png"));
		GameResources.Add(<number>BitmapId.Font_Continue, new XBitmap("./Resources/Graphics/Font/Letter_Continue.png"));
		GameResources.Add(<number>BitmapId.Font_Colon, new XBitmap("./Resources/Graphics/Font/Letter_Colon.png"));
		GameResources.Add(<number>BitmapId.Font_Streep, new XBitmap("./Resources/Graphics/Font/Letter_Streep.png"));
		GameResources.Add(<number>BitmapId.Font_Slash, new XBitmap("./Resources/Graphics/Font/Letter_Slash.png"));
		GameResources.Add(<number>BitmapId.Font_Percent, new XBitmap("./Resources/Graphics/Font/Letter_Percent.png"));
		GameResources.Add(<number>BitmapId.Font_SpeakStart, new XBitmap("./Resources/Graphics/Font/Letter_SpeakStart.png"));
		GameResources.Add(<number>BitmapId.Font_SpeakEnd, new XBitmap("./Resources/Graphics/Font/Letter_SpeakEnd.png"));
	}
	private loadItemResources(): void {
		GameResources.Add(<number>BitmapId.Chest, new XBitmap("./Resources/Graphics/Item/Chest.png"));
		GameResources.Add(<number>BitmapId.Heart_big, new XBitmap("./Resources/Graphics/Item/Heart_big.png"));
		GameResources.Add(<number>BitmapId.Heart_small, new XBitmap("./Resources/Graphics/Item/Heart_small.png"));
		GameResources.Add(<number>BitmapId.Heart_fly, new XBitmap("./Resources/Graphics/Item/Heart_fly.png"));
		GameResources.Add(<number>BitmapId.Key_big, new XBitmap("./Resources/Graphics/Item/Key_big.png"));
		GameResources.Add(<number>BitmapId.Key_small, new XBitmap("./Resources/Graphics/Item/Key_small.png"));
	}
	private loadFoeResources(): void {
		GameResources.Add(<number>BitmapId.ZakFoe_1, new XBitmap("./Resources/Graphics/Foe/ZakFoe1.png"));
		GameResources.Add(<number>BitmapId.ZakFoe_2, new XBitmap("./Resources/Graphics/Foe/ZakFoe2.png"));
		GameResources.Add(<number>BitmapId.ZakFoe_3, new XBitmap("./Resources/Graphics/Foe/ZakFoe3.png"));
		GameResources.Add(<number>BitmapId.Chandelier_1, new XBitmap("./Resources/Graphics/Foe/chandelier.png"));
		GameResources.Add(<number>BitmapId.Hag_1, new XBitmap("./Resources/Graphics/Foe/Hag_1.png"));
		GameResources.Add(<number>BitmapId.Hag_2, new XBitmap("./Resources/Graphics/Foe/Hag_2.png"));
	}
	private loadNPCResources(): void {

	}
	private loadAudioResources(): void {
		GameResources.Add(<number>AudioId.Init, AudioData.LoadAudioBufferFromFile("./Resources/Sound/Init.wav"));
		GameResources.Add(<number>AudioId.Fout, AudioData.LoadAudioBufferFromFile("./Resources/Sound/Fout.wav"));
		GameResources.Add(<number>AudioId.Selectie, AudioData.LoadAudioBufferFromFile("./Resources/Sound/Selectie.wav"));
		this.SoundEffectList.Add(AudioId.Init, __init(new Effect(), { AudioId: <number>AudioId.Init, Priority: -1 }));
		this.SoundEffectList.Add(AudioId.Fout, __init(new Effect(), { AudioId: <number>AudioId.Fout, Priority: 0 }));
		this.SoundEffectList.Add(AudioId.Selectie, __init(new Effect(), { AudioId: <number>AudioId.Selectie, Priority: 0 }));
		GameResources.Add(<number>AudioId.Heart, AudioData.LoadAudioBufferFromFile("./Resources/Sound/Heart.wav"));
		this.SoundEffectList.Add(AudioId.Heart, __init(new Effect(), { AudioId: <number>AudioId.Heart, Priority: 0 }));
		GameResources.Add(<number>AudioId.Hit, AudioData.LoadAudioBufferFromFile("./Resources/Sound/Hit.wav"));
		this.SoundEffectList.Add(AudioId.Hit, __init(new Effect(), { AudioId: <number>AudioId.Hit, Priority: 0 }));
		GameResources.Add(<number>AudioId.ItemDrop, AudioData.LoadAudioBufferFromFile("./Resources/Sound/Item_drop.wav"));
		this.SoundEffectList.Add(AudioId.ItemDrop, __init(new Effect(), { AudioId: <number>AudioId.ItemDrop, Priority: 0 }));
		GameResources.Add(<number>AudioId.ItemPickup, AudioData.LoadAudioBufferFromFile("./Resources/Sound/Item_pickup.wav"));
		this.SoundEffectList.Add(AudioId.ItemPickup, __init(new Effect(), { AudioId: <number>AudioId.ItemPickup, Priority: 0 }));
		GameResources.Add(<number>AudioId.KeyGrab, AudioData.LoadAudioBufferFromFile("./Resources/Sound/Key_grab.wav"));
		this.SoundEffectList.Add(AudioId.KeyGrab, __init(new Effect(), { AudioId: <number>AudioId.KeyGrab, Priority: 0 }));
		GameResources.Add(<number>AudioId.Knife, AudioData.LoadAudioBufferFromFile("./Resources/Sound/Knife.wav"));
		this.SoundEffectList.Add(AudioId.Knife, __init(new Effect(), { AudioId: <number>AudioId.Knife, Priority: 0 }));
		GameResources.Add(<number>AudioId.Land, AudioData.LoadAudioBufferFromFile("./Resources/Sound/Land.wav"));
		this.SoundEffectList.Add(AudioId.Land, __init(new Effect(), { AudioId: <number>AudioId.Land, Priority: 0 }));
		GameResources.Add(<number>AudioId.Lightning, AudioData.LoadAudioBufferFromFile("./Resources/Sound/Lightning.wav"));
		this.SoundEffectList.Add(AudioId.Lightning, __init(new Effect(), { AudioId: <number>AudioId.Lightning, Priority: 0 }));
		GameResources.Add(<number>AudioId.Munnies, AudioData.LoadAudioBufferFromFile("./Resources/Sound/Munnies.wav"));
		this.SoundEffectList.Add(AudioId.Munnies, __init(new Effect(), { AudioId: <number>AudioId.Munnies, Priority: 0 }));
		GameResources.Add(<number>AudioId.PlayerDamage, AudioData.LoadAudioBufferFromFile("./Resources/Sound/Player_damage.wav"));
		this.SoundEffectList.Add(AudioId.PlayerDamage, __init(new Effect(), { AudioId: <number>AudioId.PlayerDamage, Priority: 0 }));
		GameResources.Add(<number>AudioId.Portal, AudioData.LoadAudioBufferFromFile("./Resources/Sound/Portal.wav"));
		this.SoundEffectList.Add(AudioId.Portal, __init(new Effect(), { AudioId: <number>AudioId.Portal, Priority: 0 }));
		GameResources.Add(<number>AudioId.Wall_break, AudioData.LoadAudioBufferFromFile("./Resources/Sound/Wall_break.wav"));
		this.SoundEffectList.Add(AudioId.Wall_break, __init(new Effect(), { AudioId: <number>AudioId.Wall_break, Priority: 0 }));
		GameResources.Add(<number>AudioId.Whip, AudioData.LoadAudioBufferFromFile("./Resources/Sound/Whip.wav"));
		this.SoundEffectList.Add(AudioId.Whip, __init(new Effect(), { AudioId: <number>AudioId.Whip, Priority: 0 }));
		GameResources.Add(<number>AudioId.Boss, AudioData.LoadAudioBufferFromFile("./Resources/Music/Boss.wav"));
		this.MusicList.Add(AudioId.Boss, __init(new Song(), { Music: <number>AudioId.Boss, Loop: true, NextSong: null }));
		GameResources.Add(<number>AudioId.Ending, AudioData.LoadAudioBufferFromFile("./Resources/Music/Ending.wav"));
		this.MusicList.Add(AudioId.Ending, __init(new Song(), { Music: <number>AudioId.Ending, Loop: true, NextSong: null }));
		GameResources.Add(<number>AudioId.Humiliation, AudioData.LoadAudioBufferFromFile("./Resources/Music/Humiliation.wav"));
		this.MusicList.Add(AudioId.Humiliation, __init(new Song(), { Music: <number>AudioId.Humiliation, Loop: false, NextSong: null }));
		GameResources.Add(<number>AudioId.Huray, AudioData.LoadAudioBufferFromFile("./Resources/Music/Huray.wav"));
		this.MusicList.Add(AudioId.Huray, __init(new Song(), { Music: <number>AudioId.Huray, Loop: false, NextSong: null }));
		GameResources.Add(<number>AudioId.Ohnoes, AudioData.LoadAudioBufferFromFile("./Resources/Music/Ohnoes.wav"));
		this.MusicList.Add(AudioId.Ohnoes, __init(new Song(), { Music: <number>AudioId.Ohnoes, Loop: false, NextSong: null }));
		GameResources.Add(<number>AudioId.Prologue, AudioData.LoadAudioBufferFromFile("./Resources/Music/Prologue.wav"));
		this.MusicList.Add(AudioId.Prologue, __init(new Song(), { Music: <number>AudioId.Prologue, Loop: false, NextSong: null }));
		GameResources.Add(<number>AudioId.Stage, AudioData.LoadAudioBufferFromFile("./Resources/Music/Stage.wav"));
		this.MusicList.Add(AudioId.Stage, __init(new Song(), { Music: <number>AudioId.Stage, Loop: true, NextSong: null }));
	}
}