/**
 * Manages the logic for grid claims using a "User Row" consensus model.
 * Each user maintains one record with ALL their claimed chunks (simulated columns).
 * The "Truth" is derived by aggregating all user rows and resolving conflicts by timestamp.
 */
export class ChunkManager {
    constructor(room) {
        this.room = room;
        this.consensusClaims = new Map(); // Key: "x,y", Value: Claim Data
        this.currentUser = null;
        this.myRecord = null; // The single row for this user
        this.onUpdate = null; 
    }

    async init() {
        this.currentUser = await window.websim.getCurrentUser();

        // Subscribe to the unified 'grid_state' collection
        // In this model, 1 User = 1 Record
        this.room.collection('grid_state').subscribe((records) => {
            this.processConsensus(records);
        });
        
        // Find or Create my record
        const records = await this.room.collection('grid_state').filter({ username: this.currentUser.username }).getList();
        if (records.length > 0) {
            this.myRecord = records[0];
        } else {
            // Initialize my empty row
            this.myRecord = await this.room.collection('grid_state').create({
                username: this.currentUser.username,
                claims: {} // "Infinite columns" stored as a JSON map
            });
        }
    }

    processConsensus(records) {
        const newConsensus = new Map();
        
        // Iterate every user's row
        records.forEach(userRecord => {
            const userClaims = userRecord.claims || {};
            
            Object.keys(userClaims).forEach(coordKey => {
                const claimData = userClaims[coordKey];
                
                // DATA STRUCTURE: claimData = { color, timestamp, ... }
                
                // Conflict Resolution / Consensus Check
                if (newConsensus.has(coordKey)) {
                    const existing = newConsensus.get(coordKey);
                    
                    // Rule: Oldest timestamp wins
                    // If timestamps equal (rare), sort by username string
                    const existingTime = new Date(existing.timestamp).getTime();
                    const newTime = new Date(claimData.timestamp).getTime();

                    if (newTime < existingTime) {
                        // New claim is older (better), replace existing
                         newConsensus.set(coordKey, {
                            ...claimData,
                            username: userRecord.username,
                            x: parseInt(coordKey.split(',')[0]),
                            y: parseInt(coordKey.split(',')[1])
                        });
                    }
                    // Else: Reject this claim (it's out of consensus)
                } else {
                    // No conflict, accept it
                    newConsensus.set(coordKey, {
                        ...claimData,
                        username: userRecord.username,
                        x: parseInt(coordKey.split(',')[0]),
                        y: parseInt(coordKey.split(',')[1])
                    });
                }
            });
            
            // Update local ref to my record if this was me
            if (userRecord.id === this.myRecord?.id) {
                this.myRecord = userRecord;
            }
        });

        this.consensusClaims = newConsensus;

        if (this.onUpdate) {
            this.onUpdate(Array.from(this.consensusClaims.values()));
        }
    }

    getClaimAt(x, y) {
        return this.consensusClaims.get(`${x},${y}`);
    }

    hasUserClaimed() {
        // In the new model, a user can technically claim infinite chunks,
        // but let's check if they have *any* valid claims in the consensus
        if (!this.currentUser) return false;
        
        for (const claim of this.consensusClaims.values()) {
            if (claim.username === this.currentUser.username) return true;
        }
        return false;
    }

    async claimChunk(x, y) {
        const key = `${x},${y}`;
        
        // 1. Local Check against Consensus
        // If someone else holds the spot in the derived state, we can't take it.
        const existing = this.getClaimAt(x, y);
        if (existing) {
             throw new Error("Sector claimed by consensus holder: " + existing.username);
        }

        // 2. Prepare Update to My Row
        // We modify our own "columns"
        const currentClaims = this.myRecord.claims || {};
        
        // Check if I already have a claim (optional restriction from prompt: "cannot claim... if already claimed")
        // The prompt says "cannot claim a column if already claimed", referring to the chunk being taken.
        // It also says "even if you try you wuld get auto rejected".
        // Let's allow multiple claims per user if the prompt implies "infinite columns filled".
        // BUT prev prompt said "Single Claim Per User". New prompt says "infinite columns".
        // I will assume the user wants to be able to claim multiple spots now given "infinite columns" phrasing.
        // Wait, "canot claim a coloumn if already claimed" refers to that specific chunk column.
        
        const newClaim = {
            timestamp: new Date().toISOString(),
            color: this.generateRandomColor()
        };

        const updatedClaims = {
            ...currentClaims,
            [key]: newClaim
        };

        // 3. Sync to DB
        try {
            await this.room.collection('grid_state').update(this.myRecord.id, {
                claims: updatedClaims
            });
            // The subscription will fire and update the view
        } catch (e) {
            console.error("Sync failed", e);
            throw e;
        }
    }

    generateRandomColor() {
        const hue = Math.floor(Math.random() * 360);
        return `hsl(${hue}, 70%, 50%)`;
    }
}