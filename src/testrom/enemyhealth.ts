import { $ } from 'bmsx';
import { Component, componenttags_postprocessing } from 'bmsx';
import type { color_arr } from 'bmsx';
import type { ComponentAttachOptions } from 'bmsx/component/basecomponent';
import { insavegame } from 'bmsx';

@insavegame
@componenttags_postprocessing('enemy_post')
export class EnemyHealthComponent extends Component {
	hp: number; maxHp: number; scoreValue: number;
	diedAt: number | null = null;
	despawnDelay = 1.2;
	flashTimer = 0;
	private flashDur = 0.15;
	private originalColors?: color_arr[][]; // per mesh index may contain multiple stored originals if multi-mesh
	boss = false;
	constructor(opts: ComponentAttachOptions & { hp?: number, maxHp?: number, scoreValue?: number, boss?: boolean }) {
		super(opts);
		this.hp = opts.hp ?? 20;
		this.maxHp = opts.hp ?? 20;
		this.scoreValue = opts.scoreValue ?? 50;
		this.boss = !!opts?.boss;
	}
	applyDamage(d: number) {
		if (this.dead) return; this.hp -= d; if (this.hp < 0) this.hp = 0; this.flashTimer = this.flashDur; if (this.dead && this.diedAt == null) this.diedAt = $.platform.clock.now() / 1000;
	}
	get dead() { return this.hp <= 0; }
	override postprocessingUpdate(): void {
		// Handle damage flash tint (temporarily lerp base color toward flash color then restore)
		if (this.flashTimer > 0) {
			this.flashTimer -= $.deltatime_seconds;
			const wo = this.is_attached ? this.parent : undefined;
			if (wo && 'meshes' in wo) {
				const meshObj = wo as { meshes: { material?: { color: color_arr; }; }[] };
				// Capture originals once at flash start
				if (!this.originalColors) {
					this.originalColors = meshObj.meshes.map(m => m.material ? [[...m.material.color]] : []);
				}
				const t = 1 - Math.max(0, this.flashTimer) / this.flashDur; // 0..1 progression
				const ease = t * (2 - t); // easeOutQuad
				const flash = [1, 0.3, 0.2, 1] as const; // reddish flash
				meshObj.meshes.forEach((m, i) => {
					const mat = m.material; if (!mat) return;
					const origArr = this.originalColors?.[i]?.[0];
					const o = origArr ?? mat.color;
					// Lerp each channel (alpha preserved from original)
					mat.color[0] = o[0] + (flash[0] - o[0]) * (1 - ease); // stronger at start then ease back
					mat.color[1] = o[1] + (flash[1] - o[1]) * (1 - ease);
					mat.color[2] = o[2] + (flash[2] - o[2]) * (1 - ease);
					mat.color[3] = o[3];
				});
			}
		} else if (this.originalColors) {
			const wo = this.is_attached ? this.parent : undefined;
			if (wo && 'meshes' in wo) {
				const meshObj = wo as { meshes: { material?: { color: color_arr; }; }[] };
				meshObj.meshes.forEach((m, i) => { const mat = m.material; const o = this.originalColors?.[i]?.[0]; if (mat && o) { mat.color[0] = o[0]; mat.color[1] = o[1]; mat.color[2] = o[2]; mat.color[3] = o[3]; } });
			}
			this.originalColors = undefined; // clear cache after restore
		}
		if (this.dead && this.diedAt) {
			const t = $.platform.clock.now() / 1000 - this.diedAt;
			if (t > this.despawnDelay) {
				const wo = this.is_attached ? this.parent : undefined;
				wo?.dispose();
			}
		}
	}
}
