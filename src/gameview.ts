import { GameConstants as CS } from "./gameconstants"
import { GameModel as M, GameState, GameSubstate } from "./sintervaniamodel";
import { Point, IGameView } from '../BoazEngineJS/interfaces';
import { view } from "../BoazEngineJS/engine";

export class GameView implements IGameView {
    private static _instance: GameView;

    public static get _(): GameView {
        return GameView._instance;
    }

    constructor() {
        GameView._instance = this;
    }

    public drawGame(elapsedMs: number): void {
        view.clear();
        if (M._.startAfterLoad)
            return;

        switch (M._.gameState) {
            case GameState.LoadTheGame:
                break;
            case GameState.Prelude:
                M._.Title.Paint();
                break;

            case GameState.TitleScreen:
                M._.MainMenu.Paint();
                M._.GameMenu.Paint();
                break;

            case GameState.EndDemo:
                M._.EndDemo.Paint();
                break;

            case GameState.Game:
            case GameState.Event:
                let gamescreenOffset = <Point>{ x: CS.GameScreenStartX, y: CS.GameScreenStartY };
                if (M._.gameSubstate != GameSubstate.SwitchRoom) {
                    M._.currentRoom.Paint();
                    let sorted = M._.objects.sort((o1, o2) => o1.priority - o2.priority);
                    sorted.forEach(o => o.paint && o.paint(gamescreenOffset));
                }
                M._.Hud.Paint();

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

                if (M._.gameSubstate == GameSubstate.ItsCurtainsForYou || M._.gameSubstate == GameSubstate.ToEndDemo) {
                    M._.ItsCurtains.Paint();
                }
                else if (M._.gameSubstate == GameSubstate.GameOver) {
                    M._.ItsCurtains.Paint();
                    M._.GameOverScreen.Paint();
                }

                M._.GameMenu.Paint();
                if (M._.paused) {
                    M._.PauseObject.paint();
                }
                break;
        }
    }
}