# herdr-mods

Mods for the [Herdr](https://herdr.dev) desktop app (built against Herdr 0.1.18 on macOS).

| Mod | What it does |
|---|---|
| [`tab-namer`](mods/tab-namer) | Names a tab after the Claude Code session running in it (Claude's own task title, e.g. "Weekly dependency sweep"), and gives the tab back its default number when Claude exits. Never touches a name you gave a tab. |
| [`spaces-folders`](mods/spaces-folders) | The Spaces list with folders: each `/` in a space's name is a folder (`work/api` is `api` inside `work`). Folders fold. |
| [`agents-folders`](mods/agents-folders) | The Agents list, grouped into the same folders as `spaces-folders` in its "Grouped by space" view. |
| [`artifacts`](mods/artifacts) | A side panel with your claude.ai artifacts as a thumbnail grid (dark screenshots in dark mode), with search. Clicking one opens it in a new browser window. |
| [`tabs-artifacts`](mods/tabs-artifacts) | The tab bar with an **Artifacts** button that opens the `artifacts` panel. |
| [`open-code`](mods/open-code), [`open-finder`](mods/open-finder), [`open-github`](mods/open-github) | Open the focused folder in VS Code, in Finder, or on GitHub, through [`bin/herdr-open`](bin/herdr-open). Folders on a remote Herdr machine open in VS Code over Remote-SSH. |
| [`reviewer`](mods/reviewer) | [vytasgavelis/herdr-reviewer](https://github.com/vytasgavelis/herdr-reviewer) (commit `dce586d`) with local patches; see below. |

[`layouts/folders.json`](layouts/folders.json) is a copy of Herdr's `main` layout that uses all of the above.

## Install

```sh
git clone git@github.com:ianneub/herdr-mods.git
cp -R herdr-mods/mods/* ~/.config/herdr-app/mods/
cp herdr-mods/layouts/folders.json ~/.config/herdr-app/layouts/
```

Then pick the **folders** layout in Herdr (⌘⇧L cycles layouts). To use only some of the mods, copy just those and point the matching blocks of your own layout at them. `spaces-folders` and `agents-folders` go together: the agents list reads the folders that the spaces list publishes.

### open-code / open-finder / open-github

These run `~/bin/herdr-open`, so put the script there:

```sh
cp herdr-mods/bin/herdr-open ~/bin/ && chmod +x ~/bin/herdr-open
```

Bind them in `~/.config/herdr-app/keys.json`:

```json
"cmd-shift-e": "mod.open:open-code",
"cmd-shift-f": "mod.open:open-finder",
"cmd-shift-u": "mod.open:open-github"
```

`herdr-open` needs `jq`, `gh` (for GitHub) and VS Code. It can also run outside Herdr (from a hotkey in Ghostty, say). There it works out what is in front: a pane in the local `herdr`, a saved herdr SSH machine, or an ssh session to your server. For that last case, name the server in `~/.config/herdr-open.conf`:

```sh
HOST=myserver                                          # your Remote-SSH host, as in ~/.ssh/config
HOST_NAMES="myserver myserver.example.ts.net 10.0.0.5" # other names it's reached by
```

### artifacts

`sync.py` uses Claude Code's claude.ai login from the macOS Keychain (`Claude Code-credentials`) to list your artifacts. It reads the login each time and doesn't store it. It never refreshes an expired login, since that would sign Claude Code out. If the panel says the login has expired, start Claude Code once. It calls an **undocumented** endpoint (`api.anthropic.com/api/frame/artifacts`), so it may stop working without notice. Thumbnails are cached under `~/.config/herdr-app/data/artifacts/`. The script needs macOS (`security`, `sips`). Clicking a card opens it in Brave; change `open()` in `main.js` to use another browser.

### reviewer

This is the Changes panel with syntax coloring and PR-style line comments that go to the space's agent. It's by Vytas Gavelis (MIT, see [LICENSE](mods/reviewer/LICENSE) and [THIRD-PARTY-NOTICES](mods/reviewer/THIRD-PARTY-NOTICES)). Patches here on top of upstream:

- Automatic git reads write nothing under `.git` (`--no-optional-locks`, no fsmonitor, no index refresh): [upstream issue #4](https://github.com/vytasgavelis/herdr-reviewer/issues/4).
- With `diff.autoRefreshIndex=false`, `git diff --name-status` lists files whose timestamp changed but whose content didn't. Those rows are dropped.
- Ruby highlighting: extensionless Ruby files (Gemfile, Rakefile, …), `.erb`, symbols, `key:` labels, `@ivars`, `$globals` and regex literals.

## Tests

```sh
node mods/tab-namer/.test.mjs mods/tab-namer/main.js
```

## License

Apache License 2.0 ([LICENSE](LICENSE)), except `mods/reviewer` (MIT). `spaces-folders`, `agents-folders`, `tabs-artifacts` and `reviewer` are modified copies of mods that ship with Herdr, which are Apache 2.0.
