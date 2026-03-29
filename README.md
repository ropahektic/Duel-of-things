# Duel-of-things
Compare two images trivia. Singleplayer, Multiplayer, Leaderboards.

Includes parsers for 12 different games. 

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Parse Character Data

Run the parser to collect character data:
```bash
npm run parse
```

This will:
- Parse the top 1000 characters from MyAnimeList
- Download their high-quality images directly to the `characters/` folder
- Save character data (name, favorites count, image path) to `characters-data.js`

**Note:** The parsing process will take some time (approximately 30-60 minutes) as it needs to:
- Fetch 20 pages of character data
- Visit each character's individual page to get high-quality images
- Download 1000 character images
- Respect rate limits with delays between requests

The parser saves progress every 10 characters, so you can check `characters-data.js` as it runs.

### 3. Configure Discord Bot

1. Get your bot token from the [Discord Developer Portal](https://discord.com/developers/applications)
   - Go to your application (ID: `1482403606798794762`)
   - Navigate to "Bot" section
   - Copy the token

2. Create a `.env` file in the project root:
```bash
DISCORD_BOT_TOKEN=your_bot_token_here
```

3. Invite your bot to your server:
   - Go to OAuth2 → URL Generator
   - Select scopes: `bot`, `applications.commands`
   - Select bot permissions as needed
   - Copy the generated URL and open it in your browser

### 4. Run the Bot

```bash
npm start
```

Or:
```bash
node index.js
```

## Output Structure

After running the parser, you'll have:

```
AnimeDuel/
├── characters/
│   ├── 417/          (character ID folder)
│   │   └── image.jpg
│   ├── 40/
│   │   └── image.jpg
│   └── ...
└── characters-data.js  (character data export)
```

The `characters-data.js` file will contain an array of objects like:
```javascript
[
  {
    id: "417",
    name: "Lamperouge, Lelouch",
    favorites: 178111,
    imagePath: "characters/417/image.jpg"
  },
  ...
]
```
