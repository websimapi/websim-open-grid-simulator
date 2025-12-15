import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import nipplejs from 'nipplejs';
import { Avatar } from './avatar.js';

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
        this.scene.fog = new THREE.FogExp2(0x050510, 0.002); 

        // Camera Rig (for VR compatibility)
        this.userRig = new THREE.Group();
        this.userRig.position.set(0, 0, 0);
        this.scene.add(this.userRig);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.camera.position.set(0, this.playerHeight, 0); 
        this.userRig.add(this.camera);

        // WebGL Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.xr.enabled = true; 
        this.container.appendChild(this.renderer.domElement);

        // VR Setup
        document.body.appendChild(VRButton.createButton(this.renderer));
        this.setupVRControllers();

        // Avatar
        this.avatar = new Avatar(this.userRig);

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

        // Grid Helper
        this.gridHelper = new THREE.GridHelper(2000, 200, 0x333333, 0x111111);
        this.scene.add(this.gridHelper);

        // Events
        window.addEventListener('resize', this.onWindowResize.bind(this));
        window.addEventListener('keydown', (e) => this.handleKey(e, true));
        window.addEventListener('keyup', (e) => this.handleKey(e, false));

        this.setupMobileControls();
        
        this.renderer.setAnimationLoop(this.animate.bind(this));
    }

    setupVRControllers() {
        // Factories
        const handModelFactory = new XRHandModelFactory();
        const controllerModelFactory = new XRControllerModelFactory();

        // Hand 0 (Left usually)
        this.hand0 = this.renderer.xr.getHand(0);
        this.hand0.userData.handedness = 'left'; 
        this.hand0.addEventListener('connected', (e) => this.hand0.userData.handedness = e.data.handedness);
        this.hand0.add(handModelFactory.createHandModel(this.hand0, 'mesh')); // 'mesh' or 'boxes'
        this.userRig.add(this.hand0);

        // Hand 1 (Right usually)
        this.hand1 = this.renderer.xr.getHand(1);
        this.hand1.userData.handedness = 'right';
        this.hand1.addEventListener('connected', (e) => this.hand1.userData.handedness = e.data.handedness);
        this.hand1.add(handModelFactory.createHandModel(this.hand1, 'mesh'));
        this.userRig.add(this.hand1);

        // Controllers (Fallback / Raycasting)
        this.controller0 = this.renderer.xr.getController(0);
        this.controller0.add(controllerModelFactory.createControllerModel(this.controller0));
        this.userRig.add(this.controller0);

        this.controller1 = this.renderer.xr.getController(1);
        this.controller1.add(controllerModelFactory.createControllerModel(this.controller1));
        this.userRig.add(this.controller1);
        
        // Hide controller models if hands are active?
        // XRHandModelFactory handles visibility automatically usually.
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
            // Move UserRig
            this.userRig.position.add(new THREE.Vector3(direction.x * 0.016, 0, direction.z * 0.016));
            
            // Desktop Hand Animation (Bobbing)
            if (!this.renderer.xr.isPresenting) {
                this.simulatedHandBob = (Date.now() / 200);
            }
        } else {
             this.simulatedHandBob = 0;
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
    
    updateAvatar() {
        // Collect hand data for avatar
        let hands = [];
        
        if (this.renderer.xr.isPresenting) {
            // Use VR Hands
            hands = [this.hand0, this.hand1];
        } else {
            // Desktop Simulation
            // Create dummy hand objects that follow camera
            const time = Date.now() * 0.003;
            const bob = Math.sin(this.simulatedHandBob || 0) * 0.1;
            
            // Left Hand
            const lPos = new THREE.Vector3(-0.25, 1.3 + bob, 0.4).applyMatrix4(this.userRig.matrixWorld);
            lPos.add(this.camera.position.clone().multiplyScalar(0)); // Static relative to userRig for now, just walking animation
            // Better: relative to camera? 
            // Let's make them floating in front of body.
            
            const headPos = this.camera.position.clone(); // Local to Rig
            // Rig is at 0,0,0 relative to Rig.
            // We need world pos for IK targets? 
            // My avatar uses world space IK targets (because tracked hands are in world space/userRig space).
            // UserRig is parent of avatar.
            // So if I pass Local UserRig coordinates, it works if Avatar assumes UserRig Space?
            // Wait, Avatar.root is added to UserRig.
            // Avatar.solveIK uses `getWorldPosition`.
            // So I should pass World Position targets.
            
            const lHandWorld = this.userRig.localToWorld(new THREE.Vector3(-0.2, 1.0 + bob, 0.3).add(headPos));
            // Actually headPos is already varying.
            
            const rHandWorld = this.userRig.localToWorld(new THREE.Vector3(0.2, 1.0 - bob, 0.3).add(headPos));

            // Create fake objects
            const lHand = { position: lHandWorld, quaternion: this.camera.quaternion, userData: { handedness: 'left' }, children: [] };
            const rHand = { position: rHandWorld, quaternion: this.camera.quaternion, userData: { handedness: 'right' }, children: [] };
            
            hands = [lHand, rHand];
        }

        // Update Avatar
        // Head Pos/Rot in World Space?
        // Avatar is child of UserRig.
        // update expects positions.
        // Let's pass Local positions if Avatar is in UserRig?
        // Avatar.solveIK uses getWorldPosition. So we should pass World Positions.
        
        const headWorldPos = new THREE.Vector3();
        this.camera.getWorldPosition(headWorldPos);
        const headWorldRot = new THREE.Quaternion();
        this.camera.getWorldQuaternion(headWorldRot);
        
        this.avatar.update(0.016, headWorldPos, headWorldRot, hands);
    }

    animate() {
        this.movePlayer();
        this.updateAvatar();
        this.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);
    }
}