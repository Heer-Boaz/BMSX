import { GameConstants as CS } from "./gameconstants"
import { Model as M, GameState, GameSubstate, Model } from "./gamemodel";
import { Point } from "./bmsx/common";
import { view } from "./bmsx/engine";

export class GameView {
    private static _instance: GameView;

    public static get _(): GameView {
        return GameView._instance;
    }

    constructor() {
        GameView._instance = this;
    }

    public drawGame(elapsedMs: number): void {
        view.clear();
        if (Model._.startAfterLoad)
            return;

        switch (Model._.gameState) {
            case GameState.LoadTheGame:
                break;
            case GameState.TitleScreen:
                Model._.Title.Paint();
                break;

            case GameState.EndDemo:
                Model._.EndDemo.Paint();
                break;

            case GameState.Game:
            case GameState.Event:
                let gamescreenOffset = <Point>{ x: CS.GameScreenStartX, y: CS.GameScreenStartY };
                if (Model._.gameSubstate != GameSubstate.SwitchRoom) {
                    Model._.currentRoom.Paint();
                    Model._.objects.forEach(o => o.paint && o.paint(gamescreenOffset));
                }
                Model._.Hud.Paint();

                switch (Model._.gameSubstate) {
                    case GameSubstate.SwitchRoom:
                    case GameSubstate.BelmontDies:
                    case GameSubstate.ItsCurtainsForYou:
                    case GameSubstate.ToEndDemo:
                    case GameSubstate.GameOver:
                        break;
                    default:
                        break;
                }

                if (Model._.gameSubstate == GameSubstate.ItsCurtainsForYou || Model._.gameSubstate == GameSubstate.ToEndDemo) {
                    Model._.ItsCurtains.Paint();
                }
                else if (Model._.gameSubstate == GameSubstate.GameOver) {
                    Model._.ItsCurtains.Paint();
                    Model._.GameOverScreen.Paint();
                }

                Model._.GameMenu.Paint();
                if (Model._.paused) {
                    Model._.PauseObject.paint();
                }
                break;
        }
    }
}