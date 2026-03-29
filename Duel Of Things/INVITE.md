# Discord Bot Invite Instructions

## Quick Invite Link

Use this URL to invite your bot to a server:

```
https://discord.com/api/oauth2/authorize?client_id=1482403606798794762&permissions=274877906944&scope=bot%20applications.commands
```

Or use this shorter version (same thing):
```
https://discord.com/api/oauth2/authorize?client_id=1482403606798794762&permissions=274877906944&scope=bot+applications.commands
```

## Manual Setup (if the link above doesn't work)

1. Go to: https://discord.com/developers/applications/1482403606798794762/oauth2/url-generator

2. Under **SCOPES**, check:
   - ✅ `bot`
   - ✅ `applications.commands`

3. Under **BOT PERMISSIONS**, select:
   - ✅ Send Messages
   - ✅ Embed Links
   - ✅ Attach Files
   - ✅ Read Message History
   - ✅ Use External Emojis
   - ✅ Add Reactions

4. Copy the generated URL at the bottom and open it in your browser

5. Select the server you want to add the bot to

## Permissions Explained

The permission value `274877906944` includes:
- Send Messages (2048)
- Embed Links (16384)
- Attach Files (32768)
- Read Message History (65536)
- Use External Emojis (262144)
- Add Reactions (64)

## Troubleshooting

If you still get "integration requires code grant":
1. Make sure you're using the **OAuth2 URL Generator** (not the general OAuth2 page)
2. Ensure `bot` scope is checked (not just `applications.commands`)
3. Make sure you're the server owner or have "Manage Server" permission
