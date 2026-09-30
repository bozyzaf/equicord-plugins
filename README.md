# equicord-plugins

Custom plugins for [Equicord](https://github.com/Equicord/Equicord).

## Plugins

- **AutoDelete**: delete your own messages in a channel, with human-like delays, a progress view and a stop button.
- **HypeSquadSwitcher**: change or remove your HypeSquad badge (Bravery, Brilliance, Balance) straight from the plugin settings.

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
