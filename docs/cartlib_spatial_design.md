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

A gameplay class supplies actual behavior. The class-definition boundary records
its base once; prefab registration consumes that established lineage. It must
not repeatedly change a shared class table's superclass when registering
another prefab. The exact class-definition syntax must be settled before the
API is implemented; introducing an `extend` convenience wrapper is not itself a
solution to class ownership.

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
looking up a Scene-local name. The public spawn API must not require separate
spatial-input and component-initialization tables merely because those are
separate internal construction lanes.

Construction inputs are consumed at admission. Numeric pose values are copied
into the actual object's scalar state before user callbacks; retaining a
caller's position table as live object state would be an ownership error. A
caller can reuse a construction input without allocating a new position record
for every spawn. Script options and explicit reference-valued gameplay data have
their own documented ownership; construction does not deep-clone arbitrary data.

Components retain their own meaningful configuration and constructors. Generic
property-path override interpreters or component-initialization inventories are
not prerequisites for object placement. Any general prefab-override facility
needs its own gameplay purpose and construction semantics.

## Local state and world state

### Candidate A: local position, rotation and scale

Under this candidate, Object2D retains local position, an unwrapped angle and
signed scale. Object3D retains local position, quaternion rotation and signed
scale. The local transform is `L = T * R * S`, and the world transform is:

- `W(root) = L(root)`;
- `W(child) = W(parent) * L(child)`.

These semantic local values are authoritative. Local basis and world affine
values are derived caches. Setting scale to zero must not erase rotation;
restoring scale must recover that orientation. Negative scales remain signed
values, not values reconstructed through an ambiguous matrix decomposition.

Nonuniform scale combined with rotated ancestors can produce a sheared world
affine. That is a valid result of the hierarchy. Rendering and geometric queries
consume the actual affine; they do not replace it with a decomposed TRS or an
approximate axis-aligned object pose.

This candidate has no competing writable local-affine mode. General affine math
remains useful for derived transforms, model-node transforms and geometry.

### Candidate B: full local affine authority

If gameplay requires arbitrary local shear or general exact full-pose
attachment/detachment, the local representation must support those operations.
Full local affine authority is a candidate, not an implementation detail to
exclude merely because TRS is easier to expose.

Its gameplay contract must define what rotation and signed-scale operations mean
under shear and degeneracy, including zero-scale restoration. A matrix alone
does not retain every semantic choice used to construct it. Any additional
retained semantic state or representation mode needs one explicit authority and
reconciliation policy, with measured storage and execution costs.

Neither candidate makes numeric coefficient arrays mandatory for ordinary
placement. Select between them from concrete gameplay operations before fixing
the local storage or promising reparenting behavior.

### Gameplay operations

Operations belong to the actual Object2D/Object3D. Examples of their intended
semantics are:

```lua
object:set_position(x, y)          -- coordinates relative to its spatial parent
object:set_rotation(angle)        -- Object2D, radians
object:set_scale(sx, sy)

local x, y = object:get_global_position()
object:set_global_position(x, y)
```

The 3D counterparts consume three position/scale operands or four quaternion
operands. A complete pose operation can publish position, rotation and scale
together with one invalidation. Setting one semantic property preserves the
other local properties.

Getters return scalar tuples rather than allocating vector tables. World reads
resolve the object's actual dirty cache before returning values; gameplay does
not call an internal resolver and then read cache coefficient fields. Bare
writes to cache fields are not an alternative mutation path.

Local/global point and vector conversion are explicit mathematical operations.
Forward conversion remains defined for a singular transform. Inverse-dependent
conversion and world-position assignment report explicit failure when the
required inverse does not exist, without writing local state or substituting a
result. A root's world-position assignment needs no inverse. Their exact result
convention belongs to the operation-set decision
below; rollback and identity repair are not implementation strategies.
World position is unambiguous even under shear. A general exact world rotation
and world scale are not: this API must not imply that every world affine has a
unique lossless TRS decomposition. Quaternions are produced by the central math
owners and consumed directly; setters do not add repeated validation or repair.

## Parenting and lifetime are distinct decisions

World owns spatial topology changes at its existing structural barriers. Runtime
parent links refer to concrete objects in the same World and dimension, not
necessarily the same concrete gameplay class.
Child links are maintained traversal indices, not a second editable relation.

**Keep Local** reparenting retains all authoritative local pose values. A
separately named **Keep World Position** operation retains the world-space
origin and leaves local rotation/scale unchanged. It requires an invertible new
parent when solving that origin. Position preservation must not be called full
world-pose preservation.

A full **Keep World** promise is not automatic with TRS locals. For example,
preserve an initially unparented child's world basis `R(45 degrees)` while
reparenting it under `diag(2, 1)`. The required local basis is
`diag(1/2, 1) * R(45 degrees)`: its columns are not orthogonal, so it has no
`R * S` representation. The same example embeds in 3D.

Before implementation, choose one complete policy:

1. Keep TRS locals and expose full-pose reparenting only as a fallible operation,
   with defined representability, reflection and singularity rules; or
2. Require unrestricted full-affine local gameplay operations and design their
   rotation/scale semantics explicitly instead of pretending they are TRS.

Silently dropping shear, repairing scale or changing representation after a
failed operation is not a third policy. The representation choice must follow
required gameplay operations, not the convenience of an implementation kernel.
Hidden intermediate objects are not a substitute for an operation the public
object model promises to support.

Reparenting reports the result of the operation committed at the World barrier,
including rejection against the then-current topology. Preflight calculations
do not authorize a later commit. Outside a structural group the same operation
can complete inline; enqueueing alone is not reported as success.

Scene membership owns the live composition for unloading; Space membership owns
scheduling/render membership. Neither is a coordinate frame. Spatial parenting
alone does not transfer Scene ownership, inherit visibility or decide recursive
destruction. Inactive ancestors can still supply the pose of active descendants.

Parent removal needs an explicit gameplay policy before coding. The existing
promise that every surviving child automatically detaches with its entire world
affine preserved cannot be carried into a TRS-only contract. Whether removal
retires an owned assembly, detaches independent children or requires an explicit
choice is a lifetime decision, not a hidden decomposition fallback.

## Physical movement and presentation

The tile-grid movement solver provides axis-aligned rectangular movement in a
tile world. Its gameplay contract is not an arbitrary-affine rigid-body solver.
A meaningful constrained body type, such as TileBody2D, can own that invariant:
its physical placement is world-axis-aligned, while ordinary Object2D children
can carry decorative rotation and scale.

That choice is a real body/type decision, not an `authority = 'root_origin'`
option in every prefab. An alternative is a deliberately constrained solver
attachment with a precisely defined lifetime. Choose between those models from
movement/component use cases before implementation. Naming a TileBody2D type
does not by itself enforce the invariant: its relationship to Object2D's mutable
rotation/scale API and its permitted parenting operations must be explicit.
Do not silently accept an
unsupported rotated/scaled body or approximate it with a larger AABB.

Collider geometry, physical footprint and visual dimensions have separate
owners. Object transform scale is not a renamed collision width/height.
Overlap, endpoint testing and swept motion retain their distinct meanings.
Physical movement publishes its achieved position through the actual object;
velocity and fractional integration remainder do not become another position.

A visual's local placement is separate from object movement. Sprite recoil or
bob can change presentation without moving the collision body. A spatial child
is appropriate when other gameplay objects need to attach to that placement;
a render-only offset does not require manufacturing another WorldObject.

## Animation

Gameplay animation targets semantic channels: position, rotation, scale and
intentional visual placement. Authors do not animate `ox`, `woy`,
`local_origin3`, dirty flags or matrix coefficient indices.

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

For the TRS candidate, the actual spatial object stores semantic local scalars,
cached local basis, cached world affine, revisions and intrusive hierarchy links.
No separate Transform instance, vector/matrix proxy or per-object resolver
closure is needed. Nonspatial WorldObjects have none of these spatial fields.

Caching has a real cost: that candidate needs five semantic local numbers, four
local basis numbers and six world-affine numbers in Object2D; Object3D needs ten,
nine and twelve respectively, before topology/revision fields. The affine
candidate needs its own complete budget, including any semantic reconciliation
state. Do not conceal either memory cost or assume fewer allocations prove faster
execution. Compare complete emitted work and retained memory against the actual
current kernels.

Only rotation/scale changes rebuild a local basis. Position changes do not run
trigonometry, regenerate quaternion matrices or rewrite a basis. A changing
ancestor does not cause each descendant to recompute an unchanged local basis.

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
- Nested placement and actual sheared world results under nonuniform parents.
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

- Godot [Node2D](https://github.com/godotengine/godot/blob/master/scene/2d/node_2d.h)
  and [Node3D](https://github.com/godotengine/godot/blob/master/scene/3d/node_3d.h)
  demonstrate intrinsic spatial objects and semantic operations. Their alternate
  affine/Euler representations are additional machinery, not a reason to copy
  every field or mutation mode.
- Unity [Transform](https://github.com/Unity-Technologies/UnityCsReference/blob/master/Runtime/Transform/ScriptBindings/Transform.bindings.cs)
  demonstrates the coherent alternative of an actual mandatory Transform
  component. This design instead puts those responsibilities on the actual
  Object2D/Object3D; it does not mix both models with forwarding facades.
- Bevy [Transform](https://github.com/bevyengine/bevy/blob/main/crates/bevy_transform/src/components/transform.rs)
  and [GlobalTransform](https://github.com/bevyengine/bevy/blob/main/crates/bevy_transform/src/components/global_transform.rs)
  separate semantic local TRS from derived affine world state. Its documented
  shear/nondegeneracy restrictions do not establish a general lossless Keep World
  algorithm for this design.
- Filament [TransformManager](https://github.com/google/filament/blob/main/filament/src/components/TransformManager.cpp)
  provides retained topology and dirty-evaluation precedents. Its C++ storage,
  threading and inline proxies are not automatic performance wins in BLua.

## Decisions to close before coding

The proposed foundation is intrinsic Object2D/Object3D, semantic construction
inputs and retained derived world transforms. The local representation is not
settled. It is not ready to encode until these remaining contracts are explicit:

1. One class-definition/inheritance owner, consumed rather than mutated by prefab
   admission; no duplicate class/type selectors or mandatory empty classes.
2. Required full-pose reparenting, detachment and local-shear operations; the local
   representation that actually supports them; and precise result conventions
   for inverse-dependent or unrepresentable operations.
3. Spatial-parent removal and assembly/Scene lifetime policy.
4. Tile-body type versus constrained movement-component ownership.
5. Component visual-placement configuration versus presentation-only animation.

Resolve these with concrete gameplay scenarios and allocation/emitted-work
budgets. They must not be settled by parser convenience, source-edit machinery
or an inspection layout.
