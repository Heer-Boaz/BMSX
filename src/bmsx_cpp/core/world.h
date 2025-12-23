/*
 * world.h - World and Space management for BMSX
 *
 * This mirrors the TypeScript World/Space/WorldObject architecture.
 * Key differences from generic game engines:
 * - WorldObject has NO tick() or paint() methods
 * - Ticking is handled by World.run() via Systems (ECS-style phases)
 * - Rendering is handled by Components and Systems, not WorldObject
 * - FSM state machines drive object behavior via StateMachineController
 */

#ifndef BMSX_WORLD_H
#define BMSX_WORLD_H

#include "types.h"
#include "registry.h"
#include "fsm.h"
#include "../subscription.h"
#include "../ecs/ecsystem.h"
#include <string>
#include <vector>
#include <unordered_map>
#include <memory>
#include <functional>

namespace bmsx {

// Forward declarations
class World;
class Space;
class WorldObject;
class Component;
class GameView;

/* ============================================================================
 * EventPort - Simple event messaging between objects (placeholder)
 * ============================================================================ */

class EventPort {
public:
    EventPort() = default;
    ~EventPort() = default;

    // Event emission with key-value parameters
    template<typename T = std::string>
    void emit(const std::string& eventName, std::initializer_list<std::pair<std::string, T>> params = {}) {
        // TODO: Implement actual event dispatch
        (void)eventName;
        (void)params;
    }
    
    // Overload for string-variant pairs
    void emit(const std::string& eventName, std::initializer_list<std::pair<const char*, const char*>> params) {
        (void)eventName;
        (void)params;
    }
};

// Identifier is defined in registry.h

/* ============================================================================
 * Spawn reasons (matches TypeScript SpawnReason)
 * ============================================================================ */

enum class SpawnReason {
    Fresh,      // New object being spawned
    Transfer,   // Object moving between spaces
    Revive      // Object being restored from save state
};

/* ============================================================================
 * TickGroup enum - defined in ecs/ecsystem.h
 * Forward declared here to avoid circular dependencies.
 * ============================================================================ */

// Forward declaration - actual definition in ecs/ecsystem.h
enum class TickGroup : i32;

// Component is defined in component/component.h
// Forward declared here to avoid circular dependencies
class Component;

/* ============================================================================
 * ComponentContainer interface - for objects that hold components
 * ============================================================================ */

using KeyToComponentMap = std::unordered_map<std::string, std::vector<Component*>>;

/* ============================================================================
 * WorldObject - Base class for all game objects
 *
 * IMPORTANT: WorldObject does NOT have tick() or paint() methods!
 * - Ticking is driven by World.run() → Systems
 * - Rendering is driven by Components (SpriteComponent, etc.)
 * - Behavior is driven by StateMachineController (sc)
 * ============================================================================ */

class WorldObject : public Registerable {
public:
    WorldObject();
    explicit WorldObject(const Identifier& id);
    virtual ~WorldObject();

    // ─────────────────────────────────────────────────────────────────────────
    // Identity
    // ─────────────────────────────────────────────────────────────────────────
    Identifier id;
    const Identifier& registryId() const override { return id; }

    // ─────────────────────────────────────────────────────────────────────────
    // Position (vec3)
    // ─────────────────────────────────────────────────────────────────────────
protected:
    Vec3 _pos{0.0f, 0.0f, 0.0f};

public:
    const Vec3& pos() const { return _pos; }
    void setPos(const Vec3& p) { _pos = p; }

    f32 x() const { return _pos.x; }
    f32 y() const { return _pos.y; }
    f32 z() const { return _pos.z; }

    void setX(f32 v);  // May trigger component updates
    void setY(f32 v);
    void setZ(f32 v);

    // No-notify setters (direct position set without side effects)
    void setX_nonotify(f32 v) { _pos.x = v; }
    void setY_nonotify(f32 v) { _pos.y = v; }
    void setZ_nonotify(f32 v) { _pos.z = v; }
    void setPos_nonotify(const Vec3& p) { _pos = p; }

    // ─────────────────────────────────────────────────────────────────────────
    // Size (vec3)
    // ─────────────────────────────────────────────────────────────────────────
protected:
    Vec3 _size{0.0f, 0.0f, 0.0f};

public:
    const Vec3& size() const { return _size; }
    void setSize(const Vec3& s) { _size = s; }

    f32 sx() const { return _size.x; }
    f32 sy() const { return _size.y; }
    f32 sz() const { return _size.z; }

    void setSx(f32 v) { _size.x = v; }
    void setSy(f32 v) { _size.y = v; }
    void setSz(f32 v) { _size.z = v; }

    // Derived position helpers
    f32 x_plus_width() const { return _pos.x + _size.x; }
    f32 y_plus_height() const { return _pos.y + _size.y; }
    Vec3 center() const;

    // ─────────────────────────────────────────────────────────────────────────
    // State flags
    // ─────────────────────────────────────────────────────────────────────────
    bool active = false;           // Part of world and participating in gameplay
    bool tick_enabled = false;     // Systems should advance time-based logic
    bool tickEnabled = false;      // Alias for tick_enabled (mirrors TS property)
    bool visible = true;           // Should be rendered
    bool eventhandling_enabled = false;
    
    // Player index for multiplayer/input assignment
    i32 player_index = 1;
    i32 playerIndex() const { return player_index; }

    // ─────────────────────────────────────────────────────────────────────────
    // Disposal
    // ─────────────────────────────────────────────────────────────────────────
private:
    bool _dispose_flag = false;
    bool _disposed = false;

public:
    bool disposeFlag() const { return _dispose_flag; }
    void markForDisposal();

    // ─────────────────────────────────────────────────────────────────────────
    // State Machine Controller (FSM)
    // ─────────────────────────────────────────────────────────────────────────
    std::unique_ptr<StateMachineController> sc;

    // Accessor for state controller (mirrors TypeScript property)
    StateMachineController* stateController() { return sc.get(); }

    // ─────────────────────────────────────────────────────────────────────────
    // Rendering
    // ─────────────────────────────────────────────────────────────────────────
    virtual void submitForRendering(class GameView* view);

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────
    std::unique_ptr<EventPort> events;

    // ─────────────────────────────────────────────────────────────────────────
    // Components
    // ─────────────────────────────────────────────────────────────────────────
    std::vector<std::unique_ptr<Component>> components;
    KeyToComponentMap componentMap;

    template<typename T, typename... Args>
    T* addComponent(Args&&... args) {
        auto comp = std::make_unique<T>(std::forward<Args>(args)...);
        T* ptr = comp.get();
        addComponentInternal(std::move(comp));
        return ptr;
    }

    void addComponentInternal(std::unique_ptr<Component> comp);
    void removeComponent(Component* comp);

    template<typename T>
    T* getFirstComponent() {
        std::string key = std::string(T::typeName());
        auto it = componentMap.find(key);
        if (it != componentMap.end() && !it->second.empty()) {
            return static_cast<T*>(it->second[0]);
        }
        return nullptr;
    }

    template<typename T>
    std::vector<T*> getComponents() {
        std::vector<T*> result;
        std::string key = std::string(T::typeName());
        auto it = componentMap.find(key);
        if (it != componentMap.end()) {
            for (auto* c : it->second) {
                result.push_back(static_cast<T*>(c));
            }
        }
        return result;
    }

    template<typename T>
    bool hasComponent() const {
        std::string key = std::string(T::typeName());
        auto it = componentMap.find(key);
        return it != componentMap.end() && !it->second.empty();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lifecycle methods (concrete implementations, NOT virtual overrides!)
    // ─────────────────────────────────────────────────────────────────────────

    // Called when object is spawned into a space
    void onspawn(const Vec3* pos = nullptr, SpawnReason reason = SpawnReason::Fresh);

    // Called when object is removed from its space without being destroyed
    void ondespawn();

    // BeginPlay-style activation (registers, starts FSM, enables ticking)
    void activate();

    // Pauses ticking and event handling
    void deactivate();

    // Full cleanup
    void dispose();

    // Bind/unbind for event wiring
    void bind();
    void unbind();

protected:
    // ID generation
    static u64 s_nextId;
    Identifier generateId();

private:
    void addAutoComponents();
    void initializeLinkedFSMs();
};

/* ============================================================================
 * Space - Container for WorldObjects (like a level/room/scene)
 * ============================================================================ */

class Space {
public:
    explicit Space(const Identifier& id);
    ~Space();

    Identifier id;

    // Objects in this space (non-owning pointers, World owns the objects)
    std::vector<WorldObject*> objects;
    std::unordered_map<Identifier, WorldObject*> objectsById;

    // Object management
    void addObject(WorldObject* obj);
    void removeObject(WorldObject* obj, bool skipOnDespawn = false);
    void clear();

    // Lookup
    WorldObject* get(const Identifier& objId);
    bool contains(const Identifier& objId) const;

    // Depth sorting
    bool depthSortDirty = true;
    void sortByDepth();

    // Iteration
    template<typename Func>
    void forEach(Func&& fn) {
        for (auto* obj : objects) {
            fn(obj);
        }
    }
};

/* ============================================================================
 * World - The game world containing all spaces and objects
 *
 * World.run() drives the update loop through phases (Systems).
 * Individual WorldObjects do NOT have tick() methods.
 * ============================================================================ */

class World : public Registerable {
public:
    World();
    ~World();

    // ─────────────────────────────────────────────────────────────────────────
    // Identity
    // ─────────────────────────────────────────────────────────────────────────
    const Identifier& registryId() const override {
        static const Identifier worldId = "world";
        return worldId;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Space management
    // ─────────────────────────────────────────────────────────────────────────
    Space* addSpace(const Identifier& spaceId);
    void removeSpace(const Identifier& spaceId);
    Space* getSpace(const Identifier& spaceId);

    void setActiveSpace(const Identifier& spaceId);
    Space* activeSpace() const { return _activeSpace; }
    const Identifier& activeSpaceId() const { return _activeSpaceId; }

    // ─────────────────────────────────────────────────────────────────────────
    // Object management
    // ─────────────────────────────────────────────────────────────────────────
    void spawn(WorldObject* obj, const Identifier& spaceId, const Vec3* pos = nullptr);
    void despawn(WorldObject* obj);
    void despawnFromAllSpaces(WorldObject* obj);
    void transferObject(WorldObject* obj, const Identifier& toSpaceId);

    bool exists(const Identifier& objId) const;
    WorldObject* getObject(const Identifier& objId);
    Space* getSpaceOfObject(const Identifier& objId);

    u64 getNextIdNumber() { return _nextIdNumber++; }

    // Mark depth sorting dirty for an object
    void markDepthDirtyForObjectId(const Identifier& objId);

    // ─────────────────────────────────────────────────────────────────────────
    // Object iteration (mirrors TypeScript world.objects())
    // ─────────────────────────────────────────────────────────────────────────
    struct ObjectScope {
        bool activeOnly = true;
        // TODO: Add component filter support
    };

    // Returns objects from active space
    std::vector<WorldObject*> objects(const ObjectScope& scope = {true});

    // Returns pairs of (object, component) for all objects that have component T
    template<typename T>
    std::vector<std::pair<WorldObject*, T*>> objectsWithComponents(const ObjectScope& scope = {true}) {
        std::vector<std::pair<WorldObject*, T*>> result;
        for (auto* obj : objects(scope)) {
            T* comp = obj->getFirstComponent<T>();
            if (comp) {
                result.push_back({obj, comp});
            }
        }
        return result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Physics
    // ─────────────────────────────────────────────────────────────────────────
    void stepPhysics(f64 dt);
    
    // Tile collision query (used by TileCollisionSystem)
    bool collidesWithTile(WorldObject* obj, const std::string& direction) const;

    // ─────────────────────────────────────────────────────────────────────────
    // Game dimensions
    // ─────────────────────────────────────────────────────────────────────────
    i32 gameWidth() const { return _gameWidth; }
    i32 gameHeight() const { return _gameHeight; }
    void setGameDimensions(i32 w, i32 h) { _gameWidth = w; _gameHeight = h; }

    // ─────────────────────────────────────────────────────────────────────────
    // Main update loop (drives Systems, NOT individual object tick()!)
    // ─────────────────────────────────────────────────────────────────────────
    void run(f64 deltaTime);

    // Current tick phase (null when not in run())
    TickGroup currentPhase() const { return _currentPhase; }

    // ─────────────────────────────────────────────────────────────────────────
    // FSM Controller (World can have its own state machine)
    // ─────────────────────────────────────────────────────────────────────────
    std::unique_ptr<StateMachineController> sc;

private:
    // Spaces
    std::vector<std::unique_ptr<Space>> _spaces;
    std::unordered_map<Identifier, Space*> _spaceMap;

    // Active space
    Space* _activeSpace = nullptr;
    Identifier _activeSpaceId;

    // Object → Space mapping
    std::unordered_map<Identifier, Identifier> _objToSpaceMap;

    // ID generation
    u64 _nextIdNumber = 1;

    // Current tick phase
    TickGroup _currentPhase = TickGroup::Input;
    
    // Game dimensions (screen/viewport size)
    i32 _gameWidth = 256;
    i32 _gameHeight = 240;
};

} // namespace bmsx

#endif // BMSX_WORLD_H
