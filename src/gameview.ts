import { HUD } from "./hud";
import { ItsCurtainsForYou } from "./itscurtainsforyou";
import { GameOver } from "./gameover";
import { MainMenu } from "./mainmenu";
import { Title } from "./title";

module Sintervania.View {
    export class GameView {
        private static pausePosX: number = 80;
        private static pausePosY: number = 80;
        private static pauseTextPosX: number = 104;
        private static pauseTextPosY: number = 96;
        private static pauseEndX: number = 176;
        private static pauseEndY: number = 120;
        private static pauseText: string = "Paused";
        private static _instance: V;
        public static get _(): V {
            return GameView._instance != null ? GameView._instance : (GameView._instance = new V());
        }
        public Hud: HUD;
        public ItsCurtains: ItsCurtainsForYou;
        public GameOverScreen: GameOver;
        public MainMenu: MainMenu;
        public Title: Title;
        public EndDemo: EndDemo;
        public get ShowFoeBar(): boolean {
            return M._.BossBattle;
        }
        public get FoeHealthPercentage(): number {
            let foe = M._.LastFoeThatWasHit;
            if (foe == null) {
                if (!M._.BossBattle)
                    return -1;
                else foe = M._.Boss;
            }
            if (foe.DisposeFlag)
                return 0;
            return foe.HealthPercentage;
        }
        public get FoeForWhichHealthPercentageIsGiven(): Foe {
            return M._.LastFoeThatWasHit != null ? M._.LastFoeThatWasHit : M._.Boss;
        }
        public static DetermineMaxScaleForFullscreen(clientWidth: number, clientHeight: number, originalBufferWidth: number, originalBufferHeight: number): number {
            if (clientWidth >= clientHeight) {
                return clientHeight / <number>originalBufferHeight;
            }
            else {
                return clientWidth / <number>originalBufferWidth;
            }
        }
        public ChangeScale(newScale: number): HResult {
            let oldScale = GO._.Scale;
            GO._.Scale = newScale;
            let hresult: HResult = this.scaleChanged();
            if (hresult.Failed) {
                GO._.Scale = oldScale;
                this.scaleChanged();
            }
            return hresult;
        }
        private scaleChanged(): HResult {
            let hresult: HResult = BDX._.ChangeWindowSize(<number>(CS.MSX2ScreenWidth * GO._.Scale), <number>(CS.MSX2ScreenHeight * GO._.Scale));
            if (hresult.Succeeded)
                hresult = BDX._.ChangeBufferSize(<number>(CS.MSX2ScreenWidth * GO._.Scale), <number>(CS.MSX2ScreenHeight * GO._.Scale));
            if (hresult.Succeeded)
                BDX._.Zoom = GO._.Scale;
            return hresult;
        }
        public ToFullscreen(): HResult {
            let hresult: HResult = BDX._.SwitchToFullscreen();
            if (hresult.Succeeded) {
                let clientWidth: number = BDX._.GetClientWidth();
                let clientHeight: number = BDX._.GetClientHeight();
                let bufferWidth: number, bufferHeight;
                if (clientWidth >= clientHeight) {
                    bufferHeight = clientHeight;
                    bufferWidth = <number>(clientHeight * (CS.MSX2ScreenWidth / <number>CS.MSX2ScreenHeight));
                }
                else {
                    bufferWidth = clientWidth;
                    bufferHeight = <number>(clientWidth * (CS.MSX2ScreenHeight / <number>CS.MSX2ScreenWidth));
                }
                hresult = BDX._.ChangeBufferSize(bufferWidth, bufferHeight);
                if (hresult.Succeeded) {
                    BDX._.Zoom = V.DetermineMaxScaleForFullscreen(BDX._.GetWindowWidth(), BDX._.GetWindowHeight(), CS.MSX2ScreenWidth, CS.MSX2ScreenHeight);
                }
            }
            return hresult;
        }
        public ToWindowed(): HResult {
            let oldScale = GO._.Scale;
            let hresult: HResult = BDX._.SwitchToWindowed(<number>(CS.MSX2ScreenWidth * GO._.Scale), <number>(CS.MSX2ScreenHeight * GO._.Scale));
            if (hresult.Succeeded) {
                hresult = BDX._.ChangeBufferSize(<number>(CS.MSX2ScreenWidth * GO._.Scale), <number>(CS.MSX2ScreenHeight * GO._.Scale));
            }
            else {
                GO._.Scale = 1;
                hresult = BDX._.SwitchToWindowed(<number>(CS.MSX2ScreenWidth * GO._.Scale), <number>(CS.MSX2ScreenHeight * GO._.Scale));
                hresult = BDX._.ChangeBufferSize(<number>(CS.MSX2ScreenWidth * GO._.Scale), <number>(CS.MSX2ScreenHeight * GO._.Scale));
            }
            if (hresult.Succeeded)
                BDX._.Zoom = GO._.Scale;
            else GO._.Scale = oldScale;
            return hresult;
        }
        constructor() {
            this.Init();
        }
        public Init(): void {
            this.Hud = new HUD();
            this.ItsCurtains = new ItsCurtainsForYou();
            this.GameOverScreen = new GameOver();
            this.MainMenu = new MainMenu();
            this.Title = new Title();
            this.EndDemo = new EndDemo();
        }
        public Paint(): void {
            if (M._.StartAfterLoad)
                return
            switch (M._.State) {
                case M.GameState.Prelude:
                    this.Title.Paint();
                    break;
                case M.GameState.TitleScreen:
                    this.MainMenu.Paint();
                    M._.GameMenu.Paint();
                    break;
                case M.GameState.EndDemo:
                    this.EndDemo.Paint();
                    break;
                case M.GameState.Game:
                case M.GameState.Event:
                    let gamescreenOffset = new Point(CS.GameScreenStartX, CS.GameScreenStartY);
                    if (M._.Substate != M.GameSubstate.SwitchRoom) {
                        M._.CurrentRoom.Paint();
                        M._.GameObjects.OrderBy(o => o.Priority).ThenBy(o => o.pos.y + o.size.y).ToList().ForEach(o => o.Paint(gamescreenOffset));
                    }
                    this.Hud.Paint();
                    switch (M._.Substate) {
                        case M.GameSubstate.SwitchRoom:
                        case M.GameSubstate.BelmontDies:
                        case M.GameSubstate.ItsCurtainsForYou:
                        case M.GameSubstate.ToEndDemo:
                        case M.GameSubstate.GameOver:
                            break;
                        default:
                            break;
                    }
                    if (M._.Substate != M.GameSubstate.SwitchRoom) {

                    }
                    if (M._.Substate == M.GameSubstate.ItsCurtainsForYou || M._.Substate == M.GameSubstate.ToEndDemo) {
                        this.ItsCurtains.Paint();
                    }
                    else if (M._.Substate == M.GameSubstate.GameOver) {
                        this.ItsCurtains.Paint();
                        this.GameOverScreen.Paint();
                    }
                    M._.GameMenu.Paint();
                    if (M._.Paused) {
                        BDX._.FillRectangle(V.pausePosX, V.pausePosY, V.pauseEndX, V.pauseEndY, CS.Msx1Colors[1]);
                        BDX._.DrawRectangle(V.pausePosX, V.pausePosY, V.pauseEndX, V.pauseEndY, CS.Msx1Colors[15]);
                        TextWriter.DrawText(V.pauseTextPosX, V.pauseTextPosY, V.pauseText);
                    }
                    break;
            }
        }
    }
}