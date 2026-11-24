// Loads mods/tab-namer/main.js with fake herdr/gpui-kit APIs and walks one tab
// through: shell -> claude running -> claude exits -> other programs -> new session.
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const src = fs.readFileSync(process.argv[2], "utf8")
  .replace(/^import .*$/gm, "")
  .replace("export default class TabNamer", "globalThis.TabNamer = class TabNamer");

const world = { tab: { id: "tbX", name: "1", named: false }, pane: null, labels: {}, renames: [] };
const store = new Map();
const ctx = {
  console,
  View: class {},
  div: () => ({}),
  localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
  spaces: () => [{ id: "sp1", machine: null, tabs: [world.tab] }],
  panes: () => [world.pane],
    machines: () => [{ name: null, layout: "ready" }],
  run: (cmd, args) => {
    assert.equal(cmd, "tab.rename");
    world.renames.push(args.name);
    world.tab = { ...world.tab, name: args.name || "1", named: !!args.name };
  },
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const namer = new ctx.TabNamer();
namer.init();
const sweep = () => { namer.sweep(); return world.tab.name; };

const shell = { key: "shell", name: "bash", shell: true, agent: false };
const claude = { key: "claude", name: "Claude Code", shell: false, agent: true };
const pane = (o) => ({ pane: "p1", terminal: "t9", tab: "tbX", title: "", cwd: "/home/me/Code/myproject",
  branch: "main", status: null, app: null, program: shell, focused: true, ...o });

const steps = [];
const step = (label, expect) => { const got = sweep(); steps.push(`${label.padEnd(44)} ${got}`); assert.equal(got, expect, label); };

const nvim = { key: "nvim", name: "nvim", shell: false, agent: false };
const codex = { key: "codex", name: "Codex", shell: false, agent: true };

world.pane = pane({});
step("plain shell: default", "1");
world.pane = pane({ program: nvim, title: "main.js" });
step("nvim: default", "1");
world.pane = pane({ program: codex, status: "working", app: "codex", title: "Refactor parser" });
step("another agent (codex): default", "1");
world.pane = pane({ program: claude, status: "working", app: "claude-code", title: "Claude Code" });
step("claude starts, generic title: default", "1");
world.pane = pane({ program: claude, status: "working", app: "claude-code", title: "t9" });
step("claude --resume, address as title: default", "1");
world.pane = pane({ program: claude, status: "working", app: "claude-code", title: "✳ Weekly dependency sweep" });
step("claude sets its task title", "Weekly dependency sweep");
world.pane = pane({ program: claude, status: "idle", app: "claude-code", title: "Claude Code" });
step("generic title mid-session: keeps name", "Weekly dependency sweep");
world.pane = pane({ program: claude, status: "idle", app: "claude-code", title: "t9" });
step("address as title (resuming): keeps name", "Weekly dependency sweep");
world.pane = pane({ program: claude, status: "idle", app: "claude-code", title: "Something else later" });
step("/resume another session: follows title", "Something else later");
world.pane = pane({ app: "claude-code", title: "t9" }); // Herdr leaves app set after exit
step("claude exits: back to default", "1");
assert.equal(world.renames.at(-1), "", "reset uses an empty name");
step("  ...and stays default at the shell", "1");

world.pane = pane({ program: claude, status: "working", app: "claude-code", title: "Fix restore bug" });
step("second claude session in the same tab", "Fix restore bug");
world.pane = pane({ program: claude, status: "blocked", app: "claude-code", title: "Fix restore bug" });
step("  ...waiting on permission: kept", "Fix restore bug");

// User names win, even if Herdr reports named: false.
world.tab = { ...world.tab, name: "Work", named: false };
step("user renamed it (named flag false)", "Work");
world.pane = pane({});
step("  ...claude exits: stays theirs", "Work");
world.pane = pane({ program: claude, status: "working", app: "claude-code", title: "Task B" });
step("  ...new claude session: still theirs", "Work");
world.tab = { ...world.tab, name: "1", named: false };
step("user clears the name: handed back", "Task B");

// An old auto name from the previous version (no Claude) is reset to default.
world.tab = { ...world.tab, name: "myproject" };
namer.names[world.tab.id] = { name: "myproject", locked: false, source: "t9" }; // old record shape
world.pane = pane({});
step("leftover non-claude auto name: reset", "1");

console.log(steps.join("\n"));
console.log("\nall", steps.length, "steps passed");
