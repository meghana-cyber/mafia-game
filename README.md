# Mafia

Multiplayer Mafia (Node + Express + Socket.IO). Share a room link, or add bots to play solo.

## Run locally
    npm install
    npm start        # http://localhost:3000

## Hosting
GitHub Pages only serves static files; it cannot run this app's Express and Socket.IO server, which is required for multiplayer. Deploy the whole app as a Node web service instead:
1. Push this folder to a GitHub repo.
2. In Render, choose **New > Web Service** and connect the repo.
3. Use Node, build command `npm install`, and start command `npm start`.
4. Deploy. Your game is at `https://<name>.onrender.com/?room=ABCD`.

Rooms live in memory, so they reset when Render restarts or the free instance spins down. The repository ignores `.env` files; do not commit secrets.
Roles: Mafia, Doctor (4+ players), Detective (5+ players), two Detectives (10+ players), and Villagers. Rooms hold 4 to 20 players.
