export type ChromeRenderContext = {
	readonly viewportWidth: number;
	readonly headerHeight: number;
	readonly lineHeight: number;
	readonly tabBarHeight: number;
	measureText(text: string): number;
	drawText(text: string, x: number, y: number, z: number, color: number): void;
};
