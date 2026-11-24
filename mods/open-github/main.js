// Cmd+Shift+U (keys.json "mod.open:open-github"): opens the focused folder in GitHub,
// on its machine, through ~/bin/herdr-open (also behind Ghostty's same keys).
// Does its work as it opens and closes at once; the overlay is 2 px and bare.

import { View, div } from "gpui-kit";
import { exec, focused, spaces, home, props, closeOverlay } from "herdr";

export default class OpenHere extends View {
  init() {
    const overlay = props()?.overlay;
    if (!overlay) return;
    const f = focused();
    const space = spaces().find((s) => s.id === f?.space);
    const dir = f?.cwd || space?.folder || "";
    const args = ["github", "--dir", dir, ...(space?.machine ? ["--machine", space.machine] : [])];
    exec(`${home()}/bin/herdr-open`, args).catch(() => {});
    closeOverlay(overlay);
  }

  render() {
    return div();
  }
}
