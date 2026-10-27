import type { Blua32SourceImage } from '../runtime/sources';
import type { Blua32CartridgeEntry } from '../runtime/lua_pipeline';

/** Capture command context before a save prompt or asynchronous build changes focus. */
export type EditorActionRequest =
	| { readonly action: 'hot-resume' | 'reboot' | 'close' | 'theme-toggle' }
	| { readonly action: 'run'; readonly entry: Blua32CartridgeEntry; readonly expectedImage: Blua32SourceImage };
