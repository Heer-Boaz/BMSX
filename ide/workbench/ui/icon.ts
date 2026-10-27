/** UI symbols have their own pixel geometry; changing a text font never changes their meaning. */
export const WORKBENCH_ICON_SIZE = 7;

export type WorkbenchIcon = 'pin' | 'unpin' | 'close' | 'minimize' | 'maximize' | 'restore'
	| 'play' | 'pause' | 'stepBack' | 'stepForward' | 'present' | 'accept' | 'back'
	| 'source' | 'more' | 'info' | 'legend' | 'grid' | 'filter' | 'actor' | 'follow' | 'chevronRight' | 'chevronDown'
	| 'copy' | 'refresh' | 'menu';
