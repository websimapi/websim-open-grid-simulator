import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import nipplejs from 'nipplejs';

export class WorldRenderer {
    constructor(container, chunkManager) {
        this.container = container;
        this.chunkManager = chunkManager;

        // Constants
        this.CHUNK_SIZE = 256; 
        this.VIEW_DISTANCE = 3; 

        // State
        this.currentChunk = { x: 0, y: 0 };
        this.keys = { w: false, a: false, s: false, d: false };
        this.chunkMeshes = new Map(); 

        // Player State
        this.playerHeight = 1.7; // Human height (meters)
        this.walkSpeed = 1.4; // Realistic walking speed (m/s)
        this.velocity = new THREE.Vector3();

        this.init();
    }

    init() {
        // Scene Setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x050510);
        this.scene.fog = new THREE.FogExp2(0x050510, 0.002); // Thicker fog for scale

        // Camera Rig (for VR compatibility)
        this.userRig = new THREE.Group();
        this.userRig.position.set(0, 0, 0);
        this.scene.add(this.userRig);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.camera.position.set(0, this.playerHeight, 0); // Eye level local to rig
        this.userRig.add(this.camera);

        // WebGL Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.xr.enabled = true; // Enable VR
        this.container.appendChild(this.renderer.domElement);

        // VR Button
        document.body.appendChild(VRButton.createButton(this.renderer));

        // Label Renderer
        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0px';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        this.container.appendChild(this.labelRenderer.domElement);

        // Lighting
        const ambientLight = new THREE.AmbientLight(0x404040, 1.5);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(100, 200, 50);
        this.scene.add(dirLight);

        // Grid Helper (Visual floor)
        this.gridHelper = new THREE.GridHelper(2000, 200, 0x333333, 0x111111);
        this.scene.add(this.gridHelper);

        // Events
        window.addEventListener('resize', this.onWindowResize.bind(this));
        window.addEventListener('keydown', (e) => this.handleKey(e, true));
        window.addEventListener('keyup', (e) => this.handleKey(e, false));

        this.setupMobileControls();
        
        // Use setAnimationLoop for VR compatibility
        this.renderer.setAnimationLoop(this.animate.bind(this));
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

    updateClaims(claims) {
        // Remove old
        this.chunkMeshes.forEach((mesh) => {
            this.scene.remove(mesh);
            if (mesh.userData.label) this.scene.remove(mesh.userData.label);
        });
        this.chunkMeshes.clear();

        // Add new
        claims.forEach(claim => {
            const size = this.CHUNK_SIZE - 2;
            const geometry = new THREE.PlaneGeometry(size, size);
            geometry.rotateX(-Math.PI / 2);

            const color = new THREE.Color(claim.color || 0x444444);
            const material = new THREE.MeshStandardMaterial({ 
                color: color, 
                roughness: 0.8,
                metalness: 0.2,
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide
            });

            const mesh = new THREE.Mesh(geometry, material);

            const xPos = claim.x * this.CHUNK_SIZE;
            const zPos = claim.y * this.CHUNK_SIZE;

            mesh.position.set(xPos, 0.05, zPos); 

            // Label
            const div = document.createElement('div');
            div.className = 'chunk-label';
            div.innerHTML = `${claim.username}<br>(${claim.x}, ${claim.y})`;
            const label = new CSS2DObject(div);
            label.position.set(0, 5, 0); // Low label
            mesh.add(label);
            mesh.userData.label = label;

            this.scene.add(mesh);
            this.chunkMeshes.set(`${claim.x},${claim.y}`, mesh);
        });
    }

    movePlayer() {
        // Determine direction based on camera facing
        const direction = new THREE.Vector3();
        
        // Get forward vector projected on XZ plane
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();

        const right = new THREE.Vector3();
        right.crossVectors(forward, new THREE.Vector3(0, 1, 0));

        if (this.keys.w) direction.add(forward);
        if (this.keys.s) direction.sub(forward);
        if (this.keys.a) direction.sub(right);
        if (this.keys.d) direction.add(right);

        if (direction.length() > 0) {
            direction.normalize().multiplyScalar(this.walkSpeed);
            // Move the rig, not the camera (camera moves with head in VR)
            this.userRig.position.add(new THREE.Vector3(direction.x * 0.016, 0, direction.z * 0.016));
        }

        // Infinite grid illusion
        const snap = 100;
        this.gridHelper.position.x = Math.floor(this.userRig.position.x / snap) * snap;
        this.gridHelper.position.z = Math.floor(this.userRig.position.z / snap) * snap;
    }

    updateStats() {
        const cx = Math.floor((this.userRig.position.x + this.CHUNK_SIZE/2) / this.CHUNK_SIZE);
        const cy = Math.floor((this.userRig.position.z + this.CHUNK_SIZE/2) / this.CHUNK_SIZE);

        if (cx !== this.currentChunk.x || cy !== this.currentChunk.y) {
            this.currentChunk = { x: cx, y: cy };
        }
        return this.currentChunk;
    }

    animate() {
        this.movePlayer();
        this.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);
    }
}