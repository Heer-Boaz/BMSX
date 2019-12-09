import { GameConstants as CS } from "./gameconstants"
import { Model as M, GameState, GameSubstate } from "./gamemodel";
import { Point, IGameView } from "../lib/interfaces";
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
            case GameState.TitleScreen:
                M._.Title.Paint();
                break;

            case GameState.EndDemo:
                M._.EndDemo.Paint();
                break;

            case GameState.Game:
            case GameState.Event:
                let gamescreenOffset = <Point>{ x: CS.GameScreenStartX, y: CS.GameScreenStartY };
                if (M._.gameSubstate != GameSubstate.SwitchRoom) {
                    M._.currentRoom.Paint();
                    M._.objects.forEach(o => o.paint && o.paint(gamescreenOffset));
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