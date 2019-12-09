import { IGameObject, Point } from "../lib/interfaces";

export abstract class BaseModel {
    public id2object: Map<string, IGameObject>;
    public objects: IGameObject[];
    public gameState: number;
    public gameSubstate: number;
    public gameOldState: number;
    public gameOldSubstate: number;
    public paused: boolean;
    public startAfterLoad: boolean;

    public get OldState(): number {
        return this.gameOldState;
    }

    public set OldState(value: number) {
        this.gameOldState = value;
    }

    public get State(): number {
        return this.gameState;
    }

    public set State(value: number) {
        this.gameState = value;
    }

    public get OldSubstate(): number {
        return this.gameOldSubstate;
    }

    public set OldSubstate(value: number) {
        this.gameOldSubstate = value;
    }

    public get Substate(): number {
        return this.gameSubstate;
    }

    public set Substate(value: number) {
        this.gameSubstate = value;
    }

    constructor() {
        this.objects = [];
        this.id2object = new Map<string, IGameObject>();
        this.gameState = 0;
        this.gameSubstate = 0;
        this.paused = false;
    }

    public abstract InitModelForGameStart(): void;

    public clearModel(): void {
        this.objects.forEach(o => {
            o.dispose();
        });
        this.objects.length = 0;
        this.id2object.clear();
        this.paused = false;
    }

    public spawn(o: IGameObject, pos?: Point, ifnotexists = false): void {
        if (ifnotexists && this.id2object.has(o.id)) return; // Don't add objects that already exist
        if (!o) throw new Error("Cannot spawn object of type null.");

        this.objects.push(o);

        this.objects.sort((o1, o2) => (o1.priority || 0) - (o2.priority || 0));

        if (o.id) this.id2object.set(o.id, o);
        if (pos) o.spawn(pos);
        else o.spawn(null);
    }

    public remove(o: IGameObject): void {
        if (!o) throw new Error("Cannot remove object of type null.");

        let index = this.objects.indexOf(o);
        if (index > -1) {
            delete this.objects[index];
            this.objects.splice(index, 1);
        }
        else throw new Error("Could not find object to remove.");

        if (o.id !== null && this.id2object.has(o.id)) this.id2object.delete(o.id);
        o.dispose();
    }
}
