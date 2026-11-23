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
import { exportGlb } from '../export/gltf';
import { PRESETS } from '../core/presets';
import { RaceId, RACES, SHAPE_SLIDERS } from '../core/races';
import { PATTERNS, PatternId } from '../core/patterns';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ───────────────────────────────────────────────────────────── state ──
let recipe: CharacterRecipe = loadFromHash() ?? PRESETS[0].recipe();
let character: Character;
let clipName = 'Idle';
const toggles = { skeleton: false, wire: false, sockets: false, turn: true };
let lineup = false;

/** the viewer always shows hand props so you can judge the animations; export follows the recipe */
const preview = (rc: CharacterRecipe): CharacterRecipe => ({ ...rc, mesh: { ...rc.mesh, exportProps: true } });

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
async function makeActor(ch: Character): Promise<Actor> {
  const gltf = await loadGlb(exportGlb(ch));
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

function playClip(name: string) {
  clipName = name;
  for (const a of actors) {
    a.mixer.stopAllAction();
    const c = a.clips.find((x) => x.name === name) ?? a.clips[0];
    if (!c) continue;
    const act = a.mixer.clipAction(c);
    act.reset().play();
  }
  document.querySelectorAll<HTMLButtonElement>('#clips button').forEach((b) => b.classList.toggle('on', b.dataset.clip === name));
}

function clearStage() {
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
  playClip(clipName);
  applyToggles();
  renderMorphs();
  renderFacePreview();
  const s = character.stats;
  $('stats').textContent = `${recipe.name} · ${s.triangles.toLocaleString()} tris (${Math.round((1 - s.triangles / s.unoptimized) * 100)}% hidden/redundant removed) · ${s.bones} bones · ${character.clips.length} clips · ${character.morphs.length} morphs · ${recipe.body.height.toFixed(2)} m · built in ${genMs.toFixed(0)} ms`;
  if (frame) frameCamera();
  history.replaceState(null, '', `#${encodeRecipe(recipe)}`);
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
  playClip(clip);
  actors.forEach((a, i) => (a.mixer.time = i * 0.29));
  applyToggles();
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
    rebuild(frame);
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
  for (const c of ['Idle', 'Walk', 'Run', 'Jump', 'Wave', 'Punch', 'Crouch', 'CrouchWalk', 'ClimbUp', 'ClimbDown', 'ClimbLeft', 'ClimbRight', 'LadderUp', 'LadderDown', 'Swim', 'Craft', 'BowShoot', 'CrossbowShoot', 'RifleAim', 'RifleReady', 'RestPose']) {
    const b = document.createElement('button');
    b.textContent = c === 'RestPose' ? 'Rest' : c.replace(/([a-z])([A-Z])/g, '$1 $2');
    b.dataset.clip = c;
    b.addEventListener('click', () => playClip(c));
    clips.appendChild(b);
  }
  document.querySelectorAll<HTMLButtonElement>('#toggles button').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.t as keyof typeof toggles;
      toggles[k] = !toggles[k];
      applyToggles();
    }),
  );

  // top bar
  const surprise = () => {
    const styles = Object.keys(STYLES) as StyleId[];
    const themes = Object.keys(THEMES).filter((t) => t !== 'base');
    const s = Math.floor(Math.random() * 1e6);
    const races = Object.keys(RACES) as RaceId[];
    recipe = randomRecipe(s, styles[s % styles.length], themes[(s >> 3) % themes.length], (s >> 6) % 3 === 0 ? races[(s >> 8) % races.length] : 'human');
    syncAll();
    rebuild(true);
  };
  $('btn-random').addEventListener('click', surprise);
  $('btn-lineup').addEventListener('click', buildLineup);
  $('btn-save').addEventListener('click', () => download(new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' }), `${slug(recipe.name)}.badchar.json`));
  $('file-load').addEventListener('change', async (ev) => {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      recipe = JSON.parse(await f.text());
      syncAll();
      rebuild(true);
      toast(`Loaded ${recipe.name}`);
    } catch {
      toast('That file is not a recipe 🤔');
    }
  });
  $('btn-export').addEventListener('click', () => {
    // export from the real recipe: props only if 'Export props' is ticked
    const glb = exportGlb(generateCharacter(recipe));
    download(new Blob([glb as BlobPart], { type: 'model/gltf-binary' }), `${slug(recipe.name)}.glb`);
    toast(`Exported ${slug(recipe.name)}.glb (${(glb.length / 1024).toFixed(0)} KB)`);
  });
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
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

buildUI();
syncAll();
resize();
rebuild(true);
loop();
// for automated screenshots / debugging
Object.assign(window, { __bc: { get recipe() { return recipe; }, set: (r: CharacterRecipe) => { recipe = r; syncAll(); return rebuild(true); }, playClip, buildLineup, showRow, toggles, applyToggles, stage, camera, controls } });
