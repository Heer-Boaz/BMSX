import { Foe } from "./foe";
import { Belmont } from "./belmont";
import { Savegame } from "../BoazEngineJS/savegame";
import { Model, GameState } from "../BoazEngineJS/model";
import { BStopwatch } from "../BoazEngineJS/btimer";
import { BossFoe } from "./bossfoe";
import { WeaponItem, WeaponType } from "./weaponitem";
import { GameConstants as CS } from "./gameconstants";
import { ItemType } from "./item";
import { GameMenu } from "./gamemenu";
import { Point, IGameObject } from "../BoazEngineJS/interfaces";
import { Room } from "./room";
import { RoomFactory } from "./RoomFactory";

declare module "../BoazEngineJS/model" {
    export enum GameState {
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
        Conversation,
        BelmontDies,
        ItsCurtainsForYou,
        ToEndDemo,
        GameOver,
        IngameMenu,
        GameMenu,
        SwitchRoom
    }
}

export enum Chapter {
    Debug,
    Prologue,
    Chapter_0,
    GameStart
}

export class BagItem {
    public Type: ItemType;
    public Amount: number;
}

export class BagWeapon {
    public Type: WeaponType;
}

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

export class GameModel extends Model {
    public Checkpoint: Savegame;
    public SelectedChapterToPlay: Chapter;
    public static PROPERTY_KEEP_AT_ROOMSWITCH: string = "p_rs";
    public static PROPERTY_ACT_AS_WALL: string = "p_wall";

    private static _instance: GameModel;
    static GameSubstate: any;
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
        let index = this.WeaponsInInventory.findIndex(bw => bw.Type == weaponItemInBagType);
        if (index == -1)
            return null;
        return GameModel._.WeaponsInInventory[index];
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
        this.objects = new Array<IGameObject>();
        this.Foes = new Array<Foe>();
        this.ItemsInInventory = new Array<BagItem>();
        this.WeaponsInInventory = new Array<BagWeapon>();
        this.Switches = new Map<Switch, boolean>();
        this.GameMenu = new GameMenu();
        this.id2object = new Map<string, IGameObject>();
        this.FoesDefeated = new Map<string, boolean>();
        this.ItemsPickedUp = new Map<string, boolean>();
        this.WeaponItemsPickedUp = new Map<string, boolean>();
        this.DoorsOpened = new Map<string, boolean>();
        this.MainWeaponCooldownTimer = BStopwatch.createWatch();
        this.SecWeaponCooldownTimer = BStopwatch.createWatch();
        RoomFactory.PrepareData();
    }

    public InitModelForGameStart(): void {
        GameModel._.BossBattle = false;
        GameModel._.RoomExitsLocked = false;
        GameModel._.Switches.clear();
        Object.keys(Switch).forEach(t => GameModel._.Switches[t] = false);
        GameModel._.ItemsInInventory.length = 0;
        GameModel._.WeaponsInInventory.length = 0;
        GameModel._.FoesDefeated.clear();
        GameModel._.ItemsPickedUp.clear();
        GameModel._.WeaponItemsPickedUp.clear();
        GameModel._.spawn(new Belmont());
    }

    public InitAfterGameLoad(): void {
    }

    public spawn(o: IGameObject): void {
        if (o instanceof Belmont) {
            if (this.objects.findIndex(ob => ob instanceof Belmont) > -1)
                throw ("There is already a Belmont in the game! \"There can be only one!\"");
            else GameModel._.Belmont = <Belmont>o;
        }

        let f: Foe = o as Foe;
        if (f) {
            if (!f.RespawnAtRoomEntry) {
                let wasDefeated: boolean;
                let exists: boolean = this.FoesDefeated.has(f.id) && this.FoesDefeated[f.id] == true;
                if (!exists) {
                    this.FoesDefeated.set(f.id, false);
                    wasDefeated = false;
                }
                if (!wasDefeated)
                    this.Foes.push(f);
                else return
            }
            else this.Foes.push(f);
        }
        super.spawn(o);
    }

    public FoeDefeated(f: Foe): void {
        if (f.RespawnAtRoomEntry) return;
        if (this.FoesDefeated.has(f.id) && this.FoesDefeated[f.id].defeated)
            this.FoesDefeated[f.id] = true;
        else this.FoesDefeated.set(f.id, true);
    }

    public GetFoeDefeated(id: string): boolean {
        return this.FoesDefeated.has(id) ? this.FoesDefeated[id] : false;
    }

    public get FoesPresentInCurrentRoom(): boolean {
        return this.Foes.length > 0;
    }

    public GetSwitchState(s: Switch): boolean {
        return this.Switches.has(s) ? this.Switches[s] : false;
    }

    public GetItemPickedUp(id: string): boolean {
        return this.ItemsPickedUp.has(id);
    }

    public DoorOpened(id: string): boolean {
        return this.DoorsOpened.has(id) ? true : false;
    }

    public AddItemToInventory(itemType: ItemType): void {
        let itemInInventory = this.ItemsInInventory.find(i => i.Type == itemType);
        if (!itemInInventory) {
            let newBagItem = new BagItem();
            newBagItem.Amount = 1;
            newBagItem.Type = itemType;
            this.ItemsInInventory.push(newBagItem);
        }
    }

    public AddWeaponToInventory(itemType: WeaponType): void {
        let itemInInventory = this.WeaponsInInventory.find(i => i.Type == itemType);
        if (!itemInInventory == null) {
            let newWeapon = new BagWeapon();
            newWeapon.Type = itemType;
            this.WeaponsInInventory.push(newWeapon);
        }
    }

    public RemoveItemFromInventory(itemType: ItemType, removeAll: boolean = false): void {
        let itemInInventory = this.ItemsInInventory.find(i => i.Type == itemType);
        if (!itemInInventory) throw `Item is not in inventory while trying to remove an item: ${itemType}`;
        if (itemInInventory.Amount > 1 && !removeAll)
            itemInInventory.Amount--;
        else {
            if (this.SelectedItem.Type == itemType)
                this.SelectedItem = null;

            let index = this.ItemsInInventory.indexOf(itemInInventory);
            if (index > -1) {
                delete this.ItemsInInventory[index];
                this.ItemsInInventory.splice(index, 1);
            }
        }
    }

    public LoadRoom(id: number): void {
        let objectsToRemove = this.objects.filter(o => {
            return <boolean>!o.extendedProperties[GameModel.PROPERTY_KEEP_AT_ROOMSWITCH];
        });
        objectsToRemove.forEach(o => this.remove(o));
        this.CurrentRoom = RoomFactory.LoadRoom(id);
        this.CurrentRoom.InitRoom();
    }
}
