import * as THREE from 'three';

export class Avatar {
    constructor(parentGroup) {
        this.root = new THREE.Group();
        parentGroup.add(this.root);

        // Materials
        this.matBody = new THREE.MeshStandardMaterial({ 
            color: 0x00aaff, 
            roughness: 0.4, 
            metalness: 0.6,
            emissive: 0x001133,
            emissiveIntensity: 0.2
        });

        this.matJoint = new THREE.MeshStandardMaterial({ 
            color: 0x222222, 
            roughness: 0.8 
        });

        this.arms = {};
        this.buildRig();
    }

    buildRig() {
        // Torso Group (Pivots at hips)
        this.torso = new THREE.Group();
        this.root.add(this.torso);

        // Chest
        const chest = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.45, 0.18), this.matBody);
        chest.position.y = 1.35;
        this.torso.add(chest);

        // Hips/Belt
        const hip = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.16), this.matJoint);
        hip.position.y = 1.05;
        this.torso.add(hip);

        // Head (Independent rotation)
        this.head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.25), this.matBody);
        this.head.position.y = 1.75;
        this.root.add(this.head); 

        // Visor
        const visor = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.05), new THREE.MeshStandardMaterial({color:0xff00cc, emissive:0xff00cc}));
        visor.position.set(0, 0, 0.11);
        this.head.add(visor);

        // Arms
        this.arms['left'] = this.createArm('left');
        this.arms['right'] = this.createArm('right');
    }

    createArm(sideName) {
        const isLeft = sideName === 'left';
        const side = isLeft ? -1 : 1;

        const armGroup = new THREE.Group();
        this.root.add(armGroup);

        // Shoulder Joint
        const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.08), this.matJoint);
        shoulder.position.set(side * 0.22, 1.5, 0);
        armGroup.add(shoulder);

        // Upper Arm (Child of Shoulder Position Group really, but here we pivot mesh)
        const upperArm = new THREE.Group();
        upperArm.position.copy(shoulder.position);
        armGroup.add(upperArm);

        const upperGeo = new THREE.CylinderGeometry(0.05, 0.04, 0.3, 8);
        upperGeo.translate(0, -0.15, 0); // Pivot at top
        const upperMesh = new THREE.Mesh(upperGeo, this.matBody);
        upperArm.add(upperMesh);

        // Lower Arm
        const lowerArm = new THREE.Group();
        lowerArm.position.y = -0.3; // Length of upper
        upperArm.add(lowerArm);

        const lowerGeo = new THREE.CylinderGeometry(0.04, 0.03, 0.3, 8);
        lowerGeo.translate(0, -0.15, 0);
        const lowerMesh = new THREE.Mesh(lowerGeo, this.matBody);
        lowerArm.add(lowerMesh);

        // Elbow
        const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.045), this.matJoint);
        lowerArm.add(elbow);

        // Hand Container
        const hand = new THREE.Group();
        hand.position.y = -0.3;
        lowerArm.add(hand);

        // Default Hand Mesh (Visible when not tracking fingers)
        const handMesh = new THREE.Group();
        hand.add(handMesh);

        const palm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.08), this.matBody);
        palm.position.y = -0.05;
        handMesh.add(palm);

        const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.02), this.matJoint);
        thumb.position.set(side * 0.04, -0.04, 0.03);
        thumb.rotation.z = side * -0.5;
        handMesh.add(thumb);

        return { 
            root: armGroup, 
            upper: upperArm, 
            lower: lowerArm, 
            hand: hand, 
            handMesh: handMesh,
            length: { upper: 0.3, lower: 0.3 } 
        };
    }

    update(dt, headPos, headRot, hands) {
        // 1. Sync Head
        this.head.position.copy(headPos);
        this.head.quaternion.copy(headRot);

        // 2. Sync Body
        // Body follows head position projected to floor (ish)
        // And rotates Y based on head look, but dampened ideally.
        // For now, instant snap to head yaw.
        const euler = new THREE.Euler().setFromQuaternion(headRot, 'YXZ');
        this.root.position.set(headPos.x, 0, headPos.z);
        this.torso.rotation.y = euler.y;

        // Offset Head Visuals if it's blocking camera?
        // Actually, for VR, the user's head IS the camera.
        // We might want to hide the head mesh for the local user to avoid clipping.
        // this.head.visible = false; // Self-hiding

        // 3. Update Arms
        hands.forEach(hand => {
            if (!hand) return;
            const handedness = hand.userData.handedness;
            const arm = this.arms[handedness];
            if (!arm) return;

            // Check if tracking active (mesh has children from Factory)
            // XRHandModelFactory adds a 'Mesh' or 'Group' with bones.
            // Usually the hand group itself has children if tracking.
            // Also if controllers are active, they have children.
            const isTracking = hand.children.length > 0;

            // If tracked, hide our blocky hand, let the factory model show
            arm.handMesh.visible = !isTracking;

            // IK Solve
            this.solveIK(arm, hand.position, hand.quaternion);
        });
    }

    solveIK(arm, targetPos, targetRot) {
        const shoulderPos = new THREE.Vector3();
        arm.root.children[0].getWorldPosition(shoulderPos); // Sphere pos

        const dist = shoulderPos.distanceTo(targetPos);
        const len1 = arm.length.upper;
        const len2 = arm.length.lower;

        // Clamp reach
        const reach = Math.min(dist, len1 + len2 - 0.001);

        // IK Angles
        const a = len1;
        const b = len2;
        const c = reach;

        // Elbow angle (interior)
        const cosElbow = (a*a + b*b - c*c) / (2*a*b);
        const angleElbow = Math.acos(Math.max(-1, Math.min(1, cosElbow)));

        // Shoulder angle (offset from aim vector)
        const cosShoulder = (a*a + c*c - b*b) / (2*a*c);
        const angleShoulder = Math.acos(Math.max(-1, Math.min(1, cosShoulder)));

        // 1. Point Upper Arm at Target
        arm.upper.lookAt(targetPos);
        // Align -Y (arm axis) to +Z (lookAt axis)
        arm.upper.rotateX(-Math.PI / 2);

        // 2. Apply Shoulder Bend (Away from target line)
        // We bend UP (local -X) or DOWN (+X)?
        // Defaulting to bending 'up' (elbows down/out)
        arm.upper.rotateX(-angleShoulder);

        // 3. Apply Elbow Bend
        arm.lower.rotation.x = Math.PI - angleElbow; 

        // 4. Align Hand Rotation
        // Calculate world rotation needed
        // targetRot is World Rotation.
        // We need to set arm.hand.quaternion (local)
        // q_world = parent_world * q_local
        // q_local = parent_world_inv * q_world

        const parentQ = new THREE.Quaternion();
        arm.lower.getWorldQuaternion(parentQ);
        const invParent = parentQ.clone().invert();

        const localQ = new THREE.Quaternion().multiplyQuaternions(invParent, targetRot);
        arm.hand.quaternion.copy(localQ);

        // Correction for hand model axis
        // If the hand model expects wrist to point -Z, but we built -Y.
        // We might need to rotate local.
        // Assuming XRHandModel matches controller space which is -Z forward.
        // Our arm chain ends pointing -Y.
        // So we rotate -90 X to align?
        arm.hand.rotateX(-Math.PI/2);
    }
}