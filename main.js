import { ChunkManager } from './chunkManager.js';
import { WorldRenderer } from './renderer.js';

const room = new WebsimSocket();

// UI Elements
const uiCoords = document.getElementById('coordinates');
const uiStatus = document.getElementById('chunk-status');
const uiOwner = document.getElementById('owner-info');
const btnClaim = document.getElementById('claim-btn');
const msgContainer = document.getElementById('messages');

let chunkManager;
let worldRenderer;

function showToast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    msgContainer.appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

function updateUI(chunkPos) {
    uiCoords.textContent = `Loc: ${chunkPos.x}, ${chunkPos.y}`;
    
    const claim = chunkManager.getClaimAt(chunkPos.x, chunkPos.y);
    const hasUserClaimed = chunkManager.hasUserClaimed();

    if (claim) {
        uiStatus.textContent = "Status: Occupied";
        uiStatus.style.color = "#ff6666";
        uiOwner.textContent = `Owner: ${claim.username}`;
        
        btnClaim.textContent = "Occupied";
        btnClaim.className = "";
        btnClaim.disabled = true;
    } else {
        uiStatus.textContent = "Status: Available";
        uiStatus.style.color = "#66ff66";
        uiOwner.textContent = "Owner: None";
        
        if (hasUserClaimed) {
            btnClaim.textContent = "Already Own Land";
            btnClaim.className = "";
            btnClaim.disabled = true;
        } else {
            btnClaim.textContent = "Claim Sector";
            btnClaim.className = "available";
            btnClaim.disabled = false;
        }
    }
}

async function main() {
    await room.initialize();

    chunkManager = new ChunkManager(room);
    await chunkManager.init();

    worldRenderer = new WorldRenderer(document.getElementById('game-container'), chunkManager);

    // Link Data to Visuals
    chunkManager.onUpdate = (claims) => {
        worldRenderer.updateClaims(claims);
        // Force UI refresh
        const pos = worldRenderer.currentChunk;
        updateUI(pos);
    };

    // Main Game Loop for UI updates (decoupled from render loop)
    setInterval(() => {
        const pos = worldRenderer.updateStats();
        updateUI(pos);
    }, 100);

    // Interaction
    btnClaim.addEventListener('click', async () => {
        const pos = worldRenderer.currentChunk;
        try {
            await chunkManager.claimChunk(pos.x, pos.y);
            showToast(`Sector (${pos.x}, ${pos.y}) claimed successfully!`);
            // UI updates automatically via subscription callback
        } catch (e) {
            showToast(e.message);
        }
    });
}

main().catch(console.error);