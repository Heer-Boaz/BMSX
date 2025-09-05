import { CLASS_REGISTRATION_DONE } from './symbols';

/**
 * Shared helpers for decorator initializers.
 *
 * These utilities centralize the common pattern used by our decorators:
 * - register metadata on the constructor (class) once
 * - defer instance-bound initialization until after construction/field init
 */

/** Defer a function to run after the current turn/microtask. */
export function defer(fn: () => void): void {
    try {
        // Prefer microtask if available on globalThis
        const qm = (globalThis as any).queueMicrotask;
        if (typeof qm === 'function') { qm(fn); return; }
        // Fallback to Promise microtask
        Promise.resolve().then(fn);
    } catch {
        // Last-resort macro task
        setTimeout(fn, 0);
    }
}


/**
 * Adds initializers for class-level registration and deferred instance init.
 * - Calls `register(ctor)` during class evaluation
 * - Defers `init(instance)` until after the instance is fully constructed
 */
export function withClassRegistrationAndDeferredInstanceInit(
    context: ClassMethodDecoratorContext,
    register: (ctor: Function) => void,
    init: (instance: object) => void,
): void {
    // Guard in case the decorator context implementation doesn't provide addInitializer.
    const addInit = (context as any).addInitializer;
    if (typeof addInit !== 'function') {
        // Best-effort fallback: if there's no addInitializer, avoid throwing.
        // In such environments we cannot reliably defer instance init or register from an instance initializer,
        // so silently no-op to preserve runtime stability.
        return;
    }

    if (context.static) {
        // For static contexts, register class-level metadata once (guarded by a hidden flag on the constructor).
        // Do not attempt instance initialization here: `this` is the constructor, not an instance.
        addInit.call(context, function (this: unknown) {
            type CtorWithFlag = Function & { [CLASS_REGISTRATION_DONE]?: true };
            const ctor = this as CtorWithFlag;
            if (!ctor[CLASS_REGISTRATION_DONE]) {
                register(ctor);
                Object.defineProperty(ctor, CLASS_REGISTRATION_DONE, { value: true, enumerable: false, configurable: false });
            }
        });
    } else {
        /** For instance methods, the decorator runs at class definition time, but you don’t have the class (constructor) value to attach metadata to.
         * Your metadata lives on the constructor (class). The only reliable way (from an instance method decorator) to get that constructor is this.constructor inside the instance initializer.
         * That’s exactly what line 47 does: it obtains the ctor from the first constructed instance and calls register(ctor) so ctor.eventSubscriptions is populated.
         * Without it, constr.eventSubscriptions stays empty, so initClassBoundEventSubscriptions finds nothing and no handlers are wired.
         */
        addInit.call(context, function (this: unknown) {
            type CtorWithFlag = Function & { [CLASS_REGISTRATION_DONE]?: true };
            const ctor = (this as { constructor: CtorWithFlag }).constructor;
            if (!ctor[CLASS_REGISTRATION_DONE]) {
                register(ctor);
                Object.defineProperty(ctor, CLASS_REGISTRATION_DONE, { value: true, enumerable: false, configurable: false });
            }
        }); // This is the bridge from an instance method decorator to the class (constructor). Without it, there’s no moment you can attach class-level metadata for instance-decorated methods. The once-per-ctor-flag makes it more efficient while preserving behavior.
        addInit.call(context, function (this: unknown) { defer(() => init(this as object)); });
    }
}
