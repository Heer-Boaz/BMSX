#!/usr/bin/env python3
"""Compile De Bevroren Haven from the approved 8x8 assets and native actor symbols.

One numeric map owns terrain and native enemy triggers. No collision map.
Run from the repository: python scripts/nemesis_s/stadsburg/build_level.py
"""
from pathlib import Path
from collections import Counter
import hashlib
import json
import shutil
import yaml
from PIL import Image
from bake_water import compile_water
from bake_havenanimatie import compile_harbor
from bake_stadsgroen import greenery_poses

ROOT = Path(__file__).resolve().parents[3] / 'carts/nemesis_s'
ACTOR_SYMBOLS = {'formation_down': 'p', 'formation_up': 'P', 'red_mitre': 'M',
                 'blue_mitre': 'm', 'chimney': 'S', 'smoke': 'R', 'quay_cannon': 'D',
                 'turret_blue_floor':'B','turret_red_floor':'C','turret_blue_ceiling':'b','turret_red_ceiling':'c',
                 'sack': 'Z', 'snowman': 'N', 'bell': 'K', 'mill': 'W', 'moon': "'"}

class FlowRow(list):
    pass
class Dumper(yaml.SafeDumper):
    pass
Dumper.add_representer(FlowRow, lambda d, v: d.represent_sequence('tag:yaml.org,2002:seq', v, flow_style=True))

def main():
    (ROOT/'previews').mkdir(parents=True,exist_ok=True)
    catalog = yaml.safe_load((ROOT/'authoring/tileset.yaml').read_text())
    prefabs = yaml.safe_load((ROOT/'authoring/prefabs.yaml').read_text())['prefabs']
    plan = yaml.safe_load((ROOT/'authoring/level.yaml').read_text())
    width, height = plan['width'], 22
    # New entries describe native roles of unchanged art; existing IDs never change.
    tiles = {e['id']: Image.open(ROOT/e['image']).convert('RGB') for e in catalog['tiles']}
    entries = {e['id']: e for e in catalog['tiles']}
    pixels = {(im.tobytes(), entries[k]['stage_symbol']): k for k, im in tiles.items()}
    cells = [[1]*width for _ in range(height)]
    owners = [['sky']*width for _ in range(height)]
    placements = []
    used_prefabs = set()

    def rows_for(name):
        used_prefabs.add(name)
        return prefabs[name]['tiles']

    def role(tile_id, symbol, painted=None, decoration=False):
        im = tiles[tile_id] if painted is None else painted
        key = (im.tobytes(), symbol)
        if key in pixels:
            return pixels[key]
        n = max(entries)+1
        entry = {'id': n, 'name': f'haven_role_{ord(symbol):02x}_{tile_id}',
                 'asset': f'nls_{n:04}', 'image': f'res/img/nls_{n:04}@atlas=gameplay.png',
                 'stage_symbol': symbol, 'source_tile': tile_id}
        if painted is not None:
            entry['name']=f'{"stadsdecor" if decoration else "turret_aansluiting"}_{tile_id}_{n}'
            entry['category']='stadsgroen_composite' if decoration else 'turret_contact'
        catalog['tiles'].append(entry); entries[n] = entry; tiles[n] = im
        im.save(ROOT/entry['image']); pixels[key] = n
        return n

    def put(k,x,y,owner,symbol=None):
        if k is None or not (0 <= x < width and 0 <= y < height):
            return
        if symbol is not None:
            k = role(k,symbol)
        cells[y][x] = k
        owners[y][x] = owner

    def prefab(name,x,y,symbol=None,record=True):
        rows=rows_for(name)
        for yy,row in enumerate(rows):
            for xx,k in enumerate(row): put(k,x+xx,y+yy,name,symbol)
        if record: placements.append({'prefab':name,'at':[x,y]})

    # Reflections are drawn by the existing 32-pixel water modules. Warm
    # reflections belong under windows and lamps; the dark reaches use a
    # smaller set of quiet, blue-only modules from the same atlas.
    harbor=plan['harbor']
    art_origin=harbor['art_origin']
    light_spans=[]
    for item in plan['scenery']:
        name=item['prefab']
        if name.startswith(('compact_', 'stadsburg_', 'huis_', 'winkel_', 'haven_laser_house', 'haven_smoke_house')):
            light_spans.append((item['x'],item['x']+len(rows_for(name)[0])))
    for x in range(harbor['water_start'],harbor['water_end'],4):
        near_light=any(lo-1<=x+2<hi+1 for lo,hi in light_spans)
        sequence=harbor['water_lit' if near_light else 'water_calm']
        prefab(f'reuse_watergroep_{sequence[((x-art_origin)//4)%len(sequence)]:02}',x,19,record=False)
    for name,sites in harbor['far_shore'].items():
        for x in sites: prefab(name,x,19-len(rows_for(name)),record=False)
    for x in range(harbor['background_start'],harbor['background_end'],8):
        if not any(x<end and x+8>start for start,end in harbor['open_water']):
            prefab('clean_bg_quay_64',x,19,record=False)
    # Let the waterline enter and recede below the town, over four columns.
    for i in range(4):
        for y in range(19,22):
            if y < 21-i//2:
                put(1,harbor['water_start']+i,y,'space')
                put(1,harbor['water_end']-1-i,y,'space')

    # Masonry always ends in the original wet foot, against the water.
    snow=rows_for('reuse_gevelkade_sneeuw_links')[0]
    courses=rows_for('red_masonry_32x24')
    warehouse_courses=rows_for('red_masonry_alt_32x24')
    quay_bays=(courses,warehouse_courses,courses,courses,warehouse_courses,warehouse_courses,courses)
    lintel_bays=(warehouse_courses,courses,warehouse_courses,warehouse_courses,courses)
    foot=rows_for('reuse_gevelkade_voet_links')[0]
    quay_surface=[None]*width
    for x0,x1,top in plan['quays']:
        for x in range(x0,x1):quay_surface[x]=top
    for x0,x1,top in plan['quays']:
        for x in range(x0,x1):
            put(snow[1+(x-x0)%12],x,top,'quay_snow','#')
            for y in range(top+1,20):
                put(quay_bays[((x-x0)//4)%len(quay_bays)][(y-top-1)%3][(x-art_origin)%4],x,y,'quay_masonry','#')
            if top<20: put(foot[1+(x-x0)%12],x,20,'quay_foot','#')
    # Joined street sections share their wall and wet foot. Exposed outer
    # corners belong only at a step or an actual canal opening.
    for x,top in enumerate(quay_surface):
        if top is None or top>=20:continue
        for edge,neighbor in [('left',x-1),('right',x+1)]:
            other=quay_surface[neighbor] if 0<=neighbor<width else None
            if other is None or other>top:
                prefab(f'quay_snow_corner_gevelkade_{edge}',x,top,record=False)
            if other is None:
                prefab(f'quay_underside_corner_gevelkade_{edge}',x,20,record=False)

    # A side elevation exposes only the thin asphalt edge above the quay wall.
    # The road has no top-view lane, apron or parking surface.
    asphalt=rows_for('asfalt_zijrand')
    for road in plan['roads']:
        for x in range(road['from'],road['to']):
            for y,row in enumerate(asphalt):
                put(row[(x-road['from'])%len(row)],x,road['floor']+y,'asphalt','#')

    for p in plan['scenery']:
        n=p['prefab']; x=p['x']
        if 'floor' in p:
            floor=p['floor']; h=len(rows_for(n))
            y=floor-h+1
        else: y=p['y']
        prefab(n,x,y)
    for tree in plan['trees']:
        x,floor=tree
        prefab('compact_winterlinde',x,floor-6)
        prefab('compact_tree_socket_gevelkade',x+2,floor)

    # Town detail and its poses are composed during authoring. They share the
    # native terrain tape and existing animation clips, preserve every cell's
    # collision role and need no new actor or collision mechanism. Black in a
    # source prefab is transparent here; original solid ink is never repainted.
    town_details=[];greenery_layers=[]
    before_roles=''.join(entries[k]['stage_symbol'] for row in cells for k in row)
    palette_black=(0,0,0)

    def town_detail(name,x,baseline,verge=False,clip_width=None,snow_join=False):
        rows=rows_for(name)
        picture=Image.new('RGB',(len(rows[0])*8,len(rows)*8))
        for yy,row in enumerate(rows):
            for xx,k in enumerate(row):
                if k is not None:picture.paste(tiles[k],(xx*8,yy*8))
        if clip_width is not None:picture=picture.crop((0,0,clip_width,picture.height))
        ox,oy=x*8,baseline-picture.height
        raw_poses=greenery_poses(name,picture)
        pictures=raw_poses or [picture]
        pose_changes=[]
        for drawing in pictures:
            changes={}
            for py in range(drawing.height):
                for px in range(drawing.width):
                    ink=drawing.getpixel((px,py))
                    if ink==palette_black:continue
                    wx,wy=ox+px,oy+py
                    assert 0<=wx<width*8 and 0<=wy<height*8,(name,wx,wy)
                    changes.setdefault((wx//8,wy//8),{})[wx%8,wy%8]=ink
            pose_changes.append(changes)
        positions=set().union(*(set(changes) for changes in pose_changes))
        final_poses=[{} for _ in pictures];background_rows=[]
        preserved=0;background_removed=0;modified=[]
        for cx,cy in sorted(positions,key=lambda p:(p[1],p[0])):
            base=cells[cy][cx]; original=tiles[base]
            solid=entries[base]['stage_symbol']=='#'
            verge_cell=owners[cy][cx]=='planted_verge'
            def protected(px,py):
                color=original.getpixel((px,py))
                return color!=palette_black and (solid or (verge_cell and color==(224,224,224)))
            preserved+=sum(protected(px,py) for px,py in pose_changes[0].get((cx,cy),{}))

            def compose(background,incoming):
                image=background.copy();clear_rows=set()
                for (px,py),ink in incoming.items():
                    if not protected(px,py):
                        image.putpixel((px,py),ink)
                for py in range(8):
                    colors={image.getpixel((px,py)) for px in range(8)}
                    if len(colors)<=2:continue
                    fixed={original.getpixel((px,py)) for px in range(8) if protected(px,py)}
                    if fixed:
                        allowed=fixed|{palette_black}
                        assert len(allowed)<=2,(name,cx,cy,py,allowed)
                        for px in range(8):
                            if (px,py) not in incoming or protected(px,py):continue
                            color=image.getpixel((px,py))
                            # The R24 snow contact remains white when its wood
                            # source changes from gray to dark red.
                            if color==(160,32,32) and fixed=={(224,224,224)}:
                                closest=(224,224,224)
                            else:
                                closest=min(allowed,key=lambda p:sum((p[c]-color[c])**2 for c in range(3)))
                            image.putpixel((px,py),closest)
                    else:clear_rows.add(py)
                return image,clear_rows

            # All poses share one fixed backdrop. If any native row would
            # need a third ink, omit that same distant background row in all
            # poses, including rest. The blue houses never sway with a twig.
            clear_rows=set()
            for changes in pose_changes:
                _,needed=compose(original,changes.get((cx,cy),{}));clear_rows.update(needed)
            backdrop=original.copy()
            for py in clear_rows:
                background_rows.append([cx,cy,py])
                for px in range(8):
                    if original.getpixel((px,py))!=palette_black:
                        assert not protected(px,py),(name,cx,cy,py,'protected foreground')
                        backdrop.putpixel((px,py),palette_black);background_removed+=1
            for i,changes in enumerate(pose_changes):
                image,needed=compose(backdrop,changes.get((cx,cy),{}))
                assert not needed,(name,cx,cy,needed)
                assert all(len({image.getpixel((px,py)) for px in range(8)})<=2 for py in range(8))
                final_poses[i][cx,cy]=image
            image=final_poses[0][cx,cy]
            if solid:
                assert all(image.getpixel((px,py))==original.getpixel((px,py))
                           for py in range(8) for px in range(8)
                           if original.getpixel((px,py))!=palette_black),(name,cx,cy)
            if image.tobytes()!=original.tobytes():
                painted=role(base,entries[base]['stage_symbol'],image,decoration=True)
                put(painted,cx,cy,'planted_verge' if verge or owners[cy][cx]=='planted_verge' else 'town_detail')
                modified.append([cx,cy])
        bottom=[ox+px for px in range(picture.width)
                if picture.getpixel((px,picture.height-1))!=palette_black]
        snow_contacts=0
        if snow_join:
            # Four-pixel furniture must stay fully above the snow. Extend the
            # existing white snow only through its one- or two-pixel recess,
            # directly beneath a real foot; never fill a canvas rectangle.
            for wx in bottom:
                for wy in range(baseline,baseline+3):
                    cx,cy=wx//8,wy//8;base=cells[cy][cx];original=tiles[base]
                    if original.getpixel((wx%8,wy%8))!=palette_black:break
                    assert wy<baseline+2,(name,x,'snow support exceeds two pixels')
                    assert entries[base]['stage_symbol']=='#' or owners[cy][cx]=='planted_verge',(name,x,wx,wy,owners[cy][cx])
                    image=original.copy();image.putpixel((wx%8,wy%8),(224,224,224))
                    assert len({image.getpixel((px,wy%8)) for px in range(8)})<=2
                    put(role(base,entries[base]['stage_symbol'],image,decoration=True),cx,cy,
                        'planted_verge' if owners[cy][cx]=='planted_verge' else 'town_detail')
                    snow_contacts+=1
                    if [cx,cy] not in modified:modified.append([cx,cy])
        placements.append({'prefab':name,'at':[x,oy//8],'pixel_origin':[ox,oy],
                           'baseline':baseline,'static_town_detail':not bool(raw_poses)})
        def visible(wx,wy):return tiles[cells[wy//8][wx//8]].getpixel((wx%8,wy%8))!=palette_black
        contacts=sum(visible(wx,baseline-1) and visible(wx,baseline) for wx in bottom) if baseline<height*8 else 0
        assert contacts,(name,x,baseline,'ungrounded detail')
        town_details.append({'prefab':name,'x':x,'pixel_origin':[ox,oy],'baseline':baseline,
                             'ground_contact_pixels':contacts,'modified_cells':modified,
                             'snow_contact_pixels_added':snow_contacts,
                             'existing_foreground_pixels_preserved':preserved,
                             'distant_background_pixels_omitted':background_removed})
        if raw_poses:
            # Snow contact is baked after the art and remains in every pose,
            # even when a tiny shrub shares its character with the snow lip.
            for cx,cy in positions:
                rest=tiles[cells[cy][cx]]
                before=final_poses[0][cx,cy].copy()
                for py in range(8):
                    for px in range(8):
                        color=rest.getpixel((px,py))
                        if color==before.getpixel((px,py)):continue
                        assert cy*8+py>=baseline and color==(224,224,224),(name,cx,cy,px,py)
                        for pose in final_poses:pose[cx,cy].putpixel((px,py),color)
            moving_positions={p for p in positions if len({pose[p].tobytes() for pose in final_poses})>1}
            assert moving_positions,name
            for p in positions-moving_positions:
                cx,cy=p
                for pose in final_poses:pose[p]=tiles[cells[cy][cx]].copy()
            greenery_layers.append({'prefab':name,'x':x,'pixel_origin':[ox,oy],
                                    'bounds':[x,oy//8,max(drawing.width for drawing in pictures)//8,(oy+picture.height-1)//8-oy//8+1],
                                    'poses':final_poses,'positions':moving_positions,
                                    'background_rows':background_rows,'baseline':baseline})

    for bed in plan.get('planting_beds',[]):
        for x in range(bed['from'],bed['to'],2):
            town_detail('berm_sneeuwrand',x,bed['floor']*8,verge=True,
                        clip_width=min(2,bed['to']-x)*8)
    for detail in plan.get('town_details',[]):
        offset=detail.get('ground_offset',2)
        town_detail(detail['prefab'],detail['x'],detail['floor']*8+offset,
                    snow_join=detail.get('snow_join',False))
    assert before_roles==''.join(entries[k]['stage_symbol'] for row in cells for k in row)
    (ROOT/'authoring/stadsgroen/plaatsingscontrole.json').write_text(json.dumps({
        'native_roles_unchanged':True,'stage_runtime_code_changed':False,'details':town_details,
        'source_palette_constraint':'two inks per 8x1 after offline composition',
    },indent=2,ensure_ascii=False)+'\n')

    # Brick lintels extend beyond the top of the view; suspended cargo is attached
    # to them. Reuse original masonry and the blue underside strip, without
    # scaling, mirroring or repainting any tile.
    underside=rows_for('wet_quay_foot_64x8')[0]
    for x0,x1,depth in plan['ceilings']:
        for x in range(x0,x1):
            for y in range(depth-1):
                put(lintel_bays[((x-x0)//4)%len(lintel_bays)][y%3][(x-art_origin)%4],x,y,'warehouse_ceiling','#')
            put(underside[(x-x0)%len(underside)],x,depth-1,'ceiling_underside','#')
    for p in plan['hanging']:
        prefab(p['prefab'],p['x'],p['y'])

    for x,y in plan['kade_mounts']:
        prefab('stadsburg_kadebeugel',x,y)

    # Pack down the existing snow under the feet. A ceiling emplacement has two
    # short steel lugs reaching the last visible masonry course. Keep the original
    # nonblack pixels, edge profiles and collision role of each supporting tile.
    for a in plan['encounters']:
        if not a['kind'].startswith('turret_'):continue
        x,y=a['at']; hanging=a['kind'].endswith('ceiling'); sy=y-1 if hanging else y+2
        for half in (0,1):
            source=cells[sy][x+half];im=tiles[source].copy()
            columns=(2,3,4) if hanging else range(1,7)
            for xx in columns:
                for yy in (range(7,-1,-1) if hanging else range(8)):
                    if im.getpixel((xx,yy))!=(0,0,0):break
                    existing=next((im.getpixel((k,yy)) for k in range(8) if im.getpixel((k,yy))!=(0,0,0)),None)
                    ink=existing or ((64,96,224) if hanging else (224,224,224))
                    im.putpixel((xx,yy),ink)
            assert all(len({im.getpixel((k,yy)) for k in range(8)})<=2 for yy in range(8))
            put(role(source,entries[source]['stage_symbol'],im),x+half,sy,'turret_contact')

    # Preserve each marker's visible tile and change only its native semantic role.
    # S/R mark the joining masonry tile; preserve its visible art under the sprite.
    triggers=[]
    for a in plan['encounters']:
        x,y=a['at']; symbol=ACTOR_SYMBOLS[a['kind']]
        assert 32<=x<width and 0<=y<height
        before=cells[y][x]
        assert entries[before]['stage_symbol'] not in set(ACTOR_SYMBOLS.values()), f'duplicate actor at {x},{y}'
        put(before,x,y,'actor_trigger',symbol)
        triggers.append(dict(a, native_symbol=symbol, column=x-1 if symbol=='S' else x))

    # Stable drawing IDs are retained in prefabs. The cartridge imports only
    # tiles the map actually names, densely numbered with zero reserved for sky.
    visible=sorted({k for row in cells for k in row if k!=1})
    packed={k:i for i,k in enumerate(visible,1)}
    packed[1]=0
    runtime={
        'source':f"Stadsburg — De Bevroren Haven R{plan['revision']}, authoring/level.yaml", 'stage_number':0,
        'tilemap_version':2,'tile_size':8,'tile_columns':32,'tile_rows':22,
        'tape_length_tiles':width,'scroll_stop_columns':plan['scroll_stops'],
        'music_cues':plan['music_cues'],'restart_points':plan['restart_points'],
        'tile_assets':[entries[k]['asset'] for k in visible],
        'tile_symbols':''.join(entries[k]['stage_symbol'] for k in visible),
        # Zero is a genuinely absent tile: the native animated starfield shows.
        'tile_ids':[FlowRow([packed[k] for k in row]) for row in cells],
    }
    runtime['sky_actor_ids']=[packed[k] for k in visible if entries[k]['stage_symbol'] in set(ACTOR_SYMBOLS.values()) and tiles[k].getbbox() is None]
    runtime['water_animation']=compile_water(ROOT,catalog,tiles,entries,cells,owners)
    runtime['water_animation']['origin_column']=art_origin
    runtime['harbor_animation']=compile_harbor(ROOT,plan,prefabs,tiles,entries,cells,placements,catalog['palette'],greenery_layers)
    # Validate map composition and animation before relocating source drawings.
    # A rejected placement must not leave the catalog pointing at moved files.
    for entry in catalog['tiles']:
        source=ROOT/entry['image']
        target=(ROOT/'res/img' if entry['id'] in packed and entry['id']!=1
                else ROOT/'authoring/terreintegels') / source.name
        if target!=source:
            target.parent.mkdir(parents=True,exist_ok=True)
            source.replace(target)
            entry['image']=target.relative_to(ROOT).as_posix()
        if entry['id'] not in packed or entry['id']==1:
            (ROOT/'res/img'/source.name).unlink(missing_ok=True)
    out=ROOT/'res/data';out.mkdir(parents=True,exist_ok=True)
    (out/'nemesis_s_stage.yaml').write_text(yaml.dump(runtime,Dumper=Dumper,sort_keys=False,width=100000,allow_unicode=True))
    (ROOT/'authoring/tileset.yaml').write_text(yaml.safe_dump(catalog,sort_keys=False,allow_unicode=True,width=120))
    image=Image.new('RGB',(width*8,height*8),'black')
    for y,row in enumerate(cells):
        for x,k in enumerate(row): image.paste(tiles[k],(x*8,y*8))
    image.save(ROOT/'previews/level_native.png')
    report={'tile_count':len(tiles),'runtime_tiles':len(visible),'width_tiles':width,
            'height_tiles':height,'encounters':triggers,'placements':placements,'used_prefabs':sorted(used_prefabs),
            'native_actor_count':sum(6 if a['kind'].startswith('formation') else 2 if a['kind']=='bell' else 1 for a in triggers),
            'actors_by_type':dict(Counter(a['kind'] for a in triggers)),
            'used_tiles':len({n for row in cells for n in row}),
            'map_sha256':hashlib.sha256((out/'nemesis_s_stage.yaml').read_bytes()).hexdigest()}
    (ROOT/'authoring/build_report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ['encounters','placements']},indent=2))

if __name__=='__main__': main()
