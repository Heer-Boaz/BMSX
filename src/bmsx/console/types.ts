import type { vec2 } from '../rompack/rompack';
import type { BmsxConsoleApi } from './api';

export interface BmsxConsoleMetadata {
	title: string;
	version: string;
	persistentId: string;
}

export interface BmsxConsoleCartridge {
	readonly meta: BmsxConsoleMetadata;
	init(api: BmsxConsoleApi): void;
	update(api: BmsxConsoleApi, deltaSeconds: number): void;
	draw(api: BmsxConsoleApi): void;
}

export const enum BmsxConsoleButton {
	Left = 0,
	Right = 1,
	Up = 2,
	Down = 3,
	ActionO = 4,
	ActionX = 5,
}

export const BmsxConsoleButtonCount: number = 6;

export type ConsoleViewport = {
	width: number;
	height: number;
};

export type ConsoleModuleOptions = {
	playerIndex: number;
	viewport: ConsoleViewport;
	moduleId: string;
};

export type Vector2 = vec2;
