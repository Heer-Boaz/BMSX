import { clamp } from '../../common/clamp';
import type { SpriteParallaxRig } from '../shared/render_types';

export const spriteParallaxRig: SpriteParallaxRig = {
	vy: 0,
	scale: 1,
	impact: 0,
	impact_t: 0,
	bias_px: 0,
	parallax_strength: 1,
	scale_strength: 1,
	flip_strength: 0,
	flip_window: 0.6,
};

export function setSpriteParallaxRigValues(vy: number, scale: number, impact: number, impact_t: number, bias_px: number, parallax_strength: number, scale_strength: number, flip_strength: number, flip_window: number): void {
	if (flip_window <= 0) {
		throw new Error(`[Sprite Pipeline] setSpriteParallaxRig requires flip_window > 0, got ${flip_window}.`);
	}
	spriteParallaxRig.vy = vy;
	spriteParallaxRig.scale = scale;
	spriteParallaxRig.impact = impact;
	spriteParallaxRig.impact_t = impact_t;
	spriteParallaxRig.bias_px = bias_px;
	spriteParallaxRig.parallax_strength = parallax_strength;
	spriteParallaxRig.scale_strength = scale_strength;
	spriteParallaxRig.flip_strength = flip_strength;
	spriteParallaxRig.flip_window = clamp(flip_window, 0.0001, Number.POSITIVE_INFINITY);
}
