import type { Identifier } from '../rompack/rompack';
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

// decorators.ts

// fsm-decorators.ts
const HANDLER_META = Symbol('fsm:handlerMeta');

export type FsmHandlerDecl = {
    name: string;       // method/field name on the instance
    keys: string[];     // resolved keys this member answers to
};

type FsmHandlerOpts =
    | string
    | string[]
    | { key?: string | string[]; prefix?: string; suffix?: string };

function resolveKeys(memberName: string, opts?: FsmHandlerOpts): string[] {
    if (!opts) return [memberName];

    // string -> single explicit key
    if (typeof opts === 'string') return [opts];

    // array -> aliases
    if (Array.isArray(opts)) return opts.length ? opts : [memberName];

    // object form
    const base = opts.key == null
        ? [memberName]
        : Array.isArray(opts.key) ? (opts.key.length ? opts.key : [memberName])
            : [opts.key];

    const { prefix = '', suffix = '' } = opts;
    return base.map(k => `${prefix}${k}${suffix}`);
}

/**
 * @fsmHandler()
 * @fsmHandler('key')
 * @fsmHandler(['a','b'])
 * @fsmHandler({ key: 'doThing', prefix: 'player_', suffix: '_v2' })
 */
export function fsmHandler(opts?: FsmHandlerOpts) {
    return function (_value: unknown, ctx: ClassMethodDecoratorContext | ClassFieldDecoratorContext) {
        if (typeof ctx.name !== 'string') {
            throw new Error(`@fsmHandler only supports string-named members (got ${String(ctx.name)})`);
        }
        const memberName = ctx.name;

        ctx.addInitializer(function () {
            const ctor = (this as any).constructor;
            const bag: FsmHandlerDecl[] = (ctor[HANDLER_META] ||= []);
            bag.push({
                name: memberName,
                keys: resolveKeys(memberName, opts),
            });
        });
    };
}

export function getDeclaredFsmHandlers(ctor: any): FsmHandlerDecl[] {
    return (ctor && ctor[HANDLER_META]) ? [...ctor[HANDLER_META]] : [];
}
