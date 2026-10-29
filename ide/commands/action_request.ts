import type { Blua32SourceImage } from '../runtime/sources';
import type { Blua32CartridgeEntry } from '../runtime/lua_pipeline';

/** Command-owned presentation authority survives its own prompts, not another editor activation. */
export type EditorActionPresentation = { isCurrent(): boolean };

/** Capture command context before a save prompt or asynchronous build changes focus. */
export type EditorActionRequest =
	| { readonly action: 'close' | 'theme-toggle' }
	| { readonly action: 'hot-resume'; readonly presentation?: EditorActionPresentation }
	| { readonly action: 'reboot'; readonly presentation?: EditorActionPresentation }
	| { readonly action: 'run'; readonly entry: Blua32CartridgeEntry; readonly expectedImage: Blua32SourceImage;
		readonly selectionRequest: number; readonly presentation?: EditorActionPresentation };
