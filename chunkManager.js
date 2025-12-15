/**
 * Manages the logic for grid claims and database synchronization.
 * Enforces the Single Claim Per User Constraint.
 */
export class ChunkManager {
    constructor(room) {
        this.room = room;
        this.claims = new Map(); // Key: "x,y", Value: Record
        this.userClaimId = null; // ID of the claim owned by current user
        this.currentUser = null;
        this.onUpdate = null; // Callback for renderer
    }

    async init() {
        this.currentUser = await window.websim.getCurrentUser();

        // Subscribe to the land_claims collection
        this.room.collection('land_claims').subscribe((records) => {
            this.processUpdates(records);
        });
    }

    processUpdates(records) {
        this.claims.clear();
        this.userClaimId = null;

        records.forEach(record => {
            const key = `${record.x},${record.y}`;
            this.claims.set(key, record);

            // Check if this record belongs to the current user
            if (record.username === this.currentUser.username) {
                this.userClaimId = record.id;
            }
        });

        if (this.onUpdate) {
            this.onUpdate(Array.from(this.claims.values()));
        }
    }

    getClaimAt(x, y) {
        return this.claims.get(`${x},${y}`);
    }

    hasUserClaimed() {
        return this.userClaimId !== null;
    }

    async claimChunk(x, y) {
        // Validation 1: Is chunk taken?
        if (this.getClaimAt(x, y)) {
            throw new Error("This sector is already claimed.");
        }

        // Validation 2: Does user already have a claim?
        if (this.hasUserClaimed()) {
            throw new Error("You can only claim one sector.");
        }

        // Create the claim
        try {
            await this.room.collection('land_claims').create({
                x: x,
                y: y,
                claimed_at: new Date().toISOString(),
                color: this.generateRandomColor() 
            });
            return true;
        } catch (e) {
            console.error("Claim failed", e);
            throw e;
        }
    }

    // Generate a sci-fi pastel color
    generateRandomColor() {
        const hue = Math.floor(Math.random() * 360);
        return `hsl(${hue}, 70%, 50%)`;
    }
}