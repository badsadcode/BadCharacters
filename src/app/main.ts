import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { generateCharacter, type Character } from '../core/character';
import {
  BROW_STYLES, CharacterRecipe, EYE_STYLES, GARMENTS, MOUTH_STYLES, randomBody, randomFace, randomOutfit, randomRecipe,
  SKIN_TONES, SLOTS, StyleId, STYLES, THEMES,
} from '../core/recipe';
import { exportGlb, Exportable } from '../export/gltf';
import { generateCreature, CreatureRecipe } from '../creatures/generate';
import { randomCreature, SPECIES, SpeciesId } from '../creatures/species';
import { solitudeProfile } from '../creatures/solitude';
import { PRESETS } from '../core/presets';
import { RaceId, RACES, SHAPE_SLIDERS } from '../core/races';
import { PATTERNS, PatternId } from '../core/patterns';
import { createRigMode } from './rigmode';
import { CLIP_CATEGORIES, clipCategory } from '../core/categories';
import { FACTIONS, factionMember, factionSquad } from '../core/factions';
import { buildWeapon, WEAPON_ARCHETYPES, WEAPON_STYLES, WeaponArchetype } from '../weapons/badgun';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ───────────────────────────────────────────────────────────── state ──
let recipe: CharacterRecipe = ((h) => (h && (h as unknown as { kind?: string }).kind !== 'creature' ? h : null))(loadFromHash()) ?? PRESETS[0].recipe();
let character: Character;
let clipName = 'Idle';
const toggles = { skeleton: false, wire: false, sockets: false, turn: true };
let lineup = false;
let mode: 'characters' | 'creatures' | 'rig' = 'characters';
let creature: CreatureRecipe = randomCreature('megalodon', 1);

/** the viewer always shows hand props so you can judge the animations; export follows the recipe */
const preview = (rc: CharacterRecipe): CharacterRecipe => ({ ...rc, mesh: { ...rc.mesh, exportProps: true, clips: undefined, upperLayers: true }, ...(rc.weapon ? { weapon: { ...rc.weapon, embed: true } } : {}) });

// ───────────────────────────────────────────────────────────── scene ──
const canvas = $<HTMLCanvasElement>('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.53;
scene.add(new THREE.HemisphereLight(0xe8e4ff, 0x3a2f45, 0.9));
const sun = new THREE.DirectionalLight(0xfff0e0, 2.4);
sun.position.set(2.5, 5, 3.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
scene.add(sun);
const rim = new THREE.DirectionalLight(0x9d8cff, 1.1);
rim.position.set(-3, 2.5, -3);
scene.add(rim);

const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x241f33, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.002;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(30, 60, 0x3d3556, 0x2e2843);
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.6;
grid.position.y = -0.001;
scene.add(grid);

const stage = new THREE.Group();
scene.add(stage);
interface Actor {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  clips: THREE.AnimationClip[];
  meshes: THREE.SkinnedMesh[];
  helper: THREE.SkeletonHelper;
  sockets: THREE.Object3D[];
}
let actors: Actor[] = [];
const loader = new GLTFLoader();
const clock = new THREE.Clock();

function loadGlb(bytes: Uint8Array): Promise<GLTF> {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Promise((res, rej) => loader.parse(ab, '', res, rej));
}

/** The viewer shows the EXPORTED GLB, never an in-memory approximation of it. */
async function makeActor(ch: Exportable): Promise<Actor> {
  return makeActorFromBytes(exportGlb(ch));
}

async function makeActorFromBytes(glb: Uint8Array): Promise<Actor> {
  const gltf = await loadGlb(glb);
  const root = gltf.scene;
  const meshes: THREE.SkinnedMesh[] = [];
  const sockets: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
      const m = o as THREE.SkinnedMesh;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      meshes.push(m);
    }
    if (o.name.startsWith('Socket_')) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.025), new THREE.MeshBasicMaterial({ color: 0xffb35c, depthTest: false }));
      s.renderOrder = 10;
      o.add(s);
      sockets.push(s);
    }
  });
  const helper = new THREE.SkeletonHelper(root);
  (helper.material as THREE.LineBasicMaterial).depthTest = false;
  helper.renderOrder = 9;
  const mixer = new THREE.AnimationMixer(root);
  return { root, mixer, clips: gltf.animations, meshes, helper, sockets };
}

function applyToggles() {
  for (const a of actors) {
    a.helper.visible = toggles.skeleton;
    a.sockets.forEach((s) => (s.visible = toggles.sockets));
    for (const m of a.meshes) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mm) => ((mm as THREE.MeshStandardMaterial).wireframe = toggles.wire));
    }
  }
  document.querySelectorAll<HTMLButtonElement>('#toggles button').forEach((b) => b.classList.toggle('on', toggles[b.dataset.t as keyof typeof toggles]));
}

// ───────────────────────────────────────────────────────────── animation browser ──
/** category tabs + search + one row of clips; each clip has an export tick (characters mode) */
let clipNames: string[] = [];
let clipCat = (() => {
  try {
    return localStorage.getItem('bc.clipCat') ?? 'move';
  } catch {
    return 'move';
  }
})();
const label = (c: string) => (c === 'RestPose' ? 'Rest' : c.replace(/^Upper_/, '').replace(/([a-z])([A-Z])/g, '$1 $2'));
/** clips the export can contain: upper-body layers only when Export settings → Layers is on */
const exportable = () => clipNames.filter((n) => !n.startsWith('Upper_') || !!recipe.mesh.upperLayers);
/** names ticked for export (all when the recipe has no list) */
const exported = () => (mode === 'characters' ? new Set(recipe.mesh.clips ?? exportable()) : new Set(clipNames));
function setExported(set: Set<string>) {
  const names = exportable();
  recipe.mesh.clips = names.every((n) => set.has(n)) ? undefined : names.filter((n) => set.has(n));
  const total = names.length;
  const sel = recipe.mesh.clips;
  const cc = document.getElementById('clip-count');
  if (cc) cc.textContent = !sel ? `all ${total}` : `${sel.length} of ${total}`;
}
function renderClipBar(all: string[]) {
  // a held weapon's own clips (Weapon_Fire…) move only the gun: exported, not previewed here
  clipNames = all;
  const visible = all.filter((n) => !n.startsWith('Weapon_'));
  const cats = CLIP_CATEGORIES.filter((c) => c.id !== 'gun' && visible.some((n) => clipCategory(n) === c.id));
  if (!cats.some((c) => c.id === clipCat)) clipCat = cats[0]?.id ?? 'move';
  const exp = exported();
  const box = $('clips');
  box.classList.toggle('noexport', mode !== 'characters');
  $('layer-wrap').hidden = clipCat !== 'layers' && !clipName.startsWith('Upper_');
  box.hidden = !visible.length;
  const q = ($<HTMLInputElement>('clip-search').value ?? '').trim().toLowerCase();
  // tabs
  const tabs = $('clip-cats');
  tabs.innerHTML = '';
  for (const c of cats) {
    const names = visible.filter((n) => clipCategory(n) === c.id);
    const ticked = names.filter((n) => exp.has(n)).length;
    const b = document.createElement('button');
    b.className = c.id === clipCat && !q ? 'on' : '';
    b.innerHTML = `${c.icon} ${c.label}<small>${mode === 'characters' && ticked !== names.length ? `${ticked}/` : ''}${names.length}</small>`;
    b.addEventListener('click', () => {
      clipCat = c.id;
      try {
        localStorage.setItem('bc.clipCat', c.id);
      } catch {
        /* private mode */
      }
      $<HTMLInputElement>('clip-search').value = '';
      renderClipBar(clipNames);
    });
    tabs.appendChild(b);
  }
  // clips of the tab (or search hits across all of them)
  const shown = q ? visible.filter((n) => n.toLowerCase().includes(q) || label(n).toLowerCase().includes(q)) : visible.filter((n) => clipCategory(n) === clipCat);
  const list = $('clip-list2');
  list.innerHTML = '';
  for (const n of shown) {
    const el = document.createElement('div');
    el.className = `clip${n === clipName ? ' on' : ''}${exp.has(n) ? '' : ' off'}`;
    const layerOff = n.startsWith('Upper_') && !recipe.mesh.upperLayers;
    el.innerHTML = `<input type="checkbox" title="${layerOff ? 'turn on Export settings → Layers to export upper-body layers' : 'include in the export'}" ${exp.has(n) && !layerOff ? 'checked' : ''} ${layerOff ? 'disabled' : ''}><button data-clip="${n}" title="${n}">${label(n)}</button>`;
    el.querySelector('input')!.addEventListener('change', (e) => {
      const set = exported();
      if ((e.target as HTMLInputElement).checked) set.add(n);
      else set.delete(n);
      setExported(set);
      renderClipBar(clipNames);
    });
    el.querySelector('button')!.addEventListener('click', () => playClip(n));
    list.appendChild(el);
  }
  // export: this tab (or these search hits) all / none, plus the total
  const ex = $('clip-exp');
  const exNames = mode === 'characters' ? exportable() : clipNames;
  const ticked = exNames.filter((n) => exp.has(n)).length;
  ex.innerHTML = `export ${ticked === exNames.length ? 'all' : ticked}/${exNames.length} · <button data-x="all">☑ ${q ? 'these' : 'this tab'}</button><button data-x="none">☐ ${q ? 'these' : 'this tab'}</button><button data-x="reset">all clips</button>`;
  ex.querySelectorAll<HTMLButtonElement>('button').forEach((bt) =>
    bt.addEventListener('click', () => {
      const set = exported();
      if (bt.dataset.x === 'reset') exportable().forEach((n) => set.add(n));
      else for (const n of shown) bt.dataset.x === 'all' ? set.add(n) : set.delete(n);
      setExported(set);
      renderClipBar(clipNames);
    }),
  );
  // the export selection belongs to the character recipe: other modes only browse
  if (mode === 'characters') setExported(exported());
}

/** tracks an upper-body layer owns (the base clip's copies are dropped when previewing a layer) */
const UPPER_TRACK = /^(Spine|Chest|UpperChest|Neck|Head|(Left|Right)(Shoulder|UpperArm|LowerArm|Hand|ThumbProximal))\./;
const lowerHalves = new WeakMap<THREE.AnimationClip, THREE.AnimationClip>();
function playClip(name: string) {
  if (mode === 'rig' && rigMode.beforePlay(name)) return;
  clipName = name;
  for (const a of actors) {
    a.mixer.stopAllAction();
    const c = a.clips.find((x) => x.name === name) ?? a.clips[0];
    if (!c) continue;
    // an upper-body layer plays over the chosen base clip's legs, exactly like an engine blend tree
    if (name.startsWith('Upper_')) {
      const base = a.clips.find((x) => x.name === $<HTMLSelectElement>('layer-base').value) ?? a.clips.find((x) => x.name === 'Walk');
      if (base) {
        let lower = lowerHalves.get(base);
        if (!lower) {
          lower = new THREE.AnimationClip(`${base.name}_lower`, base.duration, base.tracks.filter((tr) => !UPPER_TRACK.test(tr.name)));
          lowerHalves.set(base, lower);
        }
        a.mixer.clipAction(lower).reset().play();
      }
    }
    const act = a.mixer.clipAction(c);
    act.reset().play();
  }
  const cat = clipCategory(name);
  if (cat !== clipCat && cat !== 'gun' && !$<HTMLInputElement>('clip-search').value) {
    clipCat = cat;
    renderClipBar(clipNames);
  }
  document.querySelectorAll<HTMLElement>('#clip-list2 .clip').forEach((el) => el.classList.toggle('on', el.querySelector('button')?.dataset.clip === name));
}

function clearStage() {
  stage.position.set(0, 0, 0);
  for (const a of actors) {
    stage.remove(a.root);
    scene.remove(a.helper);
  }
  actors = [];
}

let building = 0;
async function rebuild(frame = false) {
  const ticket = ++building;
  const t0 = performance.now();
  character = generateCharacter(preview(recipe));
  const genMs = performance.now() - t0;
  const actor = await makeActor(character);
  if (ticket !== building) return;
  lineup = false;
  clearStage();
  actors = [actor];
  stage.add(actor.root);
  scene.add(actor.helper);
  renderClipBar(actor.clips.map((c) => c.name));
  playClip(clipName);
  applyToggles();
  renderMorphs();
  renderFacePreview();
  const s = character.stats;
  $('stats').textContent = `${recipe.name} · ${s.triangles.toLocaleString()} tris (${Math.round((1 - s.triangles / s.unoptimized) * 100)}% hidden/redundant removed) · ${s.bones} bones · ${character.clips.length} clips · ${character.morphs.length} morphs · ${recipe.body.height.toFixed(2)} m · built in ${genMs.toFixed(0)} ms`;
  if (frame) frameCamera();
  history.replaceState(null, '', `#${encodeRecipe(recipe)}`);
}

/** debug / screenshot helper: a row of creatures, spaced by their size */
async function showCreatures(recipes: CreatureRecipe[], clip = 'Swim', gap = 1, angle = 90, y = 0) {
  const ticket = ++building;
  const list: Actor[] = [];
  for (const rc of recipes) list.push(await makeActor(generateCreature(rc)));
  if (ticket !== building) return;
  lineup = true;
  clearStage();
  stage.rotation.y = 0;
  let x = 0;
  list.forEach((a, i) => {
    const L = recipes[i].length;
    a.root.position.set(x + L / 2, y, 0);
    a.root.rotation.y = (angle * Math.PI) / 180;
    x += L + gap;
    stage.add(a.root);
    scene.add(a.helper);
    actors.push(a);
  });
  stage.position.x = -x / 2;
  playClip(clip);
  applyToggles();
}

/** debug / screenshot helper: put a row of recipes on stage */
async function showRow(recipes: CharacterRecipe[], clip = 'Idle', spacing = 1.0, angle = 0) {
  const ticket = ++building;
  const list: Actor[] = [];
  for (const rc of recipes) list.push(await makeActor(generateCharacter(preview(rc))));
  if (ticket !== building) return;
  lineup = true;
  clearStage();
  stage.rotation.y = 0;
  list.forEach((a, i) => {
    a.root.position.x = (i - (list.length - 1) / 2) * spacing;
    a.root.rotation.y = (angle * Math.PI) / 180;
    stage.add(a.root);
    scene.add(a.helper);
    actors.push(a);
  });
  renderClipBar(list[0]?.clips.map((c) => c.name) ?? []);
  playClip(clip);
  actors.forEach((a, i) => (a.mixer.time = i * 0.29));
  applyToggles();
}

// ───────────────────────────────────────────────────────────── creatures ──
/** put the stage's contents on the floor (or float swimmers above it) and aim the camera */
function autoFrame(grounded: boolean) {
  for (const a of actors) a.mixer.update(0);
  const box = new THREE.Box3().setFromObject(stage);
  const size = box.getSize(new THREE.Vector3());
  if (!grounded) stage.position.y += -box.min.y + Math.max(size.y * 0.25, 0.3);
  const r = Math.max(size.x, size.y, size.z);
  const cy = (box.max.y - box.min.y) / 2 + (grounded ? 0 : -box.min.y + Math.max(size.y * 0.25, 0.3)) + box.min.y;
  controls.target.set(0, cy, 0);
  camera.position.set(r * 0.55, cy + r * 0.25, r * 1.35);
  camera.far = Math.max(200, r * 20);
  camera.updateProjectionMatrix();
}

async function rebuildCreature(frame = false) {
  const ticket = ++building;
  const t0 = performance.now();
  const c = generateCreature(creature);
  const genMs = performance.now() - t0;
  const actor = await makeActor(c);
  if (ticket !== building) return;
  lineup = false;
  clearStage();
  actors = [actor];
  stage.add(actor.root);
  scene.add(actor.helper);
  renderClipBar(actor.clips.map((x) => x.name));
  if (!actor.clips.some((x) => x.name === clipName)) clipName = actor.clips[0]?.name ?? 'RestPose';
  playClip(clipName);
  applyToggles();
  $('morphs').style.display = 'none';
  const s = c.stats;
  $('stats').textContent = `${creature.name} · ${SPECIES[creature.species].label} · ${s.triangles.toLocaleString()} tris · ${s.bones} bones · ${c.clips.length} clips · ${creature.length} m · built in ${genMs.toFixed(0)} ms`;
  if (frame) autoFrame(c.build.grounded);
  history.replaceState(null, '', `#${encodeRecipe(creature as never)}`);
}

/** every species side by side, scaled to the same display size (the real sizes are in the files) */
async function buildBestiary() {
  const ticket = ++building;
  const ids = Object.keys(SPECIES) as SpeciesId[];
  const list: { a: Actor; L: number; grounded: boolean }[] = [];
  for (const id of ids) {
    const c = generateCreature(randomCreature(id, 1));
    list.push({ a: await makeActor(c), L: c.build.length, grounded: c.build.grounded });
  }
  if (ticket !== building) return;
  lineup = true;
  clearStage();
  const perRow = 5;
  list.forEach(({ a, L, grounded }, i) => {
    const k = 2.2 / L;
    a.root.scale.setScalar(k);
    a.root.position.set(((i % perRow) - (perRow - 1) / 2) * 3, grounded ? 0 : 1.1, -Math.floor(i / perRow) * 3.2);
    a.root.rotation.y = Math.PI / 2.6;
    stage.add(a.root);
    scene.add(a.helper);
    actors.push(a);
  });
  renderClipBar(['Swim', 'Idle', 'RestPose']);
  playClip('Swim');
  actors.forEach((a, i) => (a.mixer.time = i * 0.31));
  applyToggles();
  $('stats').textContent = `Bestiary: ${ids.length} species, shown at the same size. Real sizes range from ${Math.min(...ids.map((i) => SPECIES[i].length[0]))} m to ${Math.max(...ids.map((i) => SPECIES[i].length[1]))} m.`;
  controls.target.set(0, 0.9, -4.8);
  camera.position.set(0, 7, 9);
}

async function buildLineup() {
  const ticket = ++building;
  const styles = Object.keys(STYLES) as StyleId[];
  const themes = Object.keys(THEMES).filter((t) => t !== 'base');
  const seed0 = Math.floor(Math.random() * 1e6);
  const list: Actor[] = [];
  const N = 9;
  for (let i = 0; i < N; i++) {
    const races = Object.keys(RACES) as RaceId[];
    const rc = randomRecipe(seed0 + i, styles[i % styles.length], themes[(i * 7 + seed0) % themes.length], races[(i * 3 + seed0) % races.length]);
    list.push(await makeActor(generateCharacter(preview(rc))));
  }
  if (ticket !== building) return;
  lineup = true;
  clearStage();
  list.forEach((a, i) => {
    a.root.position.x = (i - (N - 1) / 2) * 1.0;
    a.root.position.z = Math.abs(i - (N - 1) / 2) * -0.25;
    stage.add(a.root);
    scene.add(a.helper);
    actors.push(a);
  });
  stage.rotation.y = 0;
  toggles.turn = false;
  renderClipBar(list[0].clips.map((c) => c.name));
  playClip(clipName === 'RestPose' ? 'Walk' : clipName);
  // desync so the crowd doesn't march like an army
  actors.forEach((a, i) => (a.mixer.time = i * 0.37));
  applyToggles();
  $('stats').textContent = `Lineup: ${N} characters, every style, random themes. Click 🎲 or Lineup again for more.`;
  camera.position.set(0, 2.2, 9.5);
  controls.target.set(0, 0.9, 0);
}

function frameCamera() {
  const h = recipe.body.height;
  controls.target.set(0, h * 0.52, 0);
  camera.position.set(h * 0.9, h * 0.75, h * 2.6);
}

// ───────────────────────────────────────────────────────────── UI ──
function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

let pending = false;
function changed(frame = false) {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    if (mode === 'creatures') rebuildCreature(frame);
    else if (mode === 'characters') rebuild(frame);
  });
}

function slider(parent: HTMLElement, label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt = (v: number) => v.toFixed(2)) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}"><output></output>`;
  const inp = row.querySelector('input')!;
  const out = row.querySelector('output')!;
  const sync = () => {
    inp.value = String(get());
    out.textContent = fmt(get());
  };
  inp.addEventListener('input', () => {
    set(Number(inp.value));
    out.textContent = fmt(Number(inp.value));
    changed();
  });
  parent.appendChild(row);
  return sync;
}

function select(parent: HTMLElement, label: string, opts: [string, string][], get: () => string, set: (v: string) => void, extra?: HTMLElement) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<label>${label}</label><select>${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
  const sel = row.querySelector('select')!;
  if (extra) row.appendChild(extra);
  sel.addEventListener('change', () => {
    set(sel.value);
    changed();
  });
  parent.appendChild(row);
  return () => (sel.value = get());
}

function colorInput(get: () => string, set: (v: string) => void) {
  const c = document.createElement('input');
  c.type = 'color';
  c.addEventListener('input', () => {
    set(c.value);
    changed();
  });
  return { el: c, sync: () => (c.value = get()) };
}

const syncers: (() => void)[] = [];
const creatureSyncers: (() => void)[] = [];
function syncCreature() {
  creatureSyncers.forEach((s) => s());
}
function setMode(m: 'characters' | 'creatures' | 'rig') {
  if (mode === 'rig' && m !== 'rig') rigMode.leave();
  mode = m;
  document.querySelectorAll<HTMLButtonElement>('#mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  $('left').hidden = m !== 'characters';
  $('left-creatures').hidden = m !== 'creatures';
  $('left-rig').hidden = m !== 'rig';
  $('btn-solitude').hidden = m !== 'creatures';
  for (const id of ['btn-random', 'btn-lineup', 'btn-save']) $(id).hidden = m === 'rig';
  ($('file-load').closest('label') ?? $('file-load')).hidden = m === 'rig';
  if (m === 'rig') {
    ++building;
    lineup = true; // no turntable while placing markers
    stage.rotation.y = 0;
    clearStage();
    renderClipBar([]);
    $('morphs').style.display = 'none';
    rigMode.enter();
  } else if (m === 'creatures') {
    syncCreature();
    rebuildCreature(true);
  } else {
    rebuild(true);
  }
}
function buildUI() {
  // presets
  const pc = $('presets');
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = p.label;
    b.title = p.blurb;
    b.addEventListener('click', () => {
      recipe = p.recipe();
      syncAll();
      rebuild(true);
      toast(p.blurb);
    });
    pc.appendChild(b);
  }
  pc.style.gridTemplateColumns = 'repeat(2, 1fr)';

  // styles
  const sc = $('styles');
  for (const [id, st] of Object.entries(STYLES)) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = st.label;
    b.dataset.style = id;
    b.addEventListener('click', () => {
      const keep = { ...recipe.body };
      recipe = { ...recipe, style: id as StyleId, body: { ...randomBody(recipe.seed, id as StyleId, recipe.theme, recipe.body.race ?? 'human'), shape: recipe.body.shape }, face: randomFace(recipe.seed, id as StyleId) };
      if (id === 'faceted') recipe.mesh = { ...recipe.mesh, detail: 'low', shading: 'flat' };
      recipe.body.skin = keep.skin;
      recipe.body.gender = keep.gender;
      syncAll();
      changed(true);
    });
    sc.appendChild(b);
  }
  syncers.push(() => {
    sc.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => b.classList.toggle('on', b.dataset.style === recipe.style));
    $('style-blurb').textContent = STYLES[recipe.style].blurb;
  });

  // races
  const rcEl = $('races');
  for (const [id, r] of Object.entries(RACES)) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = r.label;
    b.dataset.race = id;
    b.addEventListener('click', () => {
      const keep = { gender: recipe.body.gender, shape: recipe.body.shape };
      recipe = { ...recipe, body: { ...randomBody(recipe.seed, recipe.style, recipe.theme, id as RaceId), ...keep } };
      if (r.ears !== 'round') recipe.face.ears = true;
      syncAll();
      changed(true);
    });
    rcEl.appendChild(b);
  }
  syncers.push(() => {
    const race = recipe.body.race ?? 'human';
    rcEl.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => b.classList.toggle('on', b.dataset.race === race));
    $('race-blurb').textContent = RACES[race].blurb;
  });

  // fine proportion sliders
  const shp = $('shape-sliders');
  for (const [key, label] of SHAPE_SLIDERS) {
    syncers.push(
      slider(shp, label, -1, 1, 0.01, () => recipe.body.shape?.[key] ?? 0, (v) => (recipe.body.shape = { ...(recipe.body.shape ?? {}), [key]: v }), (v) => (v > 0 ? '+' : '') + v.toFixed(2)),
    );
  }
  $('btn-shape-reset').addEventListener('click', (e) => {
    e.preventDefault();
    recipe.body.shape = {};
    syncAll();
    changed();
  });

  // basics
  const nameIn = $<HTMLInputElement>('in-name');
  nameIn.addEventListener('change', () => {
    recipe.name = nameIn.value || recipe.name;
    changed();
  });
  const theme = $<HTMLSelectElement>('in-theme');
  theme.innerHTML = Object.entries(THEMES).map(([id, t]) => `<option value="${id}">${t.label} · ${t.genre}</option>`).join('');
  theme.addEventListener('change', () => {
    recipe.theme = theme.value;
    recipe.outfit = randomOutfit(recipe.seed, recipe.theme);
    if (THEMES[recipe.theme].skins || recipe.theme !== 'zombie') recipe.body.skin = randomBody(recipe.seed, recipe.style, recipe.theme).skin;
    syncAll();
    changed();
  });
  const seedIn = $<HTMLInputElement>('in-seed');
  const reseed = (s: number) => {
    recipe = randomRecipe(s, recipe.style, recipe.theme, recipe.body.race ?? 'human');
    syncAll();
    changed(true);
  };
  seedIn.addEventListener('change', () => reseed(Number(seedIn.value) || 1));
  $('btn-seed').addEventListener('click', () => reseed(Math.floor(Math.random() * 1e6)));
  syncers.push(() => {
    nameIn.value = recipe.name;
    theme.value = recipe.theme;
    seedIn.value = String(recipe.seed);
  });

  // body
  const bs = $('body-sliders');
  const B = recipe.body;
  void B;
  syncers.push(slider(bs, 'Height', 0.6, 2.4, 0.01, () => recipe.body.height, (v) => (recipe.body.height = v), (v) => `${v.toFixed(2)} m`));
  syncers.push(slider(bs, 'Build ♂…♀', 0, 1, 0.01, () => recipe.body.gender, (v) => (recipe.body.gender = v)));
  syncers.push(slider(bs, 'Muscle', 0, 1, 0.01, () => recipe.body.muscle, (v) => (recipe.body.muscle = v)));
  syncers.push(slider(bs, 'Fat', 0, 1, 0.01, () => recipe.body.fat, (v) => (recipe.body.fat = v)));
  syncers.push(slider(bs, 'Head size', 0.75, 1.35, 0.01, () => recipe.body.headScale, (v) => (recipe.body.headScale = v)));
  syncers.push(slider(bs, 'Leg length', -1, 1, 0.01, () => recipe.body.legLength, (v) => (recipe.body.legLength = v)));
  syncers.push(slider(bs, 'Roundness', 0, 1, 0.01, () => recipe.body.roundness, (v) => (recipe.body.roundness = v)));
  const sk = $('skins');
  const allSkins = [...SKIN_TONES, ...(THEMES.zombie.skins ?? []).slice(0, 2), '#7ab0d6', '#c98fd6'];
  for (const s of allSkins) {
    const sw = document.createElement('div');
    sw.className = 'swatch';
    sw.style.background = s;
    sw.dataset.c = s;
    sw.addEventListener('click', () => {
      recipe.body.skin = s;
      syncAll();
      changed();
    });
    sk.appendChild(sw);
  }
  syncers.push(() => sk.querySelectorAll<HTMLElement>('.swatch').forEach((w) => w.classList.toggle('on', w.dataset.c === recipe.body.skin)));

  // face
  const fc = $('face-controls');
  syncers.push(select(fc, 'Eyes', EYE_STYLES.map((e) => [e, e]), () => recipe.face.eyes, (v) => (recipe.face.eyes = v as never)));
  const iris = colorInput(() => recipe.face.iris, (v) => (recipe.face.iris = v));
  syncers.push(iris.sync);
  fc.lastElementChild!.appendChild(iris.el);
  syncers.push(select(fc, 'Mouth', MOUTH_STYLES.map((e) => [e, e]), () => recipe.face.mouth, (v) => (recipe.face.mouth = v as never)));
  const brow = colorInput(() => recipe.face.browColor, (v) => (recipe.face.browColor = v));
  syncers.push(brow.sync);
  syncers.push(select(fc, 'Brows', BROW_STYLES.map((e) => [e, e === 'none' ? 'none (bald brief)' : e]), () => recipe.face.brows, (v) => (recipe.face.brows = v as never), brow.el));
  for (const [key, label] of [['nose', 'Nose'], ['ears', 'Ears'], ['blush', 'Blush']] as const) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<label>${label}</label><input type="checkbox">`;
    const cb = row.querySelector('input')!;
    cb.addEventListener('change', () => {
      recipe.face[key] = cb.checked;
      changed();
    });
    fc.appendChild(row);
    syncers.push(() => (cb.checked = recipe.face[key]));
  }

  // outfit
  const oc = $('outfit');
  for (const slot of SLOTS) {
    const c1 = colorInput(() => recipe.outfit[slot].color, (v) => (recipe.outfit[slot].color = v));
    const c2 = colorInput(() => recipe.outfit[slot].color2, (v) => (recipe.outfit[slot].color2 = v));
    const wrap = document.createElement('div');
    wrap.className = 'colors';
    const pat = document.createElement('select');
    pat.className = 'pattern';
    pat.title = 'Fabric pattern (uses both colours)';
    pat.innerHTML = Object.entries(PATTERNS).map(([id, l]) => `<option value="${id}">${l}</option>`).join('');
    pat.addEventListener('change', () => {
      recipe.outfit[slot].pattern = pat.value as PatternId;
      changed();
    });
    wrap.append(c1.el, c2.el, pat);
    syncers.push(c1.sync, c2.sync, () => (pat.value = recipe.outfit[slot].pattern ?? 'solid'));
    syncers.push(
      select(oc, slot[0].toUpperCase() + slot.slice(1), Object.entries(GARMENTS[slot]).map(([id, g]) => [id, g.label]), () => recipe.outfit[slot].id, (v) => (recipe.outfit[slot].id = v), wrap),
    );
  }

  // export settings
  const pose = $<HTMLSelectElement>('in-pose');
  const detail = $<HTMLSelectElement>('in-detail');
  const shading = $<HTMLSelectElement>('in-shading');
  const morphs = $<HTMLInputElement>('in-morphs');
  // ── factions
  const fSel = $<HTMLSelectElement>('f-faction');
  const fRole = $<HTMLSelectElement>('f-role');
  fSel.innerHTML = `<option value="">None (free design)</option>${Object.entries(FACTIONS).map(([id, f]) => `<option value="${id}">${f.label}</option>`).join('')}`;
  const syncFaction = () => {
    const id = recipe.faction?.id ?? '';
    fSel.value = id;
    const f = FACTIONS[id];
    fRole.innerHTML = `<option value="any">Any (rolled)</option>${(f?.roles ?? []).map((r) => `<option value="${r.id}">${r.label}</option>`).join('')}`;
    fRole.disabled = !f;
    $<HTMLButtonElement>('f-member').disabled = !f;
    $<HTMLButtonElement>('f-squad').disabled = !f;
    if (f) {
      fRole.value = fRole.dataset.keep === '1' ? (recipe.faction?.role ?? 'any') : 'any';
      $('f-info').textContent = f.blurb;
    }
  };
  const newMember = (seed = Math.floor(Math.random() * 1e6)) => {
    const id = fSel.value;
    if (!id) return;
    recipe = factionMember(seed, id, recipe.style, recipe.body.race ?? 'human', fRole.value);
    fRole.dataset.keep = fRole.value === 'any' ? '' : '1';
    syncAll();
    if (recipe.weapon) clipName = recipe.weapon.archetype === 'pistol' ? 'PistolReady' : 'RifleReady';
    rebuild(true);
  };
  fSel.addEventListener('change', () => {
    fRole.dataset.keep = '';
    if (!fSel.value) {
      delete recipe.faction;
      syncFaction();
      return;
    }
    fRole.innerHTML = '<option value="any">Any</option>';
    fRole.value = 'any';
    newMember(recipe.seed);
  });
  fRole.addEventListener('change', () => newMember());
  $('f-member').addEventListener('click', () => newMember());
  $('f-squad').addEventListener('click', () => {
    if (!fSel.value) return;
    const squad = factionSquad(Math.floor(Math.random() * 1e6), fSel.value, recipe.style, 6, recipe.body.race ?? 'human');
    const armed = squad.some((m) => m.weapon);
    showRow(squad, armed ? 'RifleReady' : 'Idle', 1.0, 0);
  });
  syncers.push(syncFaction);

  // ── weapon (BadGun)
  const wArch = $<HTMLSelectElement>('w-arch');
  const wStyle = $<HTMLSelectElement>('w-style');
  const wSeed = $<HTMLInputElement>('w-seed');
  const wEmbed = $<HTMLInputElement>('w-embed');
  wArch.innerHTML = `<option value="">None</option>${WEAPON_ARCHETYPES.map((a) => `<option value="${a}">${a === 'smg' ? 'SMG' : a === 'lmg' ? 'LMG' : a[0].toUpperCase() + a.slice(1)}</option>`).join('')}`;
  wStyle.innerHTML = WEAPON_STYLES.map((st) => `<option value="${st}">${st === 'scifi' ? 'Sci-fi' : st === 'ww1' ? 'WW1' : st === 'ww2' ? 'WW2' : st[0].toUpperCase() + st.slice(1)}</option>`).join('');
  const weaponChanged = () => {
    if (!wArch.value) delete recipe.weapon;
    else recipe.weapon = { archetype: wArch.value as WeaponArchetype, style: wStyle.value, seed: Math.max(1, Number(wSeed.value) || 1), embed: wEmbed.checked };
    syncWeapon();
    if (recipe.weapon) clipName = recipe.weapon.archetype === 'pistol' ? 'PistolAim' : 'RifleAim';
    changed();
  };
  const syncWeapon = () => {
    const w = recipe.weapon;
    wArch.value = w?.archetype ?? '';
    wStyle.value = w?.style ?? 'modern';
    wSeed.value = String(w?.seed ?? 1);
    wEmbed.checked = !!w?.embed;
    for (const el of [wStyle, wSeed, wEmbed, $('w-btn-seed')]) (el as HTMLInputElement).disabled = !w;
    const info = $('w-info');
    if (w) {
      try {
        const b = buildWeapon(w);
        info.innerHTML = `<b>${b.name}</b> · <a href="${b.url}" target="_blank" rel="noopener">open in BadGun ↗</a><br>Clips: ${b.hold.kind === 'long' ? 'RifleAim, RifleReady, RifleReadyWalk' : 'PistolAim, PistolReady, PistolReadyWalk'} fitted to this weapon. Its own Fire / Reload clips export as <code>Weapon_*</code>.`;
      } catch (err) {
        info.textContent = `BadGun couldn't build that: ${(err as Error).message}`;
      }
    }
  };
  for (const el of [wArch, wStyle, wSeed, wEmbed]) el.addEventListener('change', weaponChanged);
  $('w-btn-seed').addEventListener('click', () => {
    wSeed.value = String(1 + Math.floor(Math.random() * 9999));
    weaponChanged();
  });
  syncers.push(syncWeapon);

  // animation search, and the base a layer plays over
  $('clip-search').addEventListener('input', () => renderClipBar(clipNames));
  $('layer-base').addEventListener('change', () => clipName.startsWith('Upper_') && playClip(clipName));
  const layersIn = $<HTMLInputElement>('in-layers');
  layersIn.addEventListener('change', () => {
    recipe.mesh.upperLayers = layersIn.checked;
    // newly exportable layers start ticked
    if (recipe.mesh.clips && layersIn.checked) recipe.mesh.clips = [...recipe.mesh.clips, ...clipNames.filter((n) => n.startsWith('Upper_'))];
    renderClipBar(clipNames);
  });
  syncers.push(() => (layersIn.checked = !!recipe.mesh.upperLayers));

  const propsIn = $<HTMLInputElement>('in-props');
  propsIn.addEventListener('change', () => (recipe.mesh.exportProps = propsIn.checked));
  pose.addEventListener('change', () => ((recipe.rig.restPose = pose.value as 'T' | 'A'), changed()));
  detail.addEventListener('change', () => ((recipe.mesh.detail = detail.value as never), changed()));
  shading.addEventListener('change', () => ((recipe.mesh.shading = shading.value as never), changed()));
  morphs.addEventListener('change', () => ((recipe.mesh.morphs = morphs.checked), changed()));
  syncers.push(() => {
    pose.value = recipe.rig.restPose;
    detail.value = recipe.mesh.detail;
    shading.value = recipe.mesh.shading;
    morphs.checked = recipe.mesh.morphs;
    propsIn.checked = !!recipe.mesh.exportProps;
  });

  // section re-rolls
  document.querySelectorAll<HTMLButtonElement>('[data-reroll]').forEach((b) =>
    b.addEventListener('click', () => {
      const s = Math.floor(Math.random() * 1e6);
      if (b.dataset.reroll === 'body') recipe.body = randomBody(s, recipe.style, recipe.theme, recipe.body.race ?? 'human');
      if (b.dataset.reroll === 'face') recipe.face = randomFace(s, recipe.style);
      if (b.dataset.reroll === 'outfit') recipe.outfit = randomOutfit(s, recipe.theme);
      syncAll();
      changed(b.dataset.reroll === 'body');
    }),
  );

  // viewport
  const clips = $('clips');
  void clips; // filled by renderClipBar() from whatever the loaded model exports
  document.querySelectorAll<HTMLButtonElement>('#toggles button').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.t as keyof typeof toggles;
      toggles[k] = !toggles[k];
      applyToggles();
    }),
  );

  // ── creature panel
  const csp = $('species');
  for (const [id, sp] of Object.entries(SPECIES)) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = sp.label;
    b.dataset.species = id;
    b.addEventListener('click', () => {
      creature = randomCreature(id as SpeciesId, creature.seed);
      syncCreature();
      rebuildCreature(true);
    });
    csp.appendChild(b);
  }
  const cs = $('c-sliders');
  const cSlider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt?: (v: number) => string) => {
    const sync = slider(cs, label, min, max, step, get, set, fmt);
    creatureSyncers.push(sync);
  };
  cSlider('Length', 0.3, 80, 0.1, () => creature.length, (v) => (creature.length = v), (v) => `${v.toFixed(1)} m`);
  cSlider('Mouth gape', 0, 2, 0.01, () => creature.mods.gape, (v) => (creature.mods.gape = v));
  cSlider('Teeth', 0, 2, 0.01, () => creature.mods.teeth, (v) => (creature.mods.teeth = v));
  cSlider('Fins / arms', 0.4, 1.8, 0.01, () => creature.mods.fins, (v) => (creature.mods.fins = v));
  cSlider('Glow spots', 0, 1, 0.01, () => creature.mods.glow, (v) => (creature.mods.glow = v));
  cSlider('Blotches', 0, 1, 0.01, () => creature.mods.blotch, (v) => (creature.mods.blotch = v));
  const scars = $<HTMLInputElement>('c-scars');
  scars.addEventListener('change', () => ((creature.mods.scars = scars.checked), changed()));
  const cc = $('c-colors');
  for (const [key, label] of [['base', 'Back'], ['belly', 'Belly'], ['accent', 'Blotches'], ['fin', 'Fins'], ['mouth', 'Mouth'], ['eye', 'Eyes'], ['glow', 'Glow']] as const) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<label>${label}</label>`;
    const ci = colorInput(() => creature.colors[key], (v) => (creature.colors[key] = v));
    row.appendChild(ci.el);
    cc.appendChild(row);
    creatureSyncers.push(ci.sync);
  }
  const cname = $<HTMLInputElement>('c-name');
  cname.addEventListener('change', () => ((creature.name = cname.value || creature.name), changed()));
  const cseed = $<HTMLInputElement>('c-seed');
  const creseed = (sd: number) => {
    const keep = creature.species;
    creature = { ...randomCreature(keep, sd), length: creature.length, colors: creature.colors };
    syncCreature();
    rebuildCreature();
  };
  cseed.addEventListener('change', () => creseed(Number(cseed.value) || 1));
  $('c-btn-seed').addEventListener('click', () => creseed(Math.floor(Math.random() * 1e6)));
  const cdetail = $<HTMLSelectElement>('c-detail');
  const cshading = $<HTMLSelectElement>('c-shading');
  cdetail.addEventListener('change', () => ((creature.mesh.detail = cdetail.value as never), changed()));
  cshading.addEventListener('change', () => ((creature.mesh.shading = cshading.value as never), changed()));
  creatureSyncers.push(() => {
    csp.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => b.classList.toggle('on', b.dataset.species === creature.species));
    $('species-blurb').textContent = SPECIES[creature.species].blurb;
    cname.value = creature.name;
    cseed.value = String(creature.seed);
    scars.checked = creature.mods.scars;
    cdetail.value = creature.mesh.detail;
    cshading.value = creature.mesh.shading;
  });

  // ── mode switch
  document.querySelectorAll<HTMLButtonElement>('#mode button').forEach((b) =>
    b.addEventListener('click', () => setMode(b.dataset.mode as typeof mode)),
  );
  $('btn-solitude').addEventListener('click', () => {
    const c = generateCreature(creature);
    const code = solitudeProfile(c, `${slug(creature.name)}.glb`);
    navigator.clipboard?.writeText(code).catch(() => undefined);
    download(new Blob([code], { type: 'text/plain' }), `${slug(creature.name)}.CreatureProfile.cs`);
    toast('Solitude profile copied + downloaded 🐚');
  });

  // top bar
  const surprise = () => {
    if (mode === 'creatures') {
      const ids = Object.keys(SPECIES) as SpeciesId[];
      const sd = Math.floor(Math.random() * 1e6);
      creature = randomCreature(ids[sd % ids.length], sd);
      syncCreature();
      rebuildCreature(true);
      return;
    }
    const styles = Object.keys(STYLES) as StyleId[];
    const themes = Object.keys(THEMES).filter((t) => t !== 'base');
    const s = Math.floor(Math.random() * 1e6);
    const races = Object.keys(RACES) as RaceId[];
    recipe = randomRecipe(s, styles[s % styles.length], themes[(s >> 3) % themes.length], (s >> 6) % 3 === 0 ? races[(s >> 8) % races.length] : 'human');
    syncAll();
    rebuild(true);
  };
  $('btn-random').addEventListener('click', surprise);
  $('btn-lineup').addEventListener('click', () => (mode === 'creatures' ? buildBestiary() : buildLineup()));
  $('btn-save').addEventListener('click', () =>
    mode === 'creatures'
      ? download(new Blob([JSON.stringify(creature, null, 2)], { type: 'application/json' }), `${slug(creature.name)}.badcreature.json`)
      : download(new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' }), `${slug(recipe.name)}.badchar.json`),
  );
  $('file-load').addEventListener('change', async (ev) => {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.kind === 'creature') {
        creature = data;
        setMode('creatures');
        toast(`Loaded ${creature.name}`);
      } else {
        recipe = data;
        setMode('characters');
        syncAll();
        rebuild(true);
        toast(`Loaded ${recipe.name}`);
      }
    } catch {
      toast('That file is not a recipe 🤔');
    }
  });
  $('btn-export').addEventListener('click', () => {
    if (mode === 'rig') return rigMode.export();
    if (mode === 'creatures') {
      const glb = exportGlb(generateCreature(creature));
      download(new Blob([glb as BlobPart], { type: 'model/gltf-binary' }), `${slug(creature.name)}.glb`);
      toast(`Exported ${slug(creature.name)}.glb (${(glb.length / 1024).toFixed(0)} KB)`);
      return;
    }
    // export from the real recipe: props only if 'Export props' is ticked
    const glb = exportGlb(generateCharacter(recipe));
    download(new Blob([glb as BlobPart], { type: 'model/gltf-binary' }), `${slug(recipe.name)}.glb`);
    toast(`Exported ${slug(recipe.name)}.glb (${(glb.length / 1024).toFixed(0)} KB)`);
  });
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || mode === 'rig') return;
    if (e.key === 'r') surprise();
    if (e.key === 'l') buildLineup();
  });
}

function syncAll() {
  syncers.forEach((s) => s());
}

function renderMorphs() {
  const box = $('morphs');
  box.innerHTML = '';
  const a = actors[0];
  const mesh = a?.meshes[0];
  if (!mesh?.morphTargetDictionary || !character.morphs.length) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'flex';
  box.innerHTML = '<h3>Runtime morphs (exported)</h3>';
  for (const [name, idx] of Object.entries(mesh.morphTargetDictionary)) {
    const l = document.createElement('label');
    l.innerHTML = `${name}<input type="range" min="0" max="1" step="0.01" value="0">`;
    l.querySelector('input')!.addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      a.meshes.forEach((m) => m.morphTargetInfluences && (m.morphTargetInfluences[idx] = v));
    });
    box.appendChild(l);
  }
}

function renderFacePreview() {
  const c = $<HTMLCanvasElement>('face-preview');
  const tex = character.texture;
  c.width = tex.width;
  c.height = tex.height;
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(tex.rgba), tex.width, tex.height), 0, 0);
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function encodeRecipe(r: CharacterRecipe) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(r))));
}
function loadFromHash(): CharacterRecipe | null {
  try {
    if (location.hash.length < 10) return null;
    return JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(1)))));
  } catch {
    return null;
  }
}

function resize() {
  const v = $('viewport');
  const w = v.clientWidth;
  const h = v.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  for (const a of actors) a.mixer.update(dt);
  if (toggles.turn && !lineup) stage.rotation.y += dt * 0.35;
  controls.update();
  renderer.render(scene, camera);
}

const rigMode = createRigMode({
  scene,
  camera,
  controls,
  canvas,
  show: async (glb) => {
    const a = await makeActorFromBytes(glb);
    clearStage();
    actors = [a];
    stage.add(a.root);
    scene.add(a.helper);
    renderClipBar(a.clips.map((c) => c.name));
    applyToggles();
    return a.clips.map((c) => c.name);
  },
  play: (c) => playClip(c),
  toast,
  download,
  stats: (t) => ($('stats').textContent = t),
});

buildUI();
syncAll();
resize();
{
  const h = loadFromHash() as unknown as { kind?: string } | null;
  if (h?.kind === 'creature') {
    creature = h as unknown as CreatureRecipe;
    setMode('creatures');
  } else rebuild(true);
}
loop();
// for automated screenshots / debugging
Object.assign(window, { __bc: { get recipe() { return recipe; }, get actors() { return actors; }, set: (r: CharacterRecipe) => { recipe = r; syncAll(); return rebuild(true); }, playClip, buildLineup, showRow, showCreatures, buildBestiary, setMode, toggles, applyToggles, stage, camera, controls, rigMode, THREE } });
