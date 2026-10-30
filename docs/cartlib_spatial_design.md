# Cartlib spatial hierarchy

This target design adds authored and runtime spatial hierarchies for Studio's
Scene work area. It replaces the flat object-position contract; it does not
describe an implemented feature. Existing carts migrate with their consumers.
Compatibility aliases and duplicate position storage are outside this design.

Cartlib remains independent gameplay software. Transforms require no new
hardware, BIOS or cartridge format. The [Studio workspace design](studio_workspace_design.md)
owns presentation; this document owns the proposed cartlib domain and the
source contract needed to edit it.

## Production precedents and deliberate differences

The useful precedent is a spatial component with local authority and derived
world state, not a universal tree in which every relationship means parenting.

| Reference implementation | Applied principle | Deliberate boundary |
| --- | --- | --- |
| Godot [Transform2D](https://github.com/godotengine/godot/blob/master/core/math/transform_2d.h) and [Node3D](https://github.com/godotengine/godot/blob/master/scene/3d/node_3d.cpp) | Affine composition, retained world transforms and descendant invalidation. | Transform ownership does not determine gameplay activation or destruction. |
| Godot [Node](https://github.com/godotengine/godot/blob/master/scene/main/node.cpp) and [PackedScene](https://github.com/godotengine/godot/blob/master/scene/resources/packed_scene.cpp) | Scene ownership is distinct from parenting; construction and reference binding have separate phases. | Retain cartlib's Scene-owned object set rather than replacing WorldObjects with Godot nodes. |
| Bevy [GlobalTransform](https://github.com/bevyengine/bevy/blob/main/crates/bevy_transform/src/components/global_transform.rs) and [propagation systems](https://github.com/bevyengine/bevy/blob/main/crates/bevy_transform/src/systems.rs) | Derived affine world state and explicit propagation costs. | Queries must see current committed poses, including between tick groups; a render-only propagation pass is insufficient. |
| Three.js [Object3D.attach](https://github.com/mrdoob/three.js/blob/dev/src/core/Object3D.js) and Bevy `GlobalTransform.reparented_to` | Keep-world attachment needs an inverse and an explicit representation contract. | Three.js documents non-uniform-scale restrictions; Bevy's conversion back to local TRS requires shear-free, nondegenerate input. Cartlib retains full local affine state instead of inheriting those decomposition restrictions. |

## Ownership: several relationships, one spatial forest

Each relationship retains its own owner and meaning.

| Relationship | Owner and meaning |
| --- | --- |
| World membership | World owns identity admission, structural barriers and terminal removal. |
| Scene membership | A live Scene owns its authored and procedural object set for unloading. |
| Space membership | World/Space select update and render membership; a Space is not a coordinate frame. |
| Component ownership | `component.owner` is its WorldObject and lifetime owner. This replaces the ambiguous `component.parent`. |
| Spatial parenting | A Transform links to another Transform in the same World and dimensional family. |
| Asset-node parenting | A model's internal nodes remain asset-local; placing a model does not create a WorldObject per mesh node. |

A WorldObject has either no spatial capability, one Transform2D, or one
Transform3D. A nonspatial controller allocates neither a transform nor an
invented identity pose. The prefab declares that capability; World installs
the unique spatial component before constructing its other components. The
object exposes the retained component as `object.spatial`. Spatial consumers
bind that concrete reference at attachment, not by searching each tick.
The spatial capability is fixed for the object's lifetime: it cannot be
disabled, removed or replaced through ordinary component mutation. Space
deactivation suspends scheduled work, not transform availability. Replacing a
prefab definition affects new instances, not these retained bindings.
Prefab admission resolves its declared spatial family to concrete construction
and evaluation datapaths once. An incompatible consumer is a composition error
at attachment, not a per-tick kind check or fallback to object fields.

Transform components own local affine storage. World owns their forest links
and structural mutations. The child-to-parent reference is authoritative;
retained child/sibling links are World-maintained traversal indices, never
independently editable relationship data. Runtime edges use concrete instance
references, not names looked up again after disposal.

An empty spatial object is useful for grouping. A sprite, collider or mesh is
not required to give it a transform. Conversely, adding a transform does not
implicitly add a visual, collider, tick function or visibility policy.

The implementation separates real responsibilities rather than adding a
service facade: affine arithmetic lives in the shared math modules;
`component/transform_2d_component.lua` and `transform_3d_component.lua` own
instance-local state and mutation APIs; `world/spatial_hierarchy.lua` owns
forest traversal, invalidation and world evaluation; and `world/scene_plan.lua`
owns cold authored-graph compilation. World retains admission, the existing
mutation drain and public structural commands. Spatial hierarchy algorithms
do not introduce another identity registry or lifecycle scheduler.

## Representation and spatial operations

One full local affine is the mutable spatial authority. World affine is
derived, retained and read-only to consumers.

For column vectors, write an affine as `(B, t)`, with `p' = B p + t`:

- 2D stores a 2-by-2 basis and a two-coordinate origin: six Numbers.
- 3D stores a 3-by-3 basis and a three-coordinate origin: twelve Numbers.
- `W(root) = L(root)`.
- `W(child) = W(parent) * L(child)`.
- Composition is `(A, a) * (B, b) = (A B, A b + a)`.

The coefficient order is basis columns followed by origin:
`[xx, xy, yx, yy, ox, oy]` in 2D and
`[xx, xy, xz, yx, yy, yz, zx, zy, zz, ox, oy, oz]` in 3D. Thus 2D maps
`(x, y)` to `(xx*x + yx*y + ox, xy*x + yy*y + oy)`.
There is no stored homogeneous perspective row.

The central math owners are `cartlib/math/affine2.lua` and `affine3.lua`,
introduced with their first consumers. They own composition, inversion,
point/vector transformation and explicit TRS builders. These operations use
retained destinations and scalar Number arithmetic; a clean read allocates
nothing. Device operands are produced separately at the existing GX/GTE/GEO
boundary. Game-unit affines are not packed GTE register matrices. Numeric
semantics remain those of [BLua Numbers](book1/cpu.md#sec-cpu-values-and-numeric-instructions),
not a new fixed-point ABI.

The general Transform API distinguishes local and world operations; restricted
physical capabilities expose only their admitted writers:

| Operation | Meaning |
| --- | --- |
| Set local affine | Replace the full local authority and invalidate derived world poses. |
| Set local origin | Edit translation only, retaining the local basis. |
| Read world affine/origin | Resolve current ancestors and return borrowed retained state or scalar coordinates. |
| Set world origin | Apply the current parent inverse to the desired origin; retain the local basis. |
| Set world affine | Compute `L = inverse(W(parent)) * desiredWorld`. |
| Transform point/vector | Points include translation; vectors do not. |

World setters resolve against the currently committed parent. Topology changes
requested during a tick group become effective only at its structural barrier.
Inverse-dependent world setters complete synchronously and reject without
changing local authority when the required parent inverse does not exist.
Direct writes to coefficients or borrowed world buffers are not an API.
`WorldObject.x/y/z`, `set_pos` and `set_z` are removed, not kept as proxies.

TRS is a construction/manipulation form, not another stored truth. A TRS
builder deliberately replaces a complete affine. Translation edits preserve
its basis; rotation and scale tools compose an explicitly local- or world-space
delta about an explicit pivot. Details can expose the affine basis when shear
is present; it must not silently decompose and discard it.

General transforms retain negative scale, reflection, shear and singularity.
Only inverse-dependent operations require an invertible parent basis. Detaching
to a root needs no inverse. A singular child is not itself a reason to reject
keep-world reparenting. There is no epsilon-scale repair, identity substitution
or TRS round trip. Preserving world pose avoids decomposition loss; it does
not promise bit-exact arithmetic after inversion.

## Reparenting, partitions and removal

Reparenting is a World structural operation with two explicit modes:

- **Keep local:** retain `L`, then attach to the new parent.
- **Keep world:** compute `L' = inverse(W(newParent)) * W(child)`, then attach.
  For a new root, `L' = W(child)`.

At the actual commit, World checks instance liveness, common World,
dimensional family and absence of cycles against the then-current topology.
It resolves the world poses and computes the replacement local affine before
changing any links. Ordered commands in one barrier observe preceding
committed commands: two individually plausible requests must not jointly
create a cycle. UI preflight only determines current availability; it cannot
authorize a later commit. A retired target or cycle produces an explicit failed
operation with unchanged links and local authority; a singular new parent does
so only for Keep World. Keep Local accepts singular parents. Failure does not
substitute a parent or write state followed by rollback.

The operation follows World's existing deferred-mutation convention, with a
callback/context completion rather than a new asynchronous service. Every
submitted request receives exactly one terminal result: committed, retired
target, invalid relationship, or singular parent. Completion runs after local
state, links and cache invalidation are committed, or after unchanged rejection;
enqueueing is not reported as success. Outside an open structural scope it
can complete synchronously through the same commit operation. Clear/unload
rejects affected pending requests explicitly rather than dropping callbacks.
Completion-requested mutations join the ordered drain instead of nesting
halfway through a commit. These are structural domain decisions, not per-frame
DTO validation. There is no promise broker or general transaction framework.

Spatial parenting can cross Spaces and Scene instances within the same World.
Changing Space changes only membership, not parent links or local pose.
An inactive ancestor's retained transform still participates in an active
descendant's pose; its gameplay remains inactive. Parenting does not inherit
activation, visibility or Scene ownership. A moving parent changes placement,
not automatically a swept movement or a moving-platform constraint.

Terminal removal follows the existing ownership set:

1. Determine the objects being retired at the World barrier.
2. Materialize the world poses of surviving children whose direct parent is
   retiring, before unlinking any retiring ancestor.
3. Make those children roots with `local = previous world`; their descendants
   keep their local transforms.
4. Retire the selected objects and their components through their real owners.

Thus Scene unload cannot accidentally destroy another Scene's children. A new
object with the same member name never becomes their replacement parent.
Deleting a spatial subtree is a separate explicit operation over a captured
object set; removing one WorldObject does not mean that operation.

## Evaluation and performance

The forest uses dirty-subtree invalidation and ancestor-first read-through
evaluation, not a full-world transform system before drawing.

- Each spatial instance retains local/world affine buffers, a dirty flag,
  revisions, and parent/child/sibling traversal links.
- A local write marks its node and clean descendants dirty. Encountering an
  already dirty node skips that branch: its descendants are already dirty.
  Initial construction and every attach/detach/reparent invalidate the moved
  subtree, including Keep Local attachment beneath an already dirty parent.
  The invariant is always: a dirty node has only dirty descendants.
- A world query resolves the dirty ancestor chain first, then composes the
  needed nodes downward. Clean queries read the cache in constant time.
- Invalidation uses stackless forest traversal; upward resolution uses
  World-owned reusable ancestor scratch, reserved as spatial shells are
  prepared. Deep authoring graphs do not consume the Lua call stack.
- Evaluation runs without callbacks or yielding. The same World execution
  owner serializes local writes, evaluation and structural commits.
- A derived world revision advances when its pose is recomputed. Consumers
  retain the revisions they consumed; clean frames do not rebuild geometry.
  Basis and origin dependencies remain distinguishable: an origin-only change
  does not invalidate basis-derived collider vertices or packed linear operands.
  Local mutation revisions and the last consumed parent input revisions select
  the work during evaluation; reparenting invalidates that parent identity too.
  This distinction does not weaken the whole-subtree dirty invariant.

A dirty node is recomposed at most once between intervening writes, regardless
of how many visuals, colliders or queries consume it. There is no allocation,
inversion, decomposition or ancestor walk on a clean world read. Repeated
writes before consumption do not repeatedly visit the already dirty subtree.
Reads interleaved with writes can legitimately require another evaluation.

Physics, synchronous movement and rendering all consume this evaluation
boundary. Restricting evaluation to the active Space's gameplay list would
miss inactive ancestors. Waiting until render would give collision stale poses.

## Existing consumers: one pose, explicit geometry and motion

Each consumer binds the spatial family it actually implements and publishes
its own derived representation at its owning boundary.

| Consumer | Target contract |
| --- | --- |
| Sprite, region sprite, text, surface and tile visuals | Transform local geometry through the object's world affine. Preserve retained layout/tile data; retain a translation-only fast datapath where mathematically applicable. Culling consumes transformed bounds. |
| Visual attachment and presentation animation | Compose `objectWorld * attachmentLocal * presentationLocal`. The two local inputs describe geometry placement and explicitly presentation-only effects, not competing object poses. Existing offset/scale/draw-offset fields migrate to these owners. |
| 2D draw ordering | `VisualComponent.order` and an explicit presentation order offset replace object Z and visual Z offsets. Spatial parenting does not imply draw order. Stable tie order remains the render owner's responsibility. |
| Collider2D overlap | Consume object world affine and explicit local collision geometry. A sprite-derived collider has a declared geometry-source binding; image dimensions are not a universal collision fallback. |
| Motion and screen boundaries | Use current world pose, explicit world-space displacement and a declared physical footprint. Motion components own velocity and fractional integration remainder, not a second position. Local-space motion is explicitly named. |
| Timeline spatial channels | Resolve a concrete Transform writer at channel admission. Generated direct property assignments cannot bypass invalidation. Physical channels run before physics; later channels are explicitly presentation-only. |
| 3D visual consumers | Compose object affine with the model's internal asset-node transform. GTE quantization belongs to the GX/GTE producer, not scene code or an editor gizmo. |
| Read-only runtime inspection | Migrate Actor Lab, component/visual inspection and pose/picking consumers with the changed guest fields. Preserve concrete guest identities and observation/suspension lifetimes, not a host DTO or legacy position fallback. |

Object dimensions (`sx/sy/sz` today) describe geometry, not transform scale.
They move to the actual geometry/footprint owner rather than becoming spatial
aliases. Render-only shake, squash or interpolation must not move a physical
collider unless the physical transform is deliberately animated too.

GEO's [overlap interface](book1/geo.md#sec-geo-instances-and-candidate-pairs)
accepts translated shapes, not an instance affine. Collider2D therefore
composes `objectWorld * colliderLocal` and produces retained transformed convex
pieces when its geometry or effective basis changes. Translation updates only
the instance origin. Its bounds are derived from the actual encoded geometry,
so GEO rounding cannot leave broadphase bounds inconsistent with exact data.
A rotated or sheared rectangle becomes a polygon, not an AABB pretending to be
exact geometry. AABB bounds remain broadphase data. Reflections preserve the
producer's polygon ordering convention. Degenerate geometry goes through the
documented overlap rules; the producer does not inflate it or fabricate hits.

The existing tile-grid kinematic motor remains a world-axis-aligned rectangular
sweep with an explicitly supplied footprint. Its prefab declares an
**origin-only root** spatial capability before component construction and
Scene-plan compilation. This is the same Transform2D family/cache with an
identity basis, not another position store. It exposes origin writers, not
basis writers or parenting. The motor and physical timeline channels bind
those writers; full-affine visual children use ordinary transforms beneath it.
The prefab declares this as `spatial.authority = 'root_origin'`; ordinary
transforms declare `'affine'`. Admission resolves that choice to the concrete
writer API, not a flag tested by every pose update.
Composition admission and Studio capabilities enforce that intrinsic root
contract, without ancestry checks or descendant constraint scans on ordinary
pose writes. Rotation/shear of the physical body requires a different solver,
not a larger approximate AABB. General affine overlap does not imply general
affine collision-resolved movement.

## Authored Scene contract

Scenes retain an ordered member list with stable scene-local identities and
explicit parent references. Reparenting need not move or reserialize the
member's Lua source block.

The target source shape is:

```lua
prefab.define({
    def_id = 'ship',
    class = ship_class,
    spatial = {
        family = '2d',
        authority = 'affine',
        local_transform = { 1, 0, 0, 1, 0, 0 },
    },
    components = { ship_sprite_factory },
})

scene_library.register('hangar', {
    objects = {
        {
            member_id = 'ship',
            definition_id = 'ship',
            spatial = { local_transform = { 1, 0, 0, 1, 160, 120 } },
            options = { team = 'player' },
        },
        {
            member_id = 'turret',
            definition_id = 'turret', -- declares Transform2D
            spatial = {
                parent_id = 'ship',
                local_transform = { 1, 0, 0, 1, 12, -4 },
            },
            options = {},
        },
    },
})
```

`parent_id` names a spatial member of this Scene definition, including a later
member. It is not a Registry ID, array index or display label. Each instance
resolves it to that instance's concrete transform. Root members omit it.
A prefab's declared spatial capability supplies the dimensional family and
default local affine; a member can replace the affine as one complete value.
Once constructed, only the instance's retained local affine is authoritative.
Nonspatial definitions have no `spatial` record. Gameplay `options` no longer
carry positional fields or `pos`; procedural spawn uses the same separate
spatial construction input, with a concrete parent reference.

Runtime parenting across Scenes remains explicit instance-level behavior;
authored parent IDs cannot reach into another Scene's namespace. The current
prefab still constructs one WorldObject with ordered components. Nested
prefab graphs, internal ID remapping and overrides are a separate composition
capability, not an accidental second Scene format.

### Compilation and staged construction

Cold Scene compilation at definition admission binds complete, already
registered prefab construction definitions: initializer/constructor, component
factories, defaults and spatial capability. It also binds member identities,
parent indices, stable sibling order and a parent-first construction order.
Duplicate IDs, missing/nonspatial parents, dimensional mismatches, cycles and
parent/nonidentity-basis inputs to a root-origin capability are authoring
diagnostics here. Runtime consumes this compiled plan directly.
Live Scenes retain their exact plan and concrete prefab definitions when a
definition is replaced. A later staged member spawn must not re-resolve its
definition ID and mix new constructors with an old spatial plan. Procedural
spawn resolves its requested prefab once at that request's admission boundary.
Definition affines are immutable inputs; construction copies their coefficients
into the instance's own retained local storage.

Spawning selects an explicit batch. A child's parent must already be live or
be explicitly selected in that batch. Spawning one member never implicitly
spawns a gameplay parent, waits for a namesake or silently turns it into a root.

World owns the construction/admission sequence inside a structural scope,
including when spawn is called outside a tick group:

1. Reserve all batch identities and Scene membership; install all spatial
   components, local affines and parent links before component/user code.
   Each World-owned shell is the final WorldObject identity. Initializers and
   constructors populate that same object; component factories receive its
   actual `owner` reference, not a placeholder later replaced by another object.
2. Construct other components and objects parent-first, with authored order
   as the stable tie-breaker. Constructors see their final construction pose
   but do not perform cross-member gameplay wiring.
3. At the World barrier, omit canceled pending objects. Cancellation of an
   unadmitted required parent also cancels its unadmitted batch descendants;
   they were never live children eligible for keep-world detachment.
4. Publish every surviving object's/component's Registry identity. All batch
   objects are now constructed and addressable, but not scheduled for ticks.
5. Run `onspawn` as the ready/wiring boundary; then bind subscriptions for the
   whole batch before activating objects/components, in stable parent-first
   order. A terminally requested object is skipped before each remaining
   lifecycle callback, including when an earlier callback closes its Scene.
   `onspawn` cannot assume subscriptions exist yet; activation may emit events
   after all surviving peers have bound. No parallel `ready` hook is introduced.
6. Drain callback-requested removals, admissions and other structural changes
   through the same barrier before allowing the next scheduled group to run.

Callbacks can observe fully constructed peers, not a promise that every peer's
activation callback has already run. Reentrant spawns construct within the
same open structural scope and publish in subsequent batches, not recursively
published half-batches. Scene closure retires its pending as well as live owned
set. There is no arbitrary constructor rollback; a thrown constructor error is
a failed construction, not a recoverable partial scene.

The current position-after-constructor and activation-before-publication
behavior is replaced. Single-object spawn uses this same lifecycle; it is not
a second path with different spatial timing.

## Studio correspondence

Studio edits canonical source and derives a preview; cartlib alone owns the
live runtime forest. Hierarchy, Details and viewport attach to the existing
Scene authoring context rather than acquiring independent selections or
executing guest constructors to discover structure.

- Reparent defaults to Keep World, with Keep Local explicit. Parent reference
  and new local affine are one source-edit/Undo unit.
- Delete Member removes that declaration and makes surviving direct authored
  children roots with their previous world affines, in one Undo unit. Delete
  Subtree is explicit and removes the selected authored descendant set.
  Unresolved relationships/poses make the corresponding structured operation
  unavailable; direct source editing can still produce compiler diagnostics.
- Source identity survives list reorder. Renaming a member updates authored
  parent references through the same source-preserving operation.
- Transform evaluation uses the same coefficient convention and operation
  order as cartlib. Host-side math belongs to a shared spatial math owner with
  mirrored scalar fixtures, not feature-local helpers or a shadow guest World.
- Static literal affines and admitted central builders can be projected.
  Arbitrary Lua expressions remain source evidence; an unresolved ancestor
  makes world-space manipulation unavailable rather than inventing a pose.
- A gizmo retains a preview delta until commit; Escape writes nothing.
  Source changes during manipulation use the existing source-authority and
  proposed-edit lifetimes, not a second rollback system.
  The captured authority includes the semantic snapshot and relevant prefab,
  ancestor, builder and asset-provider dependencies, not only the selected
  Scene document. A dependency change invalidates a computed pose/edit too.
- Runtime-to-source pose application needs exact member/instance/property
  correspondence and explicit user action. A runtime namesake is insufficient.

An authored viewport still needs asset/proxy resolution, an authoring renderer,
camera navigation, picking, framing and gizmos. None follows automatically from
runtime hierarchy or an image captured from a running game.

The [read-only inspection contract](cartlib_inspection_contract.md) continues
to describe the implemented layout until migration. The new observation path
projects poses from coherently captured local affines and concrete parent
links using shared host math; it does not execute a guest getter to refresh a
dirty cache. That captured projection is not another live runtime forest.

## Delivery boundaries and evidence

The target is deliberately broader than its first implementation. Admission
requires working producers and consumers; merely reserving an API is not a
completed capability.

| Boundary | Concrete first consumer and acceptance |
| --- | --- |
| 2D math, World forest and lifecycle | Empty spatial parent plus sprite/collider children in a dedicated fixture; same pose in construction, synchronous query and render. Migrate all existing position producers, consumers and read-only inspection proofs together; no old-field mirror. |
| Authored hierarchy | Cold Scene compiler and source-backed outline/reparent editing; explicit staged batches and stable instance identity. Existing carts migrate to the authored shape. |
| Main authored viewport | The actual Scene authoring context supplies asset correspondence, selection and source edits; visible picking/manipulation evidence supplements domain tests. |
| 3D affine family | Mathematical contract specified here; integrate with a concrete 3D visual consumer and GX producer before calling 3D support complete. A reusable mesh component is currently a separate cartlib gap. |
| Later domain extensions | Nested prefab graphs, attachment sockets/bones, transform constraints, moving-platform motion and inherited visibility are separate product contracts, not hidden behavior of the parent edge. |

Regression evidence uses synthetic fixtures or dedicated test carts, never the
changing contents of ordinary carts:

| Owner contract | Required cases |
| --- | --- |
| Affine math | Composition/inverse and point/vector distinction in 2D/3D; non-uniform scale, reflection, shear, zero basis; no TRS loss in keep-world. |
| Structural commits | Keep Local/World, self/cycles, cross-World/dimension rejection, sequential commands, retired targets, singular-parent inverse rejection versus valid Keep Local; failure leaves local state and links untouched. |
| Partitions/lifetime | Inactive and cross-Space ancestors, Space changes, cross-Scene parenting/unload, surviving-child detachment, namesake respawn, explicit subtree deletion. |
| Construction | Forward parent IDs, explicit parent batch, missing parent, constructor pose, all constructed before `onspawn`, cancellation, callback disposal, pending Scene closure and exact retained prefab definitions after replacement. |
| Consumers | Visual/collision agreement, transformed bounds and reflected pieces, degenerate overlap rules, world-space motion, tile-motor constraint, physical versus presentation timeline phases. |
| Source authority | One Undo for reparent or member deletion plus child affines, untouched comments/bytes, rename/reorder, dynamic ancestor, concurrent source/dependency changes, no guest execution for authored preview. |
| Performance | Clean reads/static frames allocate and compose nothing; repeated pre-read writes skip dirty subtrees; multiple consumers share one evaluation; deep graphs and changed branches avoid full-World scans. |

These are behavioral, representation and lifetime contracts, not assertions
about UI labels or incidental pixel coordinates. The implementation may change
its retained storage layout without changing these contracts.
