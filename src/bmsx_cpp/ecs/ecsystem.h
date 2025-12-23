/*
 * ecsystem.h - Entity Component System infrastructure
 *
 * Mirrors TypeScript ecs/ecsystem.ts
 * Defines TickGroups, ECSystem base class, and ECSystemManager.
 */

#ifndef BMSX_ECSYSTEM_H
#define BMSX_ECSYSTEM_H

#include "../core/types.h"
#include <string>
#include <vector>
#include <memory>
#include <functional>
#include <unordered_map>

namespace bmsx {

// Forward declarations
class World;
class WorldObject;

/* ============================================================================
 * TickGroup enumeration
 *
 * Defines coarse scheduling phases for systems.
 * Mirrors TypeScript TickGroup enum.
 * ============================================================================ */

enum class TickGroup : i32 {
    Input = 10,           // Input gathering and preprocessing
    ActionEffect = 20,    // Apply action effects (before physics)
    ModeResolution = 30,  // Resolve game modes and states
    Physics = 40,         // Physics simulation and collision detection
    Animation = 50,       // Animation updates and rendering
    Presentation = 60,    // Final rendering and presentation
    EventFlush = 70,      // Flush events
};

/* ============================================================================
 * ECSystem base class
 *
 * Abstract base for all ECS systems.
 * Systems are organized by group and priority.
 * ============================================================================ */

class ECSystem {
public:
    const TickGroup group;
    const i32 priority;
    std::string ecsId;          // Optional identifier for debugging/stats
    bool runsWhileGamePaused = false;

    ECSystem(TickGroup group, i32 priority = 0)
        : group(group), priority(priority)
    {
        ecsId = typeid(*this).name();
    }

    virtual ~ECSystem() = default;

    virtual void update(World& world) = 0;
};

/* ============================================================================
 * System timing stats
 * ============================================================================ */

struct SystemStats {
    std::string id;
    std::string name;
    TickGroup group;
    i32 priority;
    f64 ms;  // Milliseconds spent in this system
};

/* ============================================================================
 * ECSystemManager
 *
 * Manages registration and scheduling of ECS systems.
 * ============================================================================ */

class ECSystemManager {
public:
    ECSystemManager() = default;
    ~ECSystemManager() = default;

    // System registration
    void registerSystem(ECSystem* sys);
    void unregisterSystem(ECSystem* sys);
    void clear();

    // Per-frame stats
    void beginFrame();
    const std::vector<SystemStats>& getStats() const { return m_stats; }

    // Update methods for different scheduling needs
    void updateUntil(World& world, TickGroup maxGroup);
    void updateFrom(World& world, TickGroup minGroup);
    void updatePhase(World& world, TickGroup group);
    void runPaused(World& world);

    // Full frame update (all systems)
    void update(World& world);

    // Access registered systems
    const std::vector<ECSystem*>& systems() const { return m_systems; }

private:
    void sortSystems();

    std::vector<ECSystem*> m_systems;
    std::vector<SystemStats> m_stats;
};

/* ============================================================================
 * Built-in system classes
 *
 * Mirrors TypeScript system classes.
 * ============================================================================ */

// BehaviorTreeSystem: Updates all BehaviorTrees attached to objects
class BehaviorTreeSystem : public ECSystem {
public:
    explicit BehaviorTreeSystem(i32 priority = 0)
        : ECSystem(TickGroup::Input, priority) {}

    void update(World& world) override;
};

// StateMachineSystem: Ticks each object's primary state machine
class StateMachineSystem : public ECSystem {
public:
    explicit StateMachineSystem(i32 priority = 0)
        : ECSystem(TickGroup::ModeResolution, priority) {}

    void update(World& world) override;
};

// PrePositionSystem: Captures old positions before physics
class PrePositionSystem : public ECSystem {
public:
    explicit PrePositionSystem(i32 priority = 0)
        : ECSystem(TickGroup::Physics, priority) {}

    void update(World& world) override;
};

// BoundarySystem: Runs screen boundary checks and emits events
class BoundarySystem : public ECSystem {
public:
    explicit BoundarySystem(i32 priority = 5)
        : ECSystem(TickGroup::Physics, priority) {}

    void update(World& world) override;

private:
    std::unordered_map<WorldObject*, Vec2> m_prev;
};

// TileCollisionSystem: Resolves tile collisions
class TileCollisionSystem : public ECSystem {
public:
    explicit TileCollisionSystem(i32 priority = 10)
        : ECSystem(TickGroup::Physics, priority) {}

    void update(World& world) override;
};

// PhysicsWorldStepSystem: Steps the physics simulation
class PhysicsWorldStepSystem : public ECSystem {
public:
    explicit PhysicsWorldStepSystem(i32 priority = 20)
        : ECSystem(TickGroup::Physics, priority) {}

    void update(World& world) override;
};

// PhysicsPostSystem: Syncs PhysicsBody -> WorldObject
class PhysicsPostSystem : public ECSystem {
public:
    explicit PhysicsPostSystem(i32 priority = 25)
        : ECSystem(TickGroup::Physics, priority) {}

    void update(World& world) override;
};

// TransformSystem: Updates TransformComponent from WorldObject state
class TransformSystem : public ECSystem {
public:
    explicit TransformSystem(i32 priority = 30)
        : ECSystem(TickGroup::Physics, priority) {}

    void update(World& world) override;
};

// MeshAnimationSystem: Steps GLTF-based mesh animations
class MeshAnimationSystem : public ECSystem {
public:
    explicit MeshAnimationSystem(i32 priority = 0)
        : ECSystem(TickGroup::Animation, priority) {}

    void update(World& world) override;
};

// RenderSubmitSystem: Submits objects for rendering
class RenderSubmitSystem : public ECSystem {
public:
    explicit RenderSubmitSystem(i32 priority = 0)
        : ECSystem(TickGroup::Presentation, priority) {}

    void update(World& world) override;
};

} // namespace bmsx

#endif // BMSX_ECSYSTEM_H
