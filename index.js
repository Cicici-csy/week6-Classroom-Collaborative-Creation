/*
This example uses the OrbitControls addon by importing it separately from the main THREE codebase.

*/
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';


let scene, camera, renderer;
let mouse;
let chairModel = null;
let chairYOffset = 0;
let handModel = null;
let floorY = 0;
const desks = [];
const gltfLoader = new GLTFLoader();
let socket;
const pendingChairSeats = new Map(); // seatId → color, for seats claimed before chairModel loaded

const PALETTE = ['#e53935','#fb8c00','#fdd835','#43a047','#00acc1','#1e88e5','#8e24aa'];
let selectedColor = PALETTE[5]; // default blue

function initColorPicker() {
  const container = document.getElementById('swatches');
  PALETTE.forEach((hex, i) => {
    const btn = document.createElement('div');
    btn.className = 'swatch' + (i === 5 ? ' active' : '');
    btn.style.background = hex;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      selectedColor = hex;
    });
    container.appendChild(btn);
  });
}

function setHudSeat(seatId) {
  const el = document.getElementById('seat-val');
  if (el) el.textContent = seatId ? `#${String(seatId).padStart(2, '0')}` : '--';
}

function drawLabelCanvas(seatId, color = null) {
  const W = 64, H = 26;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  // background
  ctx.fillStyle = '#04040d';
  ctx.fillRect(0, 0, W, H);
  // left accent bar
  if (color) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 3, H);
  }
  // border
  ctx.strokeStyle = color || '#1a1a2e';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  // seat number
  ctx.fillStyle = color ? '#ffffff' : '#2e2e50';
  ctx.font = `bold 13px "Courier New"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`#${String(seatId).padStart(2, '0')}`, W / 2 + 1, H / 2);
  return canvas;
}

function updateSeatLabel(seatId, occupant, color = null) {
  const desk = desks.find(d => d.id === seatId);
  if (!desk) return;
  const canvas = drawLabelCanvas(seatId, occupant ? color : null);
  desk.label.material.map = new THREE.CanvasTexture(canvas);
  desk.label.material.map.needsUpdate = true;
}

function makeSeatLabel(seatId) {
  const canvas = drawLabelCanvas(seatId, null);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.55, 0.22, 1);
  return sprite;
}

function placeChairAtSeat(seatId, color = '#ffffff') {
  if (!chairModel) { pendingChairSeats.set(seatId, color); return; }
  const desk = desks.find(d => d.id === seatId);
  if (!desk) { pendingChairSeats.set(seatId, color); return; }
  if (desk.chair) { scene.remove(desk.chair); desk.chair = null; }
  const chair = chairModel.clone();
  chair.traverse(child => {
    if (child.isMesh) {
      child.material = child.material.clone();
      child.material.map = null;
      child.material.color.set(color);
    }
  });
  const p = desk.mesh.position;
  chair.position.set(p.x, floorY + chairYOffset, p.z + 0.6);
  scene.add(chair);
  desk.chair = chair;
}

function removeChairAtSeat(seatId) {
  pendingChairSeats.delete(seatId);
  const desk = desks.find(d => d.id === seatId);
  if (!desk || !desk.chair) return;
  scene.remove(desk.chair);
  desk.chair = null;
}

function init() {
  initColorPicker();

  // create a scene in which all other objects will exist
  scene = new THREE.Scene();

  // set environment
  new HDRLoader().load('cedar_bridge_sunset_1_1k.hdr', function (envMap) {
    console.log('hdr environment map loaded!');
    envMap.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = envMap;
    // scene.background = envMap;
  })

  // create a camera and position it in space
  let aspect = window.innerWidth / window.innerHeight;
  camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
  camera.position.set(0.67, 2.5, -5);
  camera.lookAt(0.67, 0.5, 2.5);

  // the renderer will actually show the camera view within our <canvas>
  renderer = new THREE.WebGLRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  // room dimensions
  const roomW = 15.0, roomH = 4.2, roomD = 17.0;
  const cx = 0.67, cy = 1.75, cz = -0.02;
  floorY = cy - roomH / 2;

  // procedural tile texture for floor
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = 256;
  tileCanvas.height = 256;
  const ctx = tileCanvas.getContext('2d');
  const grout = 6;
  ctx.fillStyle = '#9e9890';
  ctx.fillRect(0, 0, 256, 256);
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      ctx.fillStyle = '#d6cfc4';
      ctx.fillRect(tx * 128 + grout, ty * 128 + grout, 128 - grout * 2, 128 - grout * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(tx * 128 + grout, ty * 128 + grout, 128 - grout * 2, 20);
    }
  }
  const floorTex = new THREE.CanvasTexture(tileCanvas);
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(10, 11);

  // wall material
  const wallMat = new THREE.MeshStandardMaterial({ color: '#e8e0d5', roughness: 1.0, side: THREE.DoubleSide });

  // floor — used as raycast target
  let theground = new THREE.Mesh(
    new THREE.PlaneGeometry(roomW, roomD),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.8, side: THREE.DoubleSide })
  );
  theground.rotation.x = -Math.PI / 2;
  theground.position.set(cx, floorY, cz);
  scene.add(theground);

  // ceiling
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(roomW, roomD), wallMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(cx, cy + roomH / 2, cz);
  scene.add(ceil);

  // back wall
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(roomW, roomH), wallMat);
  backWall.position.set(cx, cy, cz - roomD / 2);
  scene.add(backWall);

  // front wall
  const frontWall = new THREE.Mesh(new THREE.PlaneGeometry(roomW, roomH), wallMat);
  frontWall.rotation.y = Math.PI;
  frontWall.position.set(cx, cy, cz + roomD / 2);
  scene.add(frontWall);

  // left wall
  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(roomD, roomH), wallMat);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(cx - roomW / 2, cy, cz);
  scene.add(leftWall);

  // right wall
  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(roomD, roomH), wallMat);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(cx + roomW / 2, cy, cz);
  scene.add(rightWall);

  // ambient + point light
  scene.add(new THREE.AmbientLight(0xc8d0e0, 0.5));
  const pointLight = new THREE.PointLight(0xfff5e0, 2.0, 20);
  pointLight.position.set(cx, cy + roomH / 2 - 0.3, cz);
  scene.add(pointLight);


  // add orbit controls
  let controls = new OrbitControls(camera, renderer.domElement);

  // load hand model as hover cursor
  gltfLoader.load('hand.glb', (gltf) => {
    handModel = gltf.scene;
    const box = new THREE.Box3().setFromObject(handModel);
    handModel.position.y -= box.min.y;
    scene.add(handModel);
  });

  // add a raycast on click
  mouse = new THREE.Vector2(0, 0);
  document.addEventListener(
    "mousemove",
    (ev) => {
      // three.js expects 'normalized device coordinates' (i.e. between -1 and 1 on both axes)
      mouse.x = (ev.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(ev.clientY / window.innerHeight) * 2 + 1;

      // use our raycaster to move the hoverMesh to the point on the ground where the mouse is pointing
      raycaster.setFromCamera(mouse, camera);

      // run the intersections test against the ground plane
      let intersections = raycaster.intersectObject(theground);

      // if there is an intersection, place the hoverMesh there
      if (intersections[0] && handModel) {
        let pointInSpace = intersections[0].point;
        handModel.position.set(pointInSpace.x, pointInSpace.y + chairYOffset + 0.4, pointInSpace.z);

        // trigger shake when hand is near a desk
        for (const d of desks) {
          const dx = handModel.position.x - d.mesh.position.x;
          const dz = handModel.position.z - d.mesh.position.z;
          if (Math.sqrt(dx * dx + dz * dz) < 1.2 && d.shakeTime < 0) {
            d.shakeTime = 0;
          }
        }
      }
    },
    false
  );

  let raycaster = new THREE.Raycaster();

  // load classroom environment
  gltfLoader.load('classroomenvironment.glb', (gltf) => {
    gltf.scene.traverse((child) => {
      if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
    });
    scene.add(gltf.scene);
  });

  // load chair model
  gltfLoader.load('chair.glb', (gltf) => {
    chairModel = gltf.scene;
    const box = new THREE.Box3().setFromObject(chairModel);
    chairYOffset = -box.min.y + 0.35;
    // place chairs for seats already occupied when we connected
    for (const [seatId, color] of pendingChairSeats) placeChairAtSeat(seatId, color);
    pendingChairSeats.clear();
  });

  // load desk model and arrange in classroom layout (4 columns x 4 rows)
  gltfLoader.load('desk.glb', (gltf) => {
    const template = gltf.scene;
    const box = new THREE.Box3().setFromObject(template);
    const yOffset = floorY + (-box.min.y) + 0.35;

    const cols = 4;
    const rows = 4;
    const spacingX = 2.4;
    const spacingZ = 2.8;
    const offsetX = cx - ((cols - 1) * spacingX) / 2;
    const offsetZ = cz - ((rows - 1) * spacingZ) / 2 + 2.5;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const seatId = row * cols + col + 1;
        const desk = template.clone();
        const x = offsetX + col * spacingX;
        const z = offsetZ + row * spacingZ;
        desk.position.set(x, yOffset, z);
        scene.add(desk);

        const label = makeSeatLabel(seatId);
        label.position.set(x, yOffset + 1.4, z);
        scene.add(label);

        desks.push({ mesh: desk, shakeTime: -1, id: seatId, label, chair: null });
      }
    }
    // flush any chairs that arrived via seatState before desks finished loading
    if (chairModel) {
      for (const [seatId, color] of pendingChairSeats) placeChairAtSeat(seatId, color);
      pendingChairSeats.clear();
    }
  });

  // click a desk → claim that seat
  document.addEventListener("pointerdown", () => {
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(desks.map(d => d.mesh), true);
    if (!hits.length) return;
    // walk up the hit object's parent chain to find the matching desk
    let obj = hits[0].object;
    while (obj) {
      const found = desks.find(d => d.mesh === obj);
      if (found) {
        socket.emit("claimSeat", { seatId: found.id, color: selectedColor });
        return;
      }
      obj = obj.parent;
    }
  });

  // press P to log current camera position & lookAt for copy-pasting
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'p') return;
    const p = camera.position;
    const t = controls.target;
    console.log(`camera.position.set(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
    console.log(`camera.lookAt(${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)})`);
  });

  // socket.io connection
  socket = io();

  socket.on('connect', () => {
    console.log('connected, my id:', socket.id);
  });

  // full snapshot when we first join
  socket.on('seatState', (seats) => {
    for (const [id, data] of Object.entries(seats)) {
      const seatId = Number(id);
      if (data) {
        updateSeatLabel(seatId, data.occupant, data.color);
        placeChairAtSeat(seatId, data.color);
      } else {
        updateSeatLabel(seatId, null);
      }
    }
  });

  let myCurrentSeat = null;

  // someone (including us) successfully claimed a seat
  socket.on('seatClaimed', ({ seatId, occupant, color }) => {
    updateSeatLabel(seatId, occupant, color);
    placeChairAtSeat(seatId, color);
    if (occupant === socket.id) { myCurrentSeat = seatId; setHudSeat(seatId); }
  });

  // seat was freed (disconnect or claimed another)
  socket.on('seatReleased', ({ seatId }) => {
    updateSeatLabel(seatId, null);
    removeChairAtSeat(seatId);
    if (seatId === myCurrentSeat) { myCurrentSeat = null; setHudSeat(null); }
  });

  // our claim was rejected — shake the desk as feedback
  socket.on('seatDenied', ({ seatId }) => {
    const desk = desks.find(d => d.id === seatId);
    if (desk) desk.shakeTime = 0;
  });

  socket.on('disconnect', () => {
    console.log('disconnected');
  });

  loop();
}

function loop() {
  // animate desk shaking
  for (const d of desks) {
    if (d.shakeTime >= 0) {
      d.shakeTime += 0.12;
      d.mesh.rotation.z = Math.sin(d.shakeTime * 18) * 0.06 * Math.max(0, 1 - d.shakeTime / Math.PI);
      if (d.shakeTime > Math.PI) {
        d.shakeTime = -1;
        d.mesh.rotation.z = 0;
      }
    }
  }

  renderer.render(scene, camera);

  window.requestAnimationFrame(loop); // pass the name of your loop function into this function
}

init();
