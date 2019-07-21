import { GameState } from "./sintervaniamodel";
import { BStopwatch } from "../BoazEngineJS/btimer";
import { Item } from "./item";
import { saveGame } from "../BoazEngineJS/gamesaver";
import { AudioId, BitmapId } from "./resourceids";
import { Direction } from "../BoazEngineJS/direction";
import { Bootstrapper } from "./bootstrapper";
import { Savegame } from "../BoazEngineJS/savegame";
import { GameMenu } from "./gamemenu";
import { WeaponItem } from "./weaponitem";

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

    protected switchToSubstate(newSubstate: M.GameSubstate): void {
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
                T.PauseAllRunningWatches(true);
                break;
            case M.GameSubstate.GameMenu:
                T.PauseAllRunningWatches(true);
                break;
            case M.GameSubstate.SwitchRoom:
                this.timer.restart();
                break;
            case M.GameSubstate.Default:
                if (M._.OldSubstate == M.GameSubstate.IngameMenu || M._.OldSubstate == M.GameSubstate.GameMenu)
                    T.ResumeAllPausedWatches();
                break;
        }
        M._.Substate = newSubstate;
    }

    public TakeTurn(elapsedMs: number): void {
        if (M._.Paused) {
            this.handlePausedState();
            return
        }
        if (M._.StartAfterLoad) {
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
                if (Helpers.WaitDuration(this.timer, CS.WaitAfterGameStart1)) {
                    this.SwitchToState(GameState.GameStart2);
                }
                break;
            case GameState.GameStart2:
                if (Helpers.WaitDuration(this.timer, CS.WaitAfterGameStart2)) {
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
                        if (Helpers.WaitDuration(this.timer, CS.WaitAfterRoomSwitch)) {
                            this.SwitchToOldSubstate();
                            if (CS.CheckpointAtRoomEntry)
                                this.StoreCheckpoint();
                        }
                        break;
                    case M.GameSubstate.Default:
                        this.handleInputDuringGame();
                        M._.GameObjects.ToList().ForEach(o => o.TakeTurn());
                        M._.GameObjects.FindAll(o => o.DisposeFlag).ForEach(o => M._.Remove(o));
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
                        if (Helpers.WaitDuration(this.timer, CS.WaitAfterRoomSwitch)) {
                            this.SwitchToOldSubstate();
                        }
                        break;
                    case M.GameSubstate.GameMenu:
                        this.handleInputDuringGame();
                        M._.GameMenu.TakeTurn();
                        break;
                    default:
                        M._.GameObjects.ToList().ForEach(o => o.TakeTurn());
                        M._.GameObjects.FindAll(o => o.DisposeFlag).ForEach(o => M._.Remove(o));
                        M._.CurrentRoom.TakeTurn();
                        V._.Hud.TakeTurn();
                        if (I.KeyState.KC_F5 && !M._.GameMenu.visible)
                            this.OpenGameMenu();
                        break;
                }
                break;
            default:
                break;
        }
    }
    private handleInputDuringGame(): void {
        if (I.KeyState.KC_F1)
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
                if (I.KeyState.KC_SPACE) {
                    WeaponFireHandler.HandleFireMainWeapon();
                }
                if (I.KeyState.KC_M) {
                    WeaponFireHandler.HandleFireSecondaryWeapon();
                }
                else if (I.KeyState.KC_F5 && !M._.GameMenu.visible)
                    this.OpenGameMenu();
                break;
        }
    }
    private handleInputDuringPause(): void {
        if (I.KeyState.KC_F1)
            this.UnpauseGame();
    }
    private handleInputDuringGameMenu(): void {
        M._.GameMenu.HandleInput();
        if (I.KeyState.KC_F5) {
            this.CloseGameMenu();
        }
    }
    public KillFocus(): void {
        if (!M._.Paused && M._.State == GameState.Game && M._.Substate == M.GameSubstate.Default && CS.PauseGameOnKillFocus)
            this.PauseGame();
    }
    public SetFocus(): void {

    }
    private handlePausedState(): void {
        this.handleInputDuringPause();
    }
    private handleStartAfterLoadState(): void {
        if (Helpers.WaitDuration(this.startAfterLoadTimer, CS.WaitAfterLoadGame)) {
            M._.StartAfterLoad = false;
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
                Belmont.pos.Set(Belmont.pos.x, Room.RoomHeight - (Belmont.size.y + 1));
                break;
            case Direction.Right:
                Belmont.pos.Set(0, Belmont.pos.y);
                break;
            case Direction.Down:
                Belmont.pos.Set(Belmont.pos.x, 0);
                break;
            case Direction.Left:
                Belmont.pos.Set(Room.RoomWidth - (Belmont.size.x + 1), Belmont.pos.y);
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
        M._.Paused = true;
        T.PauseAllRunningWatches();
        S.StopEffect();
        S.StopMusic();
    }
    public UnpauseGame(): void {
        M._.Paused = false;
        T.ResumeAllPausedWatches();
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
        M._ = sg.Model;
        M._.Checkpoint = GameLoader.LoadGame(CS.SaveSlotCheckpoint);
        BStopwatchWatches = sg.RegisteredWatches;
        M._.InitAfterGameLoad();
        M._.GameMenu = new GameMenu();
        V._.Init();
        M._.StartAfterLoad = true;
        this.startAfterLoadTimer.pauseDuringMenu = false;
        this.startAfterLoadTimer.restart();
        BStopwatch.addWatch(this.startAfterLoadTimer);
        BStopwatch.addWatch(this.timer);
        S.MusicBeingPlayed = sg.MusicBeingPlayed;
        GameResources.Replace(<number>BitmapId.Room, new XBitmap(M._.CurrentRoom.BitmapPath));
    }
    public SaveGame(slot: number): void {
        if (M._.Substate == M.GameSubstate.GameMenu)
            this.CloseGameMenu();
        BStopwatch.removeWatch(this.timer);
        GameSaver.SaveGame(M._, slot);
        BStopwatch.addWatch(this.timer);
    }
    public StoreCheckpoint(): void {
        BStopwatch.removeWatch(this.timer);
        M._.Checkpoint = GameSaver.GetCheckpoint(M._);
        BStopwatch.addWatch(this.timer);
    }
    public LoadCheckpoint(): void {
        if (M._.Checkpoint == null)
            M._.Checkpoint = GameLoader.LoadGame(CS.SaveSlotCheckpoint);
        this.LoadGame(M._.Checkpoint);
    }
    public PickupItem(source: Item): void {
        if (source.id != null)
            M._.ItemsPickedUp[source.id] = true;
        M._.AddItemToInventory(source.ItsType);
    }
    public UseItem(itemType: Item.Type): void {
        let bagitem = M._.ItemsInInventory.First(i => i.Type == itemType);
        if (bagitem.Amount > 0) {
            if (Item.ItemUsable(itemType) != Item.Usable.Infinite)
                --bagitem.Amount;
            this.HandleUseItem(itemType);
        }
    }
    private HandleUseItem(itemType: Item.Type): void {
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