import { $, assign_bt, assign_fsm, attach_components, BehaviorTreeDefinition, build_bt, build_fsm, insavegame, new_area, ProhibitLeavingScreenComponent, SpriteObject, StateMachineBlueprint, vec3 } from 'bmsx';
import { Action } from './bootloader';
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
            substates: {
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
            substates: {
                '#meuk1': {
                    tick: () => { },
                    entering_state(this: bclass) { this.pos.x += 10; },
                    substates: {
                        '#blupperblop1': {
                            tick(this: bclass) { },
                            entering_state(this: bclass) { }, //console.log('enter blupperblop1'); },
                        },
                        blupperblop2: {
                            tick(this: bclass) { },
                            entering_state(this: bclass) { }, //console.log('enter blupperblop2'); },
                        },
                    },
                },
                meuk2: {
                    tick: () => { },
                    entering_state(this: bclass) { }, // this.pos.y += 10; },
                },
            }
        };
    }

    @build_fsm()
    public static bouw(): StateMachineBlueprint {
        function blarun(this: bclass) {
            const speed = 2;
            if (this.sc.current_state.def_id === 'blap') {
                this.tickTree('bclass_tree');
            }

            // To check if an action is pressed for player 0
            const pressedActions = $.input.getPlayerInput(1).getPressedActions();

            for (const { action, consumed } of pressedActions) {
                switch (action as Action) {
                    case 'up':
                        this.y -= speed;
                        break;
                    case 'right':
                        this.x += speed;
                        break;
                    case 'down':
                        this.y += speed;
                        break;
                    case 'left':
                        this.x -= speed;
                        break;
                    case 'bla':
                        if (consumed) break;
                        $.input.getPlayerInput(1).consumeAction(action);
                        this.testmeuk();
                        $.event_emitter.emit('testEvent', this);

                        this.sc.machines.bclass_animation.transition_to('ani2');
                        this.sc.transition_to('bclass.bla'); // Ugly, transitioning another state machine
                    case 'blap':
                        if (consumed) break;
                        $.input.getPlayerInput(1).consumeAction(action);
                        $.event_emitter.emit('testEventOnce', this);

                        this.sc.machines.bclass_animation.transition_to('ani1');
                        if (this.sc.matches_state_path('bclass_meuk.meuk1.blupperblop1')) {
                            return this.sc.transition_to('bclass_meuk.meuk1.blupperblop1'); // Ugly, transitioning another state machine
                        }
                        else {
                            return this.sc.transition_to('bclass_meuk.meuk1.blupperblop2'); // Ugly, transitioning another state machine
                        }
                }
            }
            return undefined; // No state transition
        }

        return {
            is_concurrent: true,
            substates: {
                bla: {
                    input_event_handlers: {
                        'bla[j]': {
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

    constructor() {
        super('The B');
        this.imgid = BitmapId.b2;
        this._hitarea = new_area(0, 0, 14, 18);
        this.visible = false;
    }

    override onspawn(spawningPos?: vec3): void {
        super.onspawn(spawningPos);
        this.btreecontexts['bclass_tree'].running = false; // Stop the behavior tree by default and this cannot happen in the constructor!
    }

}
