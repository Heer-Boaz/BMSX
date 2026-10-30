local meshes<const> = require('scene_meshes')
local gte<const> = require('cartlib/gx/gte')
local gte_transform<const> = require('cartlib/gx/gte_transform')
local gp0<const> = require('cartlib/gx/gp0')
local affine3<const> = require('cartlib/math/affine3')
local affine_batch<const> = require('cartlib/gx/affine_batch')
local data<const>: *word = gte.data
local control<const>: *word = gte.control
local command<const>: *word = gte.command
local cycles<const>: *word = gte.cycles
local projection_command<const> = gte.command_sf_shift_12 | gte.opcode_rtps

local renderer<const> = {}
local prepared_meshes<const> = {}
local palette_commands<const> = {}
local projected_sxy<const> = {}
local projected_z<const> = {}
local face_sxy0<const> = {}
local face_sxy1<const> = {}
local face_sxy2<const> = {}
local face_commands<const> = {}
local face_depth<const> = {}
local face_order<const> = {}
local face_count
local model_reflected

-- A retained model-local frame is renderer scratch, not another object pose
-- or World hierarchy node. Compose the complete model once per actor and keep
-- its articulated parts in that frame until the GTE operand boundary.
local model_affine<const> = {
	xx=1,xy=0,xz=0,yx=0,yy=1,yz=0,zx=0,zy=0,zz=1,ox=0,oy=0,oz=0,
}
local place_model<const> = function(spatial, yaw, roll)
	spatial:resolve_world()
	local cy, sy, cr, sr = 1, 0, 1, 0
	if yaw ~= 0 then cy, sy = math.cos(yaw), math.sin(yaw) end
	if roll ~= 0 then cr, sr = math.cos(roll), math.sin(roll) end
	local model<const> = model_affine
	model.xx, model.xy, model.xz = cr*cy, sr*cy, -sy
	model.yx, model.yy, model.yz = -sr, cr, 0
	model.zx, model.zy, model.zz = cr*sy, sr*sy, cy
	affine3.evaluate(model, spatial, true, true)
	model_reflected = model.wxx*(model.wyy*model.wzz-model.wzy*model.wyz)
		+ model.wyx*(model.wzy*model.wxz-model.wxy*model.wzz)
		+ model.wzx*(model.wxy*model.wyz-model.wyy*model.wxz) < 0
	gte_transform.write_affine(model.wxx,model.wxy,model.wxz,model.wyx,model.wyy,model.wyz,
		model.wzx,model.wzy,model.wzz,model.wox-160,model.woy-120,model.woz)
end

local queue_mesh<const> = function(mesh_id, palette_id)
    local mesh<const> = prepared_meshes[mesh_id]
    local xy<const> = mesh.xy
    local zs<const> = mesh.z
    for index = 1, mesh.vertex_count do
        data[gte.data_vxy0] = xy[index]
        data[gte.data_vz0] = zs[index]
        *command = projection_command
        while (*cycles & 0x80000000) ~= 0 do end
        projected_sxy[index] = data[gte.data_sxy2]
        projected_z[index] = data[gte.data_sz3]
    end
    local faces<const> = mesh.faces
    local commands<const> = palette_commands[palette_id]
    for index = 1, #faces do
        local face<const> = faces[index]
        local a<const> = face[1]
        local b<const> = face[2]
        local c<const> = face[3]
        local s0<const> = projected_sxy[a]
        local s1<const> = projected_sxy[b]
        local s2<const> = projected_sxy[c]
        data[gte.data_sxy0] = s0
        data[gte.data_sxy1] = s1
        data[gte.data_sxy2] = s2
        *command = gte.opcode_nclip
        while (*cycles & 0x80000000) ~= 0 do end
        local area_word<const> = data[gte.data_mac0]
        -- MAC0 is read as a raw unsigned word; its sign is a bit, not a Lua
        -- comparison with zero. Mirroring the model reverses its front winding.
        if area_word ~= 0 and ((area_word & 0x80000000) ~= 0) == model_reflected then
            face_count = face_count + 1
            face_sxy0[face_count] = s0
            face_sxy1[face_count] = s1
            face_sxy2[face_count] = s2
            face_commands[face_count] = commands[face[4]]
            face_depth[face_count] = projected_z[a] + projected_z[b] + projected_z[c]
            face_order[face_count] = face_count
        end
    end
end

-- A single retained painter list includes every moving model and hinge.
-- Equal depths retain authored submission order; no sort callback or record
-- allocation is admitted on a frame.
local sort_faces<const> = function()
    for index = 2, face_count do
        local face<const> = face_order[index]
        local depth<const> = face_depth[face]
        local position = index
        while position > 1 and face_depth[face_order[position - 1]] < depth do
            face_order[position] = face_order[position - 1]
            position = position - 1
        end
        face_order[position] = face
    end
end

function renderer.setup()
	control[gte.control_ofx] = 160 << 16
	control[gte.control_ofy] = 120 << 16
	control[gte.control_h] = 512
	control[gte.control_dqa] = 0
	control[gte.control_dqb] = 0
	for index = 1, #meshes.definitions do
		local definition<const> = meshes.definitions[index]
		local mesh<const> = { xy = {}, z = {}, vertex_count = #definition.vertices, faces = definition.faces }
		for vertex_index = 1, mesh.vertex_count do
			local vertex<const> = definition.vertices[vertex_index]
			mesh.xy[vertex_index] = gte.pack_i16_pair(vertex[1], vertex[2])
			mesh.z[vertex_index] = vertex[3]
		end
		prepared_meshes[index] = mesh
	end
	for index = 1, #meshes.palettes do
		local palette<const> = meshes.palettes[index]
		local commands<const> = {}
		for shade = 1, #palette do commands[shade] = gp0.draw_triangle | gp0.argb_to_rgb(palette[shade]) end
		palette_commands[index] = commands
	end
	-- Two articulated ships submit at most forty faces. All work tables are retained.
	for index = 1, 64 do
		projected_sxy[index] = 0
		projected_z[index] = 0
		face_sxy0[index] = 0
		face_sxy1[index] = 0
		face_sxy2[index] = 0
		face_commands[index] = 0
		face_depth[index] = 0
		face_order[index] = 0
	end
	face_count = 0
end

local draw_hud<const> = function(game, draw)
	if game.phase ~= 'play' then return end
	draw:rect(0, 0, 320, 24, 0xff17263e)
	for index = 1, 12 do
		local color = 0xff344763
		if index <= game.score then color = 0xffffd866 end
		draw:rect(10 + (index - 1) * 15, 8, 20 + (index - 1) * 15, 16, color)
	end
	for index = 1, 3 do
		local color = 0xff344763
		if index <= game.lives then color = 0xffed627b end
		draw:triangle(260 + (index - 1) * 18, 7, 267 + (index - 1) * 18, 18, 253 + (index - 1) * 18, 18, color)
	end
	if game.dash_unlocked then draw:rect(202, 8, 214, 16, 0xff64dcb0) end
	if game.twin_cannon then draw:rect(220, 8, 232, 16, 0xffa893e3) end
end

function renderer.draw(component, draw)
	local game<const> = component.owner.game
	draw:rect(0, 0, 320, 240, 0xff0b1223)
	for index = 1, 36 do
		local y = 28 + (index * 43) % 190
		if game.scene.definition.scrolling then y = 28 + (index * 43 + game.frame) % 190 end
		draw:rect(10 + (index * 67) % 300, y, 11 + (index * 67) % 300, y + 2, 0xff344d6d)
	end
	draw:line(10, 25, 10, 222, 0xff28435d)
	draw:line(310, 25, 310, 222, 0xff28435d)
	face_count = 0
	local ship<const> = game.player
	if ship ~= nil and ship.visible then
		local style = meshes.cyan
		if ship.hit_flash > 0 then style = meshes.red
		elseif ship.dash_shield > 0 then style = meshes.jade end
		place_model(ship.spatial, ship.spin, ship.bank)
		queue_mesh(meshes.ship, style)
		local model<const> = model_affine
		local head_y<const> = -3 + ship.bob + ship.recoil
		gte_transform.write_origin(model.wox + model.wyx*head_y - model.wzx*4 - 160,
			model.woy + model.wyy*head_y - model.wzy*4 - 120,
			model.woz + model.wyz*head_y - model.wzz*4)
		queue_mesh(meshes.head, meshes.gold)
	end
	local enemy<const> = game.enemy
	if enemy ~= nil and enemy.visible then
		local style = meshes.violet
		if enemy.charge > 0.65 then style = meshes.red end
		place_model(enemy.spatial, 0, 0)
		queue_mesh(meshes.drone, style)
		local model<const> = model_affine
		gte_transform.write_origin(model.wox - model.wzx*5 - 160, model.woy - model.wzy*5 - 120,
			model.woz - model.wzz*5)
		queue_mesh(meshes.head, meshes.red)
	end
	sort_faces()
	for index = 1, face_count do
		local face<const> = face_order[index]
		draw:triangle_words(face_commands[face], face_sxy0[face], face_sxy1[face], face_sxy2[face])
	end
	for index = 1, #game.player_bolts do
		local bolt<const> = game.player_bolts[index]
		if bolt.visible then
			local pose<const> = bolt.spatial
			pose:resolve_world()
			affine_batch.rect(draw, -1,-5,2,4, pose.wxx,pose.wxy,pose.wyx,pose.wyy,pose.wox,pose.woy, 0xffa5f5ef)
			affine_batch.rect(draw, 0,-8,1,-5, pose.wxx,pose.wxy,pose.wyx,pose.wyy,pose.wox,pose.woy, 0xff55c7db)
		end
	end
	for index = 1, #game.enemy_bolts do
		local bolt<const> = game.enemy_bolts[index]
		if bolt.visible then
			local pose<const> = bolt.spatial
			pose:resolve_world()
			affine_batch.rect(draw, -2,-3,3,4, pose.wxx,pose.wxy,pose.wyx,pose.wyy,pose.wox,pose.woy, 0xffed627b)
		end
	end
	local burst<const> = game.burst
	if burst ~= nil and burst.pulse > 0 then
		local r<const> = burst.pulse
		local pose<const> = burst.spatial
		pose:resolve_world()
		local x<const>, y<const> = pose.wox, pose.woy
		local ax<const>, ay<const> = pose.wxx*r, pose.wxy*r
		local bx<const>, by<const> = pose.wyx*r, pose.wyy*r
		draw:line(x-bx,y-by, x+ax,y+ay, 0xffffd866)
		draw:line(x+ax,y+ay, x+bx,y+by, 0xffffd866)
		draw:line(x+bx,y+by, x-ax,y-ay, 0xffffd866)
		draw:line(x-ax,y-ay, x-bx,y-by, 0xffffd866)
	end
	draw_hud(game, draw)
end

return renderer
