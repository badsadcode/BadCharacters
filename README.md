# BadCharacters

**Procedural low-poly characters with knees, elbows and absolutely no hair (unless you ask nicely).**
*Bad Ideas Works: We Create Worlds. Badly. Now with people in them.*

BadCharacters generates game-ready humanoids: a skinned, rigged, animated GLB with a
Unity-Humanoid-compatible skeleton, a pixel-art face, layered clothing that bends with the body,
runtime fat/muscle morphs, and a seed-reproducible recipe.

- **App:** `npm install && npm run dev` (or the GitHub Pages deployment)
- **Devlog:** `devlog.html` on the site, a non-technical and mostly true story of how it was built
- **Rig / export contract:** [`docs/RIG.md`](docs/RIG.md)

## What you get

| | |
|---|---|
| Styles | Blocky (advanced voxel), Chibi, Stylized, Realistic, Heroic, Stocky |
| Body sliders | height, masculine↔feminine build, muscle, fat, head size, leg length, roundness, skin tone |
| Face | pixel-art texture: 6 eye styles, 6 mouths, optional brows/blush, modelled nose and ears |
| Outfits | 12 slots and 50+ garments: shirts, robes, coats, trousers, skirts, boots, gloves, plate armour, vests, hats, helmets, backpacks, a jetpack… |
| Themes | Base body, Explorer, Casual, Villager, Knight, Wizard, Soldier, Sci-fi, Worker, Athlete, Pirate, Zombie |
| Opt-in extras | voxel hair, beards, walking staff (the base brief is bald and clean-shaven) |
| Presets | Alden Wayfarer (Thornwake), Mannequin, Sir Clanksalot, Pip the Apprentice |
| Rig | 25 bones, Unity `HumanBodyBones` names, identity rest rotations, 6 sockets |
| Animations | Idle, Walk, Run, Jump, Wave, Punch (+ RestPose) |
| Export | GLB (validator-clean), editable `.badchar.json` recipe, share links |
| Budget | ~3k–9k triangles depending on outfit and detail level |

## How it works (short version)

Every body part is a **loft of rounded-box cross-sections** (superellipses). One exponent slides
the whole character from "Minecraft block" to "smooth pebble". Rings carry skin weights, and
weights are blended across joints, so an elbow is one continuous surface that bends instead of
two boxes kissing.

Clothing is the same rings again, **inflated by a layer thickness**. A sleeve is literally "arm
rings from the shoulder to the elbow, plus 8 mm", so it inherits the arm's skinning and can't
tear at the joint.

The viewer **renders the exported GLB**, not an in-memory approximation, so what you see is
what your engine gets.

## Commands

```bash
npm run dev                                       # the app
npm test                                          # 82 tests: every style × theme validates clean, feet on floor, normals outward, animation sanity
npm run cli -- export blocky explorer 42 out/     # one character → GLB + recipe
npm run cli -- samples out/samples                # a sample per style
```

## Status (honest version)

| Area | State |
|---|---|
| Generation, styles, themes, sliders, presets | ✅ working |
| GLB export (skin, morphs, texture, clips, sockets, recipe in extras) | ✅ Khronos validator: 0 errors, 0 warnings on all 72 style×theme combos |
| Animations | ✅ procedural, checked with forward-kinematics tests and by eye |
| Unity / Godot / Unreal import | ⚠️ not yet verified inside those editors (not available in the build environment) |
| Fingers | ❌ mitten hands + thumb by design (low-poly budget) |
| Facial animation | ❌ the face is a static texture for now (blinking would be a nice next step) |
