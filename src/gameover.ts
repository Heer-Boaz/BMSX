import { Model } from "./gamemodel";
import { Direction, Point } from "./bmsx/common";
import { TextWriter } from "./textwriter";
import { view, model, IGameObject, controller } from "./bmsx/engine";
import { AudioId, BitmapId } from "./bmsx/resourceids";
import { Input } from "./bmsx/input";
import { SM as S, SM } from "./bmsx/soundmaster";
import { Controller as C, Controller } from "./gamecontroller";
import { MenuItem } from "./mainmenu";
import { Msx1Colors } from "./bmsx/msx";

export const enum State {
    SelectContOrLoad,
    SelectFile
}

export class GameOver implements IGameObject {
    id: string = 'gameover';
    disposeFlag: boolean;
    priority: number = 500;
    pos: Point;
    visible: boolean = true;

    private selectedIndex: number;
    private state: State;
    private static items: string[] = new Array("Start bij controlepunt", "Laad spel");
    private static itemYs: number[] = new Array(112, 128);
    private static itemsX: number = 48;
    private static cursorPosX: number = 36;
    private static boxX: number = GameOver.cursorPosX - 8;
    private static boxY: number = 104;
    private static boxEndX: number = GameOver.boxX + 176 + 32;
    private static boxEndY: number = GameOver.boxY + 24 + 16;

    private get cursorX(): number {
        return GameOver.cursorPosX;
    }

    private get cursorY(): number {
        return GameOver.itemYs[this.selectedIndex];
    }

    constructor() {
        this.reset();
    }

    public reset(): void {
        this.selectedIndex = 0;
        this.state = State.SelectContOrLoad;
    }

    public HandleInput(): void {
        let selectionChanged: boolean = false;
        if (Input.KC_UP)
            this.changeSelection(Direction.Up, selectionChanged);
        else if (Input.KC_RIGHT)
            this.changeSelection(Direction.Right, selectionChanged);
        else if (Input.KC_DOWN)
            this.changeSelection(Direction.Down, selectionChanged);
        else if (Input.KC_LEFT)
            this.changeSelection(Direction.Left, selectionChanged);
        if (Input.KC_SPACE) {
            switch (this.state) {
                case State.SelectContOrLoad:
                    switch (this.selectedIndex) {
                        case 0:
                            (controller as Controller).LoadCheckpoint();
                            break;
                        case 1:
                            SM.play(AudioId.Selectie);
                            Input.reset();
                            (model as Model).GameMenu.Open(MenuItem.LoadFromGameOver);
                            this.state = State.SelectFile;
                            break;
                    }
                    break;
                case State.SelectFile:
                    break;
            }
        }
        if (selectionChanged) {
            S.play(AudioId.Selectie);
        }
    }

    private changeSelection(dir: Direction, selectionChanged: boolean): void {
        if (this.state == State.SelectFile)
            return
        switch (dir) {
            case Direction.Up:
                if (this.selectedIndex > 0) {
                    this.selectedIndex = 0;
                    selectionChanged = true;
                }
                break;
            case Direction.Down:
                if (this.selectedIndex < 1) {
                    this.selectedIndex = 1;
                    selectionChanged = true;
                }
                break;
        }
    }

    public takeTurn(): void {

    }

    public paint(): void {
        TextWriter.drawText(60, 56, ["Je bent vernederd!"]);
        TextWriter.drawText(32, 80, ["Wat ga je doen, Ronan?"]);
        view.drawRectangle(GameOver.boxX, GameOver.boxY, GameOver.boxEndX, GameOver.boxEndY, Msx1Colors[15]);
        for (let i = 0; i < GameOver.items.length; i++)
            TextWriter.drawText(GameOver.itemsX, GameOver.itemYs[i], [GameOver.items[i]]);
        view.drawImg(BitmapId.MenuCursor, this.cursorX, this.cursorY);
    }

    public GameMenuClosed(): void {
        this.reset();
    }
}
