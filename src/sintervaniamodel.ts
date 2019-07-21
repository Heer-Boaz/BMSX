import { Foe } from "./foe";
import { Belmont } from "./belmont";
import { Savegame } from "../BoazEngineJS/savegame";
import { Model } from "../BoazEngineJS/model";
import * as GameConstants from "./gameconstants"
import { BStopwatch } from "../BoazEngineJS/btimer";
import { BossFoe } from "./bossfoe";
import { GameMenu } from "./gamemenu";
import { WeaponItem } from "./weaponitem";
import { Item } from "./item";

/*[Serializable]*/
export class GameModel extends Model {
    public Checkpoint: Savegame;
    public SelectedChapterToPlay: Chapter;
    public static PROPERTY_KEEP_AT_ROOMSWITCH: string = "p_rs";
    public static PROPERTY_ACT_AS_WALL: string = "p_wall";

    private static _instance: GameModel;
    public static get _(): GameModel {
        return GameModel._instance;
    }

    public static set _(value: GameModel) {
        GameModel._instance = value;
    }

    public id2object: Map<string, IGameObject>;
    public objects: IGameObject[];

    public Foes: Foe[];
    public ItemsInInventory: BagItem[];
    public WeaponsInInventory: BagWeapon[];
    protected _hearts: number;
    public get Hearts(): number {
        return this._hearts;
    }
    public set Hearts(value: number) {
        if (value > CS.Belmont_MaxHearts)
            this._hearts = CS.Belmont_MaxHearts;
        else if (value < 0)
            this._hearts = 0;
        else this._hearts = value;
    }
    public Belmont: Belmont;
    public Boss: BossFoe;
    public CurrentRoom: Room;
    public GameMenu: GameMenu;
    public Switches: Map<Switch, boolean>;
    public EventTriggered: Map<number, boolean>;
    public EventFinished: Map<number, boolean>;
    public FoesDefeated: Map<string, boolean>;
    public ItemsPickedUp: Map<string, boolean>;
    public WeaponItemsPickedUp: Map<string, boolean>;
    public DoorsOpened: Map<string, boolean>;
    public BossBattle: boolean;
    public RoomExitsLocked: boolean;
    public MainWeaponCooldownTimer: BStopwatch;
    public SecWeaponCooldownTimer: BStopwatch;

    private _selectedMainWeapon: MainWeaponType;
    public get SelectedMainWeapon(): MainWeaponType {
        return MainWeaponType.TriRoe;
    }

    private _selectedSecondaryWeapon: SecWeaponType;
    public get SelectedSecondaryWeapon(): SecWeaponType {
        return this._selectedSecondaryWeapon;
    }
    public set SelectedSecondaryWeapon(value: SecWeaponType) {
        this._selectedSecondaryWeapon = value;
    }

    public get SelectedSecBagWeapon(): BagWeapon {
        let weaponItemInBagType = WeaponItem.SecWeaponType2WeaponItemType(this.SelectedSecondaryWeapon);
        let index = this.WeaponsInInventory.FindIndex(bw => bw.Type == weaponItemInBagType);
        if (index == -1)
            return null;
        return M._.WeaponsInInventory[index];
    }

    private _lastFoeThatWasHit: Foe;
    public get LastFoeThatWasHit(): Foe {
        if (this._lastFoeThatWasHit == null)
            return null;
        if (this._lastFoeThatWasHit.disposeFlag)
            return null;
        return this._lastFoeThatWasHit;
    }

    public set LastFoeThatWasHit(value: Foe) {
        this._lastFoeThatWasHit = value;
    }
    private _selectedItem: BagItem;

    public get SelectedItem(): BagItem {
        return this._selectedItem;
    }
    public set SelectedItem(value: BagItem) {
        this._selectedItem = value;
    }

    public Initialize(): void {
        this.GameObjects = new Array<IGameObject>();
        this.Foes = new Array<Foe>();
        this.ItemsInInventory = new Array<BagItem>();
        this.WeaponsInInventory = new Array<BagWeapon>();
        this.Switches = new Map<Switch, boolean>();
        this.GameMenu = new GameMenu();
        this.Id2GameObject = new Map<string, IGameObject>();
        this.FoesDefeated = new Map<string, boolean>();
        this.ItemsPickedUp = new Map<string, boolean>();
        this.WeaponItemsPickedUp = new Map<string, boolean>();
        this.DoorsOpened = new Map<string, boolean>();
        this.MainWeaponCooldownTimer = BStopwatch.createWatch();
        this.SecWeaponCooldownTimer = BStopwatch.createWatch();
        RoomFactory.PrepareData();
    }
    public InitModelForGameStart(): void {
        M._.BossBattle = false;
        M._.RoomExitsLocked = false;
        M._.Switches.Clear();
        Enum.GetValues(/*typeof*/Switch).forEach(function (t) { M._.Switches.Add(t, false); });
        M._.ItemsInInventory.Clear();
        M._.WeaponsInInventory.Clear();
        M._.FoesDefeated.Clear();
        M._.ItemsPickedUp.Clear();
        M._.WeaponItemsPickedUp.Clear();
        M._.Spawn(new Belmont());
    }
    public InitAfterGameLoad(): void {

    }
    public Spawn(o: IGameObject): void {
        if (o instanceof Belmont) {
            if (this.GameObjects.Any(ob => ob instanceof Belmont))
                throw new ArgumentException("There is already a Belmont in the game! \"There can be only one!\"");
            else M._.Belmont = <Belmont>o;
        }
        if (this.GameObjects.Contains(o))
            throw new ArgumentException("GameObject already exists in the game model!");
        o.Spawn();
        let f: Foe = __as__<Foe>(o, Foe);
        if (f != null) {
            if (!f.RespawnAtRoomEntry) {
                let wasDefeated: boolean;
                let exists: boolean = this.FoesDefeated.TryGetValue(f.id, wasDefeated);
                if (!exists) {
                    this.FoesDefeated.Add(f.id, false);
                    wasDefeated = false;
                }
                if (!wasDefeated)
                    this.Foes.Add(f);
                else return
            }
            else this.Foes.Add(f);
        }
        this.GameObjects.Add(o);
        if (o.id != null)
            this.Id2GameObject[o.id] = o;
    }
    public Remove(o: IGameObject): void {
        this.GameObjects.Remove(o);
        if (o.id != null)
            this.Id2GameObject.Remove(o.id);
        if (o instanceof Foe)
            this.Foes.Remove(<Foe>o);
        o.Dispose();
    }
    public ObjectWithId(id: string): IGameObject {
        let result: IGameObject;
        let exists: boolean = this.Id2GameObject.TryGetValue(id, result);
        return exists ? result : null;
    }
    public FoeDefeated(f: Foe): void {
        if (f.RespawnAtRoomEntry)
            return
        let defeated: boolean;
        if (this.FoesDefeated.TryGetValue(f.id, defeated))
            this.FoesDefeated[f.id] = true;
        else this.FoesDefeated.Add(f.id, true);
    }
    public GetFoeDefeated(id: string): boolean {
        return this.FoesDefeated.ContainsKey(id) ? this.FoesDefeated[id] : false;
    }
    public get FoesPresentInCurrentRoom(): boolean {
        return this.Foes.Count > 0;
    }
    public GetSwitchState(s: Switch): boolean {
        let result: boolean;
        if (this.Switches.TryGetValue(s, result))
            return result;
        return false;
    }
    public GetItemPickedUp(id: string): boolean {
        return this.ItemsPickedUp.ContainsKey(id);
    }
    public DoorOpened(id: string): boolean {
        let open: boolean;
        if (!this.DoorsOpened.TryGetValue(id, open))
            return false;
        return open;
    }
    public AddItemToInventory(itemType: Item.Type): void {
        let itemInInventory = this.ItemsInInventory.FirstOrDefault(i => i.Type == itemType);
        if (itemInInventory == null) {
            this.ItemsInInventory.Add(__init(new BagItem(), { Amount: 1, Type: itemType }));
        }
    }
    public AddWeaponToInventory(itemType: WeaponItem.Type): void {
        let itemInInventory = this.WeaponsInInventory.FirstOrDefault(i => i.Type == itemType);
        if (itemInInventory == null)
            this.WeaponsInInventory.Add(__init(new BagWeapon(), { Type: itemType }));
    }
    public RemoveItemFromInventory(itemType: Item.Type, removeAll: boolean = false): void {
        let itemInInventory = this.ItemsInInventory.FirstOrDefault(i => i.Type == itemType);
        if (itemInInventory == null)
            throw new ArgumentException(string.Format("Item is not in inventory while trying to remove an item: {0}", itemType));
        if (itemInInventory.Amount > 1 && !removeAll)
            itemInInventory.Amount--;
        else {
            if (this.SelectedItem.Type == itemType)
                this.SelectedItem = null;
            this.ItemsInInventory.Remove(itemInInventory);
        }
    }
    public LoadRoom(id: number): void {
        let objectsToRemove = this.GameObjects.Where(o => {
            return !o.ExtendedProperty<boolean>(GameModel.PROPERTY_KEEP_AT_ROOMSWITCH);
        }).ToList();
        objectsToRemove.ForEach(o => this.Remove(o));
        this.CurrentRoom = RoomFactory.LoadRoom(id);
        this.CurrentRoom.InitRoom();
    }
}

export enum GameState {
    None,

    Editor,

    Prelude,

    Story,

    TitleScreen,

    Tutorial,

    GameStart1,

    GameStart2,

    GameStartFromGameOver,

    Game,

    Event,

    F1,

    EndDemo,

    GameOver
}

export enum GameSubstate {
    Default,

    Conversation,

    BelmontDies,

    ItsCurtainsForYou,

    ToEndDemo,

    GameOver,

    IngameMenu,

    GameMenu,

    SwitchRoom
}

export enum Chapter {
    Debug,

    Prologue,

    Chapter_0,

    GameStart
}

/*[Serializable]*/
export class BagItem {
    public Type: Item.Type;
    public Amount: number;
}

/*[Serializable]*/
export class BagWeapon {
    public Type: WeaponItem.Type;
}

/*[Serializable]*/
export class Location {
    public RoomID: number;
    public Pos: Point;
}

export enum Switch {
    None = 0,
    Dummy,
    GameStart,
    Room1Aanloop,
    Room1GebouwUitleg,
    VijandenUitRaam,
    SchuurSleutelGevonden,
    PraatOverTroep,
    NaarEindbaas,
    WaterEnBroodGevonden,
    WaterEnBroodGegeven,
    VillaSleutelGevonden,

    Ch0_Chapter0Intro,

    Ch0_LigpietOnderzocht,

    Ch0_SpeelgoedOntdekt,

    Ch0_KruidnootschieterGevonden,

    Ch0_SleutelGevonden,

    Ch0_SpeelgoedOntdekt2,

    Ch0_BossIntro,

    Ch0_LangVerhaal
}
export enum CombatType {
    Encounter,
    Boss
}
export enum MainWeaponType {
    None = 0,
    TriRoe
}
export enum SecWeaponType {
    None = 0,
    Cross
}
