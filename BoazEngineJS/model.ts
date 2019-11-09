import { IGameObject, Point } from "./interfaces";

export enum GameState { None = 0 }
export enum GameSubstate { Default = 0 }

export abstract class Model {
    public id2object: Map<string, IGameObject>;
    public objects: IGameObject[];
    public gameState: GameState;
    public gameSubstate: GameSubstate;
    public gameOldState: GameState;
    public gameOldSubstate: GameSubstate;
    public paused: boolean;
    public startAfterLoad: boolean;

    public get OldState(): GameState {
        return this.gameOldState;
    }

    public set OldState(value: GameState) {
        this.gameOldState = value;
    }

    public get State(): GameState {
        return this.gameState;
    }

    public set State(value: GameState) {
        this.gameState = value;
    }

    public get OldSubstate(): GameSubstate {
        return this.gameOldSubstate;
    }

    public set OldSubstate(value: GameSubstate) {
        this.gameOldSubstate = value;
    }

    public get Substate(): GameSubstate {
        return this.gameSubstate;
    }

    public set Substate(value: GameSubstate) {
        this.gameSubstate = value;
    }

    constructor() {
        this.initModelForGameStart();
    }

    public initModelForGameStart(): void {
        this.objects = [];
        this.id2object = new Map<string, IGameObject>();
        this.gameState = GameState.None;
        this.gameSubstate = GameSubstate.Default;
        this.paused = false;
    }

    public clearModel(): void {
        this.objects.forEach(x => {
            x.exile();
        });
        this.objects.length = 0;
        this.id2object.clear();
        this.paused = false;
    }

    public spawn(o: IGameObject, pos?: Point): void {
        if (o == null) throw ("Cannot spawn object of type null.");
        if (this.objects.indexOf(o) > -1) throw ("GameObject already exists in the game model!");

        this.objects.push(o);
        if (o.id != null)
            this.id2object[o.id] = o;
        if (pos) o.spawn(pos);
        else o.spawn(null);
    }

    public remove(o: IGameObject): void {
        if (o == null) throw new Error("Cannot remove object of type null.");

        let index = this.objects.indexOf(o);
        if (index > -1) {
            delete this.objects[index];
            this.objects.splice(index, 1);
        }
        else throw new Error("Could not find object to remove.");

        if (o.id != null && this.id2object.has(o.id)) this.id2object.delete(o.id);
    }
}
