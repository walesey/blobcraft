# Blobcraft

![Blobcraft](blob.png)

A multiplayer browser-based RTS where you control blob units that eat enemies and NPCs to grow bigger and stronger. Destroy all enemy bases and units to win.

## How to Play

- **Select units**: Left-click a blob, or drag to box-select
- **Move**: Right-click empty ground
- **Attack**: Right-click an enemy blob or base
- **Attack-move**: Press `A`, then click a destination (blobs fight anything along the way)
- **Stop**: Press `S`
- **Select all**: `Ctrl+A`
- **Add to selection**: `Shift+click`
- **Pan camera**: Arrow keys or move mouse to screen edges
- **Minimap**: Click the minimap (bottom-right) to jump the camera

## Mechanics

- Your base spawns a baby blob every 3 seconds (max 50 units)
- Green NPC blobs are neutral — eat them to grow
- When two enemy blobs collide, a probability roll determines the winner based on relative size
- The winner absorbs 80% of the loser's mass
- Bigger blobs are stronger but move slower
- Destroy an opponent's base and all their units to eliminate them
- Last team standing wins

## Running the Server

```bash
npm install
npm start
```

The server starts on port 3000 by default. Set the `PORT` environment variable to change it:

```bash
PORT=8080 npm start
```

## Joining a Game

1. Start the server
2. Open `http://localhost:3000` in your browser
3. Share your LAN IP (e.g. `http://192.168.x.x:3000`) with friends on the same network
4. Up to 8 players can join — each gets a unique color and base position

## Combat Probability

Each blob's "mass" is its area (π × radius²). When two enemy blobs collide, the win probability is proportional to mass:

**P(A wins) = area_A / (area_A + area_B)**

For example, a blob with radius 10 (area ~314) fighting one with radius 5 (area ~78) has roughly an 80% chance of winning. Equal-sized blobs have a 50/50 chance. The winner absorbs 80% of the loser's mass.
