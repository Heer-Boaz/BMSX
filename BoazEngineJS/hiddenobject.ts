import { IGameObject, Point } from "../lib/interfaces";

export abstract class HiddenObject implements IGameObject {
	pos: Point;
	id: string;
	disposeFlag: boolean;
	extendedProperties: Map<string, any>;

	abstract takeTurn(): void;
	abstract spawn: ((spawningPos?: Point) => void) | (() => void);
	abstract dispose(): void;

	public static [Symbol.hasInstance](o: any): boolean {
		return o && !o.paint;
	}
}