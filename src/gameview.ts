import { HUD } from "./hud";
import { ItsCurtainsForYou } from "./itscurtainsforyou";
import { GameOver } from "./gameover";
import { MainMenu } from "./mainmenu";
import { Title } from "./title";
import { GameState, GameSubstate } from "../BoazEngineJS/model";
import { GameConstants as CS } from "./gameconstants"
import { AudioId, BitmapId } from "../BoazEngineJS/resourceids";
import { ResourceMaster } from "./resourcemaster";
import { SoundMaster as S } from "../BoazEngineJS/soundmaster";
import { Direction } from "../BoazEngineJS/direction";
import { GameModel as M } from "./sintervaniamodel";
import { GameController as C } from "./gamecontroller";
import { TextWriter } from "./textwriter";
import { view } from "../BoazEngineJS/engine";
import { MSXConstants as MCS } from "../BoazEngineJS/msx";
import { EndDemo } from "./enddemo";
import { Foe } from "./foe";
import { Point } from "../BoazEngineJS/interfaces";
import { GameOptions as GO } from '../BoazEngineJS/gameoptions';

export class GameView {
    private static pausePosX: number = 80;
    private static pausePosY: number = 80;
    private static pauseTextPosX: number = 104;
    private static pauseTextPosY: number = 96;
    private static pauseEndX: number = 176;
    private static pauseEndY: number = 120;
    private static pauseText: string = "Paused";
    private static _instance: GameView;

    public static get _(): GameView {
        return GameView._instance != null ? GameView._instance : (GameView._instance = new GameView());
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
        if (foe.disposeFlag)
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

    public ChangeScale(newScale: number): void {
        GO.Scale = newScale;
        this.scaleChanged();
    }

    private scaleChanged(): void {
        throw Error("Not implemented!");
        // BDX._.ChangeWindowSize(<number>(MCS.MSX2ScreenWidth * GO.Scale), <number>(MCS.MSX2ScreenHeight * GO.Scale));
        // BDX._.Zoom = GO.Scale;
    }

    public ToFullscreen(): void {
        throw Error("Not implemented!");
        // BDX._.SwitchToFullscreen();
        // let clientWidth: number = BDX._.GetClientWidth();
        // let clientHeight: number = BDX._.GetClientHeight();
        // let bufferWidth: number, bufferHeight;
        // if (clientWidth >= clientHeight) {
        //     bufferHeight = clientHeight;
        //     bufferWidth = <number>(clientHeight * (MCS.MSX2ScreenWidth / <number>MCS.MSX2ScreenHeight));
        // }
        // else {
        //     bufferWidth = clientWidth;
        //     bufferHeight = <number>(clientWidth * (MCS.MSX2ScreenHeight / <number>MCS.MSX2ScreenWidth));
        // }
        // BDX._.ChangeBufferSize(bufferWidth, bufferHeight);
        // BDX._.Zoom = GameView.DetermineMaxScaleForFullscreen(BDX._.GetWindowWidth(), BDX._.GetWindowHeight(), MCS.MSX2ScreenWidth, MCS.MSX2ScreenHeight);
        // }
    }

    public ToWindowed(): void {
        throw Error("Not implemented!");
        // let oldScale = GO.Scale;
        // let hresult: HResult = BDX._.SwitchToWindowed(<number>(MCS.MSX2ScreenWidth * GO.Scale), <number>(MCS.MSX2ScreenHeight * GO.Scale));
        // if (hresult.Succeeded) {
        //     hresult = BDX._.ChangeBufferSize(<number>(MCS.MSX2ScreenWidth * GO.Scale), <number>(MCS.MSX2ScreenHeight * GO.Scale));
        // }
        // else {
        //     GO.Scale = 1;
        //     hresult = BDX._.SwitchToWindowed(<number>(MCS.MSX2ScreenWidth * GO.Scale), <number>(MCS.MSX2ScreenHeight * GO.Scale));
        //     hresult = BDX._.ChangeBufferSize(<number>(MCS.MSX2ScreenWidth * GO.Scale), <number>(MCS.MSX2ScreenHeight * GO.Scale));
        // }
        // if (hresult.Succeeded)
        //     BDX._.Zoom = GO.Scale;
        // else GO.Scale = oldScale;
        // return hresult;
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
        if (M._.startAfterLoad)
            return

        switch (<number>M._.gameState) {
            case GameState.Prelude:
                this.Title.Paint();
                break;

            case GameState.TitleScreen:
                this.MainMenu.Paint();
                M._.GameMenu.Paint();
                break;

            case GameState.EndDemo:
                this.EndDemo.Paint();
                break;

            case GameState.Game:
            case GameState.Event:
                let gamescreenOffset = <Point>{ x: CS.GameScreenStartX, y: CS.GameScreenStartY };
                if (M._.gameSubstate != <number>GameSubstate.SwitchRoom) {
                    M._.CurrentRoom.Paint();
                    M._.objects.sort(o => o.priority).sort(o => o.pos.y + o.size.y).forEach(o => o.paint(gamescreenOffset));
                }
                this.Hud.Paint();

                switch (<number>M._.gameSubstate) {
                    case GameSubstate.SwitchRoom:
                    case GameSubstate.BelmontDies:
                    case GameSubstate.ItsCurtainsForYou:
                    case GameSubstate.ToEndDemo:
                    case GameSubstate.GameOver:
                        break;
                    default:
                        break;
                }

                if (M._.gameSubstate != <number>GameSubstate.SwitchRoom) {

                }

                if (M._.gameSubstate == <number>GameSubstate.ItsCurtainsForYou || M._.gameSubstate == <number>GameSubstate.ToEndDemo) {
                    this.ItsCurtains.Paint();
                }
                else if (M._.gameSubstate == <number>GameSubstate.GameOver) {
                    this.ItsCurtains.Paint();
                    this.GameOverScreen.Paint();
                }

                M._.GameMenu.Paint();
                if (M._.paused) {
                    view.FillRectangle(GameView.pausePosX, GameView.pausePosY, GameView.pauseEndX, GameView.pauseEndY, MCS.Msx1Colors[1]);
                    view.DrawRectangle(GameView.pausePosX, GameView.pausePosY, GameView.pauseEndX, GameView.pauseEndY, MCS.Msx1Colors[15]);
                    TextWriter.DrawText(GameView.pauseTextPosX, GameView.pauseTextPosY, GameView.pauseText);
                }
                break;
        }
    }
}