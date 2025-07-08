import type { Identifier } from "../game";
import type { ConstructorWithFSMProperty, FSMName, StateMachineBlueprint } from "./fsmtypes";

/**
 * A record that maps string keys to functions that build machine states.
 */
export var StateDefinitionBuilders: Record<string, () => StateMachineBlueprint>;

/**
 * Decorator function that assigns FSMs to a class constructor.
 * @param fsms The FSMs to assign.
 * @returns A decorator function.
 */
export function assign_fsm(...fsms: FSMName[]) {
    return function (constructor: ConstructorWithFSMProperty) {
        if (!constructor.hasOwnProperty('linkedFSMs')) {
            constructor.linkedFSMs = new Set<FSMName>();
        }
        fsms.forEach(fsm => constructor.linkedFSMs.add(fsm));
        updateAssignedFSMs(constructor);
    };
}

/**
 * Updates all assigned FSMs for the given constructor.
 *
 * @param constructor - The constructor function.
 */
function updateAssignedFSMs(constructor: any) {
    const linkedFSMs = new Set<FSMName>();
    let currentClass: any = constructor;

    while (currentClass && currentClass !== Object) {
        if (currentClass.linkedFSMs) {
            currentClass.linkedFSMs.forEach((fsm: FSMName) => linkedFSMs.add(fsm));
        }
        currentClass = Object.getPrototypeOf(currentClass);
    }

    constructor.linkedFSMs = linkedFSMs;
}

/**
 * Returns a function that can be used as a decorator to build a finite state machine definition.
 * @param fsm_name - Optional name of the finite state machine. If not provided, the name of the decorated class will be used.
 * @returns A decorator function that can be used to build a finite state machine definition.
 */
export function build_fsm(fsm_name?: Identifier) {
    return function statedef_builder(target: any, _name: any, descriptor: PropertyDescriptor): any {
        StateDefinitionBuilders ??= {};
        StateDefinitionBuilders[fsm_name ?? target.name] = descriptor.value;
    };
}
