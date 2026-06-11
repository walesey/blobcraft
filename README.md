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

### Control Groups

- **Ctrl+0–9**: Assign selected units to a group
- **0–9**: Recall a group (select those units)
- **Shift+0–9**: Add selected units to a group
- **Alt+0–9**: Steal selected units from other groups and assign to this group
- **Shift+Alt+0–9**: Steal selected units from other groups and add to this group
- **Ctrl+Shift+0–9**: Assign to group and remove those units from all other groups

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

NPCs are easier to farm — players get a configurable bonus to their effective mass when fighting NPCs. Set `npcCombatDisadvantage` higher to make NPCs easier (1.0 = equal difficulty).

### Group Bonus

Blobs near friendly allies gain a combat bonus. Each same-team blob within range adds a stacking multiplier to effective mass during combat. This means a swarm of small blobs can overwhelm a single large blob that lacks support.

Blobs with an active group bonus display a glowing ring and a `+N` indicator above them showing the stack count.

## Configuration

Edit `config.json` to tune game balance:

```json
{
  "npcCombatDisadvantage": 1.0,
  "groupBonusPerAlly": 0.1,
  "groupBonusRadius": 80,
  "groupBonusMax": 2.0
}
```

| Key | Description | Default |
|-----|-------------|---------|
| `npcCombatDisadvantage` | Multiplier applied to a player's effective mass when fighting NPCs. Higher = NPCs are easier to farm. Set to `1.0` for equal difficulty. | `1.0` |
| `groupBonusPerAlly` | Combat multiplier added per nearby same-team blob (e.g. `0.1` = +10% per ally). | `0.1` |
| `groupBonusRadius` | How close (in world units) allies must be to count for the group bonus. | `80` |
| `groupBonusMax` | Maximum total group bonus multiplier. Caps the stacking so very large groups don't become invincible. | `2.0` |
