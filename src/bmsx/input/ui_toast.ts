import { insavegame, type RevivableObjectArgs } from 'bmsx/serializer/serializationhooks';
import { WorldObject } from '../core/object/worldobject';
import { $, } from '../core/game';
import { ZCOORD_MAX } from '../render/backend/webgl/webgl.constants';
import { BFont } from '../core/font';
import { id_to_space_symbol } from 'bmsx/core/space';
import type { RenderProducerContext } from 'bmsx/component/customvisual_component';

const TOAST_DURATION = 1800;

@insavegame
class Toast extends WorldObject {
	private createdAt: number = 0;
	private text: string;
	private font?: BFont;
	private ms: number;

	constructor(opts: RevivableObjectArgs & { text: string; font?: BFont; ms?: number }) {
		super(opts);
		this.z = ZCOORD_MAX; // draw on top
		this.text = opts.text;
		this.font = opts.font;
		this.ms = opts.ms ?? TOAST_DURATION;
		this.getOrCreateCustomRenderer().addProducer(this.yeOldePaint);
	}

	override onspawn(): void {
		super.onspawn();
		this.createdAt = performance.now();
	}

	private yeOldePaint({ rc }: RenderProducerContext): void {
		const now = performance.now();
		const t = now - this.createdAt;
		// TODO: PRETTY UGLY TO NOT USE A (SIMPLE) STATE MACHINE FOR THIS
		if (t >= this.ms) { this.markForDisposal(); return null; } // time's up
		const vp = $.view.viewportSize;
		const centerX = vp.x / 2;
		const topY = 12;
		const alpha = t < 200 ? t / 200 : (t > this.ms - 300 ? (this.ms - t) / 300 : 1);
		const padX = 8, padY = 4;
		const font = this.font ?? $.view.default_font;
		const textWidth = font.textWidth(this.text) + 2 * padX;
		const rect = { area: { start: { x: centerX - textWidth / 2 - padX, y: topY - padY, z: this.z }, end: { x: centerX + textWidth / 2 + padX, y: topY + 10 + padY, z: this.z } }, color: { r: 0, g: 0, b: 0, a: 0.85 * alpha } };
		rc.submitGlyphs({ x: centerX - textWidth / 2, y: topY, glyphs: this.text, z: this.z, color: { r: 255, g: 255, b: 255, a: Math.max(0, Math.min(1, alpha)) } });
		rc.submitRect({ ...rect, layer: 'ui', kind: 'fill' });
	}
}

export function spawnToast(text: string, font?: BFont, ms?: number): void {
	const o = new Toast({ text, font, ms });
	$.world[id_to_space_symbol]['ui'].spawn(o);
}

export function controllerUnassignedToast(): void {
	spawnToast('Controller unassigned');
}
