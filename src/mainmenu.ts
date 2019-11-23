import { Chapter } from "./sintervaniamodel";
import { GameConstants as GCS } from "./gameconstants"
import { ResourceMaster } from "./resourcemaster";
import { SoundMaster as S } from "../BoazEngineJS/soundmaster";
import { Direction } from "../BoazEngineJS/direction";
import { GameModel as M } from "./sintervaniamodel";
import { GameController as C } from "./gamecontroller";
import { TextWriter } from "./textwriter";
import { view } from "../BoazEngineJS/engine";
import { MSXConstants as MCS } from "../BoazEngineJS/msx";
import { Constants as CS } from "../BoazEngineJS/constants";
import { KeyState } from "../BoazEngineJS/input";
import { GameMenu } from "./gamemenu";
import { SlotExists } from "../BoazEngineJS/gamestateloader";
import { GameState } from "../BoazEngineJS/model";
import { AudioId, BitmapId } from "../BoazEngineJS/resourceids";

export enum State {
    SelectMain,
    SubMenu,
    SelectChapter
}

export enum MenuItem {
    NewGame,
    Continue,
    LoadGame,
    Options,
    ToMainMenu,
    Prologue,
    Chapter0,
    Chapter1,
    Debug
}

export class MainMenu {
    private selectedIndex: number;
    private state: State;
    private static items: string[] = new Array("New game", "Continue game", "Load game", "Options");
    private static menuOptions: MenuItem[] = new Array(MenuItem.NewGame, MenuItem.Continue, MenuItem.LoadGame, MenuItem.Options);
    private static chapterItems: string[] = new Array("Debug", "Prologue", "Chapter 0", "Chapter 1", "Back");
    private static chapterOptions: MenuItem[] = new Array(MenuItem.Debug, MenuItem.Prologue, MenuItem.Chapter0, MenuItem.Chapter1, MenuItem.ToMainMenu);
    private static itemYs: number[] = new Array(140, 156, 172, 188, 196, 204);
    private static itemsX: number = 48;
    private static cursorPosX: number = 36;
    private static boxX: number = MainMenu.cursorPosX - 8;
    private static boxY: number = 132;
    private static boxEndX: number = MainMenu.boxX + 176 + 32;
    private static boxEndY: number = MainMenu.boxY + 24 + 48;

    private get cursorX(): number {
        return MainMenu.cursorPosX;
    }

    private get cursorY(): number {
        return MainMenu.itemYs[this.selectedIndex];
    }

    private get selectedItem(): MenuItem {
        switch (this.state) {
            case State.SelectMain:
                return MainMenu.menuOptions[this.selectedIndex];
            case State.SelectChapter:
                return MainMenu.chapterOptions[this.selectedIndex];
            default:
                return MenuItem.ToMainMenu;
        }
    }

    constructor() {
    }

    public Init(): void {
        this.reset();
    }

    private reset(): void {
        this.selectedIndex = 0;
        this.state = State.SelectMain;
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
        if (selectionChanged)
            S.PlayEffect(ResourceMaster.Sound[AudioId.Selectie]);
        if (KeyState.KC_SPACE) {
            switch (this.state) {
                case State.SelectMain:
                    S.PlayEffect(ResourceMaster.Sound[AudioId.Selectie]);
                    switch (this.selectedItem) {
                        case MenuItem.NewGame:
                            this.state = State.SelectChapter;
                            this.selectedIndex = 0;
                            break;
                        case MenuItem.Continue:
                            if (SlotExists(CS.SaveSlotCheckpoint))
                                C._.LoadCheckpoint();
                            else S.PlayEffect(ResourceMaster.Sound[AudioId.Fout]);
                            break;
                        case MenuItem.LoadGame:
                            KeyState.KC_SPACE = false;
                            M._.GameMenu.Open(MenuItem.LoadFromMainMenu);
                            this.state = State.SubMenu;
                            break;
                        case MenuItem.Options:
                            KeyState.KC_SPACE = false;
                            M._.GameMenu.Open(MenuItem.OptionsFromMainMenu);
                            this.state = State.SubMenu;
                            break;
                    }
                    break;
                case State.SelectChapter:
                    S.PlayEffect(ResourceMaster.Sound[AudioId.Selectie]);
                    switch (this.selectedItem) {
                        case MenuItem.Debug:
                            M._.SelectedChapterToPlay = Chapter.Debug;
                            C._.SwitchToState(GameState.Game);
                            break;
                        case MenuItem.Prologue:
                            M._.SelectedChapterToPlay = Chapter.Prologue;
                            C._.SwitchToState(GameState.GameStart1);
                            break;
                        case MenuItem.Chapter0:
                            M._.SelectedChapterToPlay = Chapter.Chapter_0;
                            C._.SwitchToState(GameState.GameStart1);
                            break;
                        case MenuItem.Chapter1:
                            M._.SelectedChapterToPlay = Chapter.GameStart;
                            C._.SwitchToState(GameState.GameStart1);
                            break;
                        case MenuItem.ToMainMenu:
                            this.state = State.SelectMain;
                            this.selectedIndex = 0;
                            break;
                    }
                    break;
                case State.SubMenu:
                    break;
            }
        }
    }

    private changeSelection(dir: Direction, selectionChanged: boolean): void {
        if (this.state == State.SubMenu)
            return
        let currentItems: string[];
        switch (this.state) {
            case State.SelectMain:
            default:
                currentItems = MainMenu.items;
                break;
            case State.SelectChapter:
                currentItems = MainMenu.chapterItems;
                break;
        }
        switch (dir) {
            case Direction.Up:
                if (this.selectedIndex > 0)
                    this.selectedIndex--;
                else this.selectedIndex = currentItems.length - 1;
                selectionChanged = true;
                break;
            case Direction.Down:
                if (this.selectedIndex < currentItems.length - 1)
                    this.selectedIndex++;
                else this.selectedIndex = 0;
                selectionChanged = true;
                break;
        }
    }

    public TakeTurn(): void {
    }

    public Paint(): void {
        view.DrawBitmap(BitmapId.Titel, 0, 0);
        view.FillRectangle(MainMenu.boxX, MainMenu.boxY, MainMenu.boxEndX, MainMenu.boxEndY, MCS.Msx1Colors[4]);
        view.DrawRectangle(MainMenu.boxX, MainMenu.boxY, MainMenu.boxEndX, MainMenu.boxEndY, MCS.Msx1Colors[15]);
        switch (this.state) {
            case State.SubMenu:
            case State.SelectMain:
                for (let i = 0; i < MainMenu.items.length; i++) {
                    switch (MainMenu.menuOptions[i]) {
                        case MenuItem.Continue:
                            if (SlotExists(CS.SaveSlotCheckpoint))
                                TextWriter.DrawText(MainMenu.itemsX, MainMenu.itemYs[i], MainMenu.items[i]);
                            else TextWriter.DrawText(MainMenu.itemsX, MainMenu.itemYs[i], MainMenu.items[i], MCS.Msx1Colors[0]);
                            break;
                        default:
                            TextWriter.DrawText(MainMenu.itemsX, MainMenu.itemYs[i], MainMenu.items[i]);
                            break;
                    }
                }
                break;
            case State.SelectChapter:
                for (let i = 0; i < MainMenu.chapterItems.length; i++) {
                    TextWriter.DrawText(MainMenu.itemsX, MainMenu.itemYs[i], MainMenu.chapterItems[i]);
                }
                break;
        }
        view.DrawBitmap(<number>BitmapId.MenuCursor, this.cursorX, this.cursorY);

    }

    public GameMenuClosed(): void {
        this.reset();
    }
}