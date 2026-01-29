import { $, assign_bt, assign_fsm, attach_components, BehaviorTreeDefinition, build_bt, build_fsm, insavegame, new_area, ProhibitLeavingScreenComponent, SpriteObject, StateMachineBlueprint, vec3, type RevivableObjectArgs } from 'bmsx';
import { mytree_builder } from './mytree_builder';
import { BitmapId } from './resourceids';
import { DerivedTestComponent, TestComponent } from './testcomponents';

@insavegame
@assign_fsm('bclass_animation', 'bclass_meuk')
@assign_bt('bclass_tree')
@attach_components(TestComponent, DerivedTestComponent, ProhibitLeavingScreenComponent)
export class bclass extends SpriteObject {
	@build_bt('bclass_tree')
	public static buildMyTree(): BehaviorTreeDefinition {
		return mytree_builder();
	}

	@build_fsm('bclass_animation')
	public static bouw_testfsm(): StateMachineBlueprint {
		return {
			states: {
				ani1: {
					tick: () => { },
					entering_state(this: bclass) { this.imgid = BitmapId.b; },
				},
				'#ani2': {
					tick: () => { },
					entering_state(this: bclass) { this.imgid = BitmapId.b2; },
				},
			}
		};
	}

	@build_fsm('bclass_meuk')
	public static bouw_meukfsm(): StateMachineBlueprint {
		return {
			is_concurrent: true,
			states: {
				'#meuk1': {
					tick: () => { },
					entering_state(this: bclass) { this.x += 10; },
					states: {
						'#blupperblop1': {
							tick(this: bclass) { },
							entering_state(this: bclass) { }, //runtime.log('enter blupperblop1'); },
						},
						blupperblop2: {
							tick(this: bclass) { },
							entering_state(this: bclass) { }, //runtime.log('enter blupperblop2'); },
						},
					},
				},
				meuk2: {
					tick: () => { },
					entering_state(this: bclass) { }, // this.y += 10; },
				},
			}
		};
	}

	@build_fsm()
	public static bouw(): StateMachineBlueprint {
		function blarun(this: bclass) {
			const speed = 2;
			const input = $.input.getPlayerInput(1);
			if (this.sc.matches_state_path('#blap')) {
				this.tick_tree('bclass_tree');
			}

			if (input.checkActionTriggered('up[p]')) this.y -= speed;
			if (input.checkActionTriggered('right[p]')) this.x += speed;
			if (input.checkActionTriggered('down[p]')) this.y += speed;
			if (input.checkActionTriggered('left[p]')) this.x -= speed;

			if (input.checkActionTriggered('bla[jp]')) {
				input.consumeAction('bla');
				this.testmeuk();
				$.emit('testEvent', this);
				this.sc.machines.bclass_animation.transition_to('#ani2');
				this.sc.transition_to('bclass:/bla');
			}

			if (input.checkActionTriggered('blap[jp]')) {
				input.consumeAction('blap');
				$.emit('testEventOnce', this);
				this.sc.machines.bclass_animation.transition_to('ani1');
				if (this.sc.matches_state_path('bclass_meuk:/#meuk1.blupperblop1')) {
					return this.sc.transition_to('bclass_meuk:/#meuk1/blupperblop1');
				}
				return this.sc.transition_to('bclass_meuk:/#meuk1/blupperblop2');
			}
			return undefined; // No state transition
		}

		return {
			is_concurrent: true,
			states: {
				bla: {
					input_event_handlers: {
						'bla[jp]': {
							do(this: bclass) {
								// PSG.playCustomInstrument(snareInstrument, 10000);
							}
						},
					},
					tick: blarun,
				},
				'#blap': {
					tick: blarun,
				},
			}
		};
	}

	testmeuk() {
		// console.log('testmeuk');
	}

	constructor(_opts?: RevivableObjectArgs) {
		super({ id: 'The B' });
		this.imgid = BitmapId.b2;
		this.getOrCreateCollider().setLocalArea(new_area(0, 0, 14, 18));
		this.visible = false;
	}

	override onspawn(spawningPos?: vec3): void {
		super.onspawn(spawningPos);
		this.btreecontexts['bclass_tree'].running = false; // Stop the behavior tree by default and this cannot happen in the constructor!
	}
}
