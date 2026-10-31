# Cartlib object and transform hierarchy

## Purpose and design boundary

This is a replacement design for cartlib's gameplay object model, not a
specification of the current implementation. It defines how a game constructs,
places, moves and relates its objects. Its requirements come from gameplay,
rendering, collision, animation and execution cost.

Cartlib is an independent gameplay library. Authoring and inspection tools are
consumers of that library; their implementation needs do not define its Lua API,
object layout, construction rules or supported gameplay expressions.

The public contract describes objects, position, rotation, scale, parents,
components and Scenes. Construction lanes, dimensional dispatch, mutation
permissions, matrix coefficients, dirty bits and compiler bindings belong to the
implementation. Exposing one of those mechanisms requires a gameplay use case;
being convenient to parse, inspect or visualize is not one.

## Object model

The proposed model has three foundational built-in object classes:

| Type | Gameplay meaning |
| --- | --- |
| `WorldObject` | A nonspatial object with identity, behavior, components and a lifetime. |
| `Object2D` | A WorldObject with an intrinsic 2D position, rotation, scale and spatial parent. |
| `Object3D` | A WorldObject with an intrinsic 3D position, rotation, scale and spatial parent. |

The spatial object itself owns its transform and hierarchy identity. It is not a
WorldObject facade forwarding to a separately allocated transform component.
Components add behavior, visuals, collision geometry and other capabilities;
they do not add another authoritative object position.

A transform is therefore automatic for Object2D/Object3D and absent for an
ordinary WorldObject. Adding a sprite is not how an object acquires a transform:
an empty spatial grouping object is useful, and a nonspatial controller must not
pay for a fabricated identity transform.

### Class and prefab construction

A prefab is a reusable construction definition for an object and its components.
Its object type comes from its class lineage, not a second spatial declaration.
A built-in class can be used directly:

```lua
local Object2D<const> = require('cartlib/world/object_2d')
local prefab<const> = require('cartlib/world/prefab')

prefab.define({ def_id = 'attachment', class = Object2D })
```

A gameplay module declares its class lineage using ordinary Lua prototype
inheritance. This is the same table-valued `__index` convention already used by
cartlib's concrete component and object modules, not a new class framework:

```lua
local Ship<const> = setmetatable({}, { __index = Object2D })
prefab.define({ def_id = 'ship', class = Ship })
```

Gameplay methods are declared on Ship normally. There are no required empty
constructors or lifecycle hooks; a prefab without custom behavior uses the
built-in class directly instead of declaring Ship at all.

The module owns that inheritance declaration. Prefab registration reads the
established lineage and captures the built-in construction type, methods and
callbacks; it does not write to the class or its metatable. Registering a second
prefab for Ship cannot change Ship's superclass. A prefab-specific `base` field,
a parallel `type` selector and an `extend` forwarding helper are unnecessary.

Custom object classes derive from WorldObject, Object2D or Object3D, directly or
through another gameplay class. A table-valued prototype chain is a deliberate
class contract: runtime instances use the compiled method surface, not arbitrary
dynamic `__index` execution. Game constructors and methods remain ordinary Lua.
There is no restriction that their bodies be declarative or statically readable.

Admission captures each definition's methods and callbacks once. Existing
instances and staged Scene spawns retain that definition when a later
registration replaces it; they do not follow mutable global class bindings or
run class-chain lookup on every dispatch. Method functions and their captured
gameplay references retain their actual identity, rather than being deep-cloned.

There is no obligatory empty `class = {}`. Omitting a class selects WorldObject;
selecting Object2D/Object3D supplies a meaningful built-in type. A prefab can
supply default position, rotation or scale, but an identity transform does not
need to be declared.

Prefab registration compiles shared methods, constructors, component factories
and initialization defaults once. Instances share executable methods; they do
not receive copied class graphs or per-instance method closures.

## Placement and construction inputs

Ordinary placement uses semantic values. These examples describe the proposed
construction contract, not an API already provided by the current code.

```lua
scene_library.register('hangar', {
    objects = {
        {
            member_id = 'ship',
            definition_id = 'ship',
            position = { x = 160, y = 120 },
            options = { team = 'player' },
        },
        {
            member_id = 'turret',
            definition_id = 'turret',
            parent = 'ship',
            position = { x = 12, y = -4 },
        },
    },
})
```

Omitted position means the prefab's default position; omitted rotation and scale
likewise retain their defaults. Built-in defaults are zero position, identity
rotation and unit scale. Position and scale overrides may name individual axes;
unnamed axes retain their prefab values. Rotation replaces the complete angle
or quaternion atomically: missing quaternion operands are not inherited from a
different prefab rotation. An explicit zero or unit value can override a
nondefault prefab value.

For Object2D, rotation is an angle in radians. For Object3D, rotation is a
quaternion with named `x`, `y`, `z`, `w` operands. Scale has named `x`, `y` and,
in 3D, `z` operands. A 3D identity quaternion does not have to be written.
The concrete type determines which properties exist.

Scene member IDs support gameplay references and staged spawning. `parent`
identifies a spatial member in that Scene definition, including a later member;
it is not an index, Registry ID or display caption. Each live Scene resolves it
to its own concrete instances. An ordered member list supports those references
without making list order a construction dependency.

Procedural construction and Scene construction use the same semantic placement
and lifecycle. Procedural parenting takes an actual object reference rather than
looking up a Scene-local name:

```lua
local ship = scene:spawn('ship', {
    position = { x = 160, y = 120 },
    team = 'player',
})
scene:spawn('turret', { parent = ship, position = { x = 12, y = -4 } })
```

Both `world:spawn(definition_id, options)` and
`scene:spawn(definition_id, options)` take this single construction input.
Omitted options use a shared empty input, not a required empty table at each
callsite. Separate spatial-input and component-initialization arguments are not
part of the public contract.

Prefab `position`, `rotation` and `scale` fields supply semantic pose defaults.
Its `defaults` table supplies ordinary gameplay properties. Nonreserved spawn
fields shallow-override those properties on the final object before gameplay
initialization. This preserves useful construction such as `room`, `player`,
`team` and `damage` without requiring assignment-only constructors or a property
schema. Reference-valued gameplay properties remain their actual references.

World consumes the public `id`, `space_id`, `tags` and `visible` construction
controls, including their prefab defaults, at their owning initialization
boundary. Pose records and `parent` are likewise construction inputs, not
arbitrary tables to copy onto the object. World-owned runtime indexes, lifetime
fields and captured executable methods are not gameplay override targets. The
separation belongs to central admission, not feature-specific field filters or
a new runtime validation layer.

Construction inputs are consumed at admission. Numeric pose values are copied
into the actual object's scalar state before user callbacks; retaining a
caller's position table as live object state would be an ownership error. A
caller can reuse a construction input without allocating a new position record
for every spawn. Constructors borrow their input read-only for construction;
they read effective placement and defaulted properties from their actual owner.
World does not build a merged options/context record for each instance. Script
options and explicit reference-valued gameplay data have their own documented
ownership; construction does not deep-clone arbitrary data.

Components retain their own meaningful configuration and constructors. Generic
property-path override interpreters or component-initialization inventories are
not prerequisites for object placement. Any general prefab-override facility
needs its own gameplay purpose and construction semantics.

## Local and world transforms

### UE-style position, rotation and scale

Object transforms follow the position/rotation/scale model selected from UE5's
[TTransform](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Core/TTransform).
Object2D stores local position, an unwrapped rotation angle and signed scale.
Object3D stores local position, quaternion rotation and signed scale. Identity
values are supplied by the type, not required in an instance declaration.

Local values are authoritative. Each object derives a retained **world TRS pose**
from its parent's world TRS and its own local pose. A rendering affine is derived
from that resulting world pose. This distinction is substantive: UE's
[ComponentToWorld calculation](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/USceneComponent/CalcNewComponentToWorld)
also produces an FTransform, not an unrestricted affine result.

The contract is therefore not `worldMatrix = parentMatrix * localMatrix` with
arbitrary shear carried through the object hierarchy. A product of rotated,
nonuniformly scaled matrices need not fit one TRS. Choosing this model means
choosing its representational limit, not silently adding a local-affine mode,
hidden intermediate nodes or coefficient-array inputs when that limit appears.
Imported model-node matrices and explicit geometry transforms remain the math
and asset owners' concern; they do not redefine the object transform contract.
Hierarchy evaluation follows the selected TRS composition at each parent edge.
It must not reassociate or collapse that chain as though it were associative
matrix multiplication; a flattened matrix product is not an optimization of the
same contract.

Position, rotation and scale remain distinct values. Setting local scale to zero
does not erase the authoritative local rotation, and restoring scale recovers
that rotation. This does not assert that a collapsed world basis retains enough
information for matrix-derived world rotation. Local negative scale remains
signed. Quaternion production and interpolation belong to the central math
owners; setters consume their representation without repeated normalization or
validation.

### Signed-scale arithmetic boundary

Unreal's ordinary composition multiplies rotations and axis scales and transforms
the child's translation through its parent. Its negative-scale path is materially
different: the inspected historical
[Epic implementation](https://github.com/folgerwang/UnrealEngine/blob/release/Engine/Source/Runtime/Core/Public/Math/TransformNonVectorized.h)
uses matrix-based orientation extraction when either input has negative scale.
The current API also documents that
[matrix-with-desired-scale operation](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Core/TTransform/MultiplyUsingMatrixWithScale).
The historical implementation is a reference for that distinction, not proof of
the current UE5 function body or numerical parity.

For example, a parent with scale `(-1, 1, 1)` and a child rotated 90 degrees
around Z distinguish `R(90) * S(-1, 1, 1)` from
`S(-1, 1, 1) * R(90)`. Applying ordinary quaternion multiplication to all signed
scales does not merely introduce a rounding difference; it changes reflection
behavior.

The historical matrix path also loses axes at zero scale and contains degenerate
rotation recovery. Cartlib does not import that recovery, replace scale with
epsilon, or silently substitute another reflection algebra. The signed/singular
composition and relative-pose rules remain an explicit implementation gate.
They must define forward zero-scale results as well as nonuniform reflections;
selecting the local/world TRS model alone does not settle that arithmetic.

Object2D arithmetic is the XY-plane restriction of the selected Object3D rules:
zero Z translation, unit Z scale and rotation around Z. Its scalar-specialized
path must agree with that restriction, including reflected/nonuniform cases;
a different planar polar-decomposition rule is not an equivalent optimization.
Local 2D angles retain their unwrapped values. Derived world rotation describes
orientation, not the number of authored turns.

### Gameplay operations

Operations belong to the actual Object2D/Object3D:

```lua
object:set_position(x, y)          -- relative to its spatial parent
object:set_rotation(angle)        -- Object2D, radians
object:set_scale(sx, sy)

local x, y = object:get_global_position()
local committed = object:set_global_position(x, y)
```

The 3D counterparts consume three position/scale operands or four quaternion
operands. A complete pose operation publishes its semantic values with one
invalidation. Changing one local property preserves the others. Global rotation
and scale describe the cached world TRS values, not a decomposition of an
arbitrary matrix supplied by a caller.

Getters return scalar tuples rather than allocating vector tables. World reads
resolve the actual object's dirty pose; gameplay does not run an internal
resolver and then read cache fields. Mutating borrowed cache coefficients is not
another public pose API.

Forward point/vector transformation remains defined at zero scale. An operation
that requires an unavailable inverse fails before changing authoritative values;
world-position assignment returns `false`, and inverse conversion returns its
explicit failure result rather than a substitute coordinate. Root world-position
assignment and detachment to a root need no parent inverse.

This is a deliberate cartlib rule, not a copy of UE's
[zero-reciprocal handling](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Core/TTransform):
cartlib neither replaces zero scale with epsilon nor fabricates inverse values.
Representable values are not repaired to make an operation appear successful.

## Attachment and lifetime

### Explicit attachment rules

Parenting uses UE's useful gameplay distinction between
[KeepRelative, KeepWorld and SnapToTarget](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/EAttachmentRule).
It does not expose construction permissions or internal transform-family flags.

| Rule | Meaning within the object TRS model |
| --- | --- |
| Keep Relative | Keep the current local position, rotation and scale under the new parent. |
| Keep World | Compute the new local pose from the currently resolved world TRS. It is not an arbitrary sheared-matrix preservation guarantee. |
| Snap to Target | Set the selected local channels to their identity values at the new parent. |

The inspected Unreal
[relative-transform implementation](https://github.com/folgerwang/UnrealEngine/blob/release/Engine/Source/Runtime/Core/Private/Math/Transform.cpp)
uses the matrix projection for negative scale too. Projecting to a relative TRS
and then composing it again is not generally an exact round trip under reflected,
nonuniform parents. Keep World is a placement rule using the selected relative
operation, not an unconditional exact-world-TRS guarantee in those cases. Its
accepted numerical behavior belongs to the signed-scale kernel decision rather
than a compensating cached world-pose override.

Attachment can choose the rule separately for position, rotation and scale.
Shared presets cover the real standard cases, following
[FAttachmentTransformRules](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/FAttachmentTransformRules):
keep all relative, keep all world, snap all channels, and snap position/rotation
while retaining world scale. Scene placement declares relative properties;
runtime attachment takes a concrete parent and explicit rules.

[Detachment](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/FDetachmentTransformRules)
supports Keep Relative and Keep World. Keep World detachment copies the cached
world TRS into the new root's local TRS; it does not decompose a sheared affine.

Keep Relative and full Snap do not need a parent inverse and remain meaningful
under a zero-scaled parent. Keep World channels requiring division by a zero
parent scale fail explicitly. All required local values are calculated before
changing the edge or local pose. There is no partial channel write, rollback,
identity substitution or failure-induced parent change.

### World mutation and completion

World commits topology at its existing structural barriers. Parent links refer
to concrete objects in the same World and dimension, not necessarily the same
concrete gameplay class. Rule operands are copied when the request is admitted;
pose and topology are evaluated when it commits. Keep World therefore uses the
object's world pose at that commit, not a stale pose captured when enqueuing.
Requests for the same object apply in their queue order.

Attachment and detachment have no success return that could mean either queued
or committed. An optional `on_completed(context, result)` observes exactly one
terminal result per admitted request:

| Result | Meaning at commit |
| --- | --- |
| `committed` | The requested relationship and placement rules have been applied. |
| `retired_target` | A participant is retiring or retired, including when World clear closes its generation. |
| `invalid_relationship` | The World, dimension or cycle relationship is incompatible. |
| `singular_parent` | A selected world-preserving operation requires an unavailable parent inverse. |

These are shared result constants, not newly allocated result records. A request
without a completion observer is a normal operation; it does not require a
no-op closure. Outside a structural group completion may run inline. Inside a
group it runs after that request's result is determined at the barrier, not at
enqueue or preflight.

World retains actual object references, captured channel rules and caller
callback/context in reusable queue storage. It removes the request's retained
references and advances the drain cursor before invoking user code. Reentrant
requests join the drain with the barrier still open; they do not recursively
publish a partially constructed batch. No promise, request object or separate
operation-broker service is needed.

Synchronous world-position assignment returns `true` on publication and `false`
when the required inverse is unavailable. Inverse point/vector conversion
returns `true` followed by its scalar coordinates, or `false` without fabricated
coordinates. Failed writes change no local pose, parent edge or dependent
contact latch and cause no write-induced invalidation. Resolving an existing
dirty cache still reflects its actual inputs; it is not an authoritative write
to undo.

### Ownership and removal

Attachment is a coordinate relationship, not automatic lifetime ownership.
Components belong to their object, and a live Scene owns its object set for
unloading. Space membership selects scheduling/render membership and is not a
coordinate frame. Attaching an object does not change its Scene, inherit
visibility or make the parent own every attached object.

This distinguishes an attached gameplay object from an owned subobject, just as
UE has an explicit
[ChildActorComponent](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/UChildActorComponent)
for an actor that a component creates and destroys. Cartlib does not need an
additional ownership mechanism merely to support spatial attachment.

At removal of a parent:

1. World determines the actual retiring set at its barrier.
2. It resolves each surviving direct child's world TRS while the old ancestry is
   still present.
3. Those children detach with Keep World into roots; their Scene membership and
   local descendant relationships remain intact.
4. World disconnects the retiring objects from the hierarchy across the whole
   set before invoking any retirement hook.
5. Normal object/component teardown follows. Removals requested by hooks join
   the next removal batch in the same drain.

No new inverse is needed for this detach, including when the old world scale is
zero. Removing one Scene cannot thereby destroy a child owned by another Scene.
A separately requested subtree removal is an explicit operation over the actual
hierarchy, not an implicit side effect of removing one object. An unadmitted
batch child whose required parent is canceled is canceled before publication;
it is not a live independent child undergoing this detachment policy.

An attachment result callback is distinct from a Scene-unload continuation.
World clear supersedes pending unload continuations so they cannot start an
incoming Scene while the World is closing. It still completes observed
attachment requests with their terminal result.

## Physical movement

The tile motor is an optional movement component on an ordinary Object2D. It
moves that object's world-space position through an explicitly supplied,
world-axis-aligned rectangular footprint in a tile collision world. The
footprint belongs to the motor, not to the object's visual transform.

Rotation and scale remain normal Object2D operations. They do not implicitly
rotate or resize the tile motor's world-space rectangle. Collider2D separately
owns overlap geometry, which may follow the object's full rendering transform.
Those are different collision questions, not two authorities for object position.
A TileBody2D class or prefab transform-permission flag is not needed merely to
select a cheaper world-position writer.

The sweep guarantee is for integer world-pixel starting coordinates, footprint
offsets and displacements. Fractional velocity accumulation belongs to its
existing integration producer. The motor is not a continuous fractional sweep:
representable fractional operands still flow deterministically through its
arithmetic, but do not acquire a stronger collision guarantee. The motor does not
round, repair or repeatedly validate owned inputs in its frame loop.

The intended operation/result shape is:

```lua
motor:set_footprint(-6, -12, 6, 0) -- offsets in world pixels
local committed, contacts = motor:move(dx, dy)
```

The solver calculates the proposed position and contact bits in scalar locals.
If position changes, it solves the actual object's world-position write against
its current parent, then publishes the pose and contact latch on success. An
inverse-dependent publication failure returns `false` with both previous pose
and contact latch unchanged. A successful operation returns `true, contacts`.
No earlier state write is undone; proposed results are not committed results.
Root-position publication keeps its direct fast path. Ordinary position setters
do not acquire motor-kind checks.

Only motor-requested motion is swept. Parenting, ancestor movement and ordinary
pose writes are unswept placement changes; attached objects are not recursively
swept. This follows the distinction made by UE's
[MovementComponent](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/UMovementComponent),
without claiming its continuous physics algorithms are this tile solver.

Disabling the motor while carrying an attached object, detaching it, then enabling
movement again is an ordinary component lifecycle. Gameplay supplies valid
starting placement when dropping it. The motor neither invents depenetration nor
changes the object's type or transform interface during that transition.

## Visual placement

Each visual component has one actual component-local pose. Construction defaults
initialize it; presentation animation and gameplay write that same pose. Its
geometry is placed by `objectWorld * visualLocal`, with further model-node or
shape-local transforms owned by the actual asset/geometry producer.

Here multiplication means **affine geometry multiplication**: derive the
object-world affine from its world TRS, then multiply the visual-local affine.
This is not another object-hierarchy TRS edge. A rotated visual under nonuniform
object scale can therefore have sheared geometry; that result is not presented
as an attachable world-TRS object pose. The distinction follows the geometry's
local coordinate system and must remain explicit in the rendering/math owner.

There are not two permanently writable attachment/presentation transforms on
every visual. A relative clip or additive effect retains its rest inputs in the
animator when needed, composes its intended output, then performs one grouped
write to the receiver:

```lua
local rest_x, rest_y = sprite:get_position()
-- Captured when the relative animation begins, not rediscovered each frame.
-- The presentation runner publishes its composed result:
sprite:set_position(rest_x + recoil_x, rest_y + bob_y)
```

Absolute tracks contain their intended local coordinates. Multiple additive
writers require one animator's defined composition and ordering; adding another
matrix to a visual does not resolve competing writers. If the rest placement
changes during a relative clip, the animator owns that new input. Initial
configuration is not secretly retained as another live transform authority.

Sprite-frame animation changes image/frame/flip bindings independently of local
placement. Fixed frame alignment is geometry/layout data, not an extra game
object. A shared attachment used by a sword visual and its hitbox is instead a
meaningful Object2D child with actual gameplay consumers.

Two-dimensional draw order belongs to the visual's actual order property, not a
third Object2D coordinate or an automatically inherited parent depth. Animation
of that property uses the render owner's normal ordering invalidation, not a
permanent extra order-offset store on every visual.

Render-only recoil, bob or squash need not move a physical collision body. That
is why a visual's local pose is separate from its object's pose, not a reason for
two extra transform layers within the visual.

## Animation

Gameplay animation targets semantic channels: position, rotation, scale and
intentional visual placement. Authors do not animate `ox`, `woy`,
`local_origin3`, dirty flags or matrix coefficient indices.
Those transform channels address the receiver's local pose. A world-space
movement operation must retain its explicit inverse/failure contract rather
than treating an unsuccessful global write as a successful animation sample.

Channel admission binds concrete receivers and grouped writers once. A position
sample publishes its coordinates together and invalidates once. Evaluation does
not interpret property paths, discover types or walk class chains each frame.
Two-dimensional angles remain unwrapped so a track can describe multiple turns;
quaternion interpolation has explicit quaternion semantics rather than four
independent scalar interpolation tracks.

Physical animation writes object state in the physical phase. Presentation-only
animation writes visual placement in its presentation phase. Both consume the
existing sampled clock rather than advancing it independently. Simultaneous
channels have defined writer/order ownership, not several unsynchronized pose
stores.

## Construction and publication

The Scene compiler binds concrete prefab definitions, semantic defaults, member
identities, parent indices and parent-first construction order at admission.
A live Scene retains those definitions when a registration is replaced; staged
spawning must not mix a new constructor with an old retained plan.

A spawn batch reserves final object identities and initializes intrinsic pose
and topology before invoking component or gameplay constructors. Components
receive the actual final owner. Constructors initialize their own object;
post-construction wiring runs only after the batch is constructed and published.
Subscription binding precedes activation of the batch. Callback-requested
structural changes join World's ordered drain rather than recursively
publishing a half-constructed batch.

Construction invokes the captured class initializer as
`initialize(owner, options)`, then each ordered `factory(owner, options)`, then
`ctor(owner, options)`. Initializer and constructor hooks are optional. They all
receive the same final owner and the existing construction input; the definition
identity is already on that owner, not another positional constructor argument.
Admission has already installed effective pose and gameplay defaults before the
first hook. This ordering preserves initialization needed by component factories
and component access needed by the constructor without an extra context object.

Component factories receive the actual owner and the existing gameplay
construction options directly. Immutable component configuration is bound once
by the admitted factory; a game-specific factory may select configuration from
its real gameplay parameters before constructing the component. World does not
allocate another per-object context table merely to wrap `owner` or route a
generic component-initialization inventory. Passing a different domain input
must carry actual additional meaning, not duplicate state already available on
the owner.

Scene registration compiles semantic member placement into retained scalar rows
and retains each member's gameplay options independently. Internal World admission
consumes those rows directly. It does not reconstruct a public options table
merely to pass the placement through the procedural interface again.

Staged spawning selects explicit members. A required parent must already be live
or be selected in the same batch. It does not implicitly spawn a namesake,
manufacture an identity parent or change the child into a root. Cycles and
incompatible composition are diagnosed at construction/topology boundaries,
not repeatedly while reading poses.

Scene construction, ordinary spawn and runtime reparenting use the same World
lifetime and barrier owner. No additional scheduler, identity broker, transaction
framework or constructor rollback is introduced.

## Execution design and cost

### Storage

The actual object stores local semantic values, retained world TRS values, a
cached world basis, revisions and intrusive hierarchy links. There is no
separate Transform instance, vector/matrix proxy or per-object resolver closure.
Nonspatial WorldObjects allocate none of this spatial state.

One concrete shared-basis layout has this numeric budget, excluding metadata:

| Object | Local pose | World TRS | World basis | Total |
| --- | ---: | ---: | ---: | ---: |
| Object2D | 5 | 5 | 4 | 14 |
| Object3D | 10 | 10 | 9 | 29 |

World translation is already part of world TRS; an additional copied affine
origin is not another required store. A retained local basis or extra signed-
scale cache is not inherited automatically from the previous matrix model: its
cost must be justified by the actual selected kernels. Storage accounting is
not a measured speed claim.

The full budget also includes object identity, component indexes, subscriptions
and lifetime bookkeeping. An empty grouping node must be measured as an actual
WorldObject, not advertised as cheap by counting only its transform scalars.
It does not justify allocating unused tick/visual work or manufacturing such
nodes to compensate for an unsupported transform operation.
Intrinsic pose storage removes a separate identity; it does not make the whole
object a single allocation. Eager tags, event ports and component containers
need justification for empty grouping objects rather than automatic inheritance
from the existing base initializer. Shared methods already exist and are not a
new allocation saving to claim again.

Separate registration, instance admission, steady evaluation and retirement:

| Boundary | Account for |
| --- | --- |
| Prefab/Scene registration | Shared compiled methods, factory bindings, retained defaults and construction plans. |
| Object admission | The final object, tags, component indexes, event port, Registry/Space/Scene membership and queue growth. |
| Spatial admission | Intrinsic scalar/link fields and shared scratch capacity, without a Transform component or its class-index buckets. |
| Component admission | Actual component identities, geometry bindings and subscriptions, separately from an empty spatial object. |
| Steady evaluation | Allocations, emitted calls, cycles and repeated work at actual pose, animation, render and collision consumers. |
| Retirement | Teardown work, collected allocations and released queue, scratch and subscription references. |

Temporary construction records and table-capacity growth count even if they are
later collected. Measure empty WorldObject, Object2D and Object3D admissions
separately from component-bearing instances. A combined spawn/attach/remove
benchmark cannot establish a fixed per-object construction cost.

A world-position change does not run trigonometry, rebuild quaternion matrices
or rewrite an unchanged world basis. Rotation/scale changes rebuild the affected
basis only when needed; clean queries share the result. Ancestor changes consume
retained semantic values rather than decomposing old matrices. Roots keep a
direct position path without a parent inverse or identity multiplication.

### Evaluation and consumers

Retain iterative dirty-ancestor resolution, separate world basis/origin revisions,
subtree invalidation that skips already dirty branches, stable hierarchy slots
and reusable scratch that releases retired references. Multiple consumers share
one recomposition between intervening writes. There is no mandatory full-World
transform pass before every frame.

Concrete 2D/3D kernels are selected at type/construction boundaries. Stable pose
reads, writes and traversal allocate no tables, vectors, closures, iterators or
formatted strings. Hot consumers bind actual object/capability references once.
Sprite frames, model replacements and collider-source mutations update retained
geometry bindings at their owning mutation boundary, not by rediscovery each
frame.

Sprite/text/tile/model consumers resolve poses outside their inner geometry loops
and use retained coefficients there; subsequent clean reads perform no
composition. This does not require a second grouping/cache layer for visuals
that already share an owner. Collider caches respond separately to basis and
position changes. Translation-only roots preserve their fast datapath. Pose
invalidation does not rebuild component views or invalidate draw ordering.

Keep existing retained Space/system views, revision-driven render ordering,
constructor specialization and timeline lowering. A method is not assumed free
because it has one line or because the caller was compiled with O3. Generated
runtime syntax and ahead-of-time compilation have different optimization paths;
measure both at the actual hot callsites.

### Evidence required before implementation is accepted

Use dedicated gameplay fixtures, not mutable shipped carts, to prove:

- Default identity placement without authored transform records in both 2D/3D.
- Object-owned local values, zero-scale rotation retention and signed scale.
- Nested placement and the selected world-TRS results under nonuniform parents,
  explicitly distinguished from unrestricted affine-matrix composition.
- Current synchronous reads between structural/tick groups.
- Defined reparent failure/removal behavior with no partial state changes.
- One real physical pose shared by movement, overlap and rendering.
- Presentation animation that does not accidentally move collision geometry.
- Staged construction, reentrant lifecycle callbacks and definition replacement.
- Clean-frame zero spatial allocations, translation-only work, dirty-chain work,
  rotation/scale work and actual constructor/teardown cost.
- Emitted instructions/calls and measured cycles on both compilation paths.

Benchmarks must include deep and wide hierarchies, flat moving objects, multiple
consumers, repeated writes before a read and interleaved writes/reads. Report
absolute cost and the baseline; source shape, typechecking and unit-test success
are not performance evidence.

## Production references and chosen differences

- UE5 [TTransform](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Core/TTransform)
  and [ComponentToWorld](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/USceneComponent/CalcNewComponentToWorld)
  establish the chosen local/world TRS model. The
  [attachment](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/FAttachmentTransformRules)
  and [detachment](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/FDetachmentTransformRules)
  contracts establish explicit placement rules. They do not establish byte-for-
  byte numerical parity with a separately implemented kernel.
- Godot [Node2D](https://github.com/godotengine/godot/blob/master/scene/2d/node_2d.h)
  and [Node3D](https://github.com/godotengine/godot/blob/master/scene/3d/node_3d.h)
  demonstrate intrinsic spatial objects. Cartlib chooses this lean object
  ownership rather than allocating an Unreal-style root SceneComponent for every
  object. That does not require copying Godot's matrix/Euler reconciliation or
  its zero-scale repair.
- Unity [Transform](https://github.com/Unity-Technologies/UnityCsReference/blob/master/Runtime/Transform/ScriptBindings/Transform.bindings.cs)
  demonstrates the coherent alternative of a real mandatory Transform component.
  Cartlib does not mix that model with object forwarding facades.
- Bevy [Transform](https://github.com/bevyengine/bevy/blob/main/crates/bevy_transform/src/components/transform.rs)
  and [GlobalTransform](https://github.com/bevyengine/bevy/blob/main/crates/bevy_transform/src/components/global_transform.rs)
  are useful contrasts: its affine world cache is not the world-TRS contract
  selected here. Its decomposition caveats cannot be hidden behind Keep World.
- Filament [TransformManager](https://github.com/google/filament/blob/main/filament/src/components/TransformManager.cpp)
  provides retained topology and dirty-evaluation precedents. Its C++ storage,
  threading and inline proxies are not automatic performance wins in BLua.

## Implementation gates

The public design is intrinsic Object2D/Object3D, class-owned inheritance,
semantic construction, UE-style local/world TRS with explicit attachment rules,
Scene/component lifetime ownership, an optional world-pixel tile motor, and one
actual local pose per visual component. No editor metadata or parseability
requirement defines those contracts.

The remaining integration criteria are:

1. Specify and check central 2D/3D composition and relative-pose arithmetic,
   especially reflected/nonuniform scales. Do not claim that a convenient
   quaternion/component-scale formula is verified Unreal numerical behavior.
2. Implement the specified terminal results at World, including observerless
   requests, inline/deferred completion, reentrant callbacks, clear and removal
   during pending construction. Establish inverse availability before any pose,
   edge, revision or contact-latch publication.
3. Measure complete object/component storage and emitted hot-path work on both
   compiler paths against the existing baseline. Those measurements are
   implementation acceptance evidence, not performance already established by
   this design. Any additional cache needs an actual consumer and cost
   comparison, not an assumed O3 optimization.

The existing implementation is not made conformant by hiding old fields,
renaming a restricted transform type or adding convenience forwarding methods.
Implementation must move actual ownership and datapaths to the selected model.
