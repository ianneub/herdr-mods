// tab-namer: names a tab after the Claude Code session running in it, and only then.
//
// - A tab with Claude Code running in one of its panes takes Claude's terminal title
//   (Claude sets it to a short summary of the task, e.g. "Weekly dependency sweep"),
//   and follows it when it changes (/resume, /clear, a new topic). While Claude shows
//   no real title (starting up, resuming), the tab keeps the last one it had.
// - Any other tab keeps Herdr's default name (its position, "1", "2", ...). When the
//   Claude session ends, the tab goes back to that default.
// - Names you give a tab are never touched: the mod remembers every name it set
//   (localStorage "names"), and a named tab whose name isn't one of ours is
//   yours. Renaming a tab to "" (or a bare number) hands it back to the mod.
//
// Runs as a 0 px block in layouts/folders.json ("tab-namer"); draws nothing.

import { View, div } from "gpui-kit";
import { spaces, panes, machines, run } from "herdr";

const KEY = "names";
// Titles that only say which program is running, not what it's doing.
const GENERIC = /^(claude( code)?|terminal|bash|zsh|fish|sh|-?bash|~)$/i;
const MAX_LEN = 40;

function clean(title) {
  if (!title) return "";
  // Drop leading spinner/status glyphs ("✳ ", "⠂ ", "● ") and surrounding space.
  let t = title.replace(/^[^\p{L}\p{N}]+/u, "").replace(/\s+/g, " ").trim();
  if (t.length > MAX_LEN) t = t.slice(0, MAX_LEN - 1).trimEnd() + "…";
  return t;
}

function goodTitle(p) {
  const t = clean(p.title);
  if (!t || GENERIC.test(t)) return "";
  if (p.program?.name && t.toLowerCase() === p.program.name.toLowerCase()) return "";
  if (t.startsWith("/") || t.startsWith("~/")) return ""; // a path, not a task
  // Untitled terminals report their address ("t5m", "server/t1d") as the title.
  if (t === p.terminal || t === p.terminal?.split("/").pop()) return "";
  return t;
}

// Claude Code is running in this pane (working, idle at its prompt, or blocked).
// Not `app`: Herdr keeps app "claude-code" on the pane after Claude exits.
const isClaude = (p) => p.program?.key === "claude";

// What the tab should be called now: {name, source}, or null for Herdr's default.
function propose(tabPanes, prev) {
  const claudes = tabPanes.filter((p) => p.terminal && isClaude(p));
  if (!claudes.length) return null;

  // Stay with the Claude that named the tab while it has a real title; else the
  // focused one, else any.
  const order = [...claudes.filter((p) => p.terminal === prev?.source),
    ...claudes.filter((p) => p.focused), ...claudes];
  for (const p of order) {
    const t = goodTitle(p);
    if (t) return { name: t, source: p.terminal };
  }
  // No real title right now: keep the last name while that Claude still runs.
  if (prev && claudes.some((p) => p.terminal === prev.source)) return { name: prev.name, source: prev.source };
  return null;
}

export default class TabNamer extends View {
  init() {
    try {
      this.names = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    } catch {
      this.names = {};
    }
  }

  save() {
    localStorage.setItem(KEY, JSON.stringify(this.names));
  }

  rename(id, name) {
    try {
      run("tab.rename", { id, name });
    } catch (e) {
      console.warn(`tab-namer: rename ${id} failed: ${e}`);
    }
  }

  sweep() {
    const byTab = new Map();
    for (const p of panes()) {
      if (!byTab.has(p.tab)) byTab.set(p.tab, []);
      byTab.get(p.tab).push(p);
    }

    const live = new Set();
    let changed = false;
    const ready = new Set(machines().filter((m) => m.layout === "ready").map((m) => m.name ?? ""));
    for (const space of spaces()) {
      for (const tab of space.tabs) {
        live.add(tab.id);
        if (!ready.has(space.machine ?? "")) continue; // its layout isn't loaded yet
        const prev = this.names[tab.id];
        // Ours only if it has Herdr's automatic name (a bare number, also when set
        // explicitly: old herdr tabs carry "1") or exactly the name we set. Any other
        // name is the person's, whatever `named` says: it has been seen false on
        // tabs the person named ("Work"), and trusting it overwrote them.
        const isDefault = /^\d+$/.test(tab.name);
        const ours = isDefault || (prev && prev.name === tab.name);
        if (!ours) {
          // The person named it: forget ours so a later "" starts fresh.
          if (prev) { delete this.names[tab.id]; changed = true; }
          continue;
        }
        const next = propose(byTab.get(tab.id) ?? [], prev);
        if (!next) {
          // No Claude session: hand the tab back to Herdr's default name.
          if (prev) { delete this.names[tab.id]; changed = true; }
          if (!isDefault) this.rename(tab.id, "");
          continue;
        }
        if (!prev || JSON.stringify(prev) !== JSON.stringify(next)) {
          this.names[tab.id] = next;
          changed = true;
        }
        if (tab.name !== next.name) this.rename(tab.id, next.name);
      }
    }

    // Forget closed tabs, but only for machines whose layout we can see now,
    // so an offline machine's tabs keep their records.
    for (const id of Object.keys(this.names)) {
      const machine = id.includes("/") ? id.split("/")[0] : "";
      if (!live.has(id) && ready.has(machine)) { delete this.names[id]; changed = true; }
    }
    if (changed) this.save();
  }

  render(cx) {
    // render runs whenever spaces/panes/terminals change; do the work just after it.
    cx.spawn(async () => this.sweep());
    return div();
  }
}
