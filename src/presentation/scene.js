import * as pc from "playcanvas";
import { gsap } from "gsap";
import { assetUrl } from "./assets.js";
import {
  choreography,
  ballPosition,
  TARGET_X,
  GOAL_Z,
} from "./choreography.js";

const vec = (x, y, z) => new pc.Vec3(x, y, z);
const color = (hex) =>
  new pc.Color(...[16, 8, 0].map((s) => ((hex >> s) & 255) / 255));

export class ShootoutScene {
  constructor(canvas, { onProgress = () => {} } = {}) {
    this.canvas = canvas;
    this.onProgress = onProgress;
    this.phase = "attack";
    this.cameraMode = "follow";
    this.time = 0;
    this.motion = false;
    this.idle = true;
    this.timeline = null;
    this.cameraTween = null;
    this.cameraRig = { x: 0, y: 3.1, z: 10.8, tx: 0, ty: 1, tz: -7, fov: 48 };
    this.effects = [];
    this.showcase = false;
    this.shake = { amount: 0 };
    this.smoothedMeshes = new WeakSet();
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  async init(manifest) {
    this.app = new pc.Application(this.canvas, {
      graphicsDeviceOptions: {
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
      },
    });
    const a = this.app;
    a.graphicsDevice.maxPixelRatio = Math.min(devicePixelRatio, 1.75);
    a.setCanvasResolution(pc.RESOLUTION_AUTO);
    a.setCanvasFillMode(pc.FILLMODE_NONE, 300, 150);
    a.scene.ambientLight = color(0x4e5964);
    a.scene.exposure = 1.13;
    a.scene.fog.type = pc.FOG_LINEAR;
    a.scene.fog.color = color(0x101923);
    a.scene.fog.start = 48;
    a.scene.fog.end = 120;
    this.camera = new pc.Entity("Match camera");
    this.camera.addComponent("camera", {
      clearColor: color(0x090e17),
      toneMapping: pc.TONEMAP_ACES,
      fov: 48,
      nearClip: 0.08,
      farClip: 220,
    });
    a.root.addChild(this.camera);
    this.light(
      "Stadium key",
      "directional",
      0xf0f3f5,
      1.55,
      [-65, -25, 0],
      true,
    );
    this.light("Warm rim", "directional", 0xffddb2, 0.5, [-18, 155, 0], false);
    this.buildPitch();
    this.buildStadium();
    this.buildGoal();
    this.buildBall();
    const group = a.batcher.addGroup("Static stadium", false, 100);
    const staticNames = new Set([
      "Stand terrace",
      "Terrace step",
      "Concourse light",
      "Terrace rail",
      "LED perimeter",
      "LED sideline",
      "Floodlight tower",
      "Floodlight housing",
      "Floodlight bulb",
      "Roof truss",
      "Roof canopy",
    ]);
    for (const render of a.root.findComponents("render"))
      if (staticNames.has(render.entity.name)) render.batchGroupId = group.id;
    a.batcher.generate([group.id]);
    this.onProgress(0.4, "球场就绪");
    const model = await this.load(manifest.models.athlete, "container");
    const texture = await this.load(manifest.models.texture, "texture");
    const strikerTexture = manifest.models.strikerTexture
      ? await this.load(manifest.models.strikerTexture, "texture")
      : texture;
    texture.flipY = false;
    texture.upload();
    strikerTexture.flipY = false;
    strikerTexture.upload();
    this.keeper = this.buildAthlete(
      model,
      texture,
      "Goalkeeper",
      vec(0, 0, GOAL_Z + 0.35),
      0,
    );
    this.striker = this.buildAthlete(
      model,
      strikerTexture,
      "Penalty taker",
      vec(-0.9, 0, 1.65),
      180,
    );
    this.keeperPose = { dive: 0, extension: 0, crouch: 0.12 };
    this.strikerPose = { run: 0, kick: 0 };
    this.ballMotion = { t: 0 };
    this.keeperShadow = this.shadow(vec(0, 0.025, GOAL_Z + 0.35), 0.85);
    this.strikerShadow = this.shadow(vec(-0.9, 0.025, 1.65), 0.75);
    this.applyCamera();
    a.on("update", (dt) => this.update(dt));
    a.start();
    this.onProgress(1, "准备开球");
  }
  load(path, type) {
    return new Promise((resolve, reject) => {
      this.app.assets.loadFromUrl(assetUrl(path), type, (error, asset) =>
        error ? reject(error) : resolve(asset.resource),
      );
    });
  }
  material(
    hex,
    { emission = 0, opacity = 1, metalness = 0, roughness = 0.8 } = {},
  ) {
    const m = new pc.StandardMaterial();
    m.diffuse = color(hex);
    m.metalness = metalness;
    m.useMetalness = true;
    m.gloss = 1 - roughness;
    if (emission) {
      m.emissive = color(hex);
      m.emissiveIntensity = emission;
    }
    if (opacity < 1) {
      m.opacity = opacity;
      m.blendType = pc.BLEND_NORMAL;
      m.depthWrite = false;
    }
    m.update();
    return m;
  }
  mesh(name, type, position, scale, material, parent = this.app.root) {
    const e = new pc.Entity(name);
    e.addComponent("render", {
      type,
      material,
      castShadows: true,
      receiveShadows: true,
    });
    e.setLocalPosition(position);
    e.setLocalScale(scale);
    parent.addChild(e);
    return e;
  }
  light(name, type, hex, intensity, angles, shadows) {
    const e = new pc.Entity(name);
    e.addComponent("light", {
      type,
      color: color(hex),
      intensity,
      castShadows: shadows,
      shadowResolution: 2048,
      shadowType: pc.SHADOW_PCF5,
      shadowDistance: 32,
      shadowBias: 0.2,
      normalOffsetBias: 0.04,
    });
    e.setEulerAngles(...angles);
    this.app.root.addChild(e);
    return e;
  }
  texture(canvas) {
    const t = new pc.Texture(this.app.graphicsDevice, {
      mipmaps: true,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
      magFilter: pc.FILTER_LINEAR,
    });
    t.setSource(canvas);
    return t;
  }
  buildPitch() {
    const c = document.createElement("canvas");
    c.width = c.height = 1024;
    const ctx = c.getContext("2d");
    const data = ctx.createImageData(1024, 1024);
    let seed = 18731;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < data.data.length; i += 4) {
      const x = (i / 4) % 1024,
        y = Math.floor(i / 4096);
      const patch = Math.sin(x / 89) * Math.cos(y / 107) * 4;
      const n = random() * 17 + patch;
      data.data[i] = 25 + n;
      data.data[i + 1] = 58 + n * 1.3;
      data.data[i + 2] = 24 + n * 0.7;
      data.data[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    for (let i = 0; i < 100000; i++) {
      const x = random() * 1024,
        y = random() * 1024;
      const tint = 65 + Math.floor(random() * 40);
      ctx.strokeStyle = `rgba(${Math.floor(tint * 0.48)},${tint},${Math.floor(tint * 0.45)},.6)`;
      ctx.lineWidth = 0.6 + random() * 0.7;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + random() * 3 - 1.5, y - 2 - random() * 5);
      ctx.stroke();
    }
    const grass = this.material(0xffffff);
    grass.diffuseMap = this.texture(c);
    grass.diffuseMapTiling.set(35, 39);
    const normal = document.createElement("canvas");
    normal.width = normal.height = 512;
    const nctx = normal.getContext("2d");
    nctx.fillStyle = "#8080ff";
    nctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 25000; i++) {
      const x = random() * 512,
        y = random() * 512;
      nctx.strokeStyle = `rgb(${110 + Math.floor(random() * 35)},${100 + Math.floor(random() * 50)},246)`;
      nctx.beginPath();
      nctx.moveTo(x, y);
      nctx.lineTo(x + random() * 2, y - 3);
      nctx.stroke();
    }
    grass.normalMap = this.texture(normal);
    grass.normalMapTiling.set(35, 39);
    grass.bumpiness = 0.28;
    grass.update();
    this.mesh("Grass", "plane", vec(0, -0.035, 16), vec(76, 1, 84), grass);
    const stripe = this.material(0x85a46b, { opacity: 0.065 });
    for (let z = -22; z < 58; z += 10)
      this.mesh(
        "Mown stripe",
        "plane",
        vec(0, -0.031, z),
        vec(68, 1, 5),
        stripe,
      );
    const blades = [],
      normals = [],
      colors = [];
    for (let i = 0; i < 6000; i++) {
      const x = (random() - 0.5) * 24,
        z = -14 + random() * 24;
      const height = 0.012 + random() * 0.029,
        width = 0.003 + random() * 0.004;
      const angle = random() * Math.PI;
      const dx = Math.cos(angle) * width,
        dz = Math.sin(angle) * width;
      blades.push(
        x - dx,
        -0.028,
        z - dz,
        x + dx,
        -0.028,
        z + dz,
        x + dx * 0.7,
        height - 0.028,
        z + dz * 0.7,
      );
      const g = 0.23 + random() * 0.1;
      for (let k = 0; k < 3; k++) {
        normals.push(0, 0.95, 0.3);
        colors.push(g * 0.55, g, g * 0.48, 1);
      }
    }
    const bladeMesh = new pc.Mesh(this.app.graphicsDevice);
    bladeMesh.setPositions(blades);
    bladeMesh.setNormals(normals);
    bladeMesh.setColors(colors);
    bladeMesh.update();
    const bladeMat = this.material(0xffffff);
    bladeMat.diffuseVertexColor = true;
    bladeMat.cull = pc.CULLFACE_NONE;
    bladeMat.update();
    const detail = new pc.Entity("Turf blades");
    detail.addComponent("render", {
      meshInstances: [new pc.MeshInstance(bladeMesh, bladeMat)],
      castShadows: false,
      receiveShadows: true,
    });
    this.app.root.addChild(detail);
    this.white = this.material(0xdae9da);
    const line = (x, z, w, d) =>
      this.mesh(
        "Pitch marking",
        "box",
        vec(x, -0.018, z),
        vec(w, 0.008, d),
        this.white,
      );
    line(0, GOAL_Z, 68, 0.09);
    line(0, 5.5, 40.32, 0.08);
    line(-20.16, -2.75, 0.08, 16.5);
    line(20.16, -2.75, 0.08, 16.5);
    line(0, -5.5, 18.32, 0.08);
    line(-9.16, -8.25, 0.08, 5.5);
    line(9.16, -8.25, 0.08, 5.5);
    line(-34, 22, 0.1, 66);
    line(34, 22, 0.1, 66);
    this.mesh(
      "Penalty spot",
      "cylinder",
      vec(0, 0.003, 0),
      vec(0.17, 0.008, 0.17),
      this.white,
    );
    const disc = this.material(0xb9f36b, { opacity: 0.13, emission: 0.3 });
    this.spotRing = this.mesh(
      "Penalty halo",
      "cylinder",
      vec(0, -0.005, 0),
      vec(0.95, 0.008, 0.95),
      disc,
    );
    // The penalty arc sits outside the area, as on a football pitch.
    for (let i = 0; i < 42; i++) {
      const angle = ((50 + (i * 80) / 41) * Math.PI) / 180;
      const e = line(
        Math.cos(angle) * 9.15,
        Math.sin(angle) * 9.15 - 0.05,
        0.3,
        0.075,
      );
      e.setLocalEulerAngles(0, (-angle * 180) / Math.PI, 0);
    }
  }
  buildStadium() {
    const structure = this.material(0x182538),
      steps = this.material(0x32495e),
      rail = this.material(0x607488, { metalness: 0.5 });
    const led = this.material(0xe5b565, { emission: 0.55 });
    const warm = this.material(0xffd8a1, { emission: 2.7 });
    // Curved, tiered stands. Seats are one static mesh rather than thousands of draw calls.
    const positions = [],
      normals = [],
      indices = [],
      colors = [];
    let vertex = 0;
    const addSilhouette = (cx, cy, cz, tangent, points, hex) => {
      for (const [x, y] of points) {
        positions.push(cx + tangent[0] * x, cy + y, cz + tangent[1] * x);
        normals.push(tangent[1], 0.3, -tangent[0]);
        colors.push(...[16, 8, 0].map((s) => ((hex >> s) & 255) / 255), 1);
      }
      for (let k = 1; k < points.length - 1; k++)
        indices.push(vertex, vertex + k, vertex + k + 1);
      vertex += points.length;
    };
    for (let tier = 0; tier < 3; tier++) {
      for (let seg = 0; seg < 36; seg++) {
        const angle = (seg / 36) * Math.PI * 2;
        const rx = 44 + tier * 5,
          rz = 38 + tier * 5;
        const x = Math.sin(angle) * rx,
          z = Math.cos(angle) * rz + 6;
        const yaw = (angle * 180) / Math.PI;
        const base = this.mesh(
          "Stand terrace",
          "box",
          vec(x, 3 + tier * 5, z),
          vec(8.2, 1.1, 5.8),
          structure,
        );
        base.setEulerAngles(0, yaw, 0);
        for (let row = 0; row < 5; row++) {
          const rrx = rx + row * 0.6,
            rrz = rz + row * 0.6;
          const p = this.mesh(
            "Terrace step",
            "box",
            vec(
              Math.sin(angle) * rrx,
              3.5 + tier * 5 + row * 0.48,
              Math.cos(angle) * rrz + 6,
            ),
            vec(8.2, 0.2, 0.6),
            steps,
          );
          p.setEulerAngles(0, yaw, 0);
          for (let col = 0; col < 13; col++) {
            const variety =
              (seg * 9281 + row * 719 + col * 137 + tier * 577) >>> 0;
            const offset = (col - 6) * 0.56 + ((variety % 13) - 6) * 0.016;
            const cx = Math.sin(angle) * rrx + Math.cos(angle) * offset;
            const cz = Math.cos(angle) * rrz + 6 - Math.sin(angle) * offset;
            const palette = [
              0x18332f, 0x344555, 0x20313c, 0x56635d, 0x6b5b43, 0x25392f,
              0x433d48,
            ];
            const hex =
              palette[
                ((seg * 9281 + row * 719 + col * 137 + tier * 577) ^
                  (col * row * 31)) %
                  palette.length
              ];
            const cy =
              3.7 + tier * 5 + row * 0.48 + ((variety % 7) - 3) * 0.026;
            const width = 0.13 + (variety % 4) * 0.012;
            const height = 0.3 + (variety % 9) * 0.014;
            const tangent = [Math.cos(angle), -Math.sin(angle)];
            addSilhouette(
              cx,
              cy,
              cz,
              tangent,
              [
                [-width * 0.8, 0],
                [width * 0.8, 0],
                [width, height * 0.72],
                [width * 0.56, height],
                [-width * 0.56, height],
                [-width, height * 0.72],
              ],
              hex,
            );
            addSilhouette(
              cx,
              cy + height + 0.073,
              cz,
              tangent,
              Array.from({ length: 8 }, (_, i) => [
                Math.cos((i * Math.PI) / 4) * 0.072,
                Math.sin((i * Math.PI) / 4) * 0.083,
              ]),
              col % 3 === 0 ? 0x615348 : 0x897865,
            );
          }
        }
        const edge = this.mesh(
          "Concourse light",
          "box",
          vec(x, 3.6 + tier * 5, z - Math.cos(angle) * 2.8),
          vec(7.8, 0.055, 0.08),
          tier === 2 ? warm : led,
        );
        edge.setEulerAngles(0, yaw, 0);
        const r = this.mesh(
          "Terrace rail",
          "box",
          vec(x, 6.2 + tier * 5, z + Math.cos(angle) * 3.2),
          vec(8.2, 0.07, 0.06),
          rail,
        );
        r.setEulerAngles(0, yaw, 0);
      }
    }
    const crowdMesh = new pc.Mesh(this.app.graphicsDevice);
    crowdMesh.setPositions(positions);
    crowdMesh.setNormals(normals);
    crowdMesh.setColors(colors);
    crowdMesh.setIndices(indices);
    crowdMesh.update();
    const crowdMat = this.material(0xffffff);
    crowdMat.diffuseVertexColor = true;
    crowdMat.cull = pc.CULLFACE_NONE;
    crowdMat.update();
    const crowd = new pc.Entity("Stadium crowd");
    crowd.addComponent("render", {
      meshInstances: [new pc.MeshInstance(crowdMesh, crowdMat)],
      castShadows: false,
    });
    this.app.root.addChild(crowd);
    const truss = this.material(0x52606b, { metalness: 0.75, roughness: 0.45 });
    for (let seg = 0; seg < 36; seg++) {
      const angle = (seg / 36) * Math.PI * 2;
      const x = Math.sin(angle) * 49,
        z = Math.cos(angle) * 43 + 6;
      const canopy = this.mesh(
        "Roof canopy",
        "box",
        vec(x, 21.6, z),
        vec(8.7, 0.14, 7.8),
        structure,
      );
      canopy.setEulerAngles(0, (angle * 180) / Math.PI, -2);
      const a = vec(Math.sin(angle) * 45, 20.9, Math.cos(angle) * 39 + 6);
      const b = vec(Math.sin(angle) * 53, 22.4, Math.cos(angle) * 47 + 6);
      const beam = this.mesh(
        "Roof truss",
        "cylinder",
        a.clone().add(b).mulScalar(0.5),
        vec(0.085, a.distance(b), 0.085),
        truss,
      );
      beam.lookAt(b);
      beam.rotateLocal(90, 0, 0);
    }
    const ads = this.adTexture();
    const adMat = this.material(0xffffff, { emission: 0.35 });
    adMat.diffuseMap = ads;
    adMat.emissiveMap = ads;
    adMat.emissive = pc.Color.WHITE;
    adMat.update();
    for (let x = -32; x <= 32; x += 8)
      this.mesh(
        "LED perimeter",
        "box",
        vec(x, 0.85, -20),
        vec(7.8, 1.45, 0.2),
        adMat,
      );
    for (let side of [-1, 1])
      for (let z = -12; z <= 30; z += 8) {
        const e = this.mesh(
          "LED sideline",
          "box",
          vec(side * 37, 0.85, z),
          vec(7.8, 1.45, 0.2),
          adMat,
        );
        e.setEulerAngles(0, 90, 0);
      }
    for (const x of [-31, 31])
      for (const z of [-27, 33]) {
        this.mesh(
          "Floodlight tower",
          "cylinder",
          vec(x, 14, z),
          vec(0.35, 28, 0.35),
          rail,
        );
        this.mesh(
          "Floodlight housing",
          "box",
          vec(x, 28, z),
          vec(6.6, 1.7, 0.65),
          structure,
        );
        for (let i = 0; i < 6; i++)
          for (let j = 0; j < 2; j++)
            this.mesh(
              "Floodlight bulb",
              "sphere",
              vec(x + (i - 2.5), 27.6 + j * 0.65, z + 0.4),
              vec(0.38, 0.38, 0.18),
              warm,
            );
      }
    // Painted twilight sky is a texture on a true 3D enclosing sphere.
    const sky = document.createElement("canvas");
    sky.width = 1024;
    sky.height = 512;
    const ctx = sky.getContext("2d"),
      gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, "#02050b");
    gradient.addColorStop(0.48, "#0c141f");
    gradient.addColorStop(0.7, "#1a2835");
    gradient.addColorStop(0.81, "#34404b");
    gradient.addColorStop(1, "#14212b");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1024, 512);
    for (let i = 0; i < 48; i++) {
      ctx.fillStyle = `rgba(39,49,75,${0.1 + (i % 3) * 0.06})`;
      ctx.beginPath();
      ctx.ellipse(
        (i * 167) % 1024,
        230 + ((i * 31) % 100),
        30 + (i % 8) * 11,
        5 + (i % 4) * 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    const skyMat = this.material(0xffffff);
    skyMat.useLighting = false;
    skyMat.emissiveMap = this.texture(sky);
    skyMat.emissive = pc.Color.WHITE;
    skyMat.cull = pc.CULLFACE_FRONT;
    skyMat.update();
    const skyMesh = this.mesh(
      "Twilight sky",
      "sphere",
      vec(0, 0, 0),
      vec(280, 280, 280),
      skyMat,
    );
    skyMesh.render.castShadows = false;
  }
  adTexture() {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 192;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#151c25";
    ctx.fillRect(0, 0, 1024, 192);
    for (let i = 0; i < 1024; i += 5) {
      ctx.fillStyle = "#293443";
      ctx.fillRect(i, 0, 1, 192);
    }
    ctx.fillStyle = "#ffc35a";
    ctx.font = "900 65px Arial";
    ctx.textAlign = "center";
    ctx.fillText("LAST KICK", 512, 105);
    ctx.fillStyle = "#cad2da";
    ctx.font = "21px Arial";
    ctx.fillText("T A N D A  D E  P E N A L E S", 512, 150);
    return this.texture(c);
  }
  buildGoal() {
    const postMat = this.material(0xf4f6f0, {
      metalness: 0.25,
      roughness: 0.3,
    });
    for (const x of [-3.66, 3.66])
      this.mesh(
        "Goal post",
        "cylinder",
        vec(x, 1.22, GOAL_Z),
        vec(0.12, 2.44, 0.12),
        postMat,
      );
    const bar = this.mesh(
      "Crossbar",
      "cylinder",
      vec(0, 2.44, GOAL_Z),
      vec(0.12, 7.44, 0.12),
      postMat,
    );
    bar.setEulerAngles(0, 0, 90);
    this.crossbar = bar;
    const netMat = this.material(0xb3cec7, { opacity: 0.42 });
    const positions = [],
      normals = [],
      indices = [];
    const add = (a, b, width = 0.01) => {
      const n = positions.length / 3;
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      const off = Math.abs(dy) > Math.abs(dx) ? [width, 0, 0] : [0, width, 0];
      positions.push(
        a[0] - off[0],
        a[1] - off[1],
        a[2],
        a[0] + off[0],
        a[1] + off[1],
        a[2],
        b[0] + off[0],
        b[1] + off[1],
        b[2],
        b[0] - off[0],
        b[1] - off[1],
        b[2],
      );
      for (let i = 0; i < 4; i++) normals.push(0, 0, 1);
      indices.push(n, n + 1, n + 2, n, n + 2, n + 3);
    };
    for (let x = -3.66; x <= 3.67; x += 0.22) {
      add([x, 0, GOAL_Z - 1.8], [x, 2.44, GOAL_Z - 1.8]);
      add([x, 2.44, GOAL_Z], [x, 2.44, GOAL_Z - 1.8]);
    }
    for (let y = 0; y <= 2.45; y += 0.2) {
      add([-3.66, y, GOAL_Z - 1.8], [3.66, y, GOAL_Z - 1.8]);
      for (const x of [-3.66, 3.66]) add([x, y, GOAL_Z], [x, y, GOAL_Z - 1.8]);
    }
    for (let z = GOAL_Z - 1.8; z < GOAL_Z; z += 0.22) {
      for (const x of [-3.66, 3.66]) add([x, 0, z], [x, 2.44, z]);
      add([-3.66, 2.44, z], [3.66, 2.44, z]);
    }
    const mesh = new pc.Mesh(this.app.graphicsDevice);
    mesh.setPositions(positions);
    mesh.setNormals(normals);
    mesh.setIndices(indices);
    mesh.update();
    netMat.cull = pc.CULLFACE_NONE;
    netMat.update();
    this.net = new pc.Entity("Goal net");
    this.net.addComponent("render", {
      meshInstances: [new pc.MeshInstance(mesh, netMat)],
      castShadows: false,
    });
    this.app.root.addChild(this.net);
    for (const x of [-3.66, 3.66]) {
      this.mesh(
        "Rear support",
        "cylinder",
        vec(x, 1.22, GOAL_Z - 1.8),
        vec(0.035, 2.44, 0.035),
        postMat,
      );
      const t = this.mesh(
        "Top support",
        "box",
        vec(x, 2.44, GOAL_Z - 0.9),
        vec(0.04, 0.04, 1.8),
        postMat,
      );
      t.render.castShadows = false;
    }
  }
  buildBall() {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 256;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fafcf3";
    ctx.fillRect(0, 0, 512, 256);
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 6; col++) {
        const x = col * 90 + (row % 2) * 45,
          y = row * 100 + 15;
        ctx.fillStyle = "#16242f";
        ctx.strokeStyle = "#aab7b4";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
          ctx.lineTo(x + Math.cos(a) * 22, y + Math.sin(a) * 22);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    const mat = this.material(0xffffff, { roughness: 0.5 });
    mat.diffuseMap = this.texture(c);
    mat.update();
    this.ball = this.mesh(
      "Match football",
      "sphere",
      vec(0, 0.14, 0),
      vec(0.27, 0.27, 0.27),
      mat,
    );
    this.ballShadow = this.shadow(vec(0, 0.012, 0), 0.32);
  }
  shadow(position, size) {
    const e = this.mesh(
      "Contact shadow",
      "cylinder",
      position,
      vec(size, 0.005, size),
      this.material(0x091e14, { opacity: 0.28 }),
    );
    e.render.castShadows = false;
    return e;
  }
  buildAthlete(resource, texture, name, position, yaw) {
    const pivot = new pc.Entity(name);
    this.app.root.addChild(pivot);
    pivot.setPosition(position);
    pivot.setEulerAngles(0, yaw, 0);
    const rig = new pc.Entity(`${name} hip pivot`);
    pivot.addChild(rig);
    rig.setLocalPosition(0, 0.95, 0);
    const model = resource.instantiateRenderEntity();
    rig.addChild(model);
    model.setLocalPosition(0, -0.95, 0);
    model.setLocalScale(0.51, 0.51, 0.51);
    const mat = this.material(0xffffff, { roughness: 0.9 });
    mat.diffuseMap = texture;
    mat.update();
    for (const render of model.findComponents("render"))
      for (const mi of render.meshInstances) {
        this.softenAthleteMesh(mi.mesh);
        mi.material = mat;
        mi.castShadow = true;
      }
    model.findByName("Head")?.setLocalScale(0.62, 0.66, 0.62);
    const bones = new Map();
    for (const boneName of [
      "Hips",
      "Spine",
      "Chest",
      "LeftArm",
      "RightArm",
      "LeftForeArm",
      "RightForeArm",
      "LeftHand",
      "RightHand",
      "LeftUpLeg",
      "RightUpLeg",
      "LeftLeg",
      "RightLeg",
      "Head",
    ]) {
      const node = model.findByName(boneName);
      if (node)
        bones.set(boneName, {
          node,
          rotation: node.getLocalRotation().clone(),
        });
    }
    return { pivot, rig, model, bones, basePosition: position.clone(), yaw };
  }
  softenAthleteMesh(mesh) {
    if (this.smoothedMeshes.has(mesh)) return;
    this.smoothedMeshes.add(mesh);
    const positions = [],
      normals = [],
      sums = new Map();
    mesh.getPositions(positions);
    mesh.getNormals(normals);
    const key = (i) =>
      positions
        .slice(i, i + 3)
        .map((v) => Math.round(v * 1000000))
        .join(":");
    for (let i = 0; i < positions.length; i += 3) {
      const k = key(i),
        s = sums.get(k) ?? [0, 0, 0];
      s[0] += normals[i];
      s[1] += normals[i + 1];
      s[2] += normals[i + 2];
      sums.set(k, s);
    }
    for (let i = 0; i < positions.length; i += 3) {
      const s = sums.get(key(i)),
        length = Math.hypot(...s) || 1;
      for (let k = 0; k < 3; k++) normals[i + k] = s[k] / length;
    }
    mesh.setNormals(normals);
    mesh.update();
  }
  bone(athlete, name, x = 0, y = 0, z = 0) {
    const b = athlete.bones.get(name);
    if (!b) return;
    b.node.setLocalRotation(
      b.rotation.clone().mul(new pc.Quat().setFromEulerAngles(x, y, z)),
    );
  }
  alignArm(athlete, name, x, y, z) {
    const b = athlete.bones.get(name);
    if (!b) return;
    b.node.setLocalRotation(b.rotation);
    const current = b.node.getRotation().transformVector(pc.Vec3.UP);
    const desired = athlete.rig
      .getRotation()
      .transformVector(vec(x, y, z).normalize());
    const delta = new pc.Quat().setFromDirections(current, desired);
    b.node.setRotation(delta.mul(b.node.getRotation().clone()));
  }
  update(dt) {
    this.time += Math.min(dt, 0.05);
    if (!this.motion && this.idle && this.keeper) {
      this.keeper.pivot.setPosition(
        Math.sin(this.time * 1.8) * 0.07,
        Math.sin(this.time * 2.5) * 0.012,
        GOAL_Z + 0.35,
      );
      this.keeperPose.extension = 0;
      this.keeperPose.dive = 0;
      this.keeperPose.crouch = 0.14 + Math.sin(this.time * 2.5) * 0.025;
    }
    if (this.keeper) this.applyPoses();
    this.applyCamera();
    for (const e of this.effects) {
      e.ttl -= dt;
      e.entity.translate(e.vx * dt, e.vy * dt, e.vz * dt);
      e.vy -= dt * 2;
      e.entity.rotate(dt * 120, dt * 70, 0);
    }
    this.effects = this.effects.filter((e) => {
      if (e.ttl <= 0) {
        e.entity.destroy();
        return false;
      }
      return true;
    });
  }
  applyPoses() {
    const k = this.keeperPose,
      s = this.strikerPose;
    const breathing =
      this.idle && !this.motion && !this.reducedMotion
        ? Math.sin(this.time * 1.7)
        : 0;
    this.alignArm(
      this.keeper,
      "LeftArm",
      -0.45 + k.extension * 0.15,
      -0.8 + k.extension * 1.7,
      0.2,
    );
    this.alignArm(
      this.keeper,
      "RightArm",
      0.45 - k.extension * 0.15,
      -0.8 + k.extension * 1.7,
      0.2,
    );
    this.bone(this.keeper, "LeftForeArm", -25 - k.extension * 20, 0, 0);
    this.bone(this.keeper, "RightForeArm", -25 - k.extension * 20, 0, 0);
    this.bone(this.keeper, "LeftUpLeg", k.crouch * 40, 0, -5);
    this.bone(this.keeper, "RightUpLeg", k.crouch * 40, 0, 5);
    this.bone(this.keeper, "LeftLeg", -k.crouch * 65, 0, 0);
    this.bone(this.keeper, "RightLeg", -k.crouch * 65, 0, 0);
    this.bone(this.keeper, "Spine", -k.crouch * 20, 0, 0);
    this.bone(
      this.keeper,
      "Head",
      Math.sin(this.time * 0.7) * 1.2,
      Math.sin(this.time * 0.55) * 3,
      0,
    );
    this.bone(this.striker, "LeftUpLeg", Math.sin(s.run * 12) * 25, 0, 0);
    this.bone(
      this.striker,
      "RightUpLeg",
      -Math.sin(s.run * 12) * 25 + s.kick * 75,
      0,
      0,
    );
    this.bone(this.striker, "RightLeg", -s.kick * 35, 0, 0);
    const celebrate = s.celebrate ?? 0;
    this.bone(this.striker, "Spine", 4 + s.kick * 12 + breathing * 1.3, 0, 0);
    this.bone(this.striker, "Chest", 0, -s.kick * 8, breathing * 0.6);
    this.bone(this.striker, "Head", -3, breathing * 1.8, 0);
    this.alignArm(
      this.striker,
      "LeftArm",
      -0.18 - celebrate * 0.4,
      -1 + celebrate * 2 + s.kick * 0.35,
      0.12 + Math.sin(s.run * 12) * 0.25 + breathing * 0.018,
    );
    this.alignArm(
      this.striker,
      "RightArm",
      0.18 + celebrate * 0.4,
      -1 + celebrate * 2 + s.kick * 0.35,
      0.12 - Math.sin(s.run * 12) * 0.25 - breathing * 0.018,
    );
  }
  applyCamera() {
    const c = this.cameraRig;
    const sway =
      this.showcase && !this.reducedMotion
        ? Math.sin(this.time * 0.22) * 0.55
        : 0;
    const shake = this.reducedMotion ? 0 : this.shake.amount;
    this.camera.setPosition(
      c.x + sway + Math.sin(this.time * 51) * shake,
      c.y + Math.cos(this.time * 39) * shake * 0.6,
      c.z,
    );
    this.camera.lookAt(c.tx, c.ty, c.tz);
    this.camera.camera.fov = c.fov;
    // Avoid foreground net/crossbar occlusion when looking out from the goal.
    const insideGoal =
      this.cameraMode === "keeper" ||
      (this.phase === "defend" && this.cameraMode === "follow");
    if (this.net) this.net.enabled = !insideGoal;
    if (this.crossbar) this.crossbar.enabled = !insideGoal;
  }
  cameraPreset() {
    const portrait = this.width / this.height < 0.8;
    if (this.cameraMode === "broadcast")
      return {
        x: portrait ? 8 : 12,
        y: portrait ? 8 : 7,
        z: portrait ? 14 : 11,
        tx: 0,
        ty: 0.9,
        tz: -5,
        fov: portrait ? 60 : 55,
      };
    if (
      this.cameraMode === "keeper" ||
      (this.phase === "defend" && this.cameraMode === "follow")
    )
      return {
        x: 0,
        y: 3.0,
        z: -16,
        tx: 0,
        ty: 0.65,
        tz: -1,
        fov: portrait ? 74 : 61,
      };
    return {
      x: 0,
      y: portrait ? 2.55 : 3.1,
      z: portrait ? 7.8 : 10.8,
      tx: 0,
      ty: 1,
      tz: -7,
      fov: portrait ? 58 : 48,
    };
  }
  async setCamera(mode, instant = false) {
    this.cameraMode = mode;
    this.cameraTween?.kill();
    if (instant || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      Object.assign(this.cameraRig, this.cameraPreset());
      return;
    }
    await new Promise((resolve) => {
      this.cameraTween = gsap.to(this.cameraRig, {
        ...this.cameraPreset(),
        duration: 0.65,
        ease: "power2.inOut",
        onComplete: resolve,
        onInterrupt: resolve,
      });
    });
  }
  resize(width, height) {
    this.width = width;
    this.height = height;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.app.resizeCanvas(width, height);
    this.camera.camera.horizontalFov = width > height;
    if (!this.motion) {
      this.cameraTween?.kill();
      Object.assign(this.cameraRig, this.cameraPreset());
    }
  }
  project(x, y, z) {
    const p = this.camera.camera.worldToScreen(vec(x, y, z));
    return { x: p.x, y: p.y, z: p.z };
  }
  aim(dir) {
    this.aimDirection = dir;
  }
  async prepare(phase) {
    this.phase = phase;
    this.motion = false;
    this.idle = true;
    this.ball.setPosition(0, 0.14, 0);
    this.ballShadow.setPosition(0, 0.012, 0);
    this.keeper.pivot.setPosition(0, 0, GOAL_Z + 0.35);
    this.keeper.pivot.setEulerAngles(0, 0, 0);
    this.keeper.rig.setLocalEulerAngles(0, 0, 0);
    this.striker.pivot.setPosition(-0.9, 0, 1.65);
    this.striker.pivot.setEulerAngles(0, 180, 0);
    this.strikerPose.run = 0;
    this.strikerPose.kick = 0;
    this.strikerPose.celebrate = 0;
    this.net.setLocalScale(1, 1, 1);
    this.keeperShadow.setPosition(0, 0.025, GOAL_Z + 0.35);
    this.strikerShadow.setPosition(-0.9, 0.025, 1.65);
    await this.setCamera(this.cameraMode);
  }
  play(
    resolution,
    {
      replay = false,
      fast = false,
      onKick = () => {},
      onImpact = () => {},
    } = {},
  ) {
    this.timeline?.kill();
    this.cameraTween?.kill();
    const plan = choreography(resolution);
    this.motion = true;
    this.idle = false;
    this.lastResolution = resolution;
    this.strikerPose.run = 0;
    this.strikerPose.kick = 0;
    this.ballMotion.t = 0;
    this.ball.setPosition(0, 0.14, 0);
    const keeperPos = { x: 0, y: 0, z: GOAL_Z + 0.35, roll: 0 };
    const strikerPos = { x: -0.9, z: 1.65 };
    const diveX = TARGET_X[plan.diveDir] * 0.77;
    const diveTarget = {
      x: diveX,
      y: plan.diveDir === "C" ? 0.12 : 0.3,
      z: GOAL_Z + 0.35,
      roll: plan.diveDir === "L" ? 65 : plan.diveDir === "R" ? -65 : 0,
    };
    if (plan.saved) {
      // Align a real rig hand with the resolved save point before the goal line.
      this.keeper.pivot.setPosition(diveTarget.x, diveTarget.y, diveTarget.z);
      this.keeper.rig.setLocalEulerAngles(0, 0, diveTarget.roll);
      Object.assign(this.keeperPose, { extension: 1, crouch: 0 });
      this.applyPoses();
      const hands = ["LeftHand", "RightHand"].map((name) =>
        this.keeper.bones.get(name).node.getPosition().clone(),
      );
      const distance = (p) =>
        (p.x - plan.target.x) ** 2 + (p.y - plan.target.y) ** 2;
      const hand = hands.sort((a, b) => distance(a) - distance(b))[0];
      diveTarget.x += plan.target.x - hand.x;
      diveTarget.y += plan.target.y - hand.y;
      diveTarget.z += plan.target.z - hand.z;
      this.keeper.pivot.setPosition(0, 0, GOAL_Z + 0.35);
      this.keeper.rig.setLocalEulerAngles(0, 0, 0);
      Object.assign(this.keeperPose, { extension: 0, crouch: 0.14 });
      this.applyPoses();
    }
    return new Promise((resolve) => {
      const timeline = gsap.timeline({
        onComplete: () => {
          this.motion = false;
          resolve();
        },
        onInterrupt: () => {
          this.motion = false;
          resolve();
        },
      });
      this.timeline = timeline;
      if (fast) timeline.timeScale(2);
      if (replay) timeline.timeScale(0.7);
      timeline.to(
        strikerPos,
        {
          x: -0.25,
          z: 0.35,
          duration: 0.58,
          ease: "power1.in",
          onUpdate: () => {
            this.striker.pivot.setPosition(strikerPos.x, 0, strikerPos.z);
            this.strikerShadow.setPosition(strikerPos.x, 0.025, strikerPos.z);
          },
        },
        0,
      );
      timeline.to(
        this.strikerPose,
        { run: 1, duration: 0.58, ease: "none" },
        0,
      );
      timeline.to(
        this.strikerPose,
        { kick: 1, duration: 0.16, ease: "power2.out" },
        0.45,
      );
      timeline.to(this.strikerPose, { kick: 0, duration: 0.45 }, 0.7);
      timeline.call(onKick, null, 0.58);
      timeline.to(
        this.ballMotion,
        {
          t: 1,
          duration: plan.flightSeconds,
          ease: "none",
          onUpdate: () => {
            const p = ballPosition(plan, this.ballMotion.t);
            this.ball.setPosition(p.x, p.y, p.z);
            this.ball.rotateLocal(14, 8, 1);
            this.ballShadow.setPosition(p.x, 0.012, p.z);
          },
        },
        0.58,
      );
      timeline.to(
        this.keeperPose,
        { extension: 1, crouch: 0, duration: 0.23 },
        0.66,
      );
      timeline.to(
        keeperPos,
        {
          ...diveTarget,
          duration: plan.flightSeconds * 0.62,
          ease: "power2.out",
          onUpdate: () => {
            this.keeper.pivot.setPosition(
              keeperPos.x,
              keeperPos.y,
              keeperPos.z,
            );
            this.keeper.rig.setLocalEulerAngles(0, 0, keeperPos.roll);
            this.keeperShadow.setPosition(keeperPos.x, 0.025, keeperPos.z);
          },
        },
        0.62,
      );
      const impact = 0.58 + plan.flightSeconds;
      timeline.call(
        () => {
          onImpact(plan);
          if (!this.reducedMotion) {
            this.shake.amount = plan.saved ? 0.025 : 0.04;
            gsap.to(this.shake, { amount: 0, duration: 0.3, overwrite: true });
          }
          if (!plan.saved) this.confetti();
        },
        null,
        impact,
      );
      const end = { ...plan.target };
      timeline.to(
        end,
        {
          x: plan.saved ? plan.target.x * 0.85 : plan.target.x,
          y: 0.15,
          z: plan.saved ? GOAL_Z + 2.7 : GOAL_Z - 1.65,
          duration: 0.48,
          ease: "power2.out",
          onUpdate: () => {
            this.ball.setPosition(end.x, end.y, end.z);
            this.ballShadow.setPosition(end.x, 0.012, end.z);
          },
        },
        impact,
      );
      if (!plan.saved) {
        const net = { v: 0 };
        timeline.to(
          net,
          {
            v: 1,
            duration: 0.13,
            yoyo: true,
            repeat: 3,
            onUpdate: () => this.net.setLocalScale(1, 1, 1 + net.v * 0.012),
          },
          impact,
        );
      }
      timeline.to(
        keeperPos,
        {
          y: plan.diveDir === "C" ? -0.05 : -0.45,
          roll: plan.diveDir === "L" ? 80 : plan.diveDir === "R" ? -80 : 0,
          duration: 0.3,
          onUpdate: () => {
            this.keeper.pivot.setPosition(
              keeperPos.x,
              keeperPos.y,
              keeperPos.z,
            );
            this.keeper.rig.setLocalEulerAngles(0, 0, keeperPos.roll);
          },
        },
        impact + 0.1,
      );
      timeline.to({}, { duration: 0.9 }, impact + 0.45);
    });
  }
  confetti(originZ = GOAL_Z + 1) {
    const palette = [0xffc35a, 0xe8ecef, 0xd99846];
    for (let i = 0; i < 45; i++) {
      const entity = this.mesh(
        "Goal celebration",
        "box",
        vec(((i % 9) - 4) * 0.7, 3 + (i % 5) * 0.3, originZ + (i % 3)),
        vec(0.05, 0.09, 0.012),
        this.material(palette[i % 3], { emission: 0.4 }),
      );
      entity.render.castShadows = false;
      this.effects.push({
        entity,
        ttl: 2.5,
        vx: ((i % 7) - 3) * 0.3,
        vy: 0.5 + (i % 4) * 0.2,
        vz: ((i % 5) - 2) * 0.4,
      });
    }
  }
  async cinematic(name, { duration = 5 } = {}) {
    await this.prepare("attack");
    this.motion = true;
    const celebration = name === "celebration";
    if (celebration) {
      this.strikerPose.celebrate = 1;
      this.ball.setPosition(0, 0.14, GOAL_Z - 1.4);
      this.striker.pivot.setEulerAngles(0, 0, 0);
      this.confetti(1.2);
    }
    const preset = celebration
      ? { x: 3.5, y: 2.4, z: 6, tx: -0.9, ty: 1.1, tz: 1.65, fov: 50 }
      : this.cameraPreset();
    Object.assign(
      this.cameraRig,
      celebration
        ? {
            x: -3,
            y: 2.6,
            z: 6,
            tx: -0.9,
            ty: 1.1,
            tz: 1.65,
            fov: 50,
          }
        : {
            x: -7,
            y: 4.5,
            z: 4,
            tx: 0,
            ty: 1,
            tz: -7,
            fov: 55,
          },
    );
    await new Promise((resolve) => {
      this.cameraTween = gsap.to(this.cameraRig, {
        ...preset,
        duration,
        ease: "sine.inOut",
        onComplete: resolve,
        onInterrupt: resolve,
      });
    });
    this.motion = false;
  }
  destroy() {
    this.timeline?.kill();
    this.cameraTween?.kill();
    this.app?.destroy();
  }
}
