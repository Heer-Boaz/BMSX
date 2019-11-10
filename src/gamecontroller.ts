import { BStopwatch } from "../BoazEngineJS/btimer";
import { Item, ItemType } from "./item";
import { AudioId, BitmapId } from "resourceids";
import { Direction } from "../BoazEngineJS/direction";
import { Bootstrapper } from "./bootstrapper";
import { Savegame } from "../BoazEngineJS/savegame";
import { WeaponItem } from "./weaponitem";
import { GameModel as M, GameModel } from "./sintervaniamodel"
import { GameState, GameSubstate } from "../BoazEngineJS/model";
import { KeyState } from "../BoazEngineJS/input";
import { WeaponFireHandler } from "./weaponfirehandler";
import { Room } from "./room";
import { GameMenu } from "./gamemenu";
import { waitDuration, setPoint } from '../BoazEngineJS/common';
import { SoundMaster as S } from "../BoazEngineJS/soundmaster";
import { ResourceMaster as RM, ResourceMaster } from './resourcemaster';
import { Constants as CS } from "../BoazEngineJS/constants";
import { GameView as V } from './gameview';
import { GameConstants } from "./gameconstants";
import { LoadGame } from '../BoazEngineJS/gamestateloader';
import { GameSaver } from "../BoazEngineJS/gamesaver";

export class GameController {
    private static _instance: GameController;
    public static get _(): GameController {
        return GameController._instance != null ? GameController._instance : (GameController._instance = new GameController());
    }

    private timer: BStopwatch;
    private startAfterLoadTimer: BStopwatch;
    public ElapsedMsDelta: number;

    public Initialize(): void {
        M._.OldState = GameState.None;
        this.timer = BStopwatch.createWatch();
        this.startAfterLoadTimer = BStopwatch.createWatch();
    }

    public SwitchToState(newState: GameState): void {
        M._.OldState = M._.State;
        if (this.DisposeOldState(M._.State, newState)) {
            this.InitNewState(newState);
        }
        M._.State = newState;
    }

    public DisposeOldState(oldState: GameState, newState: GameState): boolean {
        switch (oldState) {
            case GameState.TitleScreen:
                S.StopMusic();
                if (newState == GameState.Game)
                    this.setupGameStart(newState);
                break;
            case GameState.GameStart2:
                this.setupGameStart(newState);
                break;
            case GameState.Game:
                break;
            default:
                break;
        }
        return true;
    }

    public SwitchToOldState(): void {
        this.SwitchToState(M._.OldState);
    }

    public SwitchToOldSubstate(): void {
        this.switchToSubstate(M._.OldSubstate);
    }

    public InEventState: boolean;
    protected InitNewState(newState: GameState): void {
        switch (newState) {
            case GameState.Prelude:
                V._.Title.Init();
                break;
            case GameState.TitleScreen:
                V._.MainMenu.Init();
                break;
            case GameState.EndDemo:
                V._.EndDemo.Init();
                break;
            case GameState.GameStart1:
                this.timer.restart();
                break;
            case GameState.GameStart2:
                this.timer.restart();
                S.PlayMusic(RM.Music[AudioId.Stage]);
                break;
            case GameState.Game:
                break;
            default:
                break;
        }
    }

    protected switchToSubstate(newSubstate: GameSubstate): void {
        M._.OldSubstate = M._.Substate;
        switch (newSubstate) {
            case M.GameSubstate.Conversation:
                break;
            case M.GameSubstate.BelmontDies:
                S.PlayMusic(RM.Music[AudioId.Ohnoes]);
                break;
            case M.GameSubstate.ItsCurtainsForYou:
            case M.GameSubstate.ToEndDemo:
                V._.ItsCurtains.Init();
                break;
            case M.GameSubstate.GameOver:
                S.PlayMusic(RM.Music[AudioId.Humiliation]);
                V._.GameOverScreen.Init();
                break;
            case M.GameSubstate.IngameMenu:
                BStopwatch.pauseAllRunningWatches(true);
                break;
            case M.GameSubstate.GameMenu:
                BStopwatch.pauseAllRunningWatches(true);
                break;
            case M.GameSubstate.SwitchRoom:
                this.timer.restart();
                break;
            case M.GameSubstate.Default:
                if (M._.OldSubstate == M.GameSubstate.IngameMenu || M._.OldSubstate == M.GameSubstate.GameMenu)
                    BStopwatch.resumeAllPausedWatches();
                break;
        }
        M._.Substate = newSubstate;
    }

    public TakeTurn(elapsedMs: number): void {
        if (M._.paused) {
            this.handlePausedState();
            return
        }
        if (M._.startAfterLoad) {
            this.handleStartAfterLoadState();
            return
        }
        this.ElapsedMsDelta = elapsedMs;
        switch (M._.State) {
            case GameState.Prelude:
                V._.Title.TakeTurn();
                break;
            case GameState.TitleScreen:
                V._.MainMenu.HandleInput();
                V._.MainMenu.TakeTurn();
                if (M._.GameMenu.visible) {
                    M._.GameMenu.HandleInput();
                    M._.GameMenu.TakeTurn();
                }
                break;
            case GameState.EndDemo:
                V._.EndDemo.TakeTurn();
                break;
            case GameState.GameStart1:
                if (waitDuration(this.timer, GameConstants.WaitAfterGameStart1)) {
                    this.SwitchToState(GameState.GameStart2);
                }
                break;
            case GameState.GameStart2:
                if (waitDuration(this.timer, GameConstants.WaitAfterGameStart2)) {
                    this.SwitchToState(GameState.Game);
                }
                break;
            case GameState.Game:
                switch (M._.Substate) {
                    case M.GameSubstate.GameMenu:
                        this.handleInputDuringGame();
                        M._.GameMenu.TakeTurn();
                        break;
                    case M.GameSubstate.BelmontDies:
                        this.handleInputDuringGame();
                        M._.Belmont.TakeTurn();
                        V._.Hud.TakeTurn();
                        break;
                    case M.GameSubstate.ItsCurtainsForYou:
                    case M.GameSubstate.ToEndDemo:
                        this.handleInputDuringGame();
                        M._.Belmont.TakeTurn();
                        V._.Hud.TakeTurn();
                        V._.ItsCurtains.TakeTurn();
                        break;
                    case M.GameSubstate.GameOver:
                        this.handleInputDuringGame();
                        V._.GameOverScreen.TakeTurn();
                        M._.GameMenu.TakeTurn();
                        break;
                    case M.GameSubstate.SwitchRoom:
                        if (waitDuration(this.timer, GameConstants.WaitAfterRoomSwitch)) {
                            this.SwitchToOldSubstate();
                            if (GameConstants.CheckpointAtRoomEntry)
                                this.StoreCheckpoint();
                        }
                        break;
                    case M.GameSubstate.Default:
                        this.handleInputDuringGame();
                        M._.objects.forEach(o => o.takeTurn());
                        M._.objects.filter(o => o.disposeFlag).forEach(o => M._.remove(o));
                        M._.CurrentRoom.TakeTurn();
                        V._.Hud.TakeTurn();
                        break;
                }
                break;
            case GameState.Event:
                if (M._.Belmont.Dying)
                    this.SwitchToOldState();
                switch (M._.Substate) {
                    case M.GameSubstate.SwitchRoom:
                        if (waitDuration(this.timer, GameConstants.WaitAfterRoomSwitch)) {
                            this.SwitchToOldSubstate();
                        }
                        break;
                    case M.GameSubstate.GameMenu:
                        this.handleInputDuringGame();
                        M._.GameMenu.TakeTurn();
                        break;
                    default:
                        M._.objects.forEach(o => o.takeTurn());
                        M._.objects.filter(o => o.disposeFlag).forEach(o => M._.remove(o));
                        M._.CurrentRoom.TakeTurn();
                        V._.Hud.TakeTurn();
                        if (KeyState.KC_F5 && !M._.GameMenu.visible)
                            this.OpenGameMenu();
                        break;
                }
                break;
            default:
                break;
        }
    }

    private handleInputDuringGame(): void {
        if (KeyState.KC_F1)
            this.PauseGame();
        switch (M._.Substate) {
            case M.GameSubstate.BelmontDies:
            case M.GameSubstate.ItsCurtainsForYou:
            case M.GameSubstate.ToEndDemo:
                break;
            case M.GameSubstate.GameOver:
                V._.GameOverScreen.HandleInput();
                if (M._.GameMenu.visible)
                    this.handleInputDuringGameMenu();
                break;
            case M.GameSubstate.GameMenu:
                this.handleInputDuringGameMenu();
                break;
            case M.GameSubstate.Default:
            default:
                if (KeyState.KC_SPACE) {
                    WeaponFireHandler.HandleFireMainWeapon();
                }
                if (KeyState.KC_M) {
                    WeaponFireHandler.HandleFireSecondaryWeapon();
                }
                else if (KeyState.KC_F5 && !M._.GameMenu.visible)
                    this.OpenGameMenu();
                break;
        }
    }

    private handleInputDuringPause(): void {
        if (KeyState.KC_F1)
            this.UnpauseGame();
    }

    private handleInputDuringGameMenu(): void {
        M._.GameMenu.HandleInput();
        if (KeyState.KC_F5) {
            this.CloseGameMenu();
        }
    }

    public KillFocus(): void {
        if (!M._.paused && M._.State == GameState.Game && M._.Substate == M.GameSubstate.Default && GameConstants.PauseGameOnKillFocus)
            this.PauseGame();
    }

    public SetFocus(): void {
    }

    private handlePausedState(): void {
        this.handleInputDuringPause();
    }

    private handleStartAfterLoadState(): void {
        if (waitDuration(this.startAfterLoadTimer, GameConstants.WaitAfterLoadGame)) {
            M._.startAfterLoad = false;
            BStopwatch.removeWatch(this.startAfterLoadTimer);
            if (S.MusicBeingPlayed != null)
                S.PlayMusic(S.MusicBeingPlayed);
        }
    }

    public BelmontDied(): void {
        this.switchToSubstate(M.GameSubstate.BelmontDies);
    }

    public BelmontDeathAniFinished(): void {
        this.switchToSubstate(M.GameSubstate.ItsCurtainsForYou);
    }

    public ItsCurtainsAniFinished(): void {
        if (M._.Substate == M.GameSubstate.ItsCurtainsForYou)
            this.switchToSubstate(M.GameSubstate.GameOver);
        else this.SwitchToState(GameState.EndDemo);
    }

    public PreludeFinished(): void {
        this.SwitchToState(GameState.TitleScreen);
    }

    public BossDefeated(): void {
        this.switchToSubstate(M.GameSubstate.ToEndDemo);
    }

    public HandleRoomExitViaMovement(targetRoom: number, dir: Direction): void {
        let Belmont = M._.Belmont;
        switch (dir) {
            case Direction.Up:
                setPoint(Belmont.pos, Belmont.pos.x, Room.RoomHeight - (Belmont.size.y + 1));
                break;
            case Direction.Right:
                setPoint(Belmont.pos, 0, Belmont.pos.y);
                break;
            case Direction.Down:
                setPoint(Belmont.pos, Belmont.pos.x, 0);
                break;
            case Direction.Left:
                setPoint(Belmont.pos, Room.RoomWidth - (Belmont.size.x + 1), Belmont.pos.y);
                break;
        }
        this.DoRoomExit(targetRoom);
    }

    public DoRoomExit(targetRoom: number): void {
        M._.LastFoeThatWasHit = null;
        M._.LoadRoom(targetRoom);
        this.switchToSubstate(M.GameSubstate.SwitchRoom);
    }

    private setupGameStart(newState: GameState): void {
        M._.InitModelForGameStart();
        Bootstrapper.BootstrapGame(M._.SelectedChapterToPlay);
        V._.Hud.SetShownLevelsToProperValues();
        M._.State = newState;
        this.StoreCheckpoint();
    }

    public PauseGame(): void {
        M._.paused = true;
        BStopwatch.pauseAllRunningWatches();
        S.StopEffect();
        S.StopMusic();
    }

    public UnpauseGame(): void {
        M._.paused = false;
        BStopwatch.resumeAllPausedWatches();
        S.ResumeEffect();
        S.ResumeMusic();
    }

    public OpenGameMenu(): void {
        M._.GameMenu.Open();
        this.switchToSubstate(M.GameSubstate.GameMenu);
    }

    public CloseGameMenu(): void {
        M._.GameMenu.Close();
        this.SwitchToOldSubstate();
    }

    public LoadGame(sg: Savegame): void {
        S.StopEffect();
        S.StopMusic();
        let oldcheckpoint = M._.Checkpoint;
        M._ = sg.Model as GameModel;
        M._.Checkpoint = LoadGame(CS.SaveSlotCheckpoint);
        BStopwatch.Watches = sg.RegisteredWatches;
        M._.InitAfterGameLoad();
        M._.GameMenu = new GameMenu();
        V._.Init();
        M._.startAfterLoad = true;
        this.startAfterLoadTimer.pauseDuringMenu = false;
        this.startAfterLoadTimer.restart();
        BStopwatch.addWatch(this.startAfterLoadTimer);
        BStopwatch.addWatch(this.timer);
        S.MusicBeingPlayed = sg.MusicBeingPlayed;
        ResourceMaster.reloadImg(BitmapId.Room, M._.CurrentRoom.BitmapPath);
    }

    public SaveGame(slot: number): void {
        if (M._.Substate == M.GameSubstate.GameMenu)
            this.CloseGameMenu();
        BStopwatch.removeWatch(this.timer);
        GameSaver.saveGame(M._, slot);
        BStopwatch.addWatch(this.timer);
    }

    public StoreCheckpoint(): void {
        BStopwatch.removeWatch(this.timer);
        M._.Checkpoint = GameSaver.GetCheckpoint(M._);
        BStopwatch.addWatch(this.timer);
    }

    public LoadCheckpoint(): void {
        if (M._.Checkpoint == null)
            M._.Checkpoint = LoadGame(CS.SaveSlotCheckpoint);
        this.LoadGame(M._.Checkpoint);
    }

    public PickupItem(source: Item): void {
        if (source.id != null)
            M._.ItemsPickedUp[source.id] = true;
        M._.AddItemToInventory(source.ItsType);
    }

    public UseItem(itemType: ItemType): void {
        let bagitem = M._.ItemsInInventory.find(i => i.Type == itemType);
        if (bagitem.Amount > 0) {
            if (Item.ItemUsable(itemType) != Item.Usable.Infinite)
                --bagitem.Amount;
            this.HandleUseItem(itemType);
        }
    }

    private HandleUseItem(itemType: ItemType): void {
        switch (itemType) {
            case Item.Type.None:
                M._.Belmont.Health = M._.Belmont.MaxHealth;
                break;
        }
    }

    public PickupWeaponItem(source: WeaponItem): void {
        M._.AddWeaponToInventory(source.ItsType);
        if (source.id != null)
            M._.ItemsPickedUp[source.id] = true;
    }
}