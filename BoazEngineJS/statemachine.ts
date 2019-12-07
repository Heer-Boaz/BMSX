import { Point, IGameObject, IRenderObject } from './interfaces';

export interface anidata<A extends any | null | {}> {
	delta: number;
	data: A;
}

export type str2bst<T extends object> = { [key: string]: bst<T>; };
export type runhandle<T extends object> = (_state: bst<T>, ...input: any[]) => any;
export type bsfthandle<T extends object> = (_state: bst<T>) => void;
export type numstring = number | string;

// export function animatepos(st: bst<IRenderObject, anidata<Point>>, delta: number): void {
// 	st.delta2tapehead += delta;
// 	if (st.delta2tapehead >= st.currentdata.delta) {
// 		st.delta2tapehead = 0;
// 		++st.tapehead;
// 		if (st.endoftape) {
// 			st.ontapeend && st.tapeend();
// 		}
// 		else {
// 			st.target.pos.x += st.currentdata.data.x;
// 			st.target.pos.y += st.currentdata.data.y;
// 		}
// 	}
// }

// export function resetAnimationOnTapeEnd(st: bst<IGameObject, anidata<Point>>): void {
// 	st.tapehead = 0;
// }

export class bst<T extends object>{
	public bsm: bst<T>;
	public target: T;
	public tapedata: any[];

	protected _tapehead: number;
	public get tapehead(): number {
		return this._tapehead;
	}
	public set tapehead(v: number) {
		this._tapeheadnudges = 0;
		this._tapehead = v;
		this.tapeheadmove();
		if (this.tapedata) {
			if (this._tapehead >= this.tapedata.length - 1)
				this.tapeend();
		}
	}

	public setTapeheadNoEvent(v: number) {
		this._tapehead = v;
	}

	public setTapeheadNudgesNoEvent(v: number) {
		this._tapeheadnudges = v;
	}

	protected _tapeheadnudges: number;
	public get tapeheadnudges(): number {
		return this._tapeheadnudges;
	}
	public set tapeheadnudges(v: number) {
		this._tapeheadnudges = v;
		if (v >= this.delta2tapehead) {
			this._tapeheadnudges = 0;
			++this.tapehead;
		}
	}

	public get currentdata(): any { return (this.tapedata && this.tapehead < this.tapedata.length) ? this.tapedata[this.tapehead] : undefined; };
	public delta2tapehead: number; // Number of runs before tapehead moves to next statedata

	protected initstateid: numstring = 0;

	public states: str2bst<T>; // Note that numbers will be automatically converted to strings!
	public id: numstring;
	public currentid: numstring; // Identifier of current state
	public isfinal: boolean;
	public halted: boolean;
	public onrun: runhandle<T>;
	public onfinalstate: bsfthandle<T>;
	public ontapeend: bsfthandle<T>;
	public ontapeheadmove: bsfthandle<T>;
	public oninitstate: bsfthandle<T>;
	public onexitstate: bsfthandle<T>;
	public get endoftape(): boolean { return !this.tapedata || this.tapehead === this.tapedata.length - 1; }
	public get startoftape(): boolean { return this.tapehead === 0; }
	public get hasstates(): boolean { return this.states !== undefined; }
	public get iscomposite(): boolean { return this.states !== undefined; }
	public get internalstate() { return { statedata: this.tapedata, tapehead: this.tapehead }; }
	public get current(): bst<T> { return this.states?.[this.currentid]; };

	constructor(_target: T, _id: numstring = 0, _composite = false, _final = false) {
		if (_composite) this.states = {};
		this.target = _target;
		this.id = _id;
		this.isfinal = _final;
		this.delta2tapehead = 1;
		this.halted = false;
		this.reset();
	}

	public setStartState(_id: numstring, init = true) {
		this.initstateid = _id;
		this.currentid = _id;
		if (init) this.current.oninitstate?.(this.current);
	}

	public addNewState(_id: numstring, _composite = false, _final = false): bst<T> {
		if (this.states[_id]) throw new Error(`State ${_id} already exists for state machine!`);
		let result = new bst<T>(this.target, _id, _composite, _final);
		this.states[_id] = result;
		result.bsm = this;
		return result;
	}

	public addState(s: bst<T>): void {
		if (this.states[s.id]) throw new Error(`State ${s.id} already exists for state machine!`);
		this.states[s.id] = s;
		s.bsm = this;
	}

	public run(...input: any[]) {
		if (this.halted) return;
		let state_to_run = this.current ?? this;
		let result = state_to_run.onrun?.(state_to_run, input);
		if (state_to_run.isfinal) state_to_run.onfinalstate?.(state_to_run);
		return result;
	}

	public tapeheadmove() {
		this.ontapeheadmove?.(this);
	}

	public tapeend() {
		this.ontapeend?.(this);
	}

	public transition(newstate: numstring): void {
		this.current.onexitstate?.(this.current);
		this.currentid = newstate;
		this.current.oninitstate?.(this.current);
	}

	public transitionSM(newstate: numstring): void {
		this.bsm.transition(newstate);
	}

	public reset(): void {
		this.currentid = this.initstateid;
		this._tapehead = 0;
		this._tapeheadnudges = 0;
		this.halted = false;
	}

	public append(_state: bst<T>, _id: numstring): void {
		this.states[_id] = _state;
	}

	public remove(_id: numstring): void {
		delete this.states[_id];
	}
}