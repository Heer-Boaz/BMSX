/*
 * ecsystem.cpp - Entity Component System implementation
 */

#include "ecsystem.h"
#include "../core/world.h"
#include "../core/engine.h"
#include "../component/timelinecomponent.h"
#include <algorithm>
#include <cmath>

namespace bmsx {

/* ============================================================================
 * ECSystemManager implementation
 * ============================================================================ */

void ECSystemManager::registerSystem(ECSystem* sys) {
    m_systems.push_back(sys);
    sortSystems();
}

void ECSystemManager::unregisterSystem(ECSystem* sys) {
    auto it = std::find(m_systems.begin(), m_systems.end(), sys);
    if (it != m_systems.end()) {
        m_systems.erase(it);
    }
}

void ECSystemManager::clear() {
    m_systems.clear();
}

void ECSystemManager::sortSystems() {
    std::sort(m_systems.begin(), m_systems.end(), [](ECSystem* a, ECSystem* b) {
        if (a->group != b->group) {
            return static_cast<i32>(a->group) < static_cast<i32>(b->group);
        }
        return a->priority < b->priority;
    });
}

void ECSystemManager::beginFrame() {
    m_stats.clear();
}

void ECSystemManager::updateUntil(World& world, TickGroup maxGroup) {
    for (auto* sys : m_systems) {
        if (static_cast<i32>(sys->group) <= static_cast<i32>(maxGroup)) {
            f64 t0 = 0, t1 = 0;
            auto* clk = EngineCore::instance().clock();
            if (clk) t0 = clk->now();
            sys->update(world);
            if (clk) t1 = clk->now();

            m_stats.push_back({
                sys->ecsId,
                sys->ecsId,
                sys->group,
                sys->priority,
                t1 - t0
            });
        }
    }
}

void ECSystemManager::updateFrom(World& world, TickGroup minGroup) {
    for (auto* sys : m_systems) {
        if (static_cast<i32>(sys->group) >= static_cast<i32>(minGroup)) {
            f64 t0 = 0, t1 = 0;
            auto* clk = EngineCore::instance().clock();
            if (clk) t0 = clk->now();
            sys->update(world);
            if (clk) t1 = clk->now();

            m_stats.push_back({
                sys->ecsId,
                sys->ecsId,
                sys->group,
                sys->priority,
                t1 - t0
            });
        }
    }
}

void ECSystemManager::updatePhase(World& world, TickGroup group) {
    for (auto* sys : m_systems) {
        if (sys->group == group) {
            f64 t0 = 0, t1 = 0;
            auto* clk = EngineCore::instance().clock();
            if (clk) t0 = clk->now();
            sys->update(world);
            if (clk) t1 = clk->now();

            m_stats.push_back({
                sys->ecsId,
                sys->ecsId,
                sys->group,
                sys->priority,
                t1 - t0
            });
        }
    }
}

void ECSystemManager::runPaused(World& world) {
    beginFrame();
    for (auto* sys : m_systems) {
        if (!sys->runsWhileGamePaused) continue;

        f64 t0 = 0, t1 = 0;
        auto* clk = EngineCore::instance().clock();
        if (clk) t0 = clk->now();
        sys->update(world);
        if (clk) t1 = clk->now();

        m_stats.push_back({
            sys->ecsId,
            sys->ecsId,
            sys->group,
            sys->priority,
            t1 - t0
        });
    }
}

void ECSystemManager::update(World& world) {
    beginFrame();
    for (auto* sys : m_systems) {
        f64 t0 = 0, t1 = 0;
        auto* clk = EngineCore::instance().clock();
        if (clk) t0 = clk->now();
        sys->update(world);
        if (clk) t1 = clk->now();

        m_stats.push_back({
            sys->ecsId,
            sys->ecsId,
            sys->group,
            sys->priority,
            t1 - t0
        });
    }
}

/* ============================================================================
 * Built-in system implementations
 * ============================================================================ */

void BehaviorTreeSystem::update(World& world) {
    // TODO: Iterate objects and tick behavior trees
    (void)world;
}

void StateMachineSystem::update(World& world) {
    // Tick all world objects' state machines
    for (auto* obj : world.objects()) {
        if (!obj->active || !obj->tickEnabled) continue;

        auto* sc = obj->stateController();
        if (sc && sc->tickEnabled) {
            sc->tick();
        }
    }
}

void PrePositionSystem::update(World& world) {
    // Capture old positions for collision resolution
    // Would iterate PositionUpdateAxisComponent instances
    (void)world;
}

void BoundarySystem::update(World& world) {
    i32 width = world.gameWidth();
    i32 height = world.gameHeight();
    
    // Would iterate ScreenBoundaryComponent instances
    for (auto* obj : world.objects()) {
        if (!obj->active) continue;
        
        auto it = m_prev.find(obj);
        Vec2 prev = it != m_prev.end() ? it->second : Vec2{obj->x(), obj->y()};
        
        f32 oldx = prev.x;
        f32 oldy = prev.y;
        f32 newx = obj->x();
        f32 newy = obj->y();
        f32 sizeX = obj->sx();
        f32 sizeY = obj->sy();
        
        // X-axis boundary checks
        if (newx < oldx) {
            if (newx + sizeX < 0) {
                obj->events->emit("screen.leave", {{"d", "left"}});
            } else if (newx < 0) {
                obj->events->emit("screen.leaving", {{"d", "left"}});
            }
        } else if (newx > oldx) {
            if (newx >= static_cast<f32>(width)) {
                obj->events->emit("screen.leave", {{"d", "right"}});
            } else if (newx + sizeX >= static_cast<f32>(width)) {
                obj->events->emit("screen.leaving", {{"d", "right"}});
            }
        }
        
        // Y-axis boundary checks
        if (newy < oldy) {
            if (newy + sizeY < 0) {
                obj->events->emit("screen.leave", {{"d", "up"}});
            } else if (newy < 0) {
                obj->events->emit("screen.leaving", {{"d", "up"}});
            }
        } else if (newy > oldy) {
            if (newy >= static_cast<f32>(height)) {
                obj->events->emit("screen.leave", {{"d", "down"}});
            } else if (newy + sizeY >= static_cast<f32>(height)) {
                obj->events->emit("screen.leaving", {{"d", "down"}});
            }
        }
        
        m_prev[obj] = Vec2{obj->x(), obj->y()};
    }
}

void TileCollisionSystem::update(World& world) {
    constexpr i32 TILE_SIZE = 16; // Would come from config
    
    // Would iterate TileCollisionComponent instances
    for (auto* obj : world.objects()) {
        if (!obj->active) continue;
        
        // Would get old position from component
        f32 oldx = obj->x();
        f32 oldy = obj->y();
        f32 newx = obj->x();
        f32 newy = obj->y();
        
        // X axis movement
        if (newx < oldx) {
            if (world.collidesWithTile(obj, "left")) {
                obj->events->emit("wallcollide", {{"d", "left"}});
                newx += static_cast<f32>(TILE_SIZE) - std::fmod(newx, static_cast<f32>(TILE_SIZE));
            }
            obj->setX(newx);
        } else if (newx > oldx) {
            if (world.collidesWithTile(obj, "right")) {
                obj->events->emit("wallcollide", {{"d", "right"}});
                newx -= std::fmod(newx, static_cast<f32>(TILE_SIZE));
            }
            obj->setX(newx);
        }
        
        // Y axis movement
        if (newy < oldy) {
            if (world.collidesWithTile(obj, "up")) {
                obj->events->emit("wallcollide", {{"d", "up"}});
                newy += static_cast<f32>(TILE_SIZE) - std::fmod(newy, static_cast<f32>(TILE_SIZE));
            }
            obj->setY(newy);
        } else if (newy > oldy) {
            if (world.collidesWithTile(obj, "down")) {
                obj->events->emit("wallcollide", {{"d", "down"}});
                newy -= std::fmod(newy, static_cast<f32>(TILE_SIZE));
            }
            obj->setY(newy);
        }
    }
}

void PhysicsWorldStepSystem::update(World& world) {
    f64 dt = EngineCore::instance().deltaTime();
    world.stepPhysics(dt);
}

void PhysicsPostSystem::update(World& world) {
    // Sync physics bodies back to world objects
    (void)world;
}

void TransformSystem::update(World& world) {
    // Update transform components from world object state
    (void)world;
}

void MeshAnimationSystem::update(World& world) {
    // Step GLTF-based mesh animations
    (void)world;
}

void TimelineSystem::update(World& world) {
    f64 dt = EngineCore::instance().deltaTime();
    for (auto* obj : world.objects()) {
        if (!obj->active) continue;
        obj->getFirstComponent<TimelineComponent>()->tick_active(dt);
    }
}

void RenderSubmitSystem::update(World& world) {
    // Submit visible objects for rendering
    auto& engine = EngineCore::instance();
    auto* view = engine.view();

    for (auto* obj : world.objects()) {
        if (!obj->active || !obj->visible) continue;

        // Submit sprite if object has one
        obj->submitForRendering(view);
    }
}

} // namespace bmsx
