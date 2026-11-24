/**
 * "Rig my model": import a GLB, drag Mixamo-style markers onto the joints, preview our clips on it,
 * export the rigged GLB. All the real work is in src/rigger; this is just the screen.
 */
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { autoMarkers, MARKER_IDS, MARKER_LABELS, MarkerId, Markers, moveMirrored } from '../rigger/markers';
import { loadModel, Model } from '../rigger/model';
import { rigModel, RigResult } from '../rigger/rig';

export interface RigHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  canvas: HTMLCanvasElement;
  /** replace what's on stage with this rigged GLB; resolves to its clip names */
  show: (glb: Uint8Array) => Promise<string[]>;
  play: (clip: string) => void;
  toast: (msg: string) => void;
  download: (blob: Blob, name: string) => void;
  stats: (text: string) => void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function createRigMode(host: RigHost) {
  let bytes: Uint8Array | null = null;
  let fileName = 'model';
  let model: Model | null = null;
  let markers: Markers | null = null;
  let result: RigResult | null = null;
  let dirty = true;
  let clip = 'RestPose';
  let active = false;

  // ── marker balls
  const group = new THREE.Group();
  group.visible = false;
  host.scene.add(group);
  const balls = new Map<MarkerId, THREE.Mesh>();
  const colour = (id: MarkerId) => (id.endsWith('.L') ? 0xff5c8a : id.endsWith('.R') ? 0x5cd6ff : 0xffe14a);
  for (const id of MARKER_IDS) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: colour(id), depthTest: false, transparent: true, opacity: 0.92 }));
    m.renderOrder = 20;
    m.userData.id = id;
    balls.set(id, m);
    group.add(m);
  }
  // bones drawn between markers, so you can see the skeleton you're shaping
  const lineGeo = new THREE.BufferGeometry();
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.55 }));
  lines.renderOrder = 19;
  group.add(lines);
  const LINKS: [MarkerId, MarkerId][] = [
    ['groin', 'neck'], ['neck', 'chin'],
    ['neck', 'shoulder.L'], ['shoulder.L', 'elbow.L'], ['elbow.L', 'wrist.L'], ['groin', 'knee.L'], ['knee.L', 'ankle.L'], ['ankle.L', 'toes.L'],
    ['neck', 'shoulder.R'], ['shoulder.R', 'elbow.R'], ['elbow.R', 'wrist.R'], ['groin', 'knee.R'], ['knee.R', 'ankle.R'], ['ankle.R', 'toes.R'],
  ];

  const syncBalls = () => {
    if (!markers || !model) return;
    const r = model.height * 0.016;
    for (const [id, m] of balls) {
      m.position.set(...markers[id]);
      m.scale.setScalar(r);
    }
    const pts: number[] = [];
    for (const [a, b] of LINKS) pts.push(...markers[a], ...markers[b]);
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    lineGeo.computeBoundingSphere();
  };
  const showBalls = () => (group.visible = active && !!markers && clip === 'RestPose');

  // ── dragging
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let drag: { id: MarkerId; plane: THREE.Plane } | null = null;
  const pick = (e: PointerEvent) => {
    const r = host.canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, host.camera);
  };
  host.canvas.addEventListener('pointerdown', (e) => {
    if (!active || !group.visible) return;
    pick(e);
    const hit = ray.intersectObjects([...balls.values()], false)[0];
    if (!hit) return;
    const id = hit.object.userData.id as MarkerId;
    const n = host.camera.getWorldDirection(new THREE.Vector3()).negate();
    drag = { id, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, hit.object.position) };
    host.controls.enabled = false;
    host.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  host.canvas.addEventListener('pointermove', (e) => {
    if (!active || !group.visible) return;
    pick(e);
    if (!drag) {
      const hit = ray.intersectObjects([...balls.values()], false)[0];
      host.canvas.style.cursor = hit ? 'grab' : '';
      $('rig-hover').textContent = hit ? MARKER_LABELS[hit.object.userData.id as MarkerId] : ' ';
      return;
    }
    const p = ray.ray.intersectPlane(drag.plane, new THREE.Vector3());
    if (!p || !markers) return;
    const v: [number, number, number] = [p.x, Math.max(0, p.y), p.z];
    markers = $<HTMLInputElement>('rig-mirror').checked ? moveMirrored(markers, drag.id, v) : { ...markers, [drag.id]: v };
    dirty = true;
    syncBalls();
    $('rig-hover').textContent = MARKER_LABELS[drag.id];
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag) return;
    drag = null;
    host.controls.enabled = true;
    host.canvas.releasePointerCapture?.(e.pointerId);
  };
  host.canvas.addEventListener('pointerup', endDrag);
  host.canvas.addEventListener('pointercancel', endDrag);

  // ── pipeline
  const status = () => {
    if (!model) return host.stats('Rig my model · choose a .glb to start');
    const tris = model.triangles.length / 3;
    const w = result?.warnings.length ? ` · ⚠ ${result.warnings.join('; ')}` : '';
    host.stats(`${fileName} · ${tris.toLocaleString()} tris · ${model.height.toFixed(2)} m · ${result ? `${result.fitted.skeleton.bones.length} bones · ${result.clips.length} clips` : 'not rigged yet'}${dirty && result ? ' · markers moved: press ▶ or pick a clip to re-rig' : ''}${w}`);
  };

  const rig = async (playName = clip) => {
    if (!model || !markers) return;
    const t0 = performance.now();
    try {
      result = rigModel(model, markers, fileName);
    } catch (err) {
      host.toast(`Rigging failed: ${(err as Error).message}`);
      return;
    }
    dirty = false;
    const ms = performance.now() - t0;
    await host.show(result.glb);
    clip = playName;
    host.play(clip);
    showBalls();
    status();
    host.stats(`${(document.getElementById('stats')?.textContent ?? '')} · rigged in ${ms.toFixed(0)} ms`);
  };

  const load = async (data: Uint8Array, name: string, keepMarkers = false) => {
    bytes = data;
    fileName = name.replace(/\.glb$/i, '');
    const hIn = $<HTMLInputElement>('rig-height');
    const yaw = Number($<HTMLSelectElement>('rig-yaw').value);
    try {
      // first look: keep the file's own size unless it's clearly in other units (cm, mm)
      if (!keepMarkers) {
        const probe = loadModel(data, { yaw });
        hIn.value = (probe.sourceHeight > 0.3 && probe.sourceHeight < 3.5 ? probe.sourceHeight : 1.8).toFixed(2);
        $('rig-info').textContent = `${name}: ${probe.prims.length} mesh part${probe.prims.length > 1 ? 's' : ''}, ${(probe.triangles.length / 3).toLocaleString()} triangles, ${probe.sourceHeight.toFixed(3)} units tall in the file.`;
      }
      const prevH = model?.height;
      model = loadModel(data, { yaw, height: Number(hIn.value) || undefined });
      if (keepMarkers && markers && prevH) {
        const k = model.height / prevH;
        markers = Object.fromEntries(Object.entries(markers).map(([id, v]) => [id, v.map((x) => x * k)])) as Markers;
      } else markers = autoMarkers(model.positions, model.triangles);
    } catch (err) {
      host.toast(`Can't use that file: ${(err as Error).message}`);
      return;
    }
    syncBalls();
    const h = model.height;
    host.controls.target.set(0, h * 0.5, 0);
    host.camera.position.set(h * 0.35, h * 0.62, h * 2.5);
    await rig('RestPose');
  };

  // ── panel wiring
  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    await load(new Uint8Array(await f.arrayBuffer()), f.name);
  };
  $('rig-file').addEventListener('change', (e) => pickFile((e.target as HTMLInputElement).files?.[0]));
  const vp = $('viewport');
  vp.addEventListener('dragover', (e) => {
    if (!active) return;
    e.preventDefault();
    vp.classList.add('dropping');
  });
  vp.addEventListener('dragleave', () => vp.classList.remove('dropping'));
  vp.addEventListener('drop', (e) => {
    vp.classList.remove('dropping');
    if (!active) return;
    e.preventDefault();
    pickFile(e.dataTransfer?.files?.[0]);
  });
  $('rig-height').addEventListener('change', () => bytes && load(bytes, fileName, true));
  $('rig-yaw').addEventListener('change', () => bytes && load(bytes, fileName));
  $('rig-auto').addEventListener('click', () => {
    if (!model) return host.toast('Choose a .glb first');
    markers = autoMarkers(model.positions, model.triangles);
    dirty = true;
    syncBalls();
    rig('RestPose');
  });
  $('rig-go').addEventListener('click', () => {
    if (!model) return host.toast('Choose a .glb first');
    rig(clip === 'RestPose' ? 'Walk' : clip);
  });

  return {
    enter() {
      active = true;
      if (model && result) {
        host.show(result.glb).then(() => {
          host.play(clip);
          showBalls();
          status();
        });
      } else status();
    },
    leave() {
      active = false;
      group.visible = false;
      host.canvas.style.cursor = '';
    },
    /** the clip bar was clicked: re-rig first if the markers moved */
    beforePlay(name: string): boolean {
      if (!active) return false;
      if (dirty && model) {
        rig(name);
        return true;
      }
      clip = name;
      queueMicrotask(showBalls);
      return false;
    },
    export() {
      if (!model) return host.toast('Choose a .glb first');
      if (dirty || !result) result = rigModel(model, markers!, fileName);
      dirty = false;
      host.download(new Blob([result.glb as BlobPart], { type: 'model/gltf-binary' }), `${fileName}_rigged.glb`);
      host.toast(`Exported ${fileName}_rigged.glb (${(result.glb.length / 1024).toFixed(0)} KB)`);
    },
    /** for automated screenshots */
    debug: { load, get markers() { return markers; }, get model() { return model; } },
  };
}
