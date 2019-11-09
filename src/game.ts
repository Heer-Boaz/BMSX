// import { BStopwatch } from "../BoazEngineJS/btimer";
// import { GameOptions as GO } from "../BoazEngineJS/gameoptions";
// import { GameController as C } from './gamecontroller';

// module Sintervania {
//     export class Game {
//         public bxlib: IBXLib;
//         public gameTimer: BStopwatch;
//         private static _instance: Game;
//         public static get _(): Game {
//             return Game._instance != null ? Game._instance : (Game._instance = new Game());
//         }
//         constructor() {
//             Toolbox.Init();
//             this.bxlib = Toolbox.BXLib;
//             this.bxlib.SoundEnabled = CS.SoundEnabled;
//             this.loadGameOptions();
//             let hresult: HResult = HResult.S_OK;
//             hresult = this.bxlib.CreateGameWindow(CS.MSX2ScreenWidth, CS.MSX2ScreenHeight, CS.MSX2ScreenWidth, CS.MSX2ScreenHeight, GO.Fullscreen, CS.WindowTitle);
//             if (hresult.Succeeded) {
//                 if (GO.Fullscreen)
//                     V._.ToFullscreen();
//                 else V._.ToWindowed();
//             }
//             if (hresult.Failed && !GO.Fullscreen && GO.Scale > 1) {
//                 GO.Scale = 1;
//                 hresult = this.bxlib.CreateGameWindow(GO.WindowWidth, GO.WindowHeight, GO.BufferWidth, GO.BufferHeight, GO.Fullscreen, CS.WindowTitle);
//             }
//             if (hresult.Failed && GO.Fullscreen) {
//                 GO.Fullscreen = true;
//                 GO.Scale = 1;
//                 hresult = this.bxlib.CreateGameWindow(GO.WindowWidth, GO.WindowHeight, GO.BufferWidth, GO.BufferHeight, true, CS.WindowTitle);
//             }
//             if (hresult.Failed) {
//                 Environment.Exit(<number>ExitCodes.CouldNotCreateGameWindow);
//             }
//             if (!GO.Fullscreen)
//                 BDX._.Zoom = GO.Scale;
//             this.bxlib.InitializeGame();
//             (<BXLib>this.bxlib).bdx.SetGlobalInterpolationMode(<number>BitmapInterpolationMode.D2D1_BITMAP_INTERPOLATION_MODE_NEAREST_NEIGHBOR);
//             BDX._.SetMusicVolume(GO.MusicVolumePercentage / 100f);
//             BDX._.SetEffectsVolume(GO.EffectsVolumePercentage / 100f);
//             I.KeyDown += (key, click) => {
//                 if (key == Key.F12)
//                     this.bxlib.EndGameloop = true;
//             };
//         }
//         public Start(): void {
//             this.bxlib.GameUpdate += UpdateGame;
//             this.bxlib.OnPaintEvent += PaintGame;
//             this.bxlib.SetFocus += SetFocus;
//             this.bxlib.KillFocus += KillFocus;
//             this.bxlib.EndOfGameloop += EndOfGameloop;
//             this.bxlib.EndOfMusic += EndOfMusic;
//             this.bxlib.AltEnter += AltEnterPressed;
//             ResourceMaster._.LoadGameResources();
//             S.PlayEffect(ResourceMaster.Sound[AudioId.Init]);
//             M._ = new M();
//             M._.Initialize();
//             C._.Initialize();
//             C._.SwitchToState(CS.InitialGameState);
//             this.bxlib.StartGameloop(50, 10);
//         }
//         public SetFocus(): void {
//             C._.SetFocus();
//         }
//         public KillFocus(): void {
//             C._.KillFocus();
//         }
//         public UpdateGame(elapsedTicks: number): void {
//             C._.TakeTurn(elapsedTicks);
//         }
//         public PaintGame(): void {
//             (<BXLib>this.bxlib).bdx.BeginDraw();
//             (<BXLib>this.bxlib).bdx.ClearScreen();
//             V._.Paint();
//             (<BXLib>this.bxlib).bdx.EndDraw();
//         }
//         public EndOfMusic(): void {

//         }
//         public EndOfGameloop(): void {

//         }
//         public GameOptionsChanged(): void {
//             GameOptionsPersistor.SaveOptions(GO._);
//         }
//         private loadGameOptions(): void {
//             let result = GameOptionsPersistor.LoadOptions();
//             if (result != null)
//                 GO._ = result;
//         }
//         public AltEnterPressed(): void {
//             let hresult: HResult;
//             if (GO.Fullscreen) {
//                 hresult = V._.ToWindowed();
//                 if (hresult.Succeeded) {
//                     GO.Fullscreen = false;
//                     this.GameOptionsChanged();
//                 }
//             }
//             else {
//                 hresult = V._.ToFullscreen();
//                 if (hresult.Succeeded) {
//                     GO.Fullscreen = true;
//                     this.GameOptionsChanged();
//                 }
//             }
//         }
//     }
// }