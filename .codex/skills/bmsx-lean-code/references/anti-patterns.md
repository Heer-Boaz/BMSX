# BMSX Anti-Patterns

Use this as a quick smell list before and after editing.

## Defensive Clutter
Avoid:

```ts
if (!platform) return null;
if (!host || typeof host.getCapability !== 'function') return null;
try { return provider.getViewportMetrics(); } catch { return null; }
```

Prefer a strict internal contract:

```ts
return $.platform.gameviewHost.getCapability('viewport-metrics').getViewportMetrics();
```

Valid exceptions: external input, parsing, IO, network, optional user-provided config, feature detection, and explicitly optional APIs.

## Host Shortcut Leakage
Avoid exposing host/platform conveniences as cart-visible behavior. If a cart can observe or depend on it, route it through the console model: memory maps, MMIO, machine devices, or explicit cart helpers.

## Ad-Hoc Async Readiness
Avoid one-off booleans, local pending arrays, and custom promise gates for engine readiness. Use `TaskGate` or `AssetBarrier` when coordination is the real problem.

## Nullish Normalization
Avoid:

```ts
const value = maybeValue ?? null;
return value;
```

Prefer preserving the actual contract:

```ts
return maybeValue;
```

Only convert to `null` at a public boundary that explicitly requires `null`.

## Useless Local Constants
Avoid locals that only name one obvious use or only satisfy a rule:

```ts
const current = record.current;
return current;
```

Prefer the direct expression:

```ts
return record.current;
```

Create a local only when it names a real concept, avoids repeated work, narrows a type, or improves performance.

## Optional-Chain Bug Hiding
Avoid:

```ts
this.device?.tick?.();
```

Prefer:

```ts
this.device.tick();
```

Use optional chaining only for a property or method whose type and domain contract are truly optional.

## Catch Fallbacks
Avoid:

```ts
try {
    return buildInternalState();
} catch {
    return null;
}
```

Prefer letting internal failures surface. If the catch is a true boundary, handle it explicitly and explain why.

## Closed-Kind Dispatch
Avoid:

```ts
if (kind === 'vertex') ...
else if (kind === 'index') ...
else if (kind === 'uniform') ...
else ...
```

Prefer:

```ts
switch (kind) {
    case 'vertex':
        ...
        break;
    case 'index':
        ...
        break;
    case 'uniform':
        ...
        break;
    case 'texture':
        ...
        break;
}
```

## Repeated Semantic Work
Repeated `toLowerCase`, `trim`, `split`, `join`, `Math.min`, `Math.max`, `floor`, `clamp`, bounds checks, caret normalization, line splitting, keyword lookup, or query normalization usually means a missing concept.

Prefer one of:
- Name the computed value once.
- Move the concept to an existing shared helper.
- Add a shared helper only when no equivalent exists.
- Remove the work if the value is already bounded or normalized by contract.

## Analyzer Evasion
Never rewrite a violation into a larger equivalent violation. If the analyzer rule is too strict or too loose, improve the analyzer first.

## Serialization Leaks
Avoid putting registry state, host handles, caches, scratch buffers, or runtime infrastructure into save data. New feature state should declare what is saved and what is intentionally excluded.
