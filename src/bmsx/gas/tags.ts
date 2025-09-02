import type { Identifier, RegisterablePersistent } from '../rompack/rompack';
import { Registry } from '../core/registry';

export type TagId = string;

export type TagExpr = {
  all?: TagId[];
  any?: TagId[];
  not?: TagId[];
  and?: TagExpr[];
  or?: TagExpr[];
};

export type TagScope = 'world' | Identifier;

export class GameplayTags implements RegisterablePersistent {
  get registrypersistent(): true { return true; }
  public get id(): 'tags' { return 'tags'; }

  private static _instance: GameplayTags;
  public static get instance(): GameplayTags { return this._instance ?? (this._instance = new GameplayTags()); }

  private world = new Set<TagId>();
  private scoped = new Map<Identifier, Set<TagId>>();

  private constructor() { Registry.instance.register(this); }

  // World tags
  addWorld(tag: TagId): void { this.world.add(tag); }
  removeWorld(tag: TagId): void { this.world.delete(tag); }
  hasWorld(tag: TagId): boolean { return this.world.has(tag); }

  // Scoped tags (custom scope ids)
  add(scope: Identifier, tag: TagId): void { (this.scoped.get(scope) ?? this.scoped.set(scope, new Set()).get(scope)!).add(tag); }
  remove(scope: Identifier, tag: TagId): void { this.scoped.get(scope)?.delete(tag); }
  has(scope: Identifier, tag: TagId): boolean { return !!this.scoped.get(scope)?.has(tag); }

  // Evaluate a tag query against a set of resolvers
  evaluate(expr: TagExpr, resolvers: Array<(t: TagId) => boolean>): boolean {
    if (!expr) return true;
    const has = (t: TagId) => resolvers.some(fn => fn(t));
    if (expr.all && expr.all.some(t => !has(t))) return false;
    if (expr.any && expr.any.length > 0 && !expr.any.some(t => has(t))) return false;
    if (expr.not && expr.not.some(t => has(t))) return false;
    if (expr.and && expr.and.some(e => !this.evaluate(e, resolvers))) return false;
    if (expr.or && expr.or.length > 0 && !expr.or.some(e => this.evaluate(e, resolvers))) return false;
    return true;
  }
}

