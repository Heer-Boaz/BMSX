import { Animation } from "./bmsx/animation"
import { Point } from "./bmsx/common";
import { BitmapId } from "./bmsx/resourceids";
import { view } from "./bmsx/engine";

export const enum State {
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
		// this.titleAni = new Animation<State>(Title.titleStates, Title.titleMoves);
		// this.titleTopPos = <Point>{ x: 0, y: 0 };
		// this.titleBottomPos = <Point>{ x: 0, y: 0 };
	}

	public Init(): void {
		// this.reset();
	}

	private reset(): void {
		// setPoint(this.titleTopPos, Title.titleTopStartX, Title.titleTopY);
		// setPoint(this.titleBottomPos, Title.titleBottomStartX, Title.titleBottomY);
		// this.titleAni.restart();
		// this.state = this.titleAni.stepValue;
	}

	public TakeTurn(): void {
	}

	public Paint(): void {
		view.drawImg(BitmapId.Title, 0, 0);
	}
}