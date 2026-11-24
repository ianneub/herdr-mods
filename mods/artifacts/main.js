// Artifacts panel: the person's claude.ai artifacts as a grid of gallery
// thumbnails (dark-mode screenshots when Herdr is dark), most recently updated first. Clicking one opens it in a new Brave window.
//
// sync.py (next to this file) does the network work: it reads Claude Code's
// claude.ai login from the Keychain, lists the artifacts, caches thumbnails
// under data/artifacts/thumbs/ and writes data/artifacts/index.json, which
// this view reads. Opened from the "Artifacts" button in the tabs-artifacts bar.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, readTextFile, appHome, checking, theme, layout, window, settings } from "herdr";

const STALE_MS = 10 * 60 * 1000;   // background refresh interval while the window is active
const SHOWN_STALE_MS = 60 * 1000;  // refresh on open if older than this
const MIN_CARD = 200, GAP = 10, PAD = 10, TEXT_H = 50, RATIO = 630 / 1200;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

function ago(iso) {
  const t = typeof iso === "number" ? iso * 1000 : Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default class Artifacts extends View {
  init(_props, cx) {
    this.items = [];
    this.fetchedAt = null;
    this.error = null;
    this.syncing = false;
    this.width = 368;
    this.query = "";
    this.shown = false;
    this.search = InputState.new({ placeholder: "Search artifacts" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value().trim().toLowerCase(); cx.notify(); });
    this.search.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.search.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    cx.spawn(async (cx) => {
      await this.load();
      cx.notify();
      if (!this.fetchedAt || Date.now() - this.fetchedAt > SHOWN_STALE_MS) this.sync(cx);
    });
    // Once a minute: keep the "x ago" labels honest and refresh when due.
    cx.timer.every(60000, (cx) => {
      if (window()?.active !== false && (!this.fetchedAt || Date.now() - this.fetchedAt > STALE_MS)) this.sync(cx);
      else cx.notify();
    });
  }

  async load() {
    const text = await readTextFile(`${appHome()}/data/artifacts/index.json`).catch(() => null);
    if (!text) return;
    try {
      const d = JSON.parse(text);
      // Most recently updated first (claude.ai lists them by last viewed).
      const time = (a) => Date.parse(a.updated_at) || 0;
      this.items = (Array.isArray(d.items) ? d.items : []).slice().sort((a, b) => time(b) - time(a));
      this.fetchedAt = d.fetched_at ? d.fetched_at * 1000 : null;
      this.error = d.error ?? null;
    } catch {
      this.error = "The artifact cache is unreadable; refresh to rebuild it.";
    }
  }

  sync(cx) {
    if (this.syncing || checking()) return;
    this.syncing = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", ["-I", `${appHome()}/mods/artifacts/sync.py`], { timeout: 180000 });
        if (r.code !== 0 && !r.stdout.trim()) this.error = (r.stderr || "Sync failed").trim().split("\n").pop();
      } catch (e) {
        this.error = `Sync failed: ${e?.message ?? e}`;
      }
      await this.load();
      this.syncing = false;
      cx.notify();
    });
  }

  open(item) {
    if (!item.url) return;
    exec("open", ["-na", "Brave Browser", "--args", "--new-window", item.url]).catch(() => {});
  }

  card(item, w, imgH, t) {
    // Herdr in dark mode shows the page's dark screenshot when it has one.
    const thumb = (settings().dark && item.thumb_dark) || item.thumb;
    const audience = item.audience === "public" ? "globe" : item.audience && item.audience !== "owner" ? "users" : null;
    const placeholder = div().w_full().h(imgH).flex_none().flex().items_center().justify_center().bg(t.raised).text_color(t.dim)
      .text_size(item.favicon ? 28 : 12).child(item.favicon || item.type || "Page");
    return v_flex().id(`artifact-${item.id}`).w(w).h(imgH + TEXT_H).flex_none().rounded(8).overflow_hidden()
      .border_1().border_color(t.border).bg(t.surface).cursor_pointer()
      .hover((s) => s.border_color(t.accent).bg(t.hover))
      .on_click(() => this.open(item))
      .child(thumb ? image(thumb).w_full().h(imgH).flex_none() : placeholder)
      .child(v_flex().flex_1().min_w(0).px(8).justify_center().gap(2).border_t(1).border_color(t.border)
        .child(div().text_size(13).font_semibold().text_color(t.foreground).truncate().child(item.title))
        .child(h_flex().gap(5).items_center().text_size(11).text_color(t.dim)
          .when(Boolean(audience), (el) => el.child(svg(`mods/artifacts/${audience}.svg`).size(10).flex_none()))
          .child(div().truncate().child(`${item.type} · ${ago(item.updated_at)}`))));
  }

  render(cx) {
    const t = theme();
    // Opening the panel refreshes a list that has gone a minute without one.
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    const shown = Boolean(panel && !panel.hidden && body?.active === "artifacts");
    if (shown && !this.shown && this.fetchedAt && Date.now() - this.fetchedAt > SHOWN_STALE_MS) this.sync(cx);
    this.shown = shown;

    const q = this.query;
    const items = q ? this.items.filter((a) => `${a.title} ${a.type} ${a.label ?? ""}`.toLowerCase().includes(q)) : this.items;
    const inner = Math.max(MIN_CARD, this.width - 2 * PAD - 2);
    const cols = Math.max(1, Math.floor((inner + GAP) / (MIN_CARD + GAP)));
    const cardW = Math.floor((inner - GAP * (cols - 1)) / cols);
    const imgH = Math.round(cardW * RATIO);
    const rows = Math.ceil(items.length / cols);

    const empty = this.syncing ? "Loading your artifacts…" : q ? "No artifacts match" : this.error ? "" : "No artifacts yet";

    return v_flex().id("root").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.width) >= 1) { this.width = size.width; cx.notify(); } })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Artifacts"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted)
          .child(q ? `${items.length} of ${this.items.length}` : `${this.items.length}`))
        .child(div().flex_1())
        .when(Boolean(this.fetchedAt) && !this.syncing, (el) => el.child(div().text_size(10.5).text_color(t.dim).child(ago(this.fetchedAt / 1000))))
        .child(div().id("artifacts-refresh").size(24).flex_none().flex().items_center().justify_center().rounded(6)
          .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
          .on_click((_e, cx) => this.sync(cx))
          .child(this.syncing ? svg("mods/workspace-chrome/spinner.svg").size(13).spin(900) : svg("mods/artifacts/refresh.svg").size(13))))
      .child(h_flex().flex_none().px(PAD).pt(PAD)
        .child(div().id("artifacts-search").flex_1().min_w(0).h(30).px(10).flex().items_center().rounded(8)
          .border_1().border_color(this.typing ? t.accent : t.border).cursor_text()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Input.new(this.search).h_full().text_size(12).text_color(t.foreground))))
      .when(Boolean(this.error), (el) => el.child(div().mx(PAD).mt(PAD).px(10).py(6).rounded(6).bg(t.raised)
        .text_size(11).text_color(t.blocked).child(this.error)))
      .child(v_flex().id("artifacts-grid").flex_1().min_h(0).overflow_y_scrollbar().p(PAD).gap(GAP)
        .children(Array.from({ length: rows }, (_, r) => h_flex().flex_none().gap(GAP)
          .children(items.slice(r * cols, r * cols + cols).map((a) => this.card(a, cardW, imgH, t)))))
        .when(items.length === 0 && Boolean(empty), (el) => el.child(div().p(6).text_size(12).text_color(t.dim).child(empty))));
  }
}
