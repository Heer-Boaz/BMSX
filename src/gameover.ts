import { GameModel as M } from "./sintervaniamodel";
import { Direction } from "../BoazEngineJS/direction";
import { TextWriter } from "./textwriter";
import { MSXConstants as CS } from "../BoazEngineJS/msx";
import { view } from "../BoazEngineJS/engine";
import { BitmapId, AudioId } from "./resourceids";
import { KeyState } from "../BoazEngineJS/input";
import { SoundMaster as S } from "../BoazEngineJS/soundmaster";
import { ResourceMaster as RM } from './resourcemaster';
import { GameController as C } from './gamecontroller';
import { GameMenu } from "./gamemenu";
import { MenuItem } from './mainmenu';

export enum State {
    SelectContOrLoad,
    SelectFile
}

export class GameOver {
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

    }

    public Init(): void {
        this.reset();
    }

    private reset(): void {
        this.selectedIndex = 0;
        this.state = State.SelectContOrLoad;
    }

    public HandleInput(): void {
        let selectionChanged: boolean = false;
        if (KeyState.KC_UP)
            this.changeSelection(Direction.Up, selectionChanged);
        else if (KeyState.KC_RIGHT)
            this.changeSelection(Direction.Right, selectionChanged);
        else if (KeyState.KC_DOWN)
            this.changeSelection(Direction.Down, selectionChanged);
        else if (KeyState.KC_LEFT)
            this.changeSelection(Direction.Left, selectionChanged);
        if (KeyState.KC_SPACE) {
            switch (this.state) {
                case State.SelectContOrLoad:
                    switch (this.selectedIndex) {
                        case 0:
                            C._.LoadCheckpoint();
                            break;
                        case 1:
                            S.PlayEffect(RM.Sound[AudioId.Selectie]);
                            KeyState.KC_SPACE = false;
                            M._.GameMenu.Open(MenuItem.LoadFromGameOver);
                            this.state = State.SelectFile;
                            break;
                    }
                    break;
                case State.SelectFile:
                    break;
            }
        }
        if (selectionChanged) {
            S.PlayEffect(RM.Sound[AudioId.Selectie]);
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

    public TakeTurn(): void {

    }

    public Paint(): void {
        TextWriter.DrawText(60, 56, ["Je bent vernederd!"]);
        TextWriter.DrawText(32, 80, ["Wat ga je doen,Belmont?"]);
        view.DrawRectangle(GameOver.boxX, GameOver.boxY, GameOver.boxEndX, GameOver.boxEndY, CS.Msx1Colors[15]);
        for (let i = 0; i < GameOver.items.length; i++)
            TextWriter.DrawText(GameOver.itemsX, GameOver.itemYs[i], [GameOver.items[i]]);
        view.DrawBitmap(BitmapId.MenuCursor, this.cursorX, this.cursorY);
    }

    public GameMenuClosed(): void {
        this.reset();
    }
}
