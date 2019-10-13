import { Animation, AniStepCompoundValue } from "../BoazEngineJS/animation"
import { setPoint } from "../BoazEngineJS/common";
import { BitmapId } from "./resourceids";
import { GameController as C } from "./gamecontroller";

export enum State {
	WaitForIt,
	Konami,
	TitleTop,
	TitleBottom,
	WaitForItAgain,
	Other
}

export class Title {
	private static titleTopY: number = 16;
	private static titleBottomY: number = 41;
	private static titleTopStartX: number = -216;
	private static titleBottomStartX: number = 256;
	private static titleTopEndX: number = 24;
	private static titleBottomEndX: number = 64;
	private static deltaX: number = 8;
	private static waitFrames: number = 50;
	private static waitKonamiFrames: number = 100;
	private static konamiX: number = 76;
	private static konamiY: number = 103;
	private titleTopPos: Point;
	private titleBottomPos: Point;
	private static titleStates: State[] = new Array(State.WaitForIt, State.Konami, State.TitleTop, State.TitleBottom, State.WaitForItAgain, State.Other);
	private static titleMoves: number[] = new Array(Title.waitFrames, Title.waitKonamiFrames, -Title.titleTopStartX + Title.titleTopEndX, Title.titleBottomStartX - Title.titleBottomEndX, Title.waitFrames, 0);
	private titleAni: Animation<State>;
	private state: State;

	constructor() {
		this.titleAni = new Animation<State>(Title.titleStates, Title.titleMoves);
		this.titleTopPos = <Point>{ x: 0, y: 0 };
		this.titleBottomPos = <Point>{ x: 0, y: 0 };
	}

	public Init(): void {
		this.reset();
	}

	private reset(): void {
		setPoint(this.titleTopPos, Title.titleTopStartX, Title.titleTopY);
		setPoint(this.titleBottomPos, Title.titleBottomStartX, Title.titleBottomY);
		this.titleAni.restart();
		this.state = this.titleAni.stepValue();
	}

	public TakeTurn(): void {
		let newState: AniStepCompoundValue<State> = { nextStepValue: <State>this.state };
		if (I.KeyState.KC_SPACE) {
			C._.PreludeFinished();
			I.KeyState.KC_SPACE = false;
			return
		}

		switch (this.state) {
			case State.WaitForIt:
			case State.WaitForItAgain:
				if (this.titleAni.doAnimation(1, newState)) {
					this.state = newState.nextStepValue;
				}
				break;

			case State.Konami:
				if (this.titleAni.doAnimation(1, newState)) {
					this.state = newState.nextStepValue;
				}
				break;

			case State.TitleTop:
				if ((G._.bxlib.TurnCounter & 1) == 0) {
					this.titleTopPos.x += Title.deltaX;
					if (this.titleAni.doAnimation(<number>Title.deltaX, newState)) {
						this.state = newState.nextStepValue;
					}
				}
				break;

			case State.TitleBottom:
				if ((G._.bxlib.TurnCounter & 1) == 0) {
					this.titleBottomPos.x -= Title.deltaX;
					if (this.titleAni.doAnimation(<number>Title.deltaX, newState)) {
						this.state = newState.nextStepValue;
					}
				}
				break;

			case State.Other:
				C._.PreludeFinished();
				break;
		}
	}

	public Paint(): void {
		BDX._.DrawBitmap(<number>BitmapId.TitelBoven, this.titleTopPos.x, this.titleTopPos.y);
		BDX._.DrawBitmap(<number>BitmapId.TitelOnder, this.titleBottomPos.x, this.titleBottomPos.y);
		if (this.state != State.WaitForIt)
			BDX._.DrawBitmap(<number>BitmapId.TitelKonami, Title.konamiX, Title.konamiY);
	}
}