import { Point, IGameObject, IRenderObject } from './interfaces';

export interface anidata<A extends any | null | {}> {
	delta: number;
	data: A;
}

export type str2bst<T extends object, A extends any | null> = { [key: string]: bst<T, A>; };
export type runhandle<T extends object, A extends any | null> = (_state: bst<T, A>, ...input: any[]) => any;
export type bsfthandle<T extends object, A extends any | null> = (_state: bst<T, A>) => void;
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

export class bst<T extends object, A extends any | null>{
	public parent: bst<T, A>;
	public target: T;
	public tapedata: A[];

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

	public get currentdata(): A { return (this.tapedata && this.tapehead < this.tapedata.length) ? this.tapedata[this.tapehead] : undefined; };
	public delta2tapehead: number; // Number of runs before tapehead moves to next statedata

	public static readonly initstateid = 0;

	public states: str2bst<T, A>; // Note that numbers will be automatically converted to strings!
	public id: numstring;
	public currentid: numstring; // Identifier of current state
	public isfinal: boolean;
	public onrun: runhandle<T, A>;
	public onfinalstate: bsfthandle<T, A>;
	public ontapeend: bsfthandle<T, A>;
	public ontapeheadmove: bsfthandle<T, A>;
	public oninitstate: bsfthandle<T, A>;
	public onexitstate: bsfthandle<T, A>;
	public get endoftape(): boolean { return !this.tapedata || this.tapehead === this.tapedata.length - 1; }
	public get startoftape(): boolean { return this.tapehead === 0; }
	public get hasstates(): boolean { return this.states !== undefined; }
	public get iscomposite(): boolean { return this.states !== undefined; }
	public get internalstate() { return { statedata: this.tapedata, tapehead: this.tapehead }; }
	public get current(): bst<T, A> { return this.states[this.currentid]; };
	public invoke(_state: bst<T, A>, f: runhandle<T, A> | bsfthandle<T, A>, ...args: any[]): any {
		return (!_state || !f) ? undefined : (args ? f(_state, args) : f(_state));
	}

	constructor(_target: T, _id: numstring = 0, _composite = false, _final = false) {
		if (_composite) this.states = {};
		this.target = _target;
		this.id = _id;
		this.isfinal = _final;
		this.delta2tapehead = 1;
		this.reset();
	}

	public addNewState(_id: numstring, _composite = false, _final = false): bst<T, A> {
		if (this.states[_id]) throw new Error(`State ${_id} already exists for state machine!`);
		let result = new bst<T, A>(this.target, _id, _composite, _final);
		this.states[_id] = result;
		result.parent = this;
		return result;
	}

	public addState(s: bst<T, A>): void {
		if (this.states[s.id]) throw new Error(`State ${s.id} already exists for state machine!`);
		this.states[s.id] = s;
		s.parent = this;
	}

	public run(...input: any[]) {
		let result = this.invoke(this.current, this.current.onrun, input);
		if (this.current.isfinal) this.invoke(this.current, this.current.onfinalstate);
		return result;
	}

	public tapeheadmove() {
		this.invoke(this, this.ontapeheadmove);
	}

	public tapeend() {
		this.invoke(this, this.ontapeend);
	}

	public transition(newstate: numstring): void {
		this.invoke(this.current, this.current.onexitstate);
		this.currentid = newstate;
		this.invoke(this.current, this.current.oninitstate);
	}

	public reset(): void {
		this.currentid = bst.initstateid;
		this._tapehead = 0;
		this._tapeheadnudges = 0;
	}

	public append(_state: bst<T, A>, _id: numstring): void {
		this.states[_id] = _state;
	}

	public remove(_id: numstring): void {
		delete this.states[_id];
	}
}