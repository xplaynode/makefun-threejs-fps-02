// world.js -- turns map.js data into the three.js scene.
// It also owns all visual effects: bot bodies, the first-person viewmodel,
// tracer lines, muzzle flash, impact puffs, smoke clouds and explosions.
// Simulation code asks this module to display things and otherwise never
// touches three.js objects beyond its own actor meshes.

import * as THREE from 'three';
import { MAP } from './map.js';
import { PALETTE } from './palette.js';
import { state } from './state.js';

export let scene, camera, renderer;
let directionalSun, flashLight, blastLight;

const materialCache = new Map();
export function material(color, opts = {}) {
  const cacheKey = color + '|' + (opts.flat ? 1 : 0) + '|' + (opts.emissive || 0);
  if (!materialCache.has(cacheKey)) {
    const created = new THREE.MeshLambertMaterial({
      color: color,
      emissive: opts.emissive || 0x000000,
      emissiveIntensity: opts.emissive ? 1 : 0,
    });
    materialCache.set(cacheKey, created);
  }
  return materialCache.get(cacheKey);
}

const STYLE_BY_KIND = {
  wall: { color: PALETTE.concrete, top: PALETTE.concreteDark },
  hall: { color: PALETTE.iron, top: PALETTE.ironDark },
  crate: { color: PALETTE.crateWood, top: PALETTE.crateWood },
  stack: { color: PALETTE.crateWood, top: PALETTE.iron },
  low: { color: PALETTE.concreteDark, top: PALETTE.concrete },
  container: { color: PALETTE.teal, top: PALETTE.teal },
  furnace: { color: PALETTE.slag, top: PALETTE.ember },
  machine: { color: PALETTE.barrel, top: PALETTE.slag },
  barrel: { color: PALETTE.barrel, top: PALETTE.slag },
};

export function initWorld() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 68, 155);

  camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.08, 240);
  camera.rotation.order = 'YXZ';

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('game').appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xbdd0e0, 0x3a3128, 1.05);
  scene.add(hemi);
  directionalSun = new THREE.DirectionalLight(0xffd9a8, 1.9);
  directionalSun.position.set(-40, 55, -25);
  directionalSun.castShadow = true;
  directionalSun.shadow.mapSize.set(2048, 2048);
  directionalSun.shadow.camera.left = -70;
  directionalSun.shadow.camera.right = 70;
  directionalSun.shadow.camera.top = 55;
  directionalSun.shadow.camera.bottom = -55;
  directionalSun.shadow.camera.far = 160;
  directionalSun.shadow.bias = -0.0006;
  scene.add(directionalSun);

  flashLight = new THREE.PointLight(0xffb056, 0, 9, 2);
  scene.add(flashLight);
  blastLight = new THREE.PointLight(0xff6a2a, 0, 26, 1.6);
  scene.add(blastLight);

  buildGroundAndSky();
  buildMapGeometry();
  buildSiteMarkers();
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

function buildGroundAndSky() {
  const groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 110),
    material(PALETTE.ground),
  );
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
  // Ground paint, flat against the floor: site aprons and lane dashes.
  const paintMat = material(PALETTE.ochre);
  for (const siteBox of [MAP.sites.A, MAP.sites.B]) {
    const apronMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(siteBox.maxX - siteBox.minX, siteBox.maxZ - siteBox.minZ),
      material(PALETTE.groundDark),
    );
    apronMesh.rotation.x = -Math.PI / 2;
    apronMesh.position.set(siteBox.cx, 0.01, siteBox.cz);
    apronMesh.receiveShadow = true;
    scene.add(apronMesh);
    const edgeMesh = new THREE.Mesh(new THREE.PlaneGeometry(siteBox.maxX - siteBox.minX, 0.35), paintMat);
    edgeMesh.rotation.x = -Math.PI / 2;
    edgeMesh.position.set(siteBox.cx, 0.02, siteBox.minZ + 0.4);
    scene.add(edgeMesh);
  }
  // Background silhouettes past the east wall: harbour crane legs and
  // crossbeam, plus a strip of water.
  const craneGroup = new THREE.Group();
  const silhouetteMat = material(PALETTE.slag);
  const legPositions = [[70, -20], [70, 14], [86, -20], [86, 14]];
  for (const legPos of legPositions) {
    const legMesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 26, 1.6), silhouetteMat);
    legMesh.position.set(legPos[0], 13, legPos[1]);
    craneGroup.add(legMesh);
  }
  const beamMesh = new THREE.Mesh(new THREE.BoxGeometry(22, 1.8, 2), silhouetteMat);
  beamMesh.position.set(78, 26, -3);
  craneGroup.add(beamMesh);
  scene.add(craneGroup);
  const waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(90, 60), material(PALETTE.teal));
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.position.set(105, -0.05, 0);
  scene.add(waterMesh);
}

function buildMapGeometry() {
  for (const col of MAP.colliders) {
    const styleEntry = STYLE_BY_KIND[col.kind] || STYLE_BY_KIND.wall;
    let blockMesh;
    if (col.kind === 'furnace') {
      blockMesh = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.7, col.h, 14), material(styleEntry.color));
      const capMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.8, 1.6, 10), material(PALETTE.slag));
      capMesh.position.y = col.h / 2 + 0.8;
      blockMesh.add(capMesh);
      const glowMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(2.45, 2.45, 0.5, 14),
        material(PALETTE.ember, { emissive: PALETTE.ember }),
      );
      glowMesh.position.y = -col.h / 2 + 0.7;
      blockMesh.add(glowMesh);
    } else if (col.kind === 'barrel') {
      blockMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, col.h, 10), material(styleEntry.color));
    } else {
      blockMesh = new THREE.Mesh(new THREE.BoxGeometry(col.w, col.h, col.d), material(styleEntry.color));
      const topMesh = new THREE.Mesh(new THREE.BoxGeometry(col.w + 0.06, 0.12, col.d + 0.06), material(styleEntry.top));
      topMesh.position.y = col.h / 2 + 0.02;
      blockMesh.add(topMesh);
      if (col.kind === 'container') {
        for (let ribIdx = -1; ribIdx <= 1; ribIdx++) {
          const ribMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, col.h * 0.92, col.d + 0.08), material(PALETTE.slag));
          ribMesh.position.x = ribIdx * (col.w / 3);
          blockMesh.add(ribMesh);
        }
      }
    }
    blockMesh.position.set(col.cx, col.h / 2, col.cz);
    blockMesh.castShadow = true;
    blockMesh.receiveShadow = true;
    scene.add(blockMesh);
  }
}

function buildSiteMarkers() {
  // Site signage assembled from plain boxes -- the yard's own lettering,
  // with no textures involved.
  for (const sitePair of Object.entries(MAP.sites)) {
    const siteBox = sitePair[1];
    const signMesh = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.6, 0.25), material(PALETTE.ochre));
    signMesh.position.set(21, 4.4, siteBox.cz);
    scene.add(signMesh);
    const postMesh = new THREE.Mesh(new THREE.BoxGeometry(0.25, 4.4, 0.25), material(PALETTE.slag));
    postMesh.position.set(21, 2.2, siteBox.cz - 1.6);
    scene.add(postMesh);
    const secondPost = postMesh.clone();
    secondPost.position.z = siteBox.cz + 1.6;
    scene.add(secondPost);
    void sitePair[0];
  }
}

// --- Actor bodies -----------------------------------------------------------
// A stylised yard operative: boots and legs, a team-coloured torso with a
// vest, and a head wearing a team-coloured hard hat. The parts are stored
// on the actor so combat can run hit tests (head / torso / legs at
// *2 / *1 / *0.55 damage).

export function buildActorMesh(actor) {
  const group = new THREE.Group();
  const teamMaterial = material(actor.team === 'breaker' ? PALETTE.breaker : PALETTE.warden);
  const darkMaterial = material(PALETTE.slag);
  const skinMaterial = material(0xc9a17a);

  const legsMesh = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.3), darkMaterial);
  legsMesh.position.y = 0.39;
  legsMesh.castShadow = true;
  const torsoMesh = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), teamMaterial);
  torsoMesh.position.y = 1.14;
  torsoMesh.castShadow = true;
  const vestMesh = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.44, 0.4), darkMaterial);
  vestMesh.position.y = 1.18;
  const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), skinMaterial);
  headMesh.position.y = 1.68;
  headMesh.castShadow = true;
  const hatMesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.4), teamMaterial);
  hatMesh.position.y = 1.88;
  const gunMesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.78), darkMaterial);
  gunMesh.position.set(0.22, 1.32, -0.42);

  const allParts = [legsMesh, torsoMesh, vestMesh, headMesh, hatMesh, gunMesh];
  for (const partMesh of allParts) group.add(partMesh);
  legsMesh.userData.part = 'legs';
  torsoMesh.userData.part = 'torso';
  vestMesh.userData.part = 'torso';
  headMesh.userData.part = 'head';
  hatMesh.userData.part = 'head';
  const taggedParts = [legsMesh, torsoMesh, vestMesh, headMesh, hatMesh];
  for (const partMesh of taggedParts) partMesh.userData.actor = actor;

  actor.mesh = group;
  actor.headMesh = headMesh;
  actor.torsoMesh = torsoMesh;
  actor.legsMesh = legsMesh;
  scene.add(group);
  return group;
}

export function poseActorMesh(actor) {
  const group = actor.mesh;
  if (!group) return;
  group.visible = actor.alive;
  group.position.set(actor.x, actor.y, actor.z);
  group.rotation.y = -actor.yaw + Math.PI;
  const desiredScaleY = actor.crouch ? 0.72 : 1;
  group.scale.y += (desiredScaleY - group.scale.y) * 0.35;
}

// --- First-person viewmodel ---------------------------------------------------

export function buildViewmodel() {
  const group = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.52), material(0x35383c));
  const barrelMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.34, 8), material(PALETTE.slag));
  barrelMesh.rotation.x = Math.PI / 2;
  barrelMesh.position.set(0, 0.035, -0.4);
  const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.17, 0.09), material(0x2a2c2f));
  magazine.position.set(0, -0.13, -0.05);
  magazine.rotation.x = 0.16;
  const sightMesh = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.03), material(PALETTE.slag));
  sightMesh.position.set(0, 0.1, -0.12);
  const gripMesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.06), material(0x2a2c2f));
  gripMesh.position.set(0, -0.11, 0.14);
  gripMesh.rotation.x = 0.35;
  const handMesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.16), material(0xc9a17a));
  handMesh.position.set(0, -0.06, -0.28);
  const viewParts = [receiver, barrelMesh, magazine, sightMesh, gripMesh, handMesh];
  for (const partMesh of viewParts) group.add(partMesh);
  group.position.set(0.24, -0.22, -0.45);
  camera.add(group);
  scene.add(camera);
  return { group: group, barrelTip: barrelMesh };
}

// --- Effects ------------------------------------------------------------------

const tracerReusePool = [];
export function spawnTracer(from, to, color = 0xffd9a0) {
  let tracerMesh = tracerReusePool.pop();
  if (!tracerMesh) {
    tracerMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.02, 1),
      new THREE.MeshBasicMaterial({ color: color }),
    );
    tracerMesh.material.transparent = true;
  }
  tracerMesh.material.color.setHex(color);
  tracerMesh.material.opacity = 0.9;
  tracerMesh.position.copy(from).lerp(to, 0.5);
  tracerMesh.lookAt(to);
  tracerMesh.scale.z = from.distanceTo(to);
  tracerMesh.visible = true;
  scene.add(tracerMesh);
  state.tracers.push({ mesh: tracerMesh, ttl: 0.055 });
}

const puffReusePool = [];
export function spawnPuff(pos, color = 0xbfae94, big = 1) {
  let puffMesh = puffReusePool.pop();
  if (!puffMesh) {
    puffMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 6, 5),
      new THREE.MeshBasicMaterial({ color: color, transparent: true }),
    );
  }
  puffMesh.material.color.setHex(color);
  puffMesh.material.opacity = 0.85;
  puffMesh.position.copy(pos);
  puffMesh.scale.setScalar(big);
  puffMesh.visible = true;
  scene.add(puffMesh);
  state.tracers.push({ mesh: puffMesh, ttl: 0.22, puff: true });
}

export function muzzleFlash(worldPos) {
  flashLight.position.copy(worldPos);
  flashLight.intensity = 26;
}

export function explosionFX(pos) {
  blastLight.position.copy(pos).y += 1;
  blastLight.intensity = 320;
  for (let burstIdx = 0; burstIdx < 10; burstIdx++) {
    const puffPos = pos.clone();
    puffPos.x += (Math.random() - 0.5) * 2.4;
    puffPos.z += (Math.random() - 0.5) * 2.4;
    puffPos.y += Math.random() * 1.4;
    spawnPuff(puffPos, burstIdx % 3 ? 0x55483a : PALETTE.ember, 2.6);
  }
}

export function spawnSmoke(pos) {
  const smokeMaterial = new THREE.MeshLambertMaterial({
    color: 0xb9bcbe, transparent: true, opacity: 0.5, depthWrite: false,
  });
  const smokeMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), smokeMaterial);
  smokeMesh.position.copy(pos).y = 1.3;
  smokeMesh.scale.set(0.4, 0.3, 0.4);
  scene.add(smokeMesh);
  state.smokes.push({ mesh: smokeMesh, x: pos.x, z: pos.z, r: 3.1, ttl: 15, grow: 0 });
}

export function spawnGrenadeMesh(kind) {
  let grenadeColor = 0x707880;
  if (kind === 'he') grenadeColor = 0x5a6136;
  else if (kind === 'flash') grenadeColor = 0xd8d3c3;
  const grenadeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 7), material(grenadeColor));
  scene.add(grenadeMesh);
  return grenadeMesh;
}

export function updateEffects(dt) {
  flashLight.intensity = Math.max(0, flashLight.intensity - dt * 320);
  blastLight.intensity = Math.max(0, blastLight.intensity - dt * 900);
  for (let idx = state.tracers.length - 1; idx >= 0; idx--) {
    const tracerEntry = state.tracers[idx];
    tracerEntry.ttl -= dt;
    if (tracerEntry.puff) {
      tracerEntry.mesh.scale.multiplyScalar(1 + dt * 5);
      tracerEntry.mesh.material.opacity = Math.max(0, tracerEntry.ttl / 0.22) * 0.85;
    } else {
      tracerEntry.mesh.material.opacity = Math.max(0, tracerEntry.ttl / 0.055) * 0.9;
    }
    if (tracerEntry.ttl <= 0) {
      tracerEntry.mesh.visible = false;
      scene.remove(tracerEntry.mesh);
      const pool = tracerEntry.puff ? puffReusePool : tracerReusePool;
      pool.push(tracerEntry.mesh);
      state.tracers.splice(idx, 1);
    }
  }
  for (let idx = state.smokes.length - 1; idx >= 0; idx--) {
    const cloud = state.smokes[idx];
    cloud.ttl -= dt;
    if (cloud.grow < 1) {
      cloud.grow = Math.min(1, cloud.grow + dt * 0.9);
      const growVal = cloud.grow;
      cloud.mesh.scale.set(0.4 + growVal * (cloud.r - 0.4), 0.3 + growVal * 1.5, 0.4 + growVal * (cloud.r - 0.4));
    }
    if (cloud.ttl < 2) cloud.mesh.material.opacity = 0.5 * (cloud.ttl / 2);
    if (cloud.ttl <= 0) {
      scene.remove(cloud.mesh);
      state.smokes.splice(idx, 1);
    }
  }
}

export function render() {
  renderer.render(scene, camera);
}
