import { Component } from './basecomponent';
import type { Identifier } from 'bmsx/rompack/rompack';
import { insavegame, excludepropfromsavegame, type RevivableObjectArgs } from 'bmsx/serializer/serializationhooks';
import type { RenderSubmitQueue, ImgRenderSubmission, RectRenderSubmission, PolyRenderSubmission, MeshRenderSubmission, ParticleRenderSubmission, color, GlyphRenderSubmission } from 'bmsx/render/gameview';
import type { RenderSubmission } from 'bmsx/render/gameview';
import type { WorldObject } from 'bmsx/core/object/worldobject';
import { onload } from 'bmsx/serializer/serializationhooks';
import { calculateCenteredBlockX, renderGlyphs, wrapGlyphs } from 'bmsx/render/glyphs';
import type { BFont } from 'bmsx/core/font';
import { $ } from 'bmsx/core/game';

export type RenderProducer = (ctx: { parent: WorldObject; rc: CustomVisualComponent }) => void;

/**
 * GenericRendererComponent: a flexible, non-unique renderer buffer you can attach
 * to any WorldObject. Other components or systems enqueue draw submissions on it;
 * the PreRender system calls flush() once per frame to submit them.
 */
@insavegame
export class CustomVisualComponent extends Component {
	// @excludepropfromsavegame
	// private ops: RenderSubmission[] = [];
	@excludepropfromsavegame
	private producer?: RenderProducer;

	constructor(opts: RevivableObjectArgs & { parentid: Identifier, producer?: RenderProducer }) {
		super(opts);
		this.producer = opts.producer;
	}

	@onload
	public onload(): void {
		// this.ops = []; // Ensure that ops is always initialized
	}

	public submit = (op: RenderSubmission): void => { $.view.renderer.submit.typed(op); };
	public submitSprite = (desc: ImgRenderSubmission): void => { $.view.renderer.submit.sprite(desc); };
	public submitRect = (desc: RectRenderSubmission): void => { $.view.renderer.submit.rect(desc); };
	public submitPoly = (desc: PolyRenderSubmission): void => { $.view.renderer.submit.poly(desc); };
	public submitMesh = (desc: MeshRenderSubmission): void => { $.view.renderer.submit.mesh(desc); };
	public submitParticle = (desc: ParticleRenderSubmission): void => { $.view.renderer.submit.particle(desc); };

	/** Convenience: write text using the current renderer and default font (with simple layout options). */
	public submitGlyphs = (opts: GlyphRenderSubmission): void => { $.view.renderer.submit.glyphs(opts); };

	/** Enqueue a pre-typed submission (least overhead). */
	// public submit(op: RenderSubmission): void { this.ops.push(op); }

	// /** Convenience: enqueue a sprite submission. */
	// public submitSprite(desc: ImgRenderSubmission): void { this.ops.push({ type: 'img', ...desc }); }
	// /** Convenience: enqueue a rectangle (stroke/fill) submission. */
	// public submitRect(desc: RectRenderSubmission): void { this.ops.push({ type: 'rect', ...desc }); }
	// /** Convenience: enqueue a polygon submission. */
	// public submitPoly(desc: PolyRenderSubmission): void { this.ops.push({ type: 'poly', ...desc }); }
	// /** Convenience: enqueue a mesh submission. */
	// public submitMesh(desc: MeshRenderSubmission): void { this.ops.push({ type: 'mesh', ...desc }); }
	// /** Convenience: enqueue a particle submission. */
	// public submitParticle(desc: ParticleRenderSubmission): void { this.ops.push({ type: 'particle', ...desc }); }

	// public get queuedOpsCount(): number { return this.ops.length; }

	/** Allow setting/replacing the render producer function. If a producer already exists, compose them. */
	public addProducer(fn: RenderProducer | undefined): void {
		if (!fn) { this.producer = undefined; return; }
		const prev = this.producer;
		this.producer = prev ? ((ctx) => { prev(ctx); fn(ctx); }) : fn;
	}

	/** Submit accumulated ops into the current frame's renderer and clear the buffer. */
	public flush(_queue: RenderSubmitQueue): void {
		// Let the producer enqueue ops first (migration path for legacy rendering logic)
		if (this.producer) {
			const parent = this.parentAs<WorldObject>();
			if (parent) this.producer({ parent, rc: this });
		}

		// for (let i = 0; i < this.ops.length; i++) {
		// 	queue.submit.typed(this.ops[i]);
		// }
		// this.reset();
	}

	/** Clear any queued ops without submitting. Useful on deactivation. */
	// public reset(): void { this.ops.length = 0; }
}
