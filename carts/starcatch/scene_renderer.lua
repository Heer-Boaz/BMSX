local meshes<const> = require('scene_meshes')
local gte<const> = require('cartlib/gx/gte')
local gp0<const> = require('cartlib/gx/gp0')
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

-- Rotation belongs to each part's local frame. Articulated hinge translations
-- are composed by the scene, like a matrix hierarchy, without creating matrices.
local queue_mesh<const> = function(mesh_id, x, y, z, yaw, roll, palette_id)
    local cy = 1
    local sy = 0
    local cr = 1
    local sr = 0
    if yaw ~= 0 then
        cy = math.cos(yaw)
        sy = math.sin(yaw)
    end
    if roll ~= 0 then
        cr = math.cos(roll)
        sr = math.sin(roll)
    end
    control[gte.control_r11r12] = gte.pack_i16_pair(math.round(cr * cy * 4096), math.round(-sr * 4096))
    control[gte.control_r13r21] = gte.pack_i16_pair(math.round(cr * sy * 4096), math.round(sr * cy * 4096))
    control[gte.control_r22r23] = gte.pack_i16_pair(math.round(cr * 4096), math.round(sr * sy * 4096))
    control[gte.control_r31r32] = gte.pack_i16_pair(math.round(-sy * 4096), 0)
    control[gte.control_r33] = math.round(cy * 4096)
    control[gte.control_trx] = math.round(x)
    control[gte.control_try] = math.round(y)
    control[gte.control_trz] = math.round(z)

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
        -- comparison with zero. Clockwise screen winding faces the camera.
        if area_word ~= 0 and (area_word & 0x80000000) == 0 then
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
		local x<const> = ship.x - 160
		local y<const> = ship.y - 120
		local style = meshes.cyan
		if ship.hit_flash > 0 then style = meshes.red
		elseif ship.dash_shield > 0 then style = meshes.jade end
		queue_mesh(meshes.ship, x, y, ship.z, ship.spin, ship.bank, style)
		queue_mesh(meshes.head, x, y - 3 + ship.bob + ship.recoil, ship.z - 4, ship.spin, ship.bank, meshes.gold)
	end
	local enemy<const> = game.enemy
	if enemy ~= nil and enemy.visible then
		local style = meshes.violet
		if enemy.charge > 0.65 then style = meshes.red end
		queue_mesh(meshes.drone, enemy.x - 160, enemy.y - 120, enemy.z, 0, 0, style)
		queue_mesh(meshes.head, enemy.x - 160, enemy.y - 120, enemy.z - 5, 0, 0, meshes.red)
	end
	sort_faces()
	for index = 1, face_count do
		local face<const> = face_order[index]
		draw:triangle_words(face_commands[face], face_sxy0[face], face_sxy1[face], face_sxy2[face])
	end
	for index = 1, #game.player_bolts do
		local bolt<const> = game.player_bolts[index]
		if bolt.visible then
			draw:rect(bolt.x - 1, bolt.y - 5, bolt.x + 2, bolt.y + 4, 0xffa5f5ef)
			draw:rect(bolt.x, bolt.y - 8, bolt.x + 1, bolt.y - 5, 0xff55c7db)
		end
	end
	for index = 1, #game.enemy_bolts do
		local bolt<const> = game.enemy_bolts[index]
		if bolt.visible then draw:rect(bolt.x - 2, bolt.y - 3, bolt.x + 3, bolt.y + 4, 0xffed627b) end
	end
	local burst<const> = game.burst
	if burst ~= nil and burst.pulse > 0 then
		local r<const> = burst.pulse
		draw:line(burst.x, burst.y - r, burst.x + r, burst.y, 0xffffd866)
		draw:line(burst.x + r, burst.y, burst.x, burst.y + r, 0xffffd866)
		draw:line(burst.x, burst.y + r, burst.x - r, burst.y, 0xffffd866)
		draw:line(burst.x - r, burst.y, burst.x, burst.y - r, 0xffffd866)
	end
	draw_hud(game, draw)
end

return renderer
