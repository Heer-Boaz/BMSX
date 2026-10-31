-- One World visual owns a camera and a cross-instance triangle pass. Models
-- stay in their existing active Space view; neither camera nor assets own a
-- second scene hierarchy. Camera local -Z is forward and +Y is up.
local visual_component<const> = require('cartlib/component/visual_component')
local model_component<const> = require('cartlib/component/static_model_component')
local model_batch<const> = require('cartlib/gx/model_batch')
local affine3<const> = require('cartlib/math/affine3')
local hierarchy<const> = require('cartlib/world/spatial_hierarchy')
local shallow_copy<const> = require('cartlib/util/shallow_copy')
local empty_configuration<const> = {}

local renderer<const> = {}
renderer.__index = renderer
setmetatable(renderer, { __index = visual_component })

function renderer.new(owner, configuration, id_local, defaults)
	local self<const>, input<const> = visual_component.new(owner, configuration, id_local or 'camera', defaults)
	setmetatable(self, renderer)
	local spatial<const> = owner.spatial
	self.spatial = spatial
	self._models = owner.world:active_component_view(model_component)
	self._batch = model_batch.new()
	self._view, self._world, self._instance_view, self._part_view = {}, {}, {}, {}
	self._seen, self._revisions, self._visible = {}, {}, {}
	self._seen_count = 0
	self._basis_revision, self._origin_revision = -1, -1
	self._projection_revision, self._observed_projection_revision = 0, -1
	local definition<const> = defaults or empty_configuration
	local width<const> = input.width or definition.width or (owner.world._page_size & 0x0000ffff)
	local height<const> = input.height or definition.height or (owner.world._page_size >> 16)
	self:set_projection(width, height,
		input.focal_length or definition.focal_length or width*0.5, input.near or definition.near or 0.1,
		input.center_x or definition.center_x, input.center_y or definition.center_y)
	self:set_draw_function(renderer.draw_models)
	return self
end

function renderer.factory(definition)
	local defaults<const> = shallow_copy(definition)
	return function(owner, configuration, id_local)
		return renderer.new(owner, configuration, id_local or defaults.id_local, defaults)
	end
end

function renderer:set_projection(width, height, focal_length, near, center_x, center_y)
	self.width, self.height, self.focal_length, self.near = width, height, focal_length, near
	self.center_x = center_x or width * 0.5
	self.center_y = center_y or height * 0.5
	self._projection_revision = self._projection_revision + 1
	return self
end

function renderer:draw_models(draw)
	local spatial<const> = self.spatial
	hierarchy.resolve(spatial)
	local basis_revision<const>, origin_revision<const> = spatial._basis_revision, spatial._origin_revision
	local changed = basis_revision ~= self._basis_revision or origin_revision ~= self._origin_revision
		or self._projection_revision ~= self._observed_projection_revision
	if changed then
		self.xx = spatial.wxx
		self.xy = spatial.wxy
		self.xz = spatial.wxz
		self.yx = spatial.wyx
		self.yy = spatial.wyy
		self.yz = spatial.wyz
		self.zx = spatial.wzx
		self.zy = spatial.wzy
		self.zz = spatial.wzz
		self.ox = spatial.wox
		self.oy = spatial.woy
		self.oz = spatial.woz
		local view<const> = self._view
		if not affine3.inverse(view, self) then error('model camera world affine is singular') end
		-- Publish camera coordinates directly in the projection's right/down/
		-- forward frame; retain full Number coefficients until GP0 encoding.
		view.xy,view.yy,view.zy,view.oy = -view.xy,-view.yy,-view.zy,-view.oy
		view.xz,view.yz,view.zz,view.oz = -view.xz,-view.yz,-view.zz,-view.oz
		self._basis_revision, self._origin_revision = basis_revision, origin_revision
		self._observed_projection_revision = self._projection_revision
	end
	local models<const> = self._models.components
	local count<const> = #models
	local seen<const>, revisions<const>, visibility<const> = self._seen,self._revisions,self._visible
	if count ~= self._seen_count then changed = true end
	for index = 1, count do
		local model<const> = models[index]
		local visible<const> = model.visible and model.owner.visible
		if visible then model:resolve_pose() end
		local revision<const> = model._render_revision
		if seen[index] ~= model or revisions[index] ~= revision or visibility[index] ~= visible then changed = true end
		seen[index],revisions[index],visibility[index] = model,revision,visible
	end
	for index = count + 1, self._seen_count do
		seen[index],revisions[index],visibility[index] = nil,nil,nil
	end
	self._seen_count = count
	local batch<const> = self._batch
	if changed then
		batch:begin(self)
		local world<const>, instance_view<const>, part_view<const> = self._world,self._instance_view,self._part_view
		for index = 1, count do
			if visibility[index] then
				local model<const> = models[index]
				world.xx = model.wxx
				world.xy = model.wxy
				world.xz = model.wxz
				world.yx = model.wyx
				world.yy = model.wyy
				world.yz = model.wyz
				world.zx = model.wzx
				world.zy = model.wzy
				world.zz = model.wzz
				world.ox = model.wox
				world.oy = model.woy
				world.oz = model.woz
				affine3.compose(instance_view, self._view, world)
				local parts<const> = model._source.parts
				for part_index = 1, #parts do
					local part<const> = parts[part_index]
					affine3.compose(part_view, instance_view, part)
					local reflected<const> = part_view.xx*(part_view.yy*part_view.zz-part_view.zy*part_view.yz)
						+part_view.yx*(part_view.zy*part_view.xz-part_view.xy*part_view.zz)
						+part_view.zx*(part_view.xy*part_view.yz-part_view.yy*part_view.xz) < 0
					local primitives<const> = part.primitives
					for primitive_index = 1, #primitives do
						local primitive<const> = primitives[primitive_index]
						primitive.queue(batch, primitive, part_view, model.id, reflected)
					end
				end
			end
		end
	end
	batch:submit(draw)
end

function renderer:on_detach()
	for index = 1, self._seen_count do
		self._seen[index],self._revisions[index],self._visible[index] = nil,nil,nil
	end
	self._seen_count = 0
	self._observed_projection_revision = -1
end

return renderer
