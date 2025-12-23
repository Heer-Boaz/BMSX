/*
 * world.h - World and Space management for BMSX
 *
 * This mirrors the TypeScript World/Space architecture where:
 * - World contains multiple Spaces
 * - Each Space contains WorldObjects
 * - Objects can be transferred between spaces
 * - The World manages the active space and lifecycle events
 */

#ifndef BMSX_WORLD_H
#define BMSX_WORLD_H

#include "types.h"
#include "registry.h"
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

/* ============================================================================
 * Identifier type (string-based, like TypeScript)
 * ============================================================================ */

using Identifier = std::string;

/* ============================================================================
 * Spawn reasons (matches TypeScript SpawnReason)
 * ============================================================================ */

enum class SpawnReason {
    Fresh,      // New object being spawned
    Transfer,   // Object moving between spaces
    Revive      // Object being restored from save state
};

/* ============================================================================
 * World lifecycle context
 * ============================================================================ */

struct WorldLifecycleContext {
    World* world = nullptr;
    Identifier spaceId;
    SpawnReason reason = SpawnReason::Fresh;
    Vec3 position;
};

/* ============================================================================
 * Component - Base class for all components
 * ============================================================================ */

class Component {
public:
    virtual ~Component() = default;

    Identifier id;
    Identifier id_local;  // Local identifier within the parent object
    WorldObject* parent = nullptr;

    virtual void attach(WorldObject* owner) { parent = owner; }
    virtual void detach() { parent = nullptr; }
    virtual void tick(f64 dt) { (void)dt; }

    // Type name for serialization/reflection
    virtual std::string_view typeName() const = 0;
};

/* ============================================================================
 * WorldObject - Base class for all game objects
 * ============================================================================ */

class WorldObject {
public:
    WorldObject();
    explicit WorldObject(const Identifier& id);
    virtual ~WorldObject();

    // Identity
    Identifier id;

    // Transform (position in world space)
    f32 x = 0.0f;
    f32 y = 0.0f;
    f32 z = 0.0f;

    // Size
    f32 width = 0.0f;
    f32 height = 0.0f;
    f32 depth = 0.0f;

    // Visibility
    bool visible = true;

    // Components
    std::vector<std::unique_ptr<Component>> components;
    std::unordered_map<std::string, std::vector<Component*>> componentMap;

    template<typename T, typename... Args>
    T* addComponent(Args&&... args) {
        auto comp = std::make_unique<T>(std::forward<Args>(args)...);
        T* ptr = comp.get();
        comp->attach(this);
        components.push_back(std::move(comp));

        // Add to type map
        std::string key = std::string(ptr->typeName());
        componentMap[key].push_back(ptr);

        return ptr;
    }

    template<typename T>
    T* getComponent() {
        std::string key = T::staticTypeName();
        auto it = componentMap.find(key);
        if (it != componentMap.end() && !it->second.empty()) {
            return static_cast<T*>(it->second[0]);
        }
        return nullptr;
    }

    template<typename T>
    std::vector<T*> getComponents() {
        std::vector<T*> result;
        std::string key = T::staticTypeName();
        auto it = componentMap.find(key);
        if (it != componentMap.end()) {
            for (auto* c : it->second) {
                result.push_back(static_cast<T*>(c));
            }
        }
        return result;
    }

    template<typename T>
    bool hasComponent() {
        std::string key = T::staticTypeName();
        auto it = componentMap.find(key);
        return it != componentMap.end() && !it->second.empty();
    }

    void removeComponent(Component* comp);

    // Lifecycle hooks (virtual, can be overridden)
    virtual void onspawn(const Vec3* pos = nullptr, SpawnReason reason = SpawnReason::Fresh);
    virtual void ondespawn();
    virtual void tick(f64 dt);
    virtual void paint();

    // Disposal
    bool markedForDisposal = false;
    void markForDisposal() { markedForDisposal = true; }
    virtual void dispose();

    // Position helpers
    Vec3 position() const { return {x, y, z}; }
    void setPosition(const Vec3& pos) { x = pos.x; y = pos.y; z = pos.z; }
    void setPosition(f32 px, f32 py, f32 pz = 0.0f) { x = px; y = py; z = pz; }
};

/* ============================================================================
 * Space - Container for WorldObjects (like a level/room/scene)
 * ============================================================================ */

class Space {
public:
    explicit Space(const Identifier& id);
    ~Space();

    Identifier id;

    // Objects in this space
    std::vector<WorldObject*> objects;
    std::unordered_map<Identifier, WorldObject*> objectsById;

    // Object management
    void spawn(WorldObject* obj, const Vec3* pos = nullptr, SpawnReason reason = SpawnReason::Fresh);
    void despawn(WorldObject* obj, bool skipOnDespawn = false);
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

    template<typename T, typename Func>
    void forEachOfType(Func&& fn) {
        for (auto* obj : objects) {
            if (auto* typed = dynamic_cast<T*>(obj)) {
                fn(typed);
            }
        }
    }
};

/* ============================================================================
 * World - Main container for all Spaces and game state
 * ============================================================================ */

class World : public Registerable {
public:
    World();
    ~World();

    // Registerable interface
    const std::string& getId() const override { return id; }
    bool isRegistryPersistent() const override { return true; }

    // Identity (always "world")
    Identifier id = "world";

    // Spaces
    std::vector<std::unique_ptr<Space>> spaces;
    std::unordered_map<Identifier, Space*> spaceMap;

    // Object-to-space mapping
    std::unordered_map<Identifier, Identifier> objToSpaceMap;

    // Active space
    Identifier activeSpaceId;
    Space* activeSpace = nullptr;

    // Paused state
    bool paused = false;

    // Viewport size
    i32 viewportWidth = 256;
    i32 viewportHeight = 224;

    // Space management
    Space* addSpace(const Identifier& id);
    void removeSpace(const Identifier& id);
    Space* getSpace(const Identifier& id);
    void setActiveSpace(const Identifier& id);

    // Object management
    void spawn(WorldObject* obj, const Vec3* pos = nullptr, SpawnReason reason = SpawnReason::Fresh);
    void despawnFromAllSpaces(WorldObject* obj);
    void despawnFromActiveSpace(WorldObject* obj);
    void transfer(WorldObject* obj, const Identifier& toSpaceId);
    void destroy(WorldObject* obj);

    // Lookup
    WorldObject* getObject(const Identifier& objId);
    Space* getSpaceOfObject(const Identifier& objId);

    // Lifecycle dispatch
    void dispatchLifecycleSlot(WorldObject* obj, const std::string& slot, const WorldLifecycleContext& ctx);

    // Update
    void tick(f64 dt);
    void clearAllSpaces();

    // Iteration
    template<typename Func>
    void forEachObject(Func&& fn, bool activeOnly = true) {
        if (activeOnly && activeSpace) {
            activeSpace->forEach(std::forward<Func>(fn));
        } else {
            for (auto& sp : spaces) {
                sp->forEach(std::forward<Func>(fn));
            }
        }
    }

    template<typename T, typename Func>
    void forEachObjectOfType(Func&& fn, bool activeOnly = true) {
        if (activeOnly && activeSpace) {
            activeSpace->forEachOfType<T>(std::forward<Func>(fn));
        } else {
            for (auto& sp : spaces) {
                sp->forEachOfType<T>(std::forward<Func>(fn));
            }
        }
    }

    // Component iteration across all objects
    template<typename T, typename Func>
    void forEachComponent(Func&& fn, bool activeOnly = true) {
        forEachObject([&fn](WorldObject* obj) {
            auto comps = obj->getComponents<T>();
            for (auto* c : comps) {
                fn(obj, c);
            }
        }, activeOnly);
    }
};

} // namespace bmsx

#endif // BMSX_WORLD_H
