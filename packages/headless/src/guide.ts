export const GUIDE = `Patina: 3D PBR texture painting. You paint materials onto a mesh through commands; the same
commands drive the desktop window, the CLI and this MCP server.

MODEL
- A document = one mesh (built-in primitive or an imported .glb/.gltf/.obj with UVs) + one texture set
  (resolution 256..4096) + a layer stack. Layers are listed TOP FIRST by doc.inspect.
- Channels: baseColor (sRGB hex), metallic 0..1, roughness 0..1, height -1..1 (drives the normal map),
  emissive (hex). A layer only touches the channels it defines.
- Layer types: fill (a material over the whole surface, shaped by a mask), paint (brush strokes),
  folder (groups layers; its opacity and mask apply to the group).
- Masks: base grey (0 black hides, 1 white shows) + effects bottom to top: generator (edgeWear, dirt,
  gradient, noise, facing, curvature, ao, uniform), paint (strokes of grey), levels.
  Generators that read curvature/AO bake them on first use (about 1-3 s).
- Everything procedural is evaluated in 3D object space, so there are no UV seams.
- Sizes are relative to the mesh bounding-box diagonal (doc.inspect mesh.bounds.size = 1 unit of
  relative size): brush size 0.03 = 3% of the object, noise scale 0.05 = small features.

WORKFLOW
1. doc.new {primitive:'orb'} or mesh_import {path}. doc.inspect to see bounds, parts and ids.
2. Fastest good result: smart.list -> smart.apply {preset:'paintedSteelWorn'}. Or build it:
   material.apply {preset:'steel'}; layer.add {type:'fill', preset:'paintRed', mask:'white'};
   mask.effect.add {layer:'L2', generator:{type:'edgeWear', amount:0.5}, blend:'subtract'}.
3. Paint: layer.add {type:'paint'}; paint.stroke {material:{baseColor:'#ff3b2e', roughness:0.4},
   screen:[[0.4,0.5],[0.6,0.5]], view:'front'}. Use pick {screen, view} to find object-space points.
   Paint into a mask with paint.stroke {layer:'L3', mask:true, value:1}.
4. LOOK at the result after every few steps: render_preview {view:'iso'} or render_sheet. Channel views
   (channel:'roughness' | 'height' | 'curvature' | 'ao' | 'normal') explain what you see.
5. export_textures {dir, preset:'gltf'|'unreal'|'unityHdrp'|'unityUrp'|'separate'} or export_glb.

TIPS
- command_batch runs several commands atomically as one undo step.
- Errors name the field and the fix; read them and retry.
- Tune a generator with mask.effect.update {layer, id, generator:{amount, softness, breakupStrength}}.
- history.undo / history.redo work in both modes.`;
