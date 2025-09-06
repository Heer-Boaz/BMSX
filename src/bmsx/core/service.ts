import { type RegisterablePersistent, type Identifier, type Identifiable } from '../rompack/rompack';
import { $ } from './game';

/**
 * Base class for non-world-bound, persistent services (UE-style Subsystems).
 *
 * Characteristics:
 * - Registers in the global Registry at construction time.
 * - Default `registrypersistent = true` so services survive world loads unless explicitly disposed.
 * - Opt-in event processing is governed by `eventhandling_enabled` (true by default).
 * - Decorator-driven event subscriptions are initialized via the shared decorator logic
 *   (they will run after construction and after Registry.register due to deferred init).
 */
export abstract class Service implements Identifiable, RegisterablePersistent {
  /** Unique identifier for the service (override or pass via constructor). */
  public readonly id: Identifier;

  /**
   * If true, service survives Registry.clear() calls (e.g., during world reloads).
   */
  public get registrypersistent(): true { return true; }

  /**
   * Controls whether the service processes events (checked by EventEmitter gating).
   * Services default to listening immediately; subclasses may toggle as needed.
   */
  public eventhandling_enabled: boolean = true;

  /** Optional state snapshot API; implement in subclasses to participate in Savegame. */
  public abstract getState?(): unknown;
  public abstract setState?(dto: unknown): void;

  /**
   * Construct a new Service.
   * @param id Unique identifier. If omitted, defaults to the class name in lower_snake_case.
   * @param opts Optional flags for initial state.
   */
  protected constructor(id?: Identifier, opts?: { eventhandlingEnabled?: boolean }) {
    this.id = id ?? Service.deriveIdFromConstructor(this.constructor.name ?? 'service');
    if (opts?.eventhandlingEnabled === false) this.disableEvents();
    $.registry.register(this);
  }

  /**
   * Convenience: enable event processing for this service.
   */
  public enableEvents(): void { this.eventhandling_enabled = true; }
  /**
   * Convenience: disable event processing for this service.
   */
  public disableEvents(): void { this.eventhandling_enabled = false; }

  /**
   * Dispose the service; unsubscribes from events and deregisters from the Registry.
   * Note: persistent records are preserved by default in this codebase; pass `true` to
   * Registry.deregister's second argument if removal of the persistent record is required.
   */
  public dispose(): void {
    $.event_emitter.removeSubscriber(this);
    this.eventhandling_enabled = false;
    // For persistent services, the Registry retains the record by default; callers may
    // deregister with force if complete removal is desired.
    $.registry.deregister(this);
  }

  private static deriveIdFromConstructor(name: string): Identifier {
    // Convert PascalCase/MyService to lower_snake_case: my_service
    const snake = name.replace(/^_+/, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    return (snake || 'service') as Identifier;
  }
}
