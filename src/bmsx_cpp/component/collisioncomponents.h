/*
 * collisioncomponents.h - Collision-related components
 *
 * Mirrors TypeScript component/collisioncomponents.ts
 * Includes Collider2DComponent, ScreenBoundaryComponent, TileCollisionComponent,
 * and related position tracking components.
 */

#ifndef BMSX_COLLISION_COMPONENTS_H
#define BMSX_COLLISION_COMPONENTS_H

#include "component.h"
#include "../core/types.h"
#include "../render/render_types.h"
#include <vector>
#include <optional>

namespace bmsx {

/* ============================================================================
 * Collision shape types
 * ============================================================================ */

// RectBounds is defined in render/render_types.h

// Polygon: flat array of [x0,y0,x1,y1,...] coordinates
using Polygon = std::vector<f32>;

// Circle shape
struct Circle {
	f32 x = 0.0f;
	f32 y = 0.0f;
	f32 r = 0.0f;
	
	Circle() = default;
	Circle(f32 x_, f32 y_, f32 r_) : x(x_), y(y_), r(r_) {}
};

/* ============================================================================
 * Space events scope enumeration
 * ============================================================================ */

enum class SpaceEvents {
	Current,  // Only objects in the same active space
	UI,       // Only objects in the UI space
	Both,     // Objects in current or UI spaces
	All       // Objects in any space
};

/* ============================================================================
 * Collider2DComponent
 *
 * Holds collision shapes for a WorldObject.
 * Shapes are stored in local space; world-space accessors apply parent position.
 * ============================================================================ */

struct Collider2DComponentOptions : ComponentAttachOptions {
	bool hittable = true;
	u32 layer = 1;
	u32 mask = 0xFFFFFFFF;
	bool isTrigger = true;
	bool generateOverlapEvents = false;
	SpaceEvents spaceEvents = SpaceEvents::Current;
};

class Collider2DComponent : public Component {
public:
	static bool unique() { return false; }
	static const char* typeName() { return "Collider2DComponent"; }
	const char* name() const override { return typeName(); }

	// Collision properties
	bool hittable = true;
	u32 layer = 1;
	u32 mask = 0xFFFFFFFF;
	bool isTrigger = true;
	bool generateOverlapEvents = false;
	SpaceEvents spaceEvents = SpaceEvents::Current;

private:
	std::optional<RectBounds> m_localArea;
	std::vector<Polygon> m_localPolys;
	std::optional<Circle> m_localCircle;
	std::string m_syncToken;

public:
	explicit Collider2DComponent(const Collider2DComponentOptions& opts);
	~Collider2DComponent() override = default;

	// Sync token for sprite-driven sync
	const std::string& syncToken() const { return m_syncToken; }
	void setSyncToken(const std::string& token) { m_syncToken = token; }

	// World-space accessors
	RectBounds worldArea() const;
	std::vector<Polygon> worldPolygons() const;
	std::optional<Circle> worldCircle() const;

	// Local-space accessors
	const std::optional<RectBounds>& localArea() const { return m_localArea; }
	const std::vector<Polygon>& localPolygons() const { return m_localPolys; }
	const std::optional<Circle>& localCircle() const { return m_localCircle; }

	// Setters for local shapes
	void setLocalArea(const RectBounds& area) { m_localArea = area; }
	void setLocalPolygons(const std::vector<Polygon>& polys) { m_localPolys = polys; }
	void setLocalCircle(const Circle& circle) { m_localCircle = circle; }
};

/* ============================================================================
 * PositionUpdateAxisComponent
 *
 * Abstract component for tracking position changes.
 * Physics systems read the captured old position for collision resolution.
 * ============================================================================ */

class PositionUpdateAxisComponent : public Component {
public:
	static bool unique() { return false; }
	static const char* typeName() { return "PositionUpdateAxisComponent"; }
	const char* name() const override { return typeName(); }

	// Previous position of the world object
	Vec2 oldPos;

	explicit PositionUpdateAxisComponent(const ComponentAttachOptions& opts);
	~PositionUpdateAxisComponent() override = default;

	void preprocessingUpdate() override;
};

/* ============================================================================
 * ScreenBoundaryComponent
 *
 * Marker component for screen boundary handling.
 * Used by BoundarySystem to emit screen.leaving/screen.leave events.
 * ============================================================================ */

class ScreenBoundaryComponent : public PositionUpdateAxisComponent {
public:
	static bool unique() { return true; }
	static const char* typeName() { return "ScreenBoundaryComponent"; }
	const char* name() const override { return typeName(); }

	explicit ScreenBoundaryComponent(const ComponentAttachOptions& opts)
		: PositionUpdateAxisComponent(opts) {}
	~ScreenBoundaryComponent() override = default;
};

/* ============================================================================
 * TileCollisionComponent
 *
 * Marker component for tile collisions.
 * TileCollisionSystem performs resolution against the tilemap.
 * ============================================================================ */

class TileCollisionComponent : public PositionUpdateAxisComponent {
public:
	static bool unique() { return true; }
	static const char* typeName() { return "TileCollisionComponent"; }
	const char* name() const override { return typeName(); }

	explicit TileCollisionComponent(const ComponentAttachOptions& opts)
		: PositionUpdateAxisComponent(opts) {}
	~TileCollisionComponent() override = default;
};

/* ============================================================================
 * ProhibitLeavingScreenComponent
 *
 * Component that prohibits the world object from leaving the screen boundary.
 * Listens to screen.leaving events and constrains position.
 * ============================================================================ */

struct ProhibitLeavingScreenOptions : ComponentAttachOptions {
	bool stickToEdge = true;
};

class ProhibitLeavingScreenComponent : public ScreenBoundaryComponent {
public:
	static const char* typeName() { return "ProhibitLeavingScreenComponent"; }
	const char* name() const override { return typeName(); }

	const bool stickToEdge;

	explicit ProhibitLeavingScreenComponent(const ProhibitLeavingScreenOptions& opts);
	~ProhibitLeavingScreenComponent() override = default;

	void bind() override;

private:
	void onLeavingScreen(const std::string& direction, f32 oldXOrY);
};

/* ============================================================================
 * Screen direction enum
 * ============================================================================ */

enum class ScreenDirection {
	Left,
	Right,
	Up,
	Down
};

/* ============================================================================
 * Helper function for leaving screen handler
 * ============================================================================ */

void leavingScreenHandler_prohibit(
	WorldObject& obj,
	ScreenDirection direction,
	f32 oldXOrY,
	bool stickToEdge = true
);

} // namespace bmsx

#endif // BMSX_COLLISION_COMPONENTS_H
