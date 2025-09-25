import { Component, type ComponentAttachOptions } from '../component/basecomponent';
import type { vec3 } from '../rompack/rompack';
import { insavegame } from '../serializer/serializationhooks';
import type { color, RenderLayer } from '../render/gameview';
import type { BFont } from '../core/font';

@insavegame
export class TextComponent extends Component {
	public text: string | string[] = '';
	public color?: color;
	public backgroundColor?: color;
	public layer: RenderLayer = 'ui';
	public offset: vec3 = { x: 0, y: 0, z: 950 };
	/** Optional explicit font. If undefined, view.default_font is used. */
	public font?: BFont;
	/** Optional character-wrap; when set and text is a string, wraps into lines of at most this many chars. */
	public wrapChars?: number;
	/** Optional simple center alignment within a block of this width (pixels). Used with charWidth to compute an offset. */
	public centerBlockWidth?: number;
	/** Character width hint (pixels) used for simple centering; defaults to 8 when not provided. */
	public charWidth?: number;
	// Optional: future font override
	// public font?: BFont;

	constructor(opts: ComponentAttachOptions & { text?: string | string[] }) {
		super(opts);
		if (opts?.text !== undefined) this.text = opts.text;
	}
}
