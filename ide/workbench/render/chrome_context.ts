import type { WorkbenchChromeLayout } from '../common/layout';

export type ChromeRenderContext = Omit<WorkbenchChromeLayout, 'measureText'> & {
	drawText(text: string, x: number, y: number, z: number, color: number): void;
};
