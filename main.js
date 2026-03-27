// Three JS Modules
import * as THREE from "three";

import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { AnimationMixer } from "three";

// Post Processing
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

// Debugging Tools
import Stats from "three/examples/jsm/libs/stats.module.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";

let camera, scene, renderer, composer, controls, model;
let modelCircle, baseCircle;
let gui, guiCam;
let room; // Oda objesi
let isLocked = false; // Pointer lock durumu
let currentInteractable = null; // Şu an bakılan etkileşimli obje
let interactionHintDiv; // E tuşu ipucu elementi
window.isDoorOpen = false; // Kapı durumu
window.doorGroup = null; // Kapı objesi referansı
let handsGroup; // Procedural hands group

const clock = new THREE.Clock();
let deltaTime;

// Göz hizası sabit yüksekliği (metre cinsinden)
const EYE_HEIGHT = 1.6;
const CROUCH_HEIGHT = 0.8;
let isCrouched = false;

// Deprem Sistemi Değişkenleri
let isQuakeActive = false;
let quakeIntensity = 0;
let quakeTime = 0;

// Senaryo Durum Değişkenleri
let timerStarted = false;
let startTime = 0;
let scenarioEnded = false;
let decisionLog = [];

// ==================== FPS HAREKET KONTROLLERİ (WASD) ====================
// Klavye ile birinci şahıs (kişi POV) hareketi için değişkenler
const moveState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
};

// Hareket hızı (metre/saniye)
const moveSpeed = 2.5;

function onKeyDown(event) {
  switch (event.code) {
    case "KeyW":
      moveState.forward = true;
      break;
    case "KeyS":
      moveState.backward = true;
      break;
    case "KeyA":
      moveState.left = true;
      break;
    case "KeyD":
      moveState.right = true;
      break;
    case "KeyE":
      if (event.repeat) return;
      if (currentInteractable) {
        handleInteraction(currentInteractable);
      }
      break;
    case "KeyC":
      if (event.repeat) return;
      isCrouched = !isCrouched;
      break;
  }
}

// Etkileşim işleyicisi
function handleInteraction(object) {
  if (object.name === "Door") {
    // Kapı aç/kapat
    toggleDoor();
  }
}

function toggleDoor() {
  if (!window.doorGroup) return;

  window.isDoorOpen = !window.isDoorOpen;

  // Basit rotasyon animasyonu
  if (window.isDoorOpen) {
    // Aç (İçeri veya dışarı, -90 derece diyelim)
    // Menteşe solda, içeri açılsın
    window.doorGroup.rotation.y = -Math.PI / 2;
    showMessage("🚪 Kapı Açıldı", 1000);
  } else {
    // Kapat
    window.doorGroup.rotation.y = 0;
    showMessage("🚪 Kapı Kapandı", 1000);
  }
}

function onKeyUp(event) {
  switch (event.code) {
    case "KeyW":
      moveState.forward = false;
      break;
    case "KeyS":
      moveState.backward = false;
      break;
    case "KeyA":
      moveState.left = false;
      break;
    case "KeyD":
      moveState.right = false;
      break;
  }
}

// Oda içi sınır için yardımcı fonksiyon (GÜNCELLENDİ: Kapı ve Dışarı Çıkış)
function clampInsideRoom(position) {
  const roomHalfSize = 2.4; // Yan ve arka duvarlar
  const wallZ = 2.5; // Ön duvar (Kapı duvarı)
  const outsideLimitZ = 6.0; // Dışarıda gidilebilecek son nokta
  const doorHalfWidth = 0.5; // Kapı genişliğinin yarısı (1m kapı)

  // X Sınırları (Oda genişliği - Dışarıda da aynı genişlikte koridor varsayalım)
  if (position.x > roomHalfSize) position.x = roomHalfSize;
  if (position.x < -roomHalfSize) position.x = -roomHalfSize;

  // Z Sınırları (Arka duvar ve Dış sınır)
  if (position.z < -roomHalfSize) position.z = -roomHalfSize;
  if (position.z > outsideLimitZ) position.z = outsideLimitZ;

  // Ön Duvar Kontrolü (Z = 2.5 civarı)
  // Eğer duvara yaklaşıyorsa
  if (position.z > 2.2 && position.z < 2.8) {
    const inDoorway = Math.abs(position.x) < doorHalfWidth;

    if (!inDoorway) {
      // Kapı hizasında değiliz - Duvar var
      if (position.z < wallZ) position.z = 2.2; // İçeride kal
      else position.z = 2.8; // Dışarıda kal
    } else {
      // Kapı hizasındayız
      if (!window.isDoorOpen) {
        // Kapı kapalı - Geçiş yok
        if (position.z < wallZ) position.z = 2.2;
        else position.z = 2.8;
      }
      // Kapı açıksa geçebiliriz
    }
  }
}

function updateFirstPersonMovement(delta) {
  // Sadece kilitliyse (senaryo başladığında kilitleniyor) harekete izin ver
  if (!controls.isLocked) return;

  // Yüksekliği sabitle (göz hizası sabit kalsın veya çömelme)
  const targetEyeHeight = isCrouched ? CROUCH_HEIGHT : EYE_HEIGHT;
  camera.position.y += (targetEyeHeight - camera.position.y) * 10 * delta;

  // Hiçbir tuşa basılmıyorsa çık (ama yükseklik enterpolasyonu çalışmaya devam etmeli diye yukarı aldık)
  if (
    !moveState.forward &&
    !moveState.backward &&
    !moveState.left &&
    !moveState.right
  ) {
    return;
  }

  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  // Y eksenini sıfırla ki sadece yatay düzlemde hareket etsin
  direction.y = 0;
  direction.normalize();

  // Sağ/sol yön vektörü (strafe) - dünya yukarı ekseni ile çarpım
  const strafe = new THREE.Vector3();
  strafe.crossVectors(direction, camera.up).normalize();

  const velocity = new THREE.Vector3();

  if (moveState.forward) {
    velocity.add(direction);
  }
  if (moveState.backward) {
    velocity.sub(direction);
  }
  if (moveState.left) {
    velocity.sub(strafe);
  }
  if (moveState.right) {
    velocity.add(strafe);
  }

  if (velocity.lengthSq() === 0) return;

  velocity.normalize().multiplyScalar(moveSpeed * delta);

  // Kamera ve hedef (controls.target) birlikte taşınmalı ki FPS hissi bozulmasın
  camera.position.add(velocity);

  // Kamerayı oda içinde tut
  clampInsideRoom(camera.position);
}

// Ses sistemı
let alarmSound;

// Performans ayarları
const statsEnable = false; // FPS için istatistik panelini kapat
const guiEnable = false;
const toneMapping = THREE.ACESFilmicToneMapping;
const antialiasing = false;
const AmbientOcclusion = false;
// Masa/bilgisayar bölgesinde kasmayı azaltmak için gölge ve env yansımasını kapat
const SHADOWS_ENABLED = false;
const ENV_REFLECTION_ENABLED = false;

const loader = new GLTFLoader().setPath("/assets/3D/");
const texLoader = new THREE.TextureLoader().setPath("/assets/textures/");
const hdriLoader = new RGBELoader().setPath("/assets/hdri/");

const fileFE = "FE8.glb";
const fileBase = "circle.glb";

// ==================== GERÇEKÇİ 3D MODEL YAPILANDIRMASI ====================
// Bu modelleri assets/3D/ klasörüne indirin
// Önerilen kaynaklar: Sketchfab, Poly Pizza, CGTrader (ücretsiz bölüm)
const REALISTIC_MODELS = {
  // Ofis Masası - basit ahşap masa
  desk: {
    file: "office_desk.glb",
    position: { x: 0, y: 0, z: -1.5 },
    scale: { x: 1, y: 1, z: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  },
  // Bilgisayar Monitörü
  monitor: {
    file: "computer_monitor.glb",
    position: { x: 0, y: 0.9, z: -2 },
    scale: { x: 0.3, y: 0.3, z: 0.3 },
    rotation: { x: 0, y: 0, z: 0 },
  },
  // Klavye
  keyboard: {
    file: "mouse_and_keyboard.glb",
    position: { x: -0.2, y: 1.1, z: -1.45 },
    scale: { x: 0.07, y: 0.07, z: 0.07 },
    rotation: { x: 0, y: 0, z: 0 },
  },

  // Isıtıcı, Alarm ve Elektrik panosu Deprem senaryosu için kaldırıldı.
  // Ofis Sandalyesi
  chair: {
    file: "office_chair.glb",
    position: { x: 0, y: 0, z: -1 },
    scale: { x: 0.8, y: 0.8, z: 0.8 },
    rotation: { x: 0, y: Math.PI, z: 0 },
  },
  // Misafir Sandalyesi 1 (Sağ Duvar - Orta)
  guestChair1: {
    file: "chair.glb",
    position: { x: 2.1, y: 0, z: -0.2 },
    scale: { x: 0.8, y: 0.8, z: 0.8 },
    rotation: { x: 0, y: -Math.PI / 2, z: 0 }, // Sola bakıyor
  },
  // Misafir Sandalyesi 2 (Sağ Duvar - Arka Taraf)
  guestChair2: {
    file: "chair.glb",
    position: { x: 2.1, y: 0, z: -0.8 },
    scale: { x: 0.8, y: 0.8, z: 0.8 },
    rotation: { x: 0, y: -Math.PI / 2, z: 0 }, // Sola bakıyor
  },
  // Saksı Bitkisi (Sol Arka Köşe)
  plant: {
    file: "majesty_palm_plant.glb",
    position: { x: -2.0, y: 0, z: -2.0 }, // Sol arka köşe - duvardan uzaklaştırıldı
    scale: { x: 1.2, y: 1.2, z: 1.2 }, // Daha sade bir boyut
    rotation: { x: 0, y: 0, z: 0 },
  },
  // Yangın Dolabı (Su sistemi / Hortum Dolabı) - Kod ile oluşturulacak
};

// Yüklenen modelleri saklayacak obje
const loadedModels = {};
let modelsLoaded = false;

// Model yükleme fonksiyonu - Promise tabanlı
function loadModel(modelKey) {
  return new Promise((resolve, reject) => {
    const config = REALISTIC_MODELS[modelKey];
    if (!config) {
      reject(new Error(`Model config not found: ${modelKey}`));
      return;
    }

    loader.load(
      config.file,
      (gltf) => {
        const model = gltf.scene;
        model.position.set(
          config.position.x,
          config.position.y,
          config.position.z
        );
        model.scale.set(config.scale.x, config.scale.y, config.scale.z);
        model.rotation.set(
          config.rotation.x,
          config.rotation.y,
          config.rotation.z
        );

        // Gölge ayarları
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        loadedModels[modelKey] = model;
        console.log(`✓ Model yüklendi: ${modelKey}`);
        resolve(model);
      },
      (progress) => {
        // Yükleme ilerleme
      },
      (error) => {
        console.warn(
          `⚠ Model yüklenemedi: ${modelKey} - Fallback kullanılacak`
        );
        resolve(null); // Hata durumunda null döndür, reject yapma
      }
    );
  });
}

// Tüm modelleri yükle
async function loadAllRealisticModels() {
  console.log("📦 Gerçekçi modeller yükleniyor...");

  const modelKeys = Object.keys(REALISTIC_MODELS);
  const loadPromises = modelKeys.map((key) => loadModel(key));

  await Promise.all(loadPromises);

  modelsLoaded = true;
  console.log("✅ Model yükleme tamamlandı!");
}

const cubeGeometry = new THREE.BoxGeometry();
const cubeMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });

// -------------------- GUI --------------------

const guiObject = {
  pauseBoolean: false,
  value1: 1,
  value2: 1,
  value3: 1.55, // Sahne parlaklığı (gölge/env kapalıyken daha aydınlık)
  value4: 0.05,
  color: { r: 0.01, g: 0.01, b: 0.01 },
};

addGUI();

initApp();

async function initApp() {
  await init();
  createProceduralHands();
  animate();
}

async function init() {
  // ------------------- Scene Setup -----------------------

  const container = document.createElement("div");
  document.body.appendChild(container);

  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.01,
    100
  );
  camera.position.set(0, 1.6, 2.0); // Oda içinde, kapının biraz önünde başla

  // Ses sistemini başlat
  initAudio();

  scene = new THREE.Scene();

  // Fire and Particles removed for Earthquake Mode

  // -------------------- Oda Oluştur --------------------

  await createRoom();

  // -------------------- Import Assets --------------------

  scene.add(camera); // Kamerayı da sahneye ekle


  // Circle - KALDIRILDI (zemindeki siyah alan istenmiyor)
  // loader.load(fileBase, async function (gltf) {
  //   modelCircle = gltf.scene;
  //   modelCircle.traverse((child) => {
  //     if (child.isMesh) {
  //       child.castShadow = false;
  //       child.receiveShadow = true;
  //       child.material.renderOrder = 0;
  //       child.material.depthWrite = true;
  //       child.material.transparent = false;
  //       child.material.color = new THREE.Color(
  //         guiObject.color.r,
  //         guiObject.color.g,
  //         guiObject.color.b
  //       );
  //       baseCircle = child;
  //     }
  //   });
  //   await renderer.compileAsync(modelCircle, camera, scene);
  //   scene.add(modelCircle);
  // });

  hdriLoader.load("Env.hdr", function (texture) {
    if (!ENV_REFLECTION_ENABLED) return;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = texture;
  });
  if (!ENV_REFLECTION_ENABLED) scene.environment = null;

  // Oda için basit bir arka plan rengi
  scene.background = new THREE.Color(0x87ceeb); // Açık mavi gökyüzü rengi
  scene.fog = new THREE.Fog(0x87ceeb, 8, 20); // Hava perspektifi için sis

  // ------------------- Render Starts --------------------------------

  renderer = new THREE.WebGLRenderer({ antialias: antialiasing });
  // Yüksek DPI ekranlarda FPS'i korumak için piksel oranını sınırla
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = toneMapping;
  renderer.toneMappingExposure = 1;
  container.appendChild(renderer.domElement);

  // ---------------------------- Mouse İnteraction --------------------------------

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  function onMouseClick(event) {
    // Mouse click artık sadece pointer lock için kullanılıyor
    // Etkileşimler 'E' tuşu ile yapılıyor
  }

  // Tıklama ile kilitleme mantığı - Sadece UI interaksiyonu yoksa ve oyun başladıysa
  // Sadece senaryo başladıysa (timerStarted true ise) kilitle
  document.addEventListener("click", function (event) {
    // Kontrol ekranı açıksa kilitleme yapma
    const controlsIntro = document.getElementById("controls-intro");
    if (controlsIntro && controlsIntro.style.display !== "none") {
      return;
    }

    // Senaryo başlamadıysa kilitleme yapma
    if (!timerStarted) return;

    // Eğer bir UI elementine tıklanmadıysa ve kontroller kilitli değilse kilitle
    if (!controls.isLocked && event.target.tagName !== "BUTTON") {
      controls.lock();
    }
  });

  // ---------------------------- controls --------------------------------

  controls = new PointerLockControls(camera, document.body);

  controls.addEventListener('lock', function () {
    isLocked = true;
    // İsteğe bağlı: UI elementlerini gizle veya "Oyun Aktif" mesajı göster
  });

  controls.addEventListener('unlock', function () {
    isLocked = false;
    // İsteğe bağlı: Duraklatma menüsü göster
  });

  // OrbitControls ayarları kaldırıldı

  // FPS hareketi için klavye dinleyicileri
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  // ---------------------------- scene --------------------------------

  window.addEventListener("resize", onWindowResize);

  // Aydınlatma Sistemi (gölge/env kapalıyken ortamı aydınlatmak için güçlendirildi)

  // Normal ofis aydınlatması (elektrik varken)
  window.mainLights = new THREE.Group();

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.35);
  ambientLight.name = "mainAmbient";
  window.mainLights.add(ambientLight);

  // Gökyüzü/zemin dolgu ışığı (env map yokken eşyaları aydınlatır)
  const hemiLight = new THREE.HemisphereLight(0xe8f4fc, 0x8b7355, 0.55);
  hemiLight.name = "mainHemisphere";
  window.mainLights.add(hemiLight);

  const ceilingLight1 = new THREE.PointLight(0xffffee, 2.2, 10);
  ceilingLight1.position.set(-1, 2.8, -1);
  ceilingLight1.castShadow = true;
  window.mainLights.add(ceilingLight1);

  const ceilingLight2 = new THREE.PointLight(0xffffee, 2.2, 10);
  ceilingLight2.position.set(1, 2.8, 1);
  ceilingLight2.castShadow = true;
  window.mainLights.add(ceilingLight2);

  const fillDir = new THREE.DirectionalLight(0xffffff, 0.85);
  fillDir.position.set(2, 4, 2);
  fillDir.name = "mainFillDir";
  window.mainLights.add(fillDir);

  scene.add(window.mainLights);

  // Acil Durum Aydınlatması (sadece elektrik kesilince)
  window.emergencyLights = new THREE.Group();

  const emergencyAmbient = new THREE.AmbientLight(0xff4444, 0.25);
  emergencyAmbient.name = "emergencyAmbient";
  window.emergencyLights.add(emergencyAmbient);

  const emergencyFill = new THREE.AmbientLight(0xffffff, 0.6);
  emergencyFill.name = "emergencyFill";
  window.emergencyLights.add(emergencyFill);

  // Acil durum lambaları (kırmızı)
  const emergencyPositions = [
    [-2, 2.9, -2],
    [2, 2.9, -2],
    [-2, 2.9, 2],
    [2, 2.9, 2],
  ];

  emergencyPositions.forEach((pos, index) => {
    const emergencyLight = new THREE.PointLight(0xff0000, 1.1, 6);
    emergencyLight.position.set(pos[0], pos[1], pos[2]);
    emergencyLight.name = `emergency${index}`;
    window.emergencyLights.add(emergencyLight);

    // Görsel lamba kutusu
    const lampGeometry = new THREE.BoxGeometry(0.15, 0.08, 0.15);
    const lampMaterial = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      emissive: 0xff0000,
      emissiveIntensity: 0.5,
    });
    const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
    lamp.position.copy(emergencyLight.position);
    room.add(lamp);
  });

  window.emergencyLights.visible = false; // Başlangıçta kapalı
  scene.add(window.emergencyLights);

  // --------------------------------- post --------------------------------

  // Gölge haritaları (masa/bilgisayar bölgesinde performansı düşürüyor)
  renderer.shadowMap.enabled = SHADOWS_ENABLED;
  if (SHADOWS_ENABLED) renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Post-processing kaldırıldı - performans ve uyumluluk için sadece standart renderer kullanılıyor.
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);

  composer.setSize(window.innerWidth, window.innerHeight); // Update composer size

  render();
}

// ----------------- Oda Fonksiyonu ------------------------

async function createRoom() {
  room = new THREE.Group();

  const roomSize = 5;
  const wallHeight = 3;
  const wallThickness = 0.1;

  // Malzemeler
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0xf5f5f0,
    roughness: 0.9,
    metalness: 0.05,
  });

  // Gerçekçi ahşap zemin dokusu için malzeme
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x8b6914,
    roughness: 0.8,
    metalness: 0.05,
  });

  const ceilingMaterial = new THREE.MeshStandardMaterial({
    color: 0xfafafa,
    roughness: 0.95,
    metalness: 0.02,
  });

  // Zemin
  const floorGeometry = new THREE.BoxGeometry(
    roomSize,
    wallThickness,
    roomSize
  );
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.position.y = -wallThickness / 2;
  floor.receiveShadow = true;
  room.add(floor);

  // Tavan
  const ceilingGeometry = new THREE.BoxGeometry(
    roomSize,
    wallThickness,
    roomSize
  );
  const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
  ceiling.position.y = wallHeight;
  ceiling.receiveShadow = true;
  room.add(ceiling);

  // Arka duvar
  const backWallGeometry = new THREE.BoxGeometry(
    roomSize,
    wallHeight,
    wallThickness
  );
  const backWall = new THREE.Mesh(backWallGeometry, wallMaterial);
  backWall.position.set(0, wallHeight / 2, -roomSize / 2);
  backWall.receiveShadow = true;
  backWall.castShadow = true;
  room.add(backWall);

  // Sol duvar
  const leftWallGeometry = new THREE.BoxGeometry(
    wallThickness,
    wallHeight,
    roomSize
  );
  const leftWall = new THREE.Mesh(leftWallGeometry, wallMaterial);
  leftWall.position.set(-roomSize / 2, wallHeight / 2, 0);
  leftWall.receiveShadow = true;
  leftWall.castShadow = true;
  room.add(leftWall);

  // Sağ duvar
  const rightWallGeometry = new THREE.BoxGeometry(
    wallThickness,
    wallHeight,
    roomSize
  );
  const rightWall = new THREE.Mesh(rightWallGeometry, wallMaterial);
  rightWall.position.set(roomSize / 2, wallHeight / 2, 0);
  rightWall.receiveShadow = true;
  rightWall.castShadow = true;
  room.add(rightWall);

  // Ön Duvar (Kapılı)
  // Kapı boşluğu: x= -0.5 ile 0.5 arası (1m genişlik), Yükseklik 2.2m

  // Sol Parça (İçeriden bakınca sağ, x > 0.5)
  const frontRightGeo = new THREE.BoxGeometry(2.0, wallHeight, wallThickness);
  const frontRight = new THREE.Mesh(frontRightGeo, wallMaterial);
  frontRight.position.set(1.5, wallHeight / 2, roomSize / 2); // (0.5 + 2.5)/2 = 1.5
  frontRight.castShadow = true;
  frontRight.receiveShadow = true;
  room.add(frontRight);

  // Sağ Parça (İçeriden bakınca sol, x < -0.5)
  const frontLeftGeo = new THREE.BoxGeometry(2.0, wallHeight, wallThickness);
  const frontLeft = new THREE.Mesh(frontLeftGeo, wallMaterial);
  frontLeft.position.set(-1.5, wallHeight / 2, roomSize / 2);
  frontLeft.castShadow = true;
  frontLeft.receiveShadow = true;
  room.add(frontLeft);

  // Üst Parça (Kapı üstü)
  const doorHeight = 2.2;
  const frontTopGeo = new THREE.BoxGeometry(1.0, wallHeight - doorHeight, wallThickness);
  const frontTop = new THREE.Mesh(frontTopGeo, wallMaterial);
  frontTop.position.set(0, doorHeight + (wallHeight - doorHeight) / 2, roomSize / 2);
  frontTop.castShadow = true;
  frontTop.receiveShadow = true;
  room.add(frontTop);

  // KAPI
  const doorWidth = 1.0;
  const doorThick = 0.05;
  const doorGeo = new THREE.BoxGeometry(doorWidth, doorHeight, doorThick);
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x442200, roughness: 0.6 }); // Ahşap kapı
  const doorMesh = new THREE.Mesh(doorGeo, doorMat);

  // Pivot noktası için grup (Menteşe solda olsun)
  const doorGroup = new THREE.Group();
  doorGroup.position.set(-0.5, doorHeight / 2, roomSize / 2); // Menteşe noktası

  // Mesh'i gruba göre konumlandır (Grup merkezinden sağa doğru uzayacak)
  doorMesh.position.set(doorWidth / 2, 0, 0);

  doorMesh.name = "Door"; // Raycaster için isim
  doorGroup.add(doorMesh);

  // Kapı kolu
  const handleGeo = new THREE.SphereGeometry(0.05);
  const handleMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8 });
  const handle = new THREE.Mesh(handleGeo, handleMat);
  handle.position.set(doorWidth - 0.1, 0, 0.05); // Kapının ucunda (Dış)
  handle.name = "Door";
  doorGroup.add(handle);

  // İç Kapı Kolu
  const handleInside = new THREE.Mesh(handleGeo, handleMat);
  handleInside.position.set(doorWidth - 0.1, 0, -0.05); // Kapının ucunda (İç)
  handleInside.name = "Door";
  doorGroup.add(handleInside);

  doorGroup.name = "DoorGroup";
  room.add(doorGroup);
  window.doorGroup = doorGroup;

  // Acil çıkış tabelası (GLB): Kapının tam üstünde, odanın içinde (duvara sabit)
  loader.load(
    "exit_box.glb",
    (gltf) => {
      const exitSign = gltf.scene;

      exitSign.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Konum: kapı boşluğunun tam üstü, ön duvarın iç yüzeyi
      // Kapı üstüne daha yakın ve biraz daha büyük
      exitSign.position.set(
        0,
        doorHeight + 0.15,
        roomSize / 2 - wallThickness / 2 - 0.01
      );

      // Ölçek: biraz daha büyük
      exitSign.scale.set(0.65, 0.65, 0.65);

      // Duvara paralel olsun (90°)
      exitSign.rotation.y = Math.PI / 2;

      room.add(exitSign);
    },
    undefined,
    (error) => {
      console.warn("⚠ exit_box.glb yüklenemedi:", error);
    }
  );

  // Dış Zemin (Balkon/Koridor)
  const outFloorGeo = new THREE.BoxGeometry(roomSize, wallThickness, 4.0);
  const outFloorMat = new THREE.MeshStandardMaterial({ color: 0x333333 }); // Beton zemin
  const outFloor = new THREE.Mesh(outFloorGeo, outFloorMat);
  outFloor.position.set(0, -wallThickness / 2, 4.5); // 2.5 + 2.0 = 4.5
  outFloor.receiveShadow = true;
  room.add(outFloor);

  // Acil Çıkış Takip Yolu (Gelişmiş - L Şekli, Kusursuz Köşe)
  const exitPathGroup = new THREE.Group();
  room.add(exitPathGroup);

  // Materyaller
  const pathMat = new THREE.MeshBasicMaterial({ color: 0x009900, side: THREE.DoubleSide }); // Yeşil Yol
  const borderMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, side: THREE.DoubleSide }); // Sarı Şeritler
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, side: THREE.DoubleSide }); // Sarı Oklar

  const pathY = 0.02; // Zemin üstü

  // Koordinat Limitleri:
  // Z Başlangıç: 2.5 (Kapı)
  // Z Dönüş Merkezi: 5.0 (Koridor Ortası)
  // X Bitiş: -2.2 (Sola gidiş, zemin sınırı -2.5 olduğu için güvenli pay bırakıldı)

  // 1. DİKEY BÖLÜM (Kapıdan İleri) - YEŞİL
  // Z: 2.5 -> 5.4 (Dönüşün dış kenarına kadar)
  const vGreenGeo = new THREE.PlaneGeometry(0.8, 2.9);
  const vGreen = new THREE.Mesh(vGreenGeo, pathMat);
  vGreen.rotation.x = -Math.PI / 2;
  vGreen.position.set(0, pathY, 2.5 + 1.45); // Orta nokta: 3.95
  exitPathGroup.add(vGreen);

  // 2. YATAY BÖLÜM (Sola Dönüş) - YEŞİL
  // X: -0.4 (Dikey parçanın iç kenarı) -> -2.2
  const hGreenGeo = new THREE.PlaneGeometry(1.8, 0.8);
  const hGreen = new THREE.Mesh(hGreenGeo, pathMat);
  hGreen.rotation.x = -Math.PI / 2;
  hGreen.position.set(-1.3, pathY, 5.0); // Z=5.0 merkezli
  exitPathGroup.add(hGreen);

  // 3. DIŞ KENAR (Sağ -> Üst Sarı Şerit)
  // Dikey Sağ Border: Z 2.5 -> 5.45
  const borderRightGeo = new THREE.PlaneGeometry(0.1, 2.95);
  const borderRight = new THREE.Mesh(borderRightGeo, borderMat);
  borderRight.rotation.x = -Math.PI / 2;
  borderRight.position.set(0.45, pathY, 2.5 + 1.475);
  exitPathGroup.add(borderRight);

  // Yatay Üst Border: X 0.45 -> -2.2
  const borderTopGeo = new THREE.PlaneGeometry(2.65, 0.1);
  const borderTop = new THREE.Mesh(borderTopGeo, borderMat);
  borderTop.rotation.x = -Math.PI / 2;
  borderTop.position.set(-0.875, pathY, 5.45);
  exitPathGroup.add(borderTop);

  // 4. İÇ KENAR (Sol -> Alt Sarı Şerit)
  // Dikey Sol Border: Z 2.5 -> 4.55 (İç köşe hizası)
  const borderLeftGeo = new THREE.PlaneGeometry(0.1, 2.05);
  const borderLeft = new THREE.Mesh(borderLeftGeo, borderMat);
  borderLeft.rotation.x = -Math.PI / 2;
  borderLeft.position.set(-0.45, pathY, 2.5 + 1.025);
  exitPathGroup.add(borderLeft);

  // Yatay Alt Border: X -0.45 -> -2.2
  const borderBottomGeo = new THREE.PlaneGeometry(1.75, 0.1);
  const borderBottom = new THREE.Mesh(borderBottomGeo, borderMat);
  borderBottom.rotation.x = -Math.PI / 2;
  borderBottom.position.set(-1.325, pathY, 4.55);
  exitPathGroup.add(borderBottom);

  // KÖŞE KAPATMA (Sarı Kareler - Z-fighting önlemek için gerekirse)
  // Şu anki geometri overlap ile doğal kapanıyor.

  // --- OKLAR ---
  const arrowGeo = new THREE.CircleGeometry(0.3, 3); // Üçgen Ok

  // Ok 1: İleri
  const arrow1 = new THREE.Mesh(arrowGeo, arrowMat);
  arrow1.rotation.x = -Math.PI / 2;
  arrow1.rotation.z = -Math.PI / 2; // +Z yönü
  arrow1.position.set(0, pathY + 0.01, 3.5);
  exitPathGroup.add(arrow1);

  // Ok 2: Sola
  const arrow2 = new THREE.Mesh(arrowGeo, arrowMat);
  arrow2.rotation.x = -Math.PI / 2;
  arrow2.rotation.z = Math.PI; // -X yönü (Sol)
  arrow2.position.set(-1.5, pathY + 0.01, 5.0);
  exitPathGroup.add(arrow2);

  // ==================== GERÇEKÇİ MODELLER ====================
  // Önce modelleri yüklemeyi dene, başarısız olursa fallback kullan

  await loadAllRealisticModels();

  // -------------------- OFİS MASASI --------------------
  if (loadedModels.desk) {
    room.add(loadedModels.desk);
    console.log("✓ Gerçekçi masa modeli eklendi");
  } else {
    // Fallback: Basit geometri masa
    createFallbackDesk();
  }

  // Alarm butonu ve Isıtıcı deprem senaryosunda kaldırıldı.

  // -------------------- BİLGİSAYAR DONANIMI --------------------
  let monitor, screen, keyboard, computerMouse;

  if (loadedModels.monitor) {
    monitor = loadedModels.monitor;
    monitor.name = "monitor";
    room.add(monitor);
    console.log("✓ Gerçekçi monitör eklendi");
  } else {
    // Fallback: Basit monitör
    const monitorData = createFallbackMonitor();
    monitor = monitorData.monitor;
    screen = monitorData.screen;
  }

  if (loadedModels.keyboard) {
    keyboard = loadedModels.keyboard;
    keyboard.name = "keyboard";
    room.add(keyboard);
    console.log("✓ Gerçekçi klavye eklendi");
  } else if (!loadedModels.monitor) {
    // Fallback zaten oluşturuldu
  }

  if (loadedModels.mouse) {
    computerMouse = loadedModels.mouse;
    room.add(computerMouse);
    console.log("✓ Gerçekçi mouse eklendi");
  }

  // -------------------- OFİS SANDALYESİ --------------------
  if (loadedModels.chair) {
    loadedModels.chair.name = "chair_office";
    room.add(loadedModels.chair);
    console.log("✓ Gerçekçi ofis sandalyesi eklendi");
  } else {
    // Fallback: Basit sandalye
    createFallbackChair();
  }

  // -------------------- MİSAFİR SANDALYELERİ --------------------
  if (loadedModels.guestChair1) {
    loadedModels.guestChair1.name = "chair_guest1";
    room.add(loadedModels.guestChair1);
    console.log("✓ Misafir sandalyesi 1 eklendi");
  }

  if (loadedModels.guestChair2) {
    loadedModels.guestChair2.name = "chair_guest2";
    room.add(loadedModels.guestChair2);
    console.log("✓ Misafir sandalyesi 2 eklendi");
  }

  // -------------------- BİTKİ --------------------
  if (loadedModels.plant) {
    loadedModels.plant.name = "plant";
    room.add(loadedModels.plant);
    console.log("✓ Bitki eklendi");
  }

  // Bilgisayar referansını sakla (yangın yayılması için)
  window.computerEquipment = {
    monitor: monitor || loadedModels.monitor,
    screen: screen,
    keyboard: keyboard || loadedModels.keyboard,
    mouse: computerMouse || loadedModels.mouse,
  };

  // Elektrik panosu kaldırıldı

  scene.add(room);
}

// ==================== FALLBACK FONKSİYONLARI ====================
// Model yüklenemezse kullanılacak basit geometriler

function createFallbackDesk() {
  // Masa üstü
  const deskGeometry = new THREE.BoxGeometry(1.5, 0.05, 0.8);
  const deskMaterial = new THREE.MeshStandardMaterial({
    color: 0x5c4033,
    roughness: 0.7,
    metalness: 0.1,
  });
  const desk = new THREE.Mesh(deskGeometry, deskMaterial);
  desk.position.set(0, 0.75, 0);
  desk.castShadow = true;
  desk.receiveShadow = true;
  room.add(desk);

  // Masa Bacakları
  const legGeometry = new THREE.CylinderGeometry(0.04, 0.04, 0.72, 12);
  const legMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    roughness: 0.4,
    metalness: 0.6,
  });

  const positions = [
    [-0.68, 0.36, -0.35],
    [0.68, 0.36, -0.35],
    [-0.68, 0.36, 0.35],
    [0.68, 0.36, 0.35],
  ];

  positions.forEach((pos) => {
    const leg = new THREE.Mesh(legGeometry, legMaterial);
    leg.position.set(pos[0], pos[1], pos[2]);
    leg.castShadow = true;
    room.add(leg);
  });

  console.log("⚠ Fallback masa kullanıldı");
}

// Procedural Hands (Three.js Primitives)
function createProceduralHands() {
  handsGroup = new THREE.Group();

  const skinMaterial = new THREE.MeshStandardMaterial({
    color: 0xe0ac69, // Skin tone
    roughness: 0.6,
    metalness: 0.05
  });

  const createHand = (isRight) => {
    const handGroup = new THREE.Group();
    const side = isRight ? 1 : -1;

    // Arm (Forearm)
    const armGeo = new THREE.CylinderGeometry(0.04, 0.045, 0.5, 12);
    const arm = new THREE.Mesh(armGeo, skinMaterial);
    arm.rotation.x = Math.PI / 2 - 0.2;
    arm.position.set(0.25 * side, -0.35, -0.15);
    handGroup.add(arm);

    // Palm
    const palmGeo = new THREE.BoxGeometry(0.1, 0.03, 0.12);
    const palm = new THREE.Mesh(palmGeo, skinMaterial);
    palm.position.set(0.25 * side, -0.28, -0.42);
    palm.rotation.x = -0.1;
    handGroup.add(palm);

    // Fingers
    const fingerGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.08, 8);
    for (let i = 0; i < 4; i++) {
      const finger = new THREE.Mesh(fingerGeo, skinMaterial);
      finger.rotation.x = Math.PI / 2;
      finger.position.set(
        (0.25 * side) + (i * 0.025 - 0.0375) * side,
        -0.27,
        -0.49
      );
      handGroup.add(finger);
    }

    // Thumb
    const thumb = new THREE.Mesh(fingerGeo, skinMaterial);
    thumb.rotation.x = Math.PI / 2;
    thumb.rotation.y = side * 0.5;
    thumb.position.set(
      (0.25 * side) - (0.06 * side),
      -0.28,
      -0.44
    );
    handGroup.add(thumb);

    return handGroup;
  };

  handsGroup.add(createHand(false)); // Left
  handsGroup.add(createHand(true));  // Right

  camera.add(handsGroup);
}

function createFallbackAlarmButton() {
  // GİRİŞE YAKIN - Sol duvar (x=-2.4, z=1.8)
  const alarmX = -2.4;
  const alarmY = 1.4;
  const alarmZ = 1.8;

  // Alarm arka kutusu
  const alarmBackGeometry = new THREE.BoxGeometry(0.08, 0.35, 0.35); // Döndürüldü
  const alarmBackMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.6,
    metalness: 0.2,
  });
  const alarmBack = new THREE.Mesh(alarmBackGeometry, alarmBackMaterial);
  alarmBack.position.set(alarmX, alarmY, alarmZ);
  alarmBack.castShadow = true;
  room.add(alarmBack);

  // Alarm butonu (kırmızı - basılabilir)
  const alarmButtonGeometry = new THREE.CylinderGeometry(0.1, 0.11, 0.06, 32);
  const alarmButtonMaterial = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    emissive: 0xff0000,
    emissiveIntensity: 0.6,
    roughness: 0.2,
    metalness: 0.8,
  });
  const alarmButton = new THREE.Mesh(alarmButtonGeometry, alarmButtonMaterial);
  alarmButton.position.set(alarmX + 0.07, alarmY, alarmZ); // Duvardan dışarı
  alarmButton.rotation.z = Math.PI / 2; // Yatay - sağa baksın
  alarmButton.name = "alarmBox";
  alarmButton.castShadow = true;
  room.add(alarmButton);

  // Alarm kutu çerçevesi (kırmızı çizgi)
  const frameGeometry = new THREE.BoxGeometry(0.02, 0.37, 0.37); // Döndürüldü
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0xcc0000,
    roughness: 0.4,
    metalness: 0.6,
  });
  const frame = new THREE.Mesh(frameGeometry, frameMaterial);
  frame.position.set(alarmX + 0.02, alarmY, alarmZ);
  room.add(frame);

  // "ALARM" yazısı plakası
  const textGeometry = new THREE.BoxGeometry(0.02, 0.06, 0.3); // Döndürüldü
  const textMaterial = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    emissive: 0x440000,
    emissiveIntensity: 0.4,
  });
  const textPlate = new THREE.Mesh(textGeometry, textMaterial);
  textPlate.position.set(alarmX + 0.02, alarmY + 0.22, alarmZ);
  room.add(textPlate);

  console.log("⚠ Fallback alarm butonu kullanıldı");
}

function createFallbackTrashCan() {
  // Isıtıcı (Masa altında) - Yangın kaynağı, orijinal gri metal görünüm
  const trashCanGeometry = new THREE.CylinderGeometry(0.16, 0.19, 0.38, 20);
  const trashCanMaterial = new THREE.MeshStandardMaterial({
    color: 0x6e6e6e,
    roughness: 0.55,
    metalness: 0.35,
  });
  const trashCan = new THREE.Mesh(trashCanGeometry, trashCanMaterial);
  trashCan.position.set(0.35, 0.19, 0.15);
  trashCan.castShadow = true;
  trashCan.receiveShadow = true;
  trashCan.name = "trashcan";
  room.add(trashCan);

  // Isıtıcı kovası kenar bandı
  const rimGeometry = new THREE.TorusGeometry(0.17, 0.015, 8, 24);
  const rimMaterial = new THREE.MeshStandardMaterial({
    color: 0x505050,
    roughness: 0.4,
    metalness: 0.6,
  });
  const rim = new THREE.Mesh(rimGeometry, rimMaterial);
  rim.position.set(0.35, 0.38, 0.15);
  rim.rotation.x = Math.PI / 2;
  console.log("⚠ Fallback çöp kovası kullanıldı");
  return trashCan;
}

function createFallbackMonitor() {
  // Monitör
  const monitorGeometry = new THREE.BoxGeometry(0.55, 0.38, 0.04);
  const monitorMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.2,
    metalness: 0.7,
  });
  const monitor = new THREE.Mesh(monitorGeometry, monitorMaterial);
  monitor.position.set(0, 0.98, -0.18);
  monitor.rotation.x = -0.08;
  monitor.castShadow = true;
  monitor.receiveShadow = true;
  monitor.name = "monitor";
  room.add(monitor);

  // Monitör ekranı (mavi - açık)
  const screenGeometry = new THREE.BoxGeometry(0.5, 0.32, 0.01);
  const screenMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a8cff,
    emissive: 0x0055aa,
    emissiveIntensity: 0.6,
    roughness: 0.05,
    metalness: 0.1,
  });
  const screen = new THREE.Mesh(screenGeometry, screenMaterial);
  screen.position.set(0, 0.98, -0.155);
  screen.rotation.x = -0.08;
  room.add(screen);

  // Monitör standı - boyun
  const neckGeometry = new THREE.BoxGeometry(0.06, 0.15, 0.06);
  const standMaterial = new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.4,
    metalness: 0.6,
  });
  const neck = new THREE.Mesh(neckGeometry, standMaterial);
  neck.position.set(0, 0.855, -0.18);
  room.add(neck);

  // Monitör standı - taban
  const baseGeometry = new THREE.CylinderGeometry(0.12, 0.14, 0.02, 24);
  const base = new THREE.Mesh(baseGeometry, standMaterial);
  base.position.set(0, 0.785, -0.18);
  room.add(base);

  // Klavye
  const keyboardGeometry = new THREE.BoxGeometry(0.42, 0.015, 0.14);
  const keyboardMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    roughness: 0.6,
    metalness: 0.3,
  });
  const keyboard = new THREE.Mesh(keyboardGeometry, keyboardMaterial);
  keyboard.position.set(0, 0.785, 0.12);
  keyboard.castShadow = true;
  keyboard.name = "keyboard";
  room.add(keyboard);

  // Mouse
  const mouseGeometry = new THREE.BoxGeometry(0.055, 0.025, 0.095);
  const mouseMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.4,
    metalness: 0.4,
  });
  const computerMouse = new THREE.Mesh(mouseGeometry, mouseMaterial);
  computerMouse.position.set(0.28, 0.79, 0.15);
  computerMouse.castShadow = true;
  room.add(computerMouse);

  console.log("⚠ Fallback monitör/klavye/mouse kullanıldı");

  return { monitor, screen, keyboard, mouse: computerMouse };
}

function createFallbackChair() {
  // Basit ofis sandalyesi
  const chairGroup = new THREE.Group();

  // Oturma yeri
  const seatGeometry = new THREE.BoxGeometry(0.45, 0.06, 0.45);
  const seatMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.8,
    metalness: 0.1,
  });
  const seat = new THREE.Mesh(seatGeometry, seatMaterial);
  seat.position.y = 0.45;
  chairGroup.add(seat);

  // Sırt dayama
  const backGeometry = new THREE.BoxGeometry(0.42, 0.5, 0.05);
  const back = new THREE.Mesh(backGeometry, seatMaterial);
  back.position.set(0, 0.73, -0.2);
  back.rotation.x = 0.1;
  chairGroup.add(back);

  // Merkez ayak
  const legGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.25, 12);
  const legMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.3,
    metalness: 0.8,
  });
  const centerLeg = new THREE.Mesh(legGeometry, legMaterial);
  centerLeg.position.y = 0.3;
  chairGroup.add(centerLeg);

  // 5 tekerlekli ayak
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const wheelLeg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.25, 8),
      legMaterial
    );
    wheelLeg.position.set(Math.cos(angle) * 0.18, 0.08, Math.sin(angle) * 0.18);
    wheelLeg.rotation.z = (Math.PI / 6) * (angle > Math.PI ? 1 : -1);
    chairGroup.add(wheelLeg);

    // Tekerlek
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.03, 12),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
    );
    wheel.position.set(Math.cos(angle) * 0.25, 0.015, Math.sin(angle) * 0.25);
    wheel.rotation.z = Math.PI / 2;
    chairGroup.add(wheel);
  }

  chairGroup.position.set(0, 0, 0.9);
  chairGroup.rotation.y = Math.PI + 0.2;
  room.add(chairGroup);

  console.log("⚠ Fallback sandalye kullanıldı");
}

// Elektrik Panosu - Gerçekçi
function createElectricalPanel() {
  // ARKA KÖŞE - Sağ duvar (x=2.4, z=-1.8)
  const panelX = 2.4;
  const panelY = 1.2;
  const panelZ = -1.8;

  // Ana pano kutusu (gri metal)
  const panelGeometry = new THREE.BoxGeometry(0.12, 0.7, 0.5); // Döndürüldü
  const panelMaterial = new THREE.MeshStandardMaterial({
    color: 0x666666,
    roughness: 0.5,
    metalness: 0.6,
  });
  const panel = new THREE.Mesh(panelGeometry, panelMaterial);
  panel.position.set(panelX, panelY, panelZ);
  panel.name = "electricalPanel";
  panel.castShadow = true;
  room.add(panel);

  // Pano kapağı (açık gri)
  const doorGeometry = new THREE.BoxGeometry(0.03, 0.65, 0.45); // Döndürüldü
  const doorMaterial = new THREE.MeshStandardMaterial({
    color: 0xaaaaaa,
    roughness: 0.4,
    metalness: 0.5,
  });
  const door = new THREE.Mesh(doorGeometry, doorMaterial);
  door.position.set(panelX - 0.06, panelY, panelZ);
  room.add(door);

  // Tehlike işareti (sarı-siyah)
  const warningGeometry = new THREE.BoxGeometry(0.01, 0.15, 0.15); // Döndürüldü
  const warningMaterial = new THREE.MeshStandardMaterial({
    color: 0xffdd00,
    emissive: 0x443300,
    emissiveIntensity: 0.4,
    roughness: 0.3,
  });
  const warning = new THREE.Mesh(warningGeometry, warningMaterial);
  warning.position.set(panelX - 0.08, panelY + 0.15, panelZ);
  room.add(warning);

  // Kırmızı çizgi (tehlike)
  const lineGeometry = new THREE.BoxGeometry(0.01, 0.02, 0.4); // Döndürüldü
  const lineMaterial = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    emissive: 0x660000,
    emissiveIntensity: 0.3,
  });
  const line = new THREE.Mesh(lineGeometry, lineMaterial);
  line.position.set(panelX - 0.08, panelY - 0.15, panelZ);
  room.add(line);

  // "ELEKTRİK PANOSU" yazı plakası
  const labelGeometry = new THREE.BoxGeometry(0.01, 0.06, 0.35); // Döndürüldü
  const labelMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    emissive: 0x111111,
    emissiveIntensity: 0.2,
  });
  const label = new THREE.Mesh(labelGeometry, labelMaterial);
  label.position.set(panelX - 0.08, panelY + 0.35, panelZ);
  room.add(label);

  // Kilit/mandal
  const lockGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.05, 8);
  const lockMaterial = new THREE.MeshStandardMaterial({
    color: 0x222222,
    metalness: 0.9,
    roughness: 0.2,
  });
  const lock = new THREE.Mesh(lockGeometry, lockMaterial);
  lock.position.set(panelX - 0.08, panelY, panelZ + 0.15);
  lock.rotation.x = Math.PI / 2;
  room.add(lock);

  window.electricalPanel = panel;
}

// ----------------- Senaryo Kontrol Fonksiyonları ------------------------

// ----------------- Yangın Kontrol Fonksiyonları ------------------------

function startEarthquake() {
  if (!timerStarted) {
    timerStarted = true;
    startTime = Date.now();
  }

  isQuakeActive = true;
  quakeIntensity = 1.0;
  quakeTime = 0;

  // Elektrik kesintisi
  cutElectricity();

  decisionLog.push({
    time: Date.now() - startTime,
    action: "earthquake_started",
    description: "Deprem başladı!",
  });

  console.log("⚡ Deprem başladı!");
}

// Elektriği kes
function cutElectricity() {
  window.electricityOn = false;

  // Normal ışıkları kapat
  if (window.mainLights) {
    window.mainLights.visible = false;
  }

  // Acil durum ışıklarını aç
  if (window.emergencyLights) {
    window.emergencyLights.visible = true;
  }

  // Arka plan koyu ama tam karanlık değil; eşyalar orijinal renklerini korusun
  scene.background = new THREE.Color(0x2a2540);
  scene.fog = new THREE.Fog(0x2a2540, 5, 14);

  // Ortam ışığı azaldığında malzemeler üzerindeki parlaklık/yansıma dursun
  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    const m = obj.material;
    if (!m) return;
    const mats = Array.isArray(m) ? m : [m];
    mats.forEach((mat) => {
      if (mat && typeof mat.metalness !== "undefined") mat.metalness = 0;
      if (mat && typeof mat.roughness !== "undefined") mat.roughness = 0.95;
    });
  });

  console.log(
    "💡 Kaçak akım rölesi devreye girdi! Sadece acil durum ışıkları yanıyor."
  );
}

// Earthquake Logic Functions removed

// Mesaj göster
function showMessage(message, duration = 4000) {
  const messageDiv = document.getElementById("messageBox");
  if (messageDiv) {
    messageDiv.textContent = message;
    messageDiv.style.display = "block";

    setTimeout(() => {
      messageDiv.style.display = "none";
    }, duration);
  }
}

// Durum güncelle
function updateStatus() {
  const statusDiv = document.getElementById("fireStatus");
  if (!statusDiv) return;

  if (!isQuakeActive && !scenarioEnded) {
    statusDiv.textContent = "Durum: Beklemede";
    statusDiv.style.color = "#ffff00";
    statusDiv.style.animation = "none";
    return;
  }

  if (scenarioEnded) {
    statusDiv.textContent = "✅ Deprem Sona Erdi!";
    statusDiv.style.color = "#00ff00";
    statusDiv.style.borderColor = "#00ff00";
    statusDiv.style.animation = "none";
  } else {
    statusDiv.textContent = "🌍 DEPREM OLUYOR! ÇÖK-KAPAN-TUTUN (C)";
    statusDiv.style.color = "#ff4444";
    statusDiv.style.borderColor = "#ff4444";
    statusDiv.style.animation = "pulse 0.5s infinite";
  }
}

// Senaryo sonu
function endScenario(result) {
  if (scenarioEnded) return;

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // Zamanlayıcıyı ve animasyonları durdur
  scenarioEnded = true;
  timerStarted = false;
  isQuakeActive = false;

  const timerDiv = document.getElementById("timer");
  if (timerDiv) {
    timerDiv.style.display = "none";
  }

  // Sonuç ekranı göster
  const resultDiv = document.getElementById("resultScreen");
  const resultTitle = document.getElementById("resultTitle");
  const resultText = document.getElementById("resultText");
  const scoreText = document.getElementById("scoreText");
  const timeText = document.getElementById("timeText");
  const logText = document.getElementById("decisionLog");

  if (!resultDiv) return;

  resultDiv.style.display = "block";

  let title = "";
  let text = "";
  let color = "";

  switch (result) {
    case "success":
      title = "🎉 BAŞARILI: Güvenli Alana Sığındınız!";
      text = "Deprem anında doğru pozisyonda ve masa altında kalarak hayatınızı kurtardınız.";
      color = "#00ff00";
      break;

    case "failed_standing":
      title = "❌ BAŞARISIZ: Çökmediniz";
      text = "Deprem anında ayakta kalmak düşmenize ve yaralanmanıza neden olabilir!";
      color = "#ff0000";
      break;

    case "failed_not_under_desk":
      title = "❌ BAŞARISIZ: Güvenli Alanda Değildiniz";
      text = "Masanın altına sığınmadığınız için üzerinize eşya düşebilirdi.";
      color = "#ff0000";
      break;
  }

  resultTitle.textContent = title;
  resultTitle.style.color = color;
  resultText.textContent = text;

  // Karar geçmişini göster
  let logHTML = "<h4>Karar Geçmişi:</h4><ul>";
  decisionLog.forEach((log) => {
    logHTML += `<li>[${(log.time / 1000).toFixed(1)}s] ${log.description}</li>`;
  });
  logHTML += "</ul>";
  logText.innerHTML = logHTML;

  console.log("=== SENARYO SONU ===");
  console.log(`Sonuç: ${result}`);

  // Kontrolleri serbest bırak
  if (controls) controls.unlock();

  // CSV Raporunu Otomatik İndir
  setTimeout(() => {
    try {
      const finalResultText = title + " - " + text;
      exportToCSV(totalTime, userScore, finalResultText);
      console.log("📊 Rapor indiriliyor...");
    } catch (e) {
      console.error("Rapor oluşturma hatası:", e);
    }
  }, 500); // 0.5sn bekleme
}

// Ses sistemi - Web Audio API ile basit alarm sesi
let audioContext;
let alarmAudio = null;

// Global alarm durdurma fonksiyonu
window.stopAlarmSound = function () {
  if (alarmAudio) {
    alarmAudio.pause();
    alarmAudio.currentTime = 0;
    console.log("🔇 Alarm sesi durduruldu");
  }
};

function initAudio() {
  console.log("✓ Alarm ses sistemi hazır");
}

// ----------------- CSV EXPORT ------------------------

function exportToCSV(totalTime, score, resultText) {
  // Kullanıcı bilgisini al
  const user = window.userData || { name: "Bilinmeyen", surname: "Kullanıcı", startTime: new Date().toLocaleString() };

  // Excel'in sayıları "tarih" gibi otomatik biçimlendirmesini engellemek için
  // zamanı metin olarak yazdırıyoruz (örn: 00:12.3).
  function formatElapsedTime(seconds) {
    const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const totalSecondsInt = Math.floor(safeSeconds);
    const tenths = Math.floor((safeSeconds - totalSecondsInt) * 10 + 1e-9); // 0-9

    const mins = Math.floor(totalSecondsInt / 60);
    const secs = totalSecondsInt % 60;

    const mm = String(mins).padStart(2, "0");
    const ss = String(secs).padStart(2, "0");
    return `${mm}:${ss}.${tenths}`;
  }

  // CSV İçeriği Oluştur
  let csvContent = "\uFEFF"; // UTF-8 BOM (Excel için Türkçe karakter desteği)
  csvContent += "Yangın Eğitimi Simülasyon Raporu\n";
  csvContent += "--------------------------------\n";
  csvContent += `Ad Soyad;${user.name} ${user.surname}\n`;
  csvContent += `Tarih;${user.startTime}\n`;
  csvContent += `Toplam Süre;${totalTime} saniye\n`;
  csvContent += `Puan;${score}\n`;
  csvContent += `Sonuç;${resultText.replace(/\n/g, " ")}\n\n`;

  csvContent += "--------------------------------\n";
  csvContent += "DETAYLI HAREKET DÖKÜMÜ\n";
  csvContent += "Zaman (mm:ss.s);Eylem;Açıklama\n";

  // Logları ekle
  decisionLog.forEach(log => {
    // CSV formatına uygun hale getir (noktalı virgül çakışmasını önle)
    const timeSeconds = typeof log.time === 'number' ? (log.time / 1000) : Number(log.time);
    const timeFormatted = formatElapsedTime(timeSeconds);
    // Başına apostrof koyarak Excel'de "metin" kalmasını sağla (tarih/sayıya dönmesin)
    const time = `'${timeFormatted}`;
    const desc = log.description.replace(/;/g, ",");
    csvContent += `${time};${log.action};${desc}\n`;
  });

  // Dosya İndirme İşlemi
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  // Dosya adı: Ad_Soyad_Tarih.csv
  const dateStr = new Date().toISOString().slice(0, 10);
  link.setAttribute("href", url);
  link.setAttribute("download", `Egitim_Raporu_${user.name}_${user.surname}_${dateStr}.csv`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ----------------- GUI ------------------------

function addGUI() {
  if (guiEnable) {
    gui = new GUI();
    guiCam = gui.addFolder("FireAR");

    // guiCam.add( guiObject, 'value1', 1, textureCount, 1 ).name('Texture');
    // guiCam.add( guiObject, 'value2', 0, 1 ).name('Box Brightness');
    guiCam.add(guiObject, "value3", 0, 10).name("Sahne Parlaklığı");
    // guiCam.add( guiObject, 'value4', 0, 1 ).name('Camera Damping');
    guiCam.addColor(guiObject, "color", 255).name("Zemin Rengi");
    guiCam.add(guiObject, "fireBoolean").name("🔥 Yangın");
    guiCam.add(guiObject, "smokeBoolean").name("💨 Duman");
    // Yangın söndürücü kontrolü kaldırıldı - artık kola tıklayarak aktif edilecek
    // guiCam.add(guiObject, "feBoolean").name("🧯 Yangın Söndürücü");
    guiCam.add(guiObject, "pauseBoolean").name("⏸ Duraklat");

    gui.onChange((event) => {
      console.log(event.property);
      // FE animasyonu artık kola tıklayarak kontrol edilecek
      // if (event.property == "feBoolean" && guiObject.feBoolean == true)
      //   playFeAnimations();
      // else stopFeAnimations();
    });
  }
}

// ----------------- Stats ---------------------

const stats = () => {
  if (statsEnable) {
    const stats1 = new Stats();
    stats1.showPanel(0);
    const stats2 = new Stats();
    stats2.showPanel(1);
    stats2.dom.style.cssText = "position:absolute;top:0px;left:80px;";
    const stats3 = new Stats();
    stats3.showPanel(2);
    stats3.dom.style.cssText = "position:absolute;top:0px;left:160px;";
    document.body.appendChild(stats1.dom);
    document.body.appendChild(stats2.dom);
    document.body.appendChild(stats3.dom);

    function statsUpdate() {
      requestAnimationFrame(statsUpdate);
      stats1.update();
      stats2.update();
      stats3.update();
    }
    statsUpdate();
  }
};
stats();

// createFireHitbox removed

function animate() {
  requestAnimationFrame(animate);

  deltaTime = clock.getDelta();

  controls.update();
  controls.dampingFactor = guiObject.value4;

  // WASD ile birinci şahıs hareket güncellemesi
  updateFirstPersonMovement(deltaTime);

  updateInteraction();

  // --- DEPREM SARSINTISI ---
  let shakeOffset = new THREE.Vector3();
  let rollOffset = 0;

  if (isQuakeActive && !scenarioEnded) {
    quakeTime += deltaTime;
    
    // Güvenli alanda olma durumunu kaydet (Sadece masa altı ve çömelik)
    const isUnderDeskNow = 
      camera.position.x > -0.5 && camera.position.x < 1.5 &&
      camera.position.z > -2.5 && camera.position.z < -0.5;

    if (isUnderDeskNow && isCrouched) {
      window.userIsSafe = true;
    }

    // Sarsıntı şiddeti (ilk 3 saniye artar, sonra sabit kalır, 20 sn sonra biter)
    if (quakeTime < 3) {
      quakeIntensity = quakeTime / 3;
    } else if (quakeTime > 20) {
      quakeIntensity = Math.max(0, 1 - (quakeTime - 20) / 5);
      if (quakeIntensity === 0 && !scenarioEnded) {
        if (!isCrouched) {
          endScenario("failed_standing");
        } else if (!isUnderDeskNow) {
          endScenario("failed_not_under_desk");
        } else {
          endScenario("success");
        }
      }
    } else {
      quakeIntensity = 1.0;
    }

    // Eşya Animasyonları
    if (quakeTime > 1) {
      if (room) {
        room.children.forEach(child => {
          // Saksı bitkisi devriliyor
          if (child.name && child.name.toLowerCase() === "plant") {
             child.rotation.x = THREE.MathUtils.lerp(child.rotation.x, Math.PI / 2, 0.05);
          }
          // Sandalyeler sadece sarsılıyor
          if (child.name && child.name.toLowerCase().includes("chair")) {
             child.rotation.z = (Math.random() - 0.5) * 0.1 * quakeIntensity;
             child.rotation.x = (Math.random() - 0.5) * 0.1 * quakeIntensity;
          }
        });
      }
    }

    // Kullanıcı güvendeyse (masa altındaysa) bilgisayarı düşür
    if (window.userIsSafe || quakeTime > 15) {
      if (window.computerEquipment) {
        if (window.computerEquipment.monitor) {
          window.computerEquipment.monitor.rotation.x = THREE.MathUtils.lerp(window.computerEquipment.monitor.rotation.x, -Math.PI / 2, 0.1);
          window.computerEquipment.monitor.position.y = THREE.MathUtils.lerp(window.computerEquipment.monitor.position.y, 0.0, 0.1);
        }
        if (window.computerEquipment.keyboard) {
          window.computerEquipment.keyboard.rotation.z = THREE.MathUtils.lerp(window.computerEquipment.keyboard.rotation.z, Math.PI / 4, 0.15);
          window.computerEquipment.keyboard.position.y = THREE.MathUtils.lerp(window.computerEquipment.keyboard.position.y, 0, 0.15);
        }
      }
    }

    // Kamera Sarsıntısı - Render öncesi offset
    if (quakeIntensity > 0) {
      const t = Date.now() * 0.035; // Sarsıntı frekansı (hız)
      shakeOffset.set(
        Math.sin(t * 1.1) * 0.125 * quakeIntensity,
        Math.cos(t * 1.3) * 0.075 * quakeIntensity,
        Math.sin(t * 0.9) * 0.125 * quakeIntensity
      );
      rollOffset = Math.sin(t * 1.5) * 0.04 * quakeIntensity;
      
      camera.position.add(shakeOffset);
      camera.rotation.z += rollOffset;
    }
  }

  renderer.render(scene, camera);

  // Render bittikten sonra kamerayı eski yerine al ki kalıcı kaymalar (drift) olmasın
  if (isQuakeActive && quakeIntensity > 0 && !scenarioEnded) {
    camera.position.sub(shakeOffset);
    camera.rotation.z -= rollOffset;
  }

  // Durum güncelleme
  if (isQuakeActive) {
    updateStatus();
  }

  // Zamanlayıcıyı göster (sadece senaryo devam ederken)
  if (timerStarted && !scenarioEnded) {
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const timerDiv = document.getElementById("timer");
    if (timerDiv) {
      timerDiv.textContent = `⏱️ Geçen Süre: ${elapsedTime}s`;

      // Renk değişimi - süreye göre
      if (elapsedTime < 10) {
        timerDiv.style.color = "#00ff00";
      } else if (elapsedTime < 20) {
        timerDiv.style.color = "#ffaa00";
      } else {
        timerDiv.style.color = "#ff0000";
      }
    }
  }

  // Hands Visibility Update
  if (handsGroup) {
    handsGroup.visible = true;
    // Basit sallanma
    if (moveState.forward || moveState.backward || moveState.left || moveState.right) {
      const time = Date.now() * 0.005;
      handsGroup.position.y = Math.sin(time) * 0.01;
      handsGroup.position.x = Math.cos(time * 0.5) * 0.005;
    } else {
      const time = Date.now() * 0.001;
      handsGroup.position.y = Math.sin(time) * 0.005;
    }
  }

  renderer.toneMappingExposure = guiObject.value3;
}

// ==================== ODA TURU ====================
let tourOverlay;

function showTourMessage(text, duration = 3000) {
  if (!tourOverlay) {
    tourOverlay = document.createElement("div");
    tourOverlay.style.position = "fixed";
    tourOverlay.style.bottom = "20%";
    tourOverlay.style.left = "50%";
    tourOverlay.style.transform = "translate(-50%, 0)";
    tourOverlay.style.backgroundColor = "rgba(0,0,0,0.8)";
    tourOverlay.style.color = "#00ff00";
    tourOverlay.style.padding = "20px 40px";
    tourOverlay.style.fontSize = "24px";
    tourOverlay.style.fontWeight = "bold";
    tourOverlay.style.borderRadius = "15px";
    tourOverlay.style.border = "2px solid #00ff00";
    tourOverlay.style.textAlign = "center";
    tourOverlay.style.zIndex = "10000";
    tourOverlay.style.transition = "opacity 0.5s";
    tourOverlay.style.pointerEvents = "none";
    document.body.appendChild(tourOverlay);
  }

  tourOverlay.textContent = text;
  tourOverlay.style.opacity = "1";
}

function hideTourMessage() {
  if (tourOverlay) tourOverlay.style.opacity = "0";
}

function tweenCameraLookAt(targetPos, targetLookAt, duration) {
  return new Promise((resolve) => {
    const startPos = camera.position.clone();

    // Mevcut bakış yönünü bul
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(camera.quaternion);
    const startLookAt = startPos.clone().add(forward.multiplyScalar(2)); // 2m ileriye bakıyor varsayalım

    const startTime = Date.now();

    function update() {
      const now = Date.now();
      let progress = (now - startTime) / duration;
      if (progress > 1) progress = 1;

      // Ease in out quadratic
      const ease =
        progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      // Pozisyon enterpolasyonu
      camera.position.lerpVectors(startPos, targetPos, ease);

      // Bakış enterpolasyonu
      const currentLook = new THREE.Vector3().lerpVectors(
        startLookAt,
        targetLookAt,
        ease
      );
      camera.lookAt(currentLook);

      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        resolve();
      }
    }
    update();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runRoomTour() {
  console.log("🎬 Otomatik oda turu başlıyor...");

  // Kontrolleri kapalı tut
  if (controls) controls.unlock();

  const initialPos = new THREE.Vector3(0, 1.6, 2.0); // Başlangıç
  const centerPos = new THREE.Vector3(0, 1.6, 0.5); // Merkeze yakın

  const targets = [
    {
      // 1. Masa ve "Güvenli Alan"
      pos: centerPos,
      look: new THREE.Vector3(0.7, 0.5, -1.5),
      text: "🪑 Masanın altı, deprem anında sığınabileceğiniz iyi bir Güvenli Alandır.",
      wait: 3500,
    },
    {
      // 2. Çıkış Kapısı
      pos: new THREE.Vector3(0, 1.6, 0), // Biraz daha öne gel
      look: new THREE.Vector3(0, 1.5, 3.0), // Kapıya doğru
      text: "🚪 Sarsıntı geçtikten ve tehlike bittikten sonra kapıdan çıkıp binayı tahliye edin.",
      wait: 3500,
    },
  ];

  for (const target of targets) {
    showTourMessage(target.text);
    await tweenCameraLookAt(target.pos, target.look, 1500); // 1.5 sn hareket
    await sleep(target.wait); // Bekle
  }

  // Başa dön
  hideTourMessage();
  showTourMessage("✅ Simülasyon Başlıyor! Hazır olun...", 2000);

  // Başlangıç pozisyonuna dön
  await tweenCameraLookAt(initialPos, new THREE.Vector3(0, 1.6, -2.0), 1500);

  await sleep(1000);
  hideTourMessage();

  // Başla butonunu göster
  const startBtn = document.getElementById("startScenarioBtn");
  if (startBtn) {
    startBtn.style.display = "block";

    // Butonu vurgula
    startBtn.style.transform = "translate(-50%, -50%) scale(1.1)";
    startBtn.style.transition = "transform 0.5s";
    setTimeout(() => {
      startBtn.style.transform = "translate(-50%, -50%) scale(1.0)";
    }, 500);
  }
}

// Senaryo başlatıcı
function startScenario() {
  // Başlat butonunu hemen gizle
  const startBtn = document.getElementById("startScenarioBtn");
  if (startBtn) {
    startBtn.style.display = "none";
  }

  // İmleci HEMEN kilitle (Tarayıcı politikası gereği, setTimeout içinde olamaz)
  if (controls && !controls.isLocked) {
    controls.lock();
  }

  // Senaryo talimat penceresini otomatik kapat
  const instructionsDiv = document.getElementById("instructions");
  if (instructionsDiv && !instructionsDiv.classList.contains("collapsed")) {
    instructionsDiv.classList.add("collapsed");
  }

  // Yangın durumu penceresinde uyarı göster
  const statusDiv = document.getElementById("fireStatus");
  if (statusDiv) {
    statusDiv.textContent = "🚪 Ofise giriyorsunuz...";
    statusDiv.style.color = "#ffffff";
    statusDiv.style.borderColor = "#ffffff";
  }

  setTimeout(() => {
    if (statusDiv) {
      statusDiv.textContent = "Sarsıntı bekliyor...";
      statusDiv.style.color = "#ffff00";
      statusDiv.style.borderColor = "#ffff00";
      statusDiv.style.animation = "pulse 0.5s infinite";
    }

    startEarthquake();

    // Zamanlayıcıyı göster
    const timerDiv = document.getElementById("timer");
    if (timerDiv) {
      timerDiv.style.display = "block";
    }

    // Crosshair göster
    const crosshair = document.getElementById("crosshair");
    if (crosshair) {
      crosshair.style.display = "block";
    }
  }, 2000);
}

// Global fonksiyonları export et
window.fireSimulation = {
  startScenario: startScenario,
  runRoomTour: runRoomTour,
};

// Sayfa yüklendiğinde Kontrol Bilgilendirme Ekranını göster
window.addEventListener("load", () => {
  setTimeout(() => {
    // Kontrolleri serbest bırak (Mouse görünsün)
    if (controls) controls.unlock();

    // Önce Kullanım Kılavuzu Ekranını Göster
    const controlsIntro = document.getElementById("controls-intro");
    if (controlsIntro) {
      controlsIntro.style.display = "block";
    }
  }, 1000);
});

// Etkileşim kontrolü (her karede çalışır)
function updateInteraction() {
  if (!controls.isLocked) {
    if (interactionHintDiv) interactionHintDiv.style.display = 'none';
    return;
  }

  const raycaster = new THREE.Raycaster();
  // Ekranın tam ortasından ray at
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  let foundInteractable = null;
  let hintText = "";

  // 1. Sahne objelerini kontrol et (Kapı vs.)
  if (room) {
    const intersects = raycaster.intersectObjects(room.children, true);
    if (intersects.length > 0) {
      // En yakın objeyi al
      const object = intersects[0].object;

      // Mesafe kontrolü
      if (intersects[0].distance < 3.0) { // 3 metre etkileşim mesafesi
        if (object.name === "Door") {
          foundInteractable = object;
          const actionText = window.isDoorOpen ? "KAPATMAK" : "AÇMAK";
          hintText = `🚪 KAPIYI ${actionText} İÇİN [E]`;
        }
      }
    }
  }

  // Durumu güncelle
  currentInteractable = foundInteractable;

  // UI Güncelleme
  // Hint div'i henüz oluşturulmadıysa oluştur
  if (!interactionHintDiv) {
    interactionHintDiv = document.createElement('div');
    interactionHintDiv.style.position = 'fixed';
    interactionHintDiv.style.top = '55%'; // Ortadan biraz aşağıda
    interactionHintDiv.style.left = '50%';
    interactionHintDiv.style.transform = 'translate(-50%, -50%)';
    interactionHintDiv.style.color = '#ffffff';
    interactionHintDiv.style.fontFamily = 'Arial, sans-serif';
    interactionHintDiv.style.fontSize = '18px';
    interactionHintDiv.style.fontWeight = 'bold';
    interactionHintDiv.style.textShadow = '0px 0px 5px #000000';
    interactionHintDiv.style.pointerEvents = 'none';
    interactionHintDiv.style.display = 'none';
    interactionHintDiv.style.zIndex = '1000';
    document.body.appendChild(interactionHintDiv);
  }

  if (currentInteractable) {
    interactionHintDiv.textContent = hintText;
    interactionHintDiv.style.display = 'block';
    const crosshair = document.getElementById("crosshair");
    if (crosshair) crosshair.style.backgroundColor = "rgba(255, 255, 0, 0.9)";
  } else {
    interactionHintDiv.style.display = 'none';
    const crosshair = document.getElementById("crosshair");
    if (crosshair) crosshair.style.backgroundColor = "rgba(255, 255, 255, 0.8)";
  }
}
