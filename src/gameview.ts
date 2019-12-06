import { HUD } from "./hud";
import { ItsCurtainsForYou } from "./itscurtainsforyou";
import { GameOver } from "./gameover";
import { MainMenu } from "./mainmenu";
import { Title } from "./title";
import { GameState, GameSubstate } from "../BoazEngineJS/model";
import { GameConstants as CS } from "./gameconstants"
import { AudioId, BitmapId } from "./resourceids";
import { SM as S } from "../BoazEngineJS/soundmaster";
import { Direction } from "../BoazEngineJS/direction";
import { GameModel as M } from "./sintervaniamodel";
import { GameController as C } from "./gamecontroller";
import { TextWriter } from "./textwriter";
import { view } from "../BoazEngineJS/engine";
import { MSXConstants as MCS } from "../BoazEngineJS/msx";
import { EndDemo } from "./enddemo";
import { Foe } from "./foe";
import { Point, IGameView } from '../BoazEngineJS/interfaces';
import { GameOptions as GO } from '../BoazEngineJS/gameoptions';
import { Sprite } from "../BoazEngineJS/sprite";

export class GameView implements IGameView {
    private static pausePosX: number = 80;
    private static pausePosY: number = 80;
    private static pauseTextPosX: number = 104;
    private static pauseTextPosY: number = 96;
    private static pauseEndX: number = 176;
    private static pauseEndY: number = 120;
    private static pauseText: string = "Paused";
    private static _instance: GameView;

    public static get _(): GameView {
        return GameView._instance;
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
        return foe.healthPercentage;
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

    public ToFullscreen(): void {
        // https://zinoui.com/blog/javascript-fullscreen-api
        window.addEventListener('keyup', GameView.triggerFullScreenOnFakeUserEvent);
    }

    public static triggerFullScreenOnFakeUserEvent(): void {
        if (document.fullscreenEnabled) document.documentElement.requestFullscreen();
        window.removeEventListener('keyup', GameView.triggerFullScreenOnFakeUserEvent);
    }

    public ToWindowed(): void {
        window.addEventListener('keyup', GameView.triggerWindowedOnFakeUserEvent);
    }

    public static triggerWindowedOnFakeUserEvent(): void {
        document.exitFullscreen();
        window.removeEventListener('keyup', GameView.triggerWindowedOnFakeUserEvent);
    }

    constructor() {
        GameView._instance = this;
    }

    public init(): void {
        this.Hud = new HUD();
        this.ItsCurtains = new ItsCurtainsForYou();
        this.GameOverScreen = new GameOver();
        this.MainMenu = new MainMenu();
        this.Title = new Title();
        this.EndDemo = new EndDemo();
    }

    public drawGame(elapsedMs: number): void {
        if (M._.startAfterLoad)
            return

        switch (M._.gameState) {
            case GameState.LoadTheGame:
                break;
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
                if (M._.gameSubstate != GameSubstate.SwitchRoom) {
                    M._.currentRoom.Paint();
                    let sorted = M._.objects.sort((o1, o2) => (<Sprite>o1).priority - (<Sprite>o2).priority);
                    sorted.forEach(o => o.paint && o.paint(gamescreenOffset));
                }
                this.Hud.Paint();

                switch (M._.gameSubstate) {
                    case GameSubstate.SwitchRoom:
                    case GameSubstate.BelmontDies:
                    case GameSubstate.ItsCurtainsForYou:
                    case GameSubstate.ToEndDemo:
                    case GameSubstate.GameOver:
                        break;
                    default:
                        break;
                }

                if (M._.gameSubstate != GameSubstate.SwitchRoom) {

                }

                if (M._.gameSubstate == GameSubstate.ItsCurtainsForYou || M._.gameSubstate == GameSubstate.ToEndDemo) {
                    this.ItsCurtains.Paint();
                }
                else if (M._.gameSubstate == GameSubstate.GameOver) {
                    this.ItsCurtains.Paint();
                    this.GameOverScreen.Paint();
                }

                M._.GameMenu.Paint();
                if (M._.paused) {
                    view.fillRectangle(GameView.pausePosX, GameView.pausePosY, GameView.pauseEndX, GameView.pauseEndY, MCS.Msx1Colors[1]);
                    view.drawRectangle(GameView.pausePosX, GameView.pausePosY, GameView.pauseEndX, GameView.pauseEndY, MCS.Msx1Colors[15]);
                    TextWriter.drawText(GameView.pauseTextPosX, GameView.pauseTextPosY, GameView.pauseText);
                }
                break;
        }
    }
}