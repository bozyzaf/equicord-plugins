# equicord-plugins

Custom plugins for [Equicord](https://github.com/Equicord/Equicord).

## Plugins

- **AutoDelete**: delete your own messages in a channel, with human-like delays, a progress view and a stop button.
- **HypeSquadSwitcher**: change or remove your HypeSquad badge (Bravery, Brilliance, Balance) straight from the plugin settings.
- **ChannelStats**: per-channel statistics (top users, message counts, activity by hour/day/month). Server stats are only collected for servers listed in the plugin's whitelist setting (comma-separated server IDs). DMs are controlled by a separate toggle.

## Known Issues

- **ChannelStats:** the stats are sometimes wiped on their own. I'm aware of it and working on a fix. Until then, I recommend exporting your statistics regularly (plugin settings → **Export Statistics**), once a day, so you can restore them with **Import Statistics**.

## Installation

Requirements: [Node.js](https://nodejs.org), [pnpm](https://pnpm.io) and [git](https://git-scm.com).

**1. Get Equicord from source** (skip if you already have it built from source):

```
git clone https://github.com/Equicord/Equicord
cd Equicord
pnpm install --frozen-lockfile
```

**2. Add the plugins**

If `src/userplugins` doesn't exist or is empty:

```
cd src
git clone https://github.com/bozyzaf/equicord-plugins userplugins
cd ..
```

If you already have your own plugins in `src/userplugins`, clone this repo somewhere else (or use Code → Download ZIP) and copy the plugin folders you want into `src/userplugins`.

**3. Build and inject**

```
pnpm build
pnpm inject
```

Then restart Discord.
