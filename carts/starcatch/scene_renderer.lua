local meshes<const> = require('scene_meshes')
local gte<const> = require('cartlib/gx/gte')
local gp0<const> = require('cartlib/gx/gp0')
local gpu<const> = require('cartlib/gx/gpu')
local data<const>: *word = gte.data
local control<const>: *word = gte.control
local command<const>: *word = gte.command
local cycles<const>: *word = gte.cycles
local gp0_register<const>: *word = 0x0801023c
local framebuffer_size<const> = 320 | (240 << 16)
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
local static_words<const> = {}
local face_count
local static_word_count

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
        local mesh<const> = {
            xy = {},
            z = {},
            vertex_count = #definition.vertices,
            faces = definition.faces,
        }
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
        for shade = 1, #palette do
            commands[shade] = gp0.draw_triangle | gp0.argb_to_rgb(palette[shade])
        end
        palette_commands[index] = commands
    end
    -- The authored scene has at most 108 submitted moving faces, before cull.
    -- Pre-admit the complete work storage once rather than growing frame tables.
    for index = 1, 128 do
        projected_sxy[index] = 0
        projected_z[index] = 0
        face_sxy0[index] = 0
        face_sxy1[index] = 0
        face_sxy2[index] = 0
        face_commands[index] = 0
        face_depth[index] = 0
        face_order[index] = 0
    end
    static_word_count = 0
    local star_command<const> = gp0.draw_rectangle | gp0.argb_to_rgb(0xff344d6d)
    for index = 1, 28 do
        static_words[static_word_count + 1] = star_command
        static_words[static_word_count + 2] = gp0.pair16(10 + (index * 67) % 300, 30 + (index * 43) % 110)
        static_words[static_word_count + 3] = gp0.rectangle_size_1x1
        static_word_count = static_word_count + 3
    end
    face_count = 0
    queue_mesh(meshes.arena, 0, 0, 0, 0, 0, meshes.arena_colors)
    sort_faces()
    for index = 1, face_count do
        local face<const> = face_order[index]
        static_words[static_word_count + 1] = face_commands[face]
        static_words[static_word_count + 2] = face_sxy0[face]
        static_words[static_word_count + 3] = face_sxy1[face]
        static_words[static_word_count + 4] = face_sxy2[face]
        static_word_count = static_word_count + 4
    end
    -- Fixed arena grid is transformed once by the same hardware projection.
    local line_command<const> = gp0.draw_line | gp0.argb_to_rgb(0xff2b4664)
    for index = 1, #meshes.arena_lines do
        local points<const> = meshes.arena_lines[index]
        static_words[static_word_count + 1] = line_command
        for point_index = 1, 2 do
            local point<const> = points[point_index]
            data[gte.data_vxy0] = gte.pack_i16_pair(point[1], point[2])
            data[gte.data_vz0] = point[3]
            *command = projection_command
            while (*cycles & 0x80000000) ~= 0 do end
            static_words[static_word_count + 1 + point_index] = data[gte.data_sxy2]
        end
        static_word_count = static_word_count + 3
    end
    face_count = 0
end

local draw_star_icon<const> = function(x, y, color)
    gpu.fill_rect_color(x + 3, y, x + 5, y + 8, color)
    gpu.fill_rect_color(x, y + 3, x + 8, y + 5, color)
    gpu.fill_rect_color(x + 2, y + 2, x + 6, y + 6, color)
end

local draw_hud<const> = function(game)
    gpu.fill_rect_color(8, 23, 312, 25, 0xff426481)
    gpu.fill_rect_color(8, 216, 312, 218, 0xff426481)
    for index = 1, 12 do
        local color = 0xff344763
        if index <= game.score then color = 0xffffd866 end
        draw_star_icon(12 + (index - 1) * 18, 8, color)
    end
    for index = 1, 3 do
        local color = 0xff344763
        if index <= game.lives then color = 0xfff87888 end
        local x<const> = 254 + (index - 1) * 18
        gpu.fill_rect_color(x, 8, x + 4, 13, color)
        gpu.fill_rect_color(x + 6, 8, x + 10, 13, color)
        gpu.fill_rect_color(x + 2, 11, x + 8, 16, color)
        gpu.fill_rect_color(x + 4, 16, x + 6, 18, color)
    end
    if game.shield_boost then
        gpu.draw_line_color(232, 8, 242, 8, 0xff64e6b4)
        gpu.draw_line_color(232, 8, 234, 15, 0xff64e6b4)
        gpu.draw_line_color(242, 8, 240, 15, 0xff64e6b4)
        gpu.draw_line_color(234, 15, 237, 18, 0xff64e6b4)
        gpu.draw_line_color(240, 15, 237, 18, 0xff64e6b4)
    end
    gpu.draw_line_color(120, 230, 200, 230, 0xff344763)
    gpu.draw_triangle_color(106, 230, 115, 225, 115, 235, 0xff64dce6)
    gpu.draw_triangle_color(214, 230, 205, 225, 205, 235, 0xff64dce6)
    if game.phase ~= 'play' then
        local accent = 0xffffd866
        if game.phase == 'over' then
            accent = 0xffff657a
        elseif game.phase == 'won' then
            accent = 0xff64e6b4
        end
        gpu.fill_rect_color(84, 76, 236, 168, 0xff314d6e)
        gpu.fill_rect_color(86, 78, 234, 166, 0xff17263e)
        gpu.fill_rect_color(86, 78, 234, 81, accent)
        if game.phase == 'over' then
            gpu.fill_rect_color(143, 94, 155, 106, accent)
            gpu.fill_rect_color(165, 94, 177, 106, accent)
            gpu.draw_triangle_color(143, 104, 177, 104, 160, 125, accent)
            gpu.draw_quad_color(156, 92, 163, 92, 163, 125, 170, 125, 0xff17263e)
        elseif game.phase == 'won' then
            gpu.draw_quad_color(146, 92, 174, 92, 150, 113, 170, 113, accent)
            gpu.fill_rect_color(157, 110, 163, 123, accent)
            gpu.fill_rect_color(148, 123, 172, 127, accent)
            gpu.draw_line_color(145, 95, 137, 95, accent)
            gpu.draw_line_color(137, 95, 139, 108, accent)
            gpu.draw_line_color(139, 108, 150, 112, accent)
            gpu.draw_line_color(175, 95, 183, 95, accent)
            gpu.draw_line_color(183, 95, 181, 108, accent)
            gpu.draw_line_color(181, 108, 170, 112, accent)
        else
            gpu.draw_triangle_color(150, 92, 150, 122, 177, 107, accent)
        end
        -- A physical wide keycap is the existing Space start/retry cue.
        gpu.fill_rect_color(124, 143, 196, 158, 0xff64dce6)
        gpu.fill_rect_color(127, 143, 193, 153, 0xff23334d)
        gpu.fill_rect_color(136, 149, 184, 151, 0xff64dce6)
    end
end

function renderer.draw(game)
    gpu.clear_color(0, framebuffer_size, 0xff0b1223)
    for index = 1, static_word_count do
        *gp0_register = static_words[index]
    end
    face_count = 0
    local player<const> = game.player
    local px<const> = player.x + 16 - 160
    local py<const> = 88 + player.bob + player.recoil
    local bank<const> = player.bank
    local cb<const> = math.cos(bank)
    local sb<const> = math.sin(bank)
    local style = meshes.cyan
    if game.flash > 0 then style = meshes.red end
    -- The catch chassis stays on the game's fixed 204..212 contact band.
    -- Only its head and hinged flaps consume the animated body pose.
    if player.visible then
        queue_mesh(meshes.collector, px, 88, 512, 0, 0, style)
        queue_mesh(meshes.head, px + 11 * sb, py - 11 * cb, 510, 0.25, bank, style)
        local flap_angle<const> = 0.35 + player.opening * 0.9
        queue_mesh(meshes.flap, px - 14 * cb + 4 * sb, py - 14 * sb - 4 * cb, 512, 0, bank - flap_angle, style)
        queue_mesh(meshes.flap, px + 14 * cb + 4 * sb, py + 14 * sb - 4 * cb, 512, 0, bank + math.pi + flap_angle, style)
    end
    local sentinel<const> = game.sentinel
    if sentinel.visible then
        -- Its screen anchor stays explicit even though this actor is farther away.
        local sx<const> = (sentinel.x - 160) * 11 / 8
        local sy<const> = (sentinel.y + sentinel.bob + sentinel.recoil - 120) * 11 / 8
        local wing_angle<const> = 0.2 + sentinel.opening * 0.8
        queue_mesh(meshes.drone, sx, sy, 704, sentinel.spin, 0, meshes.violet)
        queue_mesh(meshes.head, sx, sy - 9, 694, sentinel.spin, 0, meshes.gold)
        queue_mesh(meshes.flap, sx - 18, sy, 704, 0, math.pi + wing_angle, meshes.violet)
        queue_mesh(meshes.flap, sx + 18, sy, 704, 0, -wing_angle, meshes.violet)
    end
    local drop<const> = game.drop
    local show_drop<const> = drop.visible and game.phase == 'play'
    if show_drop then
        local dx<const> = drop.x + 4 - 160
        local dy<const> = drop.y + 4 - 120
        if drop.danger then
            queue_mesh(meshes.hazard, dx, dy, 512, game.frame * 0.09, game.frame * 0.04, meshes.red)
        else
            queue_mesh(meshes.star, dx, dy, 512, game.frame * 0.11, game.frame * 0.03, meshes.gold)
        end
    end
    sort_faces()
    -- GTE SXY is already the GP0 screen-coordinate word. The emitter consumes
    -- it directly; it never splits, rounds or repacks projected vertices.
    for index = 1, face_count do
        local face<const> = face_order[index]
        *gp0_register = face_commands[face]
        *gp0_register = face_sxy0[face]
        *gp0_register = face_sxy1[face]
        *gp0_register = face_sxy2[face]
    end
    if show_drop and not drop.danger then
        gpu.fill_rect_color(drop.x + 3, drop.y - 8, drop.x + 5, drop.y - 3, 0xff6a562d)
        gpu.fill_rect_color(drop.x + 3, drop.y - 3, drop.x + 5, drop.y, 0xffad8239)
    end
    if player.visible and game.shield_boost then
        gpu.draw_line_color(player.x - 2, 211, player.x + 2, 215, 0xff64e6b4)
        gpu.draw_line_color(player.x + 2, 215, player.x + 30, 215, 0xff64e6b4)
        gpu.draw_line_color(player.x + 30, 215, player.x + 34, 211, 0xff64e6b4)
    end
    draw_hud(game)
end

return renderer
