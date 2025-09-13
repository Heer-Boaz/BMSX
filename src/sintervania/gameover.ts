import { Model } from "./gamemodel";
import { Direction, Point } from "bmsx/common";
import { TextWriter } from "./textwriter";
import { $, model, WorldObject, controller, new_area3d, new_vec3 } from 'bmsx';
import { AudioId, BitmapId } from "./resourceids";
import { Input } from "bmsx/input";
import { SM as S, SM } from "bmsx/soundmaster";
import { Controller } from "./gamecontroller";
import { MenuItem } from "./mainmenu";
import { Msx1Colors } from "bmsx/msx";

export const enum State {
	SelectContOrLoad,
	SelectFile
}

export class GameOver implements WorldObject {
	id: string = 'gameover';
	disposeFlag: boolean;
	z: number = 500;
	pos: Point;
	visible: boolean = true;

	private selectedIndex: number;
	private state: State;
	private static items: string[] = new Array("Start bij controlepunt", "Laad spel");
	private static itemYs: number[] = new Array(112, 128);
	private static itemsX: number = 48;
	private static cursorPosX: number = 36;
	private static boxX: number = GameOver.cursorPosX - 8;
	private static boxY: number = 104;
	private static boxEndX: number = GameOver.boxX + 176 + 32;
	private static boxEndY: number = GameOver.boxY + 24 + 16;

	private get cursorX(): number {
		return GameOver.cursorPosX;
	}

	private get cursorY(): number {
		return GameOver.itemYs[this.selectedIndex];
	}

	constructor() {
		this.reset();
	}

	public reset(): void {
		this.selectedIndex = 0;
		this.state = State.SelectContOrLoad;
	}

	public HandleInput(): void {
		let selectionChanged: boolean = false;
		if (Input.KC_UP)
			this.changeSelection('up', selectionChanged);
		else if (Input.KC_RIGHT)
			this.changeSelection('right', selectionChanged);
		else if (Input.KC_DOWN)
			this.changeSelection('down', selectionChanged);
		else if (Input.KC_LEFT)
			this.changeSelection('left', selectionChanged);
		if (Input.KC_SPACE) {
			switch (this.state) {
				case State.SelectContOrLoad:
					switch (this.selectedIndex) {
						case 0:
							(controller as Controller).LoadCheckpoint();
							break;
						case 1:
							SM.play(AudioId.Selectie);
							Input.reset();
							(model as Model).GameMenu.Open(MenuItem.LoadFromGameOver);
							this.state = State.SelectFile;
							break;
					}
					break;
				case State.SelectFile:
					break;
			}
		}
		if (selectionChanged) {
			S.play(AudioId.Selectie);
		}
	}

	private changeSelection(dir: Direction, selectionChanged: boolean): void {
		if (this.state == State.SelectFile)
			return
		switch (dir) {
			case 'up':
				if (this.selectedIndex > 0) {
					this.selectedIndex = 0;
					selectionChanged = true;
				}
				break;
			case 'down':
				if (this.selectedIndex < 1) {
					this.selectedIndex = 1;
					selectionChanged = true;
				}
				break;
		}
	}

	public run(): void {

	}

	public paint(): void {
		$.drawGlyphs(60, 56, ["Je bent vernederd!"]);
		$.drawGlyphs(32, 80, ["Wat ga je doen, Ronan?"]);
		$.view.renderer.submit.rect({ area: new_area3d(GameOver.boxX, GameOver.boxY, 0, GameOver.boxEndX, GameOver.boxEndY, 0), color: Msx1Colors[15], layer: 'ui' });
		for (let i = 0; i < GameOver.items.length; i++)
			$.drawGlyphs(GameOver.itemsX, GameOver.itemYs[i], [GameOver.items[i]]);
		$.view.drawImg({ imgid: BitmapId.MenuCursor, pos: new_vec3(this.cursorX, this.cursorY, 0), layer: 'ui' });
	}

	public GameMenuClosed(): void {
		this.reset();
	}
}
