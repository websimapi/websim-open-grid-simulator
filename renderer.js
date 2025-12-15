import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import nipplejs from 'nipplejs';

export class WorldRenderer {
    constructor(container, chunkManager) {
        this.container = container;
        this.chunkManager = chunkManager;

        // Constants
        this.CHUNK_SIZE = 256; // 256 meters
        this.VIEW_DISTANCE = 3; // How many chunks out to see

        // State
        this.currentChunk = { x: 0, y: 0 };
        this.targetPos = new THREE.Vector3(0, 2, 0); // Start slightly above ground
        this.keys = { w: false, a: false, s: false, d: false };
        this.chunkMeshes = new Map(); // Key "x,y" -> Mesh

        this.init();
    }

    init() {
        // Scene Setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x050510);
        this.scene.fog = new THREE.FogExp2(0x050510, 0.0015);

        // Camera
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.camera.position.set(0, 100, 100);
        this.camera.lookAt(0, 0, 0);

        // WebGL Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);

        // Label Renderer (for text over chunks)
        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0px';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        this.container.appendChild(this.labelRenderer.domElement);

        // Lights
        const ambientLight = new THREE.AmbientLight(0x404040, 2);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(100, 200, 50);
        this.scene.add(dirLight);

        // Avatar (Simple Representation)
        const geometry = new THREE.CapsuleGeometry(1, 4, 4, 8);
        const material = new THREE.MeshBasicMaterial({ color: 0x00ffcc, wireframe: true });
        this.avatar = new THREE.Mesh(geometry, material);
        this.avatar.position.y = 2;
        this.scene.add(this.avatar);

        // Grid Helper (Visual floor for context)
        // Infinite grid illusion handled by moving a large grid helper
        this.gridHelper = new THREE.GridHelper(2000, 80, 0x333333, 0x111111);
        this.scene.add(this.gridHelper);

        // Events
        window.addEventListener('resize', this.onWindowResize.bind(this));
        window.addEventListener('keydown', (e) => this.handleKey(e, true));
        window.addEventListener('keyup', (e) => this.handleKey(e, false));

        this.setupMobileControls();
        this.animate();
    }

    setupMobileControls() {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (isMobile) {
            const zone = document.getElementById('mobile-zone');
            zone.style.display = 'block';
            this.joystick = nipplejs.create({
                zone: zone,
                mode: 'static',
                position: { left: '75px', bottom: '75px' },
                color: 'white'
            });

            this.joystick.on('move', (evt, data) => {
                if (data.vector) {
                    this.keys.w = data.vector.y > 0.3;
                    this.keys.s = data.vector.y < -0.3;
                    this.keys.a = data.vector.x < -0.3;
                    this.keys.d = data.vector.x > 0.3;
                }
            });

            this.joystick.on('end', () => {
                this.keys = { w: false, a: false, s: false, d: false };
            });
        }
    }

    handleKey(e, isDown) {
        const k = e.key.toLowerCase();
        if (this.keys.hasOwnProperty(k)) this.keys[k] = isDown;
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    }

    // Core logic to update the scene based on claims
    updateClaims(claims) {
        // Remove old claim visualizations
        this.chunkMeshes.forEach((mesh) => {
            this.scene.remove(mesh);
            if (mesh.userData.label) this.scene.remove(mesh.userData.label);
        });
        this.chunkMeshes.clear();

        // Add new claim visualizations
        claims.forEach(claim => {
            const size = this.CHUNK_SIZE - 2; // Slight gap
            const geometry = new THREE.PlaneGeometry(size, size);
            geometry.rotateX(-Math.PI / 2);

            const color = new THREE.Color(claim.color || 0x444444);
            const material = new THREE.MeshStandardMaterial({ 
                color: color, 
                roughness: 0.8,
                metalness: 0.2,
                transparent: true,
                opacity: 0.8
            });

            const mesh = new THREE.Mesh(geometry, material);

            // Position: Center of the chunk
            // Grid 0,0 is center of world.
            // Chunk 0,0 spans -128 to 128.
            const xPos = claim.x * this.CHUNK_SIZE;
            const zPos = claim.y * this.CHUNK_SIZE; // Y in DB is Z in 3D

            mesh.position.set(xPos, 0.1, zPos); // Slightly above 0 to avoid z-fighting with grid

            // Add Label
            const div = document.createElement('div');
            div.className = 'chunk-label';
            div.innerHTML = `${claim.username}'s Sim<br>(${claim.x}, ${claim.y})`;
            const label = new CSS2DObject(div);
            label.position.set(0, 50, 0);
            mesh.add(label);
            mesh.userData.label = label;

            this.scene.add(mesh);
            this.chunkMeshes.set(`${claim.x},${claim.y}`, mesh);
        });
    }

    movePlayer() {
        const speed = 2.0; // Meters per tick

        const direction = new THREE.Vector3();
        if (this.keys.w) direction.z -= 1;
        if (this.keys.s) direction.z += 1;
        if (this.keys.a) direction.x -= 1;
        if (this.keys.d) direction.x += 1;

        if (direction.length() > 0) {
            direction.normalize().multiplyScalar(speed);
            this.targetPos.add(direction);
        }

        // Smoothly move avatar to target
        this.avatar.position.lerp(this.targetPos, 0.1);

        // Camera Follow (Isometric-ish)
        this.camera.position.x = this.avatar.position.x + 100;
        this.camera.position.z = this.avatar.position.z + 100;
        this.camera.position.y = 150;
        this.camera.lookAt(this.avatar.position);

        // Move infinite grid helper to always be centered on player to create illusion
        // Snap to grid size to prevent jittering texture
        const snap = 100;
        this.gridHelper.position.x = Math.floor(this.avatar.position.x / snap) * snap;
        this.gridHelper.position.z = Math.floor(this.avatar.position.z / snap) * snap;
    }

    updateStats() {
        // Calculate current chunk coordinate
        // Range for chunk 0 is -128 to +128.
        // Formula: Rounding needs to handle negative numbers correctly for grid coords
        const cx = Math.floor((this.avatar.position.x + this.CHUNK_SIZE/2) / this.CHUNK_SIZE);
        const cy = Math.floor((this.avatar.position.z + this.CHUNK_SIZE/2) / this.CHUNK_SIZE);

        if (cx !== this.currentChunk.x || cy !== this.currentChunk.y) {
            this.currentChunk = { x: cx, y: cy };
        }

        return this.currentChunk;
    }

    animate() {
        requestAnimationFrame(this.animate.bind(this));

        this.movePlayer();
        this.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);
    }
}