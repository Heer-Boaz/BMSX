import { insavegame, type RevivableObjectArgs } from '../serializer/serializationhooks';
import { WorldObject } from '../core/object/worldobject';
import { $, } from '../core/engine_core';
import { ZCOORD_MAX } from '../render/backend/webgl/webgl.constants';
import { BFont } from '../core/font';
import type { RenderProducerContext } from '../component/customvisual_component';


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
		this.getOrCreateCustomRenderer().add_producer(this.yeOldePaint);
	}

	override onspawn(): void {
		super.onspawn();
		this.createdAt = $.platform.clock.now();
	}

	private yeOldePaint({ parent, rc }: RenderProducerContext): void {
		const toast = parent as Toast;
		const now = $.platform.clock.now();
		const t = now - toast.createdAt;
		// TODO: PRETTY UGLY TO NOT USE A (SIMPLE) STATE MACHINE FOR THIS
		if (t >= toast.ms) { toast.mark_for_disposal(); return null; } // time's up
		const vp = $.view.viewportSize;
		const centerX = vp.x / 2;
		const topY = 12;
		const alpha = t < 200 ? t / 200 : (t > toast.ms - 300 ? (toast.ms - t) / 300 : 1);
		const padX = 8, padY = 4;
		const font = toast.font ?? $.view.default_font;
		const textWidth = font.textWidth(toast.text) + 2 * padX;
		const rect = { area: { left: centerX - textWidth / 2 - padX, top: topY - padY, right: centerX + textWidth / 2 + padX, bottom: topY + 10 + padY, z: toast.z }, color: { r: 0, g: 0, b: 0, a: 0.85 * alpha } };
		rc.submit_glyphs({ x: centerX - textWidth / 2, y: topY, glyphs: toast.text, z: toast.z, color: { r: 255, g: 255, b: 255, a: Math.max(0, Math.min(1, alpha)) } });
		rc.submit_rect({ ...rect, layer: 'ui', kind: 'fill' });
	}
}

export function spawnToast(text: string, font?: BFont, ms?: number): void {
	const o = new Toast({ text, font, ms });
	const uiSpace = $.world.getSpace('ui');
	if (!uiSpace) throw new Error('[UIToast] UI space not found while showing toast.');
	uiSpace.spawn(o);
}

export function controllerUnassignedToast(): void {
	spawnToast('Controller unassigned');
}
