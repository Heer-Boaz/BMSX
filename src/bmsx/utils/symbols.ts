/**
 * Central registry of engine-wide unique Symbols.
 * Keep this lean and documented; prefer module-local symbols unless cross-module use is required.
 */

/**
 * Marks that a constructor has completed one-time class-level registration by decorators.
 * Used to avoid re-registering class metadata on each instance construction.
 */
export const CLASS_REGISTRATION_DONE: unique symbol = Symbol('bmsx.classRegistrationDone');
