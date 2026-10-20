# Recon map: Adobe Substance 3D Painter (desktop: Windows, macOS, Linux via Steam/Enterprise)

Scope: the Painter **texturing app**: project creation and mesh import, mesh map baking, the layer stack (fill/paint layers, folders, masks, effects, generators, filters, instancing), 3D/2D painting tools, smart materials and smart masks, Texture Set channels, the PBR viewport (environment, display modes, shaders), texture export (output templates, padding, formats) and the scripting surfaces (Python API, remote scripting, command line). Iray rendering, Substance Designer authoring, the asset store and Adobe cloud services are referenced only to mark them out of scope.
For: Patina (working name), an open-source desktop 3D PBR texture painting app built for humans and AI agents. First MVP goal: import a mesh, bake mesh maps, layer stack with fill/paint layers and generator masks, paint in 3D, smart materials, PBR viewport, export texture sets.
Date: 2026-10-20
Method: clean-room. Public sources only: Adobe's Painter user docs (helpx.adobe.com/substance-3d-painter now redirects to experienceleague.adobe.com), the public Painter Python API docs, the Shader API docs, release notes, Adobe's plans page, the Steam store page, Bing results, the Khronos glTF 2.0 spec, and a few public third-party guides (marked as such). No Adobe binary was downloaded, installed, run or inspected. No account was used. Everything below is paraphrased; only menu names, channel identifiers, keywords and shortcut keys are kept verbatim.

## Sources

Base for rows 1 to 58: `https://experienceleague.adobe.com/en/docs/substance-3d-painter/using/` (written as `E/` below). Python API base: `https://experienceleague.adobe.com/en/docs/substance-3d-dev/painter-python/api/` (written as `P/`). Full URLs are used in `features.csv`.

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | docs home + full nav index | E/home | helpx URL redirects here; nav lists every generator and filter by name |
| 2 | project creation | E/getting-started/project-creation | template, resolution, normal format, UV tiles, auto-unwrap, mesh map import naming |
| 3 | system requirements | E/getting-started/system-requirements | Linux: Enterprise RHEL 8/9, Steam Ubuntu 22.04; Mesa unsupported (updated 2026-10-19) |
| 4 | import/export formats (all Substance apps) | https://experienceleague.adobe.com/en/docs/substance-3d/general-knowledge/ecosystem/import-and-export-formats | Painter in/out format matrix |
| 5 | interface overview | E/interface/interface | list of panels |
| 6 | layer stack | E/interface/layer-stack/layer-stack | layer types, view mode, mask menu |
| 7 | creating layers | E/interface/layer-stack/creating-layers | |
| 8 | masking and effects | E/interface/layer-stack/masking-and-effects | mask ops, smart mask drop rules |
| 9 | blending modes | E/interface/layer-stack/blending-modes | full list incl. normal-map modes |
| 10 | layer instancing | E/interface/layer-stack/layer-instancing | source/instance, cycles |
| 11 | geometry mask | E/interface/layer-stack/geometry-mask | by mesh name or UV tile |
| 12 | effects overview | E/effects/effects | 7 effect types |
| 13 | generators | E/effects/generators/generator | mesh-map driven |
| 14 | levels | E/effects/levels | |
| 15 | anchor point | E/effects/anchor-point | |
| 16 | smart materials and masks | E/features/smart-materials-and-masks | |
| 17 | baking mode interface | E/baking/baking-interface | F8, 4 baking panels |
| 18 | mesh map bakers panel | E/interface/baking-mode/mesh-map-bakers | per-map controls, sync across Texture Sets |
| 19 | common settings | E/interface/baking-mode/common-mesh-map-settings | |
| 20 | mesh map settings | E/baking/mesh-map-settings | every baker parameter |
| 21 | Texture Set settings | E/interface/texture-set/texture-set-settings | channels, formats, normal/AO mixing, UV padding |
| 22 | Texture Set list | E/interface/texture-set/texture-set-list | |
| 23 | tool list | E/painting/paint-tools/tool-list | |
| 24 | paint brush | E/painting/paint-tools/paint-brush | all brush params, stencil, alignment |
| 25 | projection tool | E/painting/paint-tools/projection | |
| 26 | polygon fill | E/painting/paint-tools/polygon-fill | 4 modes |
| 27 | smudge, clone | E/painting/paint-tools/smudge-tool , E/painting/paint-tools/clone-tool | |
| 28 | symmetry, lazy mouse | E/painting/symmetry/symmetry , E/painting/lazy-mouse | |
| 29 | fill projections | E/painting/fill-projections/fill-projections | 7 projection modes |
| 30 | shortcuts | E/interface/settings/shortcuts | full editable + fixed shortcut tables |
| 31 | environment settings | E/interface/display-settings/environment-settings | |
| 32 | viewport settings | E/interface/display-settings/viewport-settings | |
| 33 | shader settings | E/interface/shader-settings/shader-settings | shader instances, displacement, tessellation |
| 34 | 2D view | E/interface/viewport/2d-view | |
| 35 | history | E/interface/history | session-only list |
| 36 | file menu | E/interface/main-menu/file-menu | incremental vs compact save |
| 37 | export overview | E/export/export | textures + mesh export |
| 38 | export settings | E/export/export-window/export-settings | sizes, padding, file formats and bit depths |
| 39 | output templates tab | E/export/export-window/output-templates | map types, filename keywords, source/mesh/converted maps |
| 40 | default output templates | E/export/output-templates/default-output-templates/default-presets | 33 editable presets (names + one-liners) |
| 41 | predefined output templates | E/export/output-templates/default-output-templates/predefined-presets | 8 non-editable presets |
| 42 | USDz (Apple AR) preset | E/export/output-templates/default-output-templates/usd-pbr-metal-roughness-preset | only preset whose outputs are spelled out |
| 43 | projects are really big | E/technical-support/workflow-issues/project-issues/projects-are-really-big | what an .spp contains |
| 44 | automatic UV unwrapping | E/features/automatic-uv-unwrapping | |
| 45 | color management | E/features/color-management/color-management | OCIO 2, ACE; color-managed channel list |
| 46 | command lines | E/pipeline-and-integration/configuration/command-lines | |
| 47 | remote control with scripting | E/scripting-and-development/scripts-and-plugins/remote-control-with-scripting | HTTP JSON endpoint |
| 48 | JavaScript plugin | E/scripting-and-development/scripts-and-plugins/creating-a-javascript-plugin | QML plugins, plugin folders incl. Linux |
| 49 | Shader API | E/scripting-and-development/shader-api-reference/shader-api | GLSL surface shaders |
| 50 | Python API overview (v0.3.5) | P/api-overview | module list |
| 51 | Python export module | P/substancepainter-package/export | full export JSON schema |
| 52 | Python Channel class | P/substancepainter-package/textureset-module/channel | User0..User31 |
| 53 | Python paint layer | P/substancepainter-package/layerstack-module/layers-and-effects/paint | strokes not accessible |
| 54 | Python baking module | P/substancepainter-package/baking | BakingParameters, link groups |
| 55 | Python layerstack edition | P/substancepainter-package/layerstack-module/edition | from Bing snippet: history grouping |
| 56 | release notes 12.1 (2026-06-22) | E/release-notes/version-12-1 | OpenPBR default, auto-rebake, skew painting, hard-surface unwrap |
| 57 | release notes 12.0 (2026-03-09) | E/release-notes/version-12-0 | flatten layers, warp to geometry, post effects, Python 3.13 |
| 58 | Adobe plans page | https://www.adobe.com/products/substance3d/plans.html | prices are geo-localized (read from KZ region) |
| 59 | Steam store page | https://store.steampowered.com/app/4329260/Substance_3D_Painter_2026/ | $89.99 one-time, Indie $12.49/mo, SteamOS + Linux |
| 60 | Bing: pricing | https://www.bing.com/search?q=Adobe+Substance+3D+Painter+price+per+month+plans+Substance+3D+Texturing+Collection+Steam | snippet: Collection $59.99/mo, Texturing $24.99/mo (third-party, July 2026) |
| 61 | Bing: formats | https://www.bing.com/search?q=Substance+3D+Painter+supported+file+formats+mesh+fbx+obj+gltf+usd+experienceleague | led to src 4 |
| 62 | Khronos glTF 2.0 spec | https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html | channel packing that the glTF preset must follow |
| 63 | third-party engine export guide | https://bitsoulhosting.com/marketplace/blog/substance-painter-export-settings-unity-unreal-godot | UE ORM, Unity HDRP mask map, URP; one claim conflicts with Adobe (see Uncertainties) |
| 64 | third-party glTF export guide | https://www.meshmarkup.com/help/export-from-substance-painter | glTF preset writes .glb or .gltf+.bin+images |
| 65 | Bing: Painter MCP | https://www.bing.com/search?q=Substance+3D+Painter+MCP+server+AI+agent+Claude | only community MCP servers exist |
| 66 | community MCP example | https://github.com/elliezu/SubstancePainterMCP | 79 tools, live-validated on 12.1.1, needs a running Painter |
| 67 | DCC-MCP Painter page | https://dcc-mcp.github.io/control/substance-3d-painter | generic adapter, needs a live session |
| 68 | Bing: Firefly in Substance | https://www.bing.com/search?q=Substance+3D+Painter+generative+AI+Firefly+text+to+texture+feature+2026 | Firefly text-to-texture is in Sampler, not Painter |

## Core loop

Import a low-poly mesh, bake its mesh maps (from a high-poly or from itself), stack fill layers and smart materials whose masks are driven by those maps, paint details directly on the 3D surface, check the result in a PBR viewport, and export the Texture Sets as packed bitmaps for a target engine or renderer.
For Patina's MVP that whole loop is the slice. What it should add: a headless engine, an MCP/CLI surface and a stroke-level API (Painter's Python API cannot read or write strokes, src 53).

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Start / empty workspace + File menu | launch; File | open/create projects | New, Open, Recent files, Open sample, Close, Save, Save and compact, Save as, Save as copy, Save as template, Clean, Import resources, Export mesh, Export textures, Send to, Quit (src 36) | no project open, project open, unsaved changes prompt |
| S02 | New project dialog | File > New, Ctrl+N | create project from a mesh | file picker, template dropdown (OpenPBR first since 12.1), document resolution, normal map format (OpenGL/DirectX), tangent per fragment, UV tile mode (3 options, fixed after creation), import cameras, auto-unwrap + Options, import baked maps list (Add), physical size, color management; USD-only scope/variants/subdivision/frame (src 2) | default, USD selected, invalid mesh |
| S03 | Main shell, Painting mode | default after creation, F9 | texturing workspace | main menu, left toolbar (tools), contextual toolbar (tool settings), 3D/2D viewports, right docks (Layer stack, Properties, Texture Set list/settings, Assets, Display/Shader settings, History, Log) (src 5) | panels docked/floating/hidden (Tab hides UI) |
| S04 | 3D viewport | center | paint, navigate, inspect | channel/display-mode dropdown, brush cursor with lazy-mouse ring, symmetry plane, stencil overlay, fill manipulator (Q/W/E/R), bake button area in Baking mode | Material view (M), solo channel (C), solo mesh map (B), isolated mask (Alt+click mask), wireframe, grid, engine paused |
| S05 | 2D (UV) view | F1 split, F3 only, F4 swap | see/paint UV islands | display mode dropdown, UV tile info, U/V axis gizmo (src 34) | regular 0-1 project, UV tile grid with UDIM numbers |
| S06 | Layer stack | right dock | build the material per Texture Set | view-mode (channel) dropdown, per-layer blend mode + opacity for the viewed channel, thumbnails (content, mask), effect indicator line (grey none / red some), geometry-mask icon, instance icon, toolbar: Add effect, Create mask menu (white, black, bitmap, color selection, height combination), New paint layer, New fill layer, Smart material mini-shelf, New folder, Delete (src 6) | empty stack, nested folders, mask selected vs content selected, instance cycle disabled |
| S07 | Properties | right dock | context editor for tool, layer, effect, fill | brush/material previews, Brush, Alpha, Stencil, Physics, Material (channel toggle buttons), fill projection + transform, generator picker, instance tree list (src 24, 29, 10) | tool selected, fill layer, generator, levels (histogram), anchor point references |
| S08 | Assets (shelf) | dock | browse/import resources | filter area (types, saved searches, path filter, advanced queries), asset grid/list, bottom bar, Starter assets vs Your assets libraries, sub-library tabs (src 1, 8 links) | empty search, thumbnails missing |
| S09 | Texture Set list | dock | switch materials, visibility, shader instance per set | set rows, eye toggle, focus mode, show/hide all/invert menu, rename, description, shader instance button (src 22) | selected, hidden, disabled (unassigned) |
| S10 | Texture Set settings | dock | resolution, channels, mesh maps | name, description, size (lock for non-square), shader instance, channel list (+ add, remove, format menu sRGB8...RGB32F, color-managed flag), Add or remove channels window (12.1), Normal mixing, Height to normal method, AO mixing, UV padding mode, mesh map slots (src 21, 56) | supported/unsupported/user channels |
| S11 | Display settings | dock | lighting and camera look | environment map (mini-shelf), exposure, rotation, blur, opacity, alignment world/local, shadows (mode, opacity), camera (FOV, ortho), post effects stack (DOF, bloom, glare, lens flare, lateral aberration, vignette, sharpen, film grain, tone mapping, color correction, color profile) (src 31, 57) | shadows computing |
| S12 | Shader settings | dock | shader file and params | separate undo/redo, shader file mini-shelf, instance name, restore defaults, shader params, displacement (source channel, scale unit, amount), tessellation (uniform/edge length/count) (src 33) | outdated shader warning |
| S13 | Contextual toolbar | top of viewport | quick tool params | size, flow, stroke opacity, spacing, lazy mouse toggle + radius, symmetry toggle + settings, warp-to-geometry toggle (src 24, 28, 57) | per tool |
| S14 | Baking mode | F8, Mode > Bake Mesh Maps | bake mesh maps | Mesh map bakers list (check, visualize, quick bake, auto-rebake, sync), Common settings, Mesh map settings, Baking log, visualization settings overlay, single Bake button showing count (src 17, 18, 56) | baking progress, errors in log, skew paint mode |
| S15 | Export textures window | File > Export textures, Ctrl+Shift+E | write bitmaps | Settings tab (Texture Set checklist + global settings + per-set overrides: output dir, output template, file type, size, padding, dithering, per-set Output maps list, Export USD asset), Output templates tab (presets list, map rows Gray/RGB/R+G+B/RGB+A/R+G+B+A, filename with $ keywords, format/bit depth, Input/Mesh/Converted maps lists), naming convention dropdown (12.1), list of exports (src 38, 39, 56) | invalid template, export warnings |
| S16 | Export mesh dialog | File > Export mesh | write processed geometry | with/without displacement-tessellation, triangulation, recompute normals (src 37) | |
| S17 | History | dock | jump back to prior state | action list (session only) (src 35) | branch truncation |
| S18 | Log | dock | messages and errors | log list (src 1 nav) | warnings, errors |
| S19 | Project configuration | Edit menu | change mesh/UV/normal settings after creation | reimport mesh checkbox with prefilled path, USD scope/variant, color management (src 57) | |
| S20 | Settings/Preferences | Edit menu | general, shortcuts, libraries | shortcut editor (pen icon, right-click reset), library paths (src 30) | |
| S21 | Color picker | click a color swatch | pick colors | wheel/sliders/hex, picker from viewport (src 1 nav) | |
| S22 | Instance tree list | instance icon on a layer | navigate source and instances across sets | list of source + instances (src 10) | |
| S23 | Geometry mask edit mode | click geometry-mask icon | include/exclude meshes or UV tiles | viewport selection, icon state with remaining count (src 11) | all excluded = no effect |
| S24 | Import resources window | File > Import resources, drag-drop | bring textures/materials/brushes in | file list, type per file, destination (project / session / shelf) (src 1 nav) | unsupported type |
| S25 | Texture Set reassignment | after mesh changes | map old sets to new materials | old/new set mapping (src 43 mention) | disabled sets |
| S26 | Mini-shelf popovers | smart material button, generator/filter picker, env map, shader | pick a resource in context | filtered grid | |
| S27 | Rendering (Iray) mode | F10 | path-traced stills | Iray settings, MDL (src 1 nav) | out of scope |
| S28 | Instantiate across Texture Sets dialog | layer right-click | create instances in several sets | set checklist, channel-mismatch warning (src 10) | mismatch |

## Flows

```
F01 Texture a mesh end to end (Patina MVP loop)
    S01 Ctrl+N -> S02 pick mesh + template + resolution + normal format -> OK
    -> S14 F8, tick maps, Bake -> S03 F9
    -> S06 Smart material mini-shelf (or drag from S08) -> S07 tweak params
    -> S06 add fill layer + black mask + generator (e.g. Dirt) -> S07 pick generator
    -> S06 new paint layer -> S04 paint with 1 (brush), [ ] size, L symmetry
    -> S15 Ctrl+Shift+E, pick preset, size, padding -> Export
    happy path clicks: about 18 to 22 plus strokes
    edge: mesh has no UVs (auto-unwrap needed), overlapping UVs inside one material,
          UV islands outside 0-1 without UV tile mode (not paintable, src 34),
          generators look wrong until mesh maps are baked,
          8K export needs enough VRAM (src 2, 38)

F02 Bake mesh maps from a high-poly
    S14 -> Common settings: output size, dilation, add high-poly meshes (or use low as high),
    cage (distance / automatic / custom file), match Always or By mesh name (_low/_high suffix),
    antialiasing -> per-map settings (AO rays, distances, ground plane; curvature method;
    position axis/normalization; thickness; ID color source) -> Bake (count shown)
    edge: projection skew on hard edges (12.1 skew painting + edge protection),
          intersecting parts bleed (match by name), common settings cannot be overridden per map
          (bake twice at different sizes, src 19), settings sync across Texture Sets

F03 Procedural material with masks
    S06 New fill layer -> S07 set channels (color, roughness, metal...) or drop a material
    -> projection: UV / tri-planar / planar / spherical / cylindrical / warp -> transform (Q, W/E/R)
    -> Create mask: black -> Add generator (Metal edge wear) -> Add levels -> Add filter (blur)
    -> Add paint effect to touch up
    edge: re-adding or removing a mask destroys its effects (src 8);
          levels act on one channel at a time (src 14); anchor references must sit above the anchor

F04 Paint details in 3D
    select Paint (1) -> S07 brush alpha, material, channel toggles -> stroke on S04
    modifiers: Shift+click straight line, Ctrl+RMB drag size/hardness, Ctrl+LMB drag flow/rotation,
    D lazy mouse, L symmetry, S stencil transform, N ignore stencil, A resume stroke,
    X invert mask value, P material picker, V clone source
    edge: Follow Path needs two stamps, single click paints nothing (src 24);
          painting bleeds across UV islands (padding mode, src 21);
          stencil/projection in 2D view has no symmetry (src 28)

F05 Make and reuse a smart material / smart mask
    group layers into a folder (Ctrl+G) -> right-click folder > Create smart material -> appears in shelf
    mask -> right-click > Create smart mask; drop on layer: black mask created or effects merged,
    hold Ctrl to replace (src 8, 16)
    edge: once inserted there is no link back to the smart material (src 16)

F06 Export for a game engine
    S15 Settings tab: tick Texture Sets, output dir, template (e.g. Unreal Engine (Packed)),
    size, padding (infinite / diffusion...), dithering -> optional Output templates tab to edit packing
    -> Export
    edge: opacity map exports black when shader lacks alpha (troubleshooting page title, src 1 nav);
          format/bit depth per map only applies with "Based on output template" (src 39);
          user channels are referenced by userN identifiers, not custom names (src 39)

F07 Instance a layer across Texture Sets
    select layer -> Ctrl+C -> Ctrl+Shift+V (or right-click Instantiate across texture sets, S28)
    edge: paint strokes only land in the source set; instance inside its own source = cycle, disabled (src 10)

F08 Flatten for performance (12.0)
    select layers -> Ctrl+G -> Ctrl+M (flatten copy, source group disabled) -> optional export to disk

F09 Script / agent control (original)
    launch with --enable-remote-scripting -> POST base64 JS or Python to localhost /run.json
    (default port 60041 in the sample client) -> substance_painter.* calls (project, layerstack,
    baking, export) -> export_project_textures(json_config)
    edge: GUI must be running and ready; Python objects must be stringified to return;
          strokes cannot be read or written (src 47, 53)

F10 Re-import mesh / change resolution
    Project configuration > Reimport mesh (path prefilled) -> layers and strokes recomputed;
    Texture Set size changed at any time, recompute (non-destructive) (src 21, 57)
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Layer row | paint, fill, folder, instance source, instance target, smart material folder | visible/hidden, selected content vs mask, effects present marker, geometry mask icon | S06 |
| Thumbnail pair | content, mask (+ geometry mask icon) | mask disabled (Shift+click), isolated view (Alt+click) | S06 |
| Effect row | generator, fill, paint, levels, filter, compare mask, color selection, anchor point | blend + opacity, reorder Alt+Up/Down | S06 |
| Blend mode dropdown | ~30 modes incl. normal-map modes | arrow keys / wheel cycle when focused | S06, S07 |
| Channel toggle button | one per Texture Set channel | on/off | S07 (Material section), fill layers |
| Slider (scrubbable) | float, int, angle, with pen-pressure toggle | default, pressure-driven | S07, S13 |
| Mini-shelf popover | smart materials, generators, filters, env maps, shaders | filtered | S06, S07, S11, S12 |
| Resource tile | material, smart material, smart mask, brush, alpha, texture, env, generator, filter, export preset | selected, missing thumbnail | S08 |
| Histogram editor | levels | per-channel, clamp | S07 |
| 3D manipulator | translate, rotate, scale, surface snap; object/world space | snap with Shift | S04 |
| Stencil overlay | image, tiling none/H/V/HV | hidden while painting | S04 |
| Output map row | Gray, RGB, R+G+B, RGB+A, R+G+B+A slots | drag source maps in | S15 |
| Mesh map baker row | per map: check, visualize, quick bake, auto-rebake, sync | baking, done, failed | S14 |
| Display mode dropdown | Material, each channel, each mesh map, mask | R/G/B/A sub-view | S04, S05 |

## Keyboard shortcuts (defaults, src 30)

Navigation (Windows; macOS in brackets where it differs):
- Orbit Alt+LMB (Option+LMB); snap orbit 90 degrees Alt+Shift+LMB; pan Alt+MMB (Option+Cmd+LMB), alt pan Ctrl+Alt+LMB; zoom Alt+RMB (MMB); frame mesh F; perspective F5, orthographic F6; rotate environment Shift+RMB; DOF auto-focus Ctrl+MMB; pick Texture Set under cursor Ctrl+Alt+RMB.
- Layouts: F1 3D+2D, F2 3D only, F3 2D only, F4 swap. Hide UI Tab. Isolate Texture Set Alt+Q. Hide excluded geometry Alt+H.
- Modes: F8 Baking, F9 Painting, F10 Rendering (Iray). Bake mesh maps window Ctrl+Shift+B. Export textures Ctrl+Shift+E.
- Display: M material, C / Shift+C next/previous channel solo, B / Shift+B next/previous mesh map solo.

Tools: 1 Paint (Ctrl+1 with particles), 2 Eraser (Ctrl+2 particles), 3 Projection (Ctrl+3 particles), 4 Polygon fill, 5 Smudge, 6 Clone relative (Ctrl+6 absolute), P material picker, U quick mask edit, Y clear quick mask, I invert quick mask.
Brush: ] / [ size up/down, Ctrl+RMB drag size (horizontal) and hardness (vertical), Ctrl+LMB drag flow (horizontal) and rotation (vertical), D lazy mouse, L symmetry, X invert grayscale on masks, A resume previous stroke, Shift+LMB straight line, Ctrl+Shift+LMB snapped straight line, V+LMB clone source, S+LMB/MMB/RMB stencil rotate/translate/zoom (Shift snaps rotation), N ignore stencil, Space pause particles.
Manipulator: Q show/hide, W translate, E rotate, R scale, Shift+W surface snap, T object/world space, + / - manipulator size, Shift+V warp edit mode.
Layers (fixed, mouse over layer stack): Ctrl+C/X/V, Delete, Ctrl+D duplicate, Ctrl+G group, Ctrl+Shift+C/V copy/paste layer content, Ctrl+Shift+V paste as instance (src 10), Ctrl+M flatten (src 57), Alt+Up/Down reorder effects (src 12).
App: Ctrl+N/O/S, Ctrl+F4 close (Cmd+W), Ctrl+Z / Ctrl+Y undo/redo, Shift+Esc pause engine.

## Channels (Texture Set)

- Export identifiers for document channels (src 51): basecolor, height, specular, opacity, emissive, displacement, glossiness, roughness, anisotropylevel, anisotropyangle, transmissive, scattering, reflection, ior, metallic, normal, ambientOcclusion, diffuse, specularlevel, blendingmask, user0 to user7. The Python Channel class allows User0 to User31 (src 52). OpenPBR (12.1) adds a larger set, e.g. coat color/normal/opacity/roughness/specular level, sheen color, scattering color (src 45, 56).
- Storage formats per channel: sRGB8, L8, RGB8, L16, RGB16, L16F, RGB16F, L32F, RGB32F. Storage format does not change how a channel is interpreted; color management is fixed per channel except user channels (src 21, 45).
- Per-set mixing: Normal mixing Combine (default, detail-oriented) or Replace; Height-to-normal Sharp or Smooth (Sobel, default); AO mixing Multiply (default) or Replace; UV padding 3D Space Neighbor (default, falls back to 2D for normal) or 2D Space Neighbor (src 21).
- Resolution: up to 4096 inside the app, up to 8192 on export; non-square allowed (src 2, 21).

## Mesh maps (bakers)

Normal, World space normal, ID, Ambient occlusion, Curvature, Position, Thickness, Height, Bent normals, Opacity (src 18, 20, 39). Import naming for pre-baked maps: `TextureSetName_<slot>` with slots ambient_occlusion, curvature, normal_base, world_space_normals, id, position, thickness (src 2, 46). Common settings: output size (lock for non-square), dilation width, apply diffusion, use low poly as high poly, high-definition meshes list, cage (distance based / automatic experimental / custom file with same vertex count), ignore backface, match Always / By mesh name with low/high suffixes, antialiasing, skew correction (paint, edge protection, edge distance, edge contrast). ID color source: vertex color, material color, file ID, mesh ID/polygroup; generator random/hue shift/grayscale. AO: secondary rays, min/max occluder distance, relative to bbox, spread angle, distribution (e.g. Cosine), ignore backface, self occlusion, attenuation, ground plane + offset. Curvature: method (FromMesh / FromNormalMap per src 54), rays, sampling radius, self intersection, auto tonemapping per UV tile or min/max. Position: all axes or single axis, normalization bbox / sphere / none, scale. Thickness: like AO plus normalization. Height: normalization, scaling divisor. Bent normals: like AO (src 20).

## Layer stack model (src 6, 8, 9, 12)

- Bottom layer computed first; folder contents computed before siblings. Each layer is multi-channel and has its own blend mode and opacity per channel; the view-mode dropdown chooses which channel's blend/opacity/thumbnail is shown.
- Order per layer: content (with its effect stack) is blended onto the result below, then the mask (with its own effect stack) scales the contribution. All blending happens in linear space; HSV used for Tint/Saturation/Color/Value.
- Blend modes: Normal, Passthrough, Disable, Replace, Multiply, Divide, Inverse Divide, Darken (Min), Lighten (Max), Linear Dodge (Add), Subtract, Inverse Subtract, Difference, Exclusion, Signed Addition (AddSub), Overlay, Screen, Linear Burn, Color Burn, Color Dodge, Soft Light, Hard Light, Vivid Light, Linear Light, Pin Light, Tint, Saturation, Color, Value, Normal Map Combine (whiteout), Normal Map Detail (reoriented normal mapping), Normal Map Inverse Detail.
- Effects: Generator, Paint, Fill, Levels, Compare Mask, Filter, Anchor Point (+ color selection, smart mask per Python API).
- Generators shipped (names from nav): 3D Distance, 3D Linear Gradient, Ambient Occlusion, Auto Stitcher, Curvature, Dirt, Dripping Rust, Fiber Glass Edge Wear, Grayscale Conversion, Inflate Shrinkwrap, Light, Mask Builder, Mask Editor, Metal Edge Wear, Position, Tri-Planar Advanced, UV Border Distance, UV Checker, UV Random Color, UV Texel Density, World Space Normals. All are Substance graphs that read baked maps (src 13).
- Filters shipped: about 28 standard (blur variants, clamp, color balance/correct, contrast, drop shadow, fill area, FXAA, glow, gradient, highpass, histogram scan/shift, HSL, invert, mirror, pixelate, posterize, sharpen, smoothstep, threshold, transform, warp), 9 MatFinish, 10 MatFx, 2 baked lighting, 13 advanced (bevel, color match, height adjustments, height to normal, mask outline, PBR validate, quantize, stylization...).

## Export presets and channel packing

Adobe's public user docs list presets only by name with a one-line description (src 40, 41); the exact map rows are visible only inside the app's Output templates tab. The table below combines what Adobe states with the public format/engine conventions the presets must satisfy. Patina should define its own presets from the target spec, which is also the clean-room way.

| preset (Adobe name) | outputs | packing | normal | evidence / confidence |
| --- | --- | --- | --- | --- |
| Document channels + Normal + AO (No Alpha) / (With Alpha) | every enabled channel as its own file, plus a combined normal and mixed AO | one channel per file; "With Alpha" variant adds alpha (likely opacity into base color A) | converted normal in project format | names src 41; alpha placement is a guess |
| glTF PBR Metal Roughness | glTF/GLB with mesh + textures; predefined presets run pre/post processes that generate glTF data (src 51) | base color RGB (+opacity A); occlusion read from R; metallicRoughness: roughness in G, metal in B (spec-mandated); Painter likely ships one combined occlusion-roughness-metallic file | +X right, +Y up (OpenGL), linear | src 41, 51, 62, 64; packing high (spec), file count medium |
| glTF PBR Metal Roughness + Displacement texture (experimental) | as above plus a displacement/height map | as above | as above | name only, src 41 |
| USDz (Apple AR) | 5 textures: base color, metallic, normal, occlusion, roughness; JPG except normal as PNG; plus .usdc and .usdz | unpacked, one map per file | (not stated) | src 42, high |
| Export USD asset (checkbox) | texture folder + .usda pointing at it + optional .usd assembling materials with mesh + optional mesh .usd | uses the chosen template | per template | src 38, high |
| Unreal Engine (Packed) | BaseColor, OcclusionRoughnessMetallic, Normal, (Emissive) | ORM: R = mixed AO, G = roughness, B = metallic | DirectX | Adobe says it packs for the smallest memory use (src 40); packing from src 63 and UE forum hit; medium |
| Unreal Engine SSS (Packed) | as above, opacity slot replaced by subsurface | implies opacity normally rides in a packed alpha | DirectX | src 40; medium |
| Unity HD Render Pipeline (Metallic Standard) | BaseMap, MaskMap, Normal, Emissive | MaskMap: R metallic, G AO, B detail mask, A smoothness (1 - roughness) | OpenGL (Unity default per src 2) | src 40, 63; medium |
| Unity Universal Render Pipeline (Metallic Standard) | BaseMap, MetallicSmoothness, Normal, Occlusion, Emission | BaseMap A = opacity; metallic R, smoothness A | OpenGL | src 40, 63; medium |
| PBR Metallic Roughness | BaseColor, Metallic, Roughness, Normal, Height (+AO/Emissive when present) | unpacked | per project | src 40 one-liner; map list is a guess |
| PBR Specular Glossiness (+ "converted from Metallic Roughness") | Diffuse, Specular, Glossiness, Normal, Height | converted maps (src 39) | per project | src 40; medium |
| Blender (Principled BSDF), Arnold, Vray, Redshift, Renderman, Corona, Keyshot, Maxwell, CryEngine, Lumberyard, Roblox, Lens Studio, Spark AR, Shade 3D, Dota 2, Sketchfab, Substance 3D Stager, 2D View | renderer/engine-specific names | not documented publicly | | names only, src 40, 41 |
| Mesh Maps | each baked mesh map at the Texture Set resolution | one map per file | baked | src 40, high |

Export mechanics that are documented and must be cloned (src 38, 39, 51):
- Map slot types: Gray, RGB, R+G+B, RGB+A, R+G+B+A. Source map kinds: document channels, mesh maps (normal, world space normal, id, AO, curvature, position, thickness, height, bent normals), converted maps (Normal OpenGL, Normal DirectX, Mixed AO, Diffuse, Specular, Glossiness, Glossiness2, Unity4 Diffuse/Gloss (deprecated), Reflection, 1/ior, f0, View_2D) and constants (black, white). Python names: srcMapType documentMap / meshMap / virtualMap / defaultMap; destChannel L, R, G, B, A.
- Filename keywords: $project, $mesh, $textureSet, $udim, $colorSpace, $sceneMaterial, $uvTileName.
- Size: per Texture Set or 128 to 8192 (Python sizeLog2, int or [w, h]).
- Padding: passthrough, infinite dilation, dilation + transparent, dilation + default background color, dilation + diffusion (mip-based); Python paddingAlgorithm passthrough / color / transparent / diffusion / infinite + dilationDistance.
- Formats and bit depths: bmp 8; exr 16f/32f; gif 8; hdr 32f; ico 8; j2k/jp2/jng 8/16; jpeg 8; jpeg-xr 8/16/32f; pbm/pgm/ppm 8/16; pfm 32f; png 8/16; psd 8/16 (one container file); tga 8; tiff 8/16/32f; wbmp 8; webp 8; xpm 8. 8-bit options include dithering.
- Rules: global settings with per-Texture-Set overrides; per-map format only when file type is "Based on output template"; exportParameters filtered by dataPaths; exportList rootPath = TextureSet or TextureSet/stack.

## File-format interop (src 4, 2, 38, 62)

- Painter imports meshes FBX, OBJ, glTF, USD, ABC, DAE, PLY and exports FBX, OBJ, glTF, USD, DAE, PLY. Materials in: SBSAR, MDL, GLSL shaders; out: MDL. Lights in: EXR, HDR. Images in/out incl. PSD; ABR brushes in. Project: .spp in/out; template .spt.
- Patina MVP: import glTF/GLB, OBJ, FBX (via an open loader); export textures PNG (8/16), JPEG, TGA, EXR (16f/32f), and glTF/GLB with embedded textures; later USD (UsdPreviewSurface/OpenPBR) and UDIM naming.
- Packing conventions to support as presets: glTF metallicRoughness (G rough, B metal) + occlusion R; UE ORM (R AO, G rough, B metal) with DirectX normal; Unity HDRP MaskMap (R metal, G AO, B detail, A smooth); Unity URP MetallicSmoothness (R metal, A smooth); Godot ORM (same as UE) with OpenGL normal (src 63).
- Normal Y convention: DirectX (X+, Y-, Z+) vs OpenGL (X+, Y+, Z+); Adobe notes Unreal defaults to DirectX and Unity to OpenGL; Unreal also wants tangent per fragment enabled (src 2).
- .spp: one self-contained file embedding the processed mesh, baked mesh maps, every referenced resource and a cached layer-stack result per Texture Set; high-poly meshes are linked not embedded; incremental saves fragment the archive; Save and compact rewrites it (src 36, 43). Internal format undocumented: treat as closed.

## Inferred data model

```
Project       name, mesh (processed copy), template ref, normalFormat (OpenGL|DirectX),
              tangentPerFragment, uvTileMode (none|preserve per material|split legacy),
              unitScale, colorManagement (legacy|OCIO|ACE), textureSets[], resources[] (embedded),
              exportSettings, displaySettings, shaderInstances[]
              evidence: src 2, 36, 43; confidence: high (fields), guess (layout)
TextureSet    name (from mesh material), description, size (w,h log2, non-square), shaderInstance,
              channels[], meshMaps{slot -> image}, normalMixing (combine|replace),
              heightToNormal (sharp|sobel), aoMixing (multiply|replace),
              uvPadding (3d neighbor|2d neighbor), stacks[] (material layering), uvTiles[], enabled
              evidence: src 21, 22; confidence: high
Channel       type (BaseColor..., User0-31), format (sRGB8|L8|RGB8|L16|RGB16|L16F|RGB16F|L32F|RGB32F),
              label (user only), colorManaged (fixed except user)
              evidence: src 21, 52; confidence: high
LayerNode     uid, name, kind (paint|fill|group|instance), visible, perChannel{blendMode, opacity},
              contentEffects[], mask? {kind white|black|bitmap|colorSelection|heightCombination,
              effects[], enabled, inverted background}, geometryMask {include/exclude mesh names|uvTiles},
              instanceSource?
              evidence: src 6, 8, 10, 11, P/layerstack; confidence: high
EffectNode    kind (generator|fill|paint|levels|filter|compareMask|colorSelection|anchorPoint|smartMask),
              blendMode, opacity, params (substance params / levels curve per channel / clamp)
              evidence: src 12, 14, 15, 50; confidence: high
FillParams    projection (uv/fill per tile|triplanar|planar|spherical|cylindrical|warp), transform
              (scale, rotation, offset, tiling), perChannel source (uniformColor|bitmap|substance|
              vectorial svg|font text|anchor reference), symmetry
              evidence: src 29, P/source module list; confidence: high (kinds), medium (fields)
Stroke        stored per paint layer/effect; replayed so resolution can change; NOT exposed by API
              evidence: src 21 (dynamic resolution), 43, 53; confidence: medium (storage), high (no API)
ToolPreset    tool, size, flow, strokeOpacity, spacing, angle, followPath, jitters (size/flow/angle/pos),
              alignment (camera|tangent wrap|tangent planar|uv), backfaceCulling angle,
              sizeSpace (object|viewport|texture), alpha, stencil (+tiling), material channels,
              physics/particle script, pressure bindings
              evidence: src 24; confidence: high
BakingParams  per TextureSet: common (outputSize, dilation, diffusion, highPolyMeshes[], useLowAsHigh,
              cage mode/file, ignoreBackface, match mode + suffixes, antialiasing, skew map)
              + per baker params; link groups across sets; enabled maps
              evidence: src 20, 54; confidence: high
SmartMaterial saved folder of layers + effects (file in shelf); SmartMask saved mask effect stack
              evidence: src 16; confidence: high (concept), guess (file format)
ShaderInstance shader file (GLSL / OpenPBR), params, displacement {sourceChannel, scaleUnit, amount},
              tessellation {mode, count|maxLength}
              evidence: src 33, 49; confidence: high
ExportPreset  name, maps[] {fileName with $keywords, channels[] {destChannel, srcChannel, srcMapType,
              srcMapName}, parameters {fileFormat, bitDepth, dithering, sizeLog2, paddingAlgorithm,
              dilationDistance}}
              evidence: src 39, 51; confidence: high (public JSON schema)
DisplaySettings envMap, exposure, rotation, blur, opacity, alignment, shadows {mode, opacity},
              camera {fov, ortho}, postEffects[], wireframe, grid
              evidence: src 31, 32, 57; confidence: high
```

Relationships: Project 1-n TextureSet; TextureSet 1-n Channel, 1-n Stack 1-n LayerNode (tree via groups), 1-n MeshMap; LayerNode 1-n EffectNode (content) + 0-1 Mask 1-n EffectNode; Instance n-1 source LayerNode (across sets); AnchorPoint 1-n references (same set only, referencing layer must be above); ShaderInstance 1-n TextureSet; ExportPreset applied per TextureSet with overrides.

## Scripting and the AI-agent gap

What Painter offers (verified 2026-10-20):
1. **Python API v0.3.5** (Python 3.13 since 12.0; src 50, 57): modules application, async_utils, baking, colormanagement, display, event, exception, export, js, layerstack (navigation, edition, selection, all layer/effect kinds), logging, project, properties, resource, source, textureset, ui. Plugins live in the user's Documents/Adobe/Adobe Substance 3D Painter folder (Linux path documented, src 48).
2. **Remote scripting** (src 47): start the GUI with `--enable-remote-scripting`; a local HTTP server takes POSTs of base64-encoded JS or Python to `/run.json` (sample client uses port 60041). Python results must be stringified by the caller. No auth is described.
3. **Command line** (src 46): `--mesh`, `--mesh-map` (repeatable, naming convention), `--split-by-udim`, `--export-path`, `--vram-budget`, `--disable-version-checking`, `--enable-remote-scripting`, `--help`, `--version`. These only open/create a project in the GUI; there is no documented headless bake or export command.
4. **Legacy JS/QML plugins** and a **GLSL surface-shader API** (src 48, 49).
5. **No official MCP or agent**: Bing shows only community MCP servers (src 65 to 67), all of which drive a running, licensed GUI session through the scripting bridge. Adobe's generative features (Firefly text-to-texture) live in Sampler, not Painter (src 68).

Gaps an agent-first open-source clone can exploit:
- **Strokes are invisible to the API** (src 53): an agent can create paint layers but cannot paint, read or replay strokes. Patina should expose a stroke API (stamps along a 3D/UV polyline with brush params) and store strokes as data.
- **No headless mode**: everything needs the GUI, a GPU and a license; CI and server-side texturing are impossible. Patina: headless engine + CLI (`patina bake`, `patina apply-smart-material`, `patina export`) + MCP on all OSes.
- **No visual self-check primitive** for agents: no documented "render viewport to PNG" call (display module exists but details not read; uncertain). Patina: deterministic render of viewport/channel/mask to PNG in one call.
- **Closed content and formats**: .spp, smart materials and all generators/filters are Substance (.sbsar) graphs run by Adobe's engine. Patina: open, diffable project and preset formats (JSON + PNG/EXR sidecars), procedural generators as open shader code.
- **History is session-only** (src 35) and the shader has its own separate undo stack (src 33). Patina: persistent, named, transactional history that agents can group and roll back.
- **Platform and price**: Linux only via Steam (Ubuntu 22.04) or Enterprise (RHEL); Mesa drivers and x86 integrated GPUs unsupported (src 3); subscription or yearly-version purchase. Patina: free, Linux-first, runs on Mesa/integrated GPUs (Vulkan/WebGPU), lower-res defaults.
- **Export config is already JSON-shaped** (src 51): Patina can accept the same concepts (source map types, dest channels, padding, sizeLog2) so agent prompts and pipelines port over easily, without copying Adobe text.

## Pricing and platforms (read 2026-10-20)

- Adobe plans page (src 58, prices shown are localized to the reader's region): Substance 3D Collection for individuals (Painter, Sampler, Stager, Designer, Modeler + Assets, 100 GB storage, 30-day trial) shown at 26.87 US$/mo incl. VAT; Collection for teams 119.99 US$/mo per license (1 TB); education offer. A Texturing plan is not shown on that regional page.
- Third-party snippet (src 60): US prices Collection $59.99/mo and Texturing $24.99/mo (July 2026); Adobe changed Substance prices on 2025-03-25 (Adobe FAQ title in the same results).
- Steam (src 59): "Substance 3D Painter 2026" one-time $89.99 (a yearly version, not upgrades), "Substance Indie Monthly" $12.49/mo (Painter, Designer, Modeler + 1,000 assets); Windows, macOS, SteamOS + Linux.
- System requirements (src 3): Windows 11 23H2+, macOS 15+ (12.1 notes say 13+ minimum, conflict), Linux RHEL 8/9 (Enterprise) or Ubuntu 22.04 (Steam); NVIDIA RTX 2060 Super-class minimum, 8 GB VRAM min, 16 GB RAM min; Linux NVIDIA driver 535.171.04+, AMD Radeon 22.40.6, Intel unsupported on Linux; Mesa unsupported; VMs unsupported; 9 UI languages.
- Takeaway: Painter gates by license and hardware, not by features. Every texturing feature is in every paid SKU.

## Feature matrix

See `features.csv` (columns: feature, area, priority, original, clone, notes, source_url). Total 157 rows. Must: 66, should: 56, could: 28, wont: 7. Every row is `original=yes, clone=no`; the scripting rows describe Painter's real surfaces, with the Patina agent-first angle in `notes`. Priority uses `wont` where the precedent used `skip`.

## Out of scope (cannot or should not be cloned)

- Substance engine and the .sbsar format (proprietary): Patina reimplements generators/filters as its own shader code instead of loading Adobe graphs.
- Adobe's content: starter smart materials, materials, brushes, alphas, environment maps, Substance 3D Assets library. Patina must ship its own (CC0 sources like Poly Haven for HDRIs and textures).
- Iray path tracer and MDL, Send to Stager/other Adobe apps, Adobe accounts, licensing, cloud storage, Firefly.
- Physical paint (particle scripts) and Dynamic strokes (Substance-driven stamps): too large for MVP, marked wont.
- .spp internals (undocumented); Patina does not read .spp.
- Adobe UI chrome, icons, branding, tutorials, sample projects.

## Uncertainties

- Exact map rows of each default and predefined export preset are not in the public docs; packing in the table above comes from format/engine specs and third-party guides (medium confidence). Specifically unverified: whether the glTF preset writes one combined occlusion-roughness-metallic texture, where the UE preset puts opacity, and the Document channels "With Alpha" placement.
- Third-party guide (src 63) says Unity wants DirectX normals; Adobe (src 2) says Unity uses OpenGL by default. Trust Adobe and Unity convention (OpenGL).
- Default remote-scripting port 60041 is from the sample client code in the docs; whether it is configurable was not checked.
- Python display module may offer screenshots/camera control; not read.
- macOS minimum: system requirements page says macOS 15; 12.1 notes say 13 (Ventura). Pages updated on different dates.
- Pricing: Adobe page is geo-localized; US prices come from a third-party snippet, not an Adobe page.
- How strokes are stored in .spp (vector replay vs raster tiles) is inferred from the docs saying the workflow is non-destructive and resolution can change at any time (src 21, 43); it is not stated.
- Generator internals (which mesh maps each generator reads and how) are documented per generator page (21 pages) but only the overview was read; Patina should design its own math anyway.

## Size

Screens 28, flows 10, entities about 14. Hard parts: (1) a GPU stamp-painting engine that projects stamps from 3D onto UV space with seam handling, padding and pen pressure, storing strokes so resolution can change; (2) a baking raytracer (high-to-low with cage, AO, thickness, curvature, bent normals) that runs on GPU or fast CPU (embree-class); (3) a live, per-channel layer compositor with masks and effect stacks that recomputes incrementally; (4) a procedural generator library (edge wear, dirt, position gradient, light, curvature-based) without Substance; (5) export packing with padding/dilation and correct color spaces; (6) the agent surface: headless engine, MCP, stroke API, render-to-PNG. Full Painter parity: XL (rescope). Patina MVP slice (import, bake 7 maps, fill/paint layers, masks with ~6 generators and ~6 filters, smart materials as JSON presets, PBR viewport with IBL, export presets for glTF/UE/Unity/Godot, CLI + MCP): L (about a quarter).
