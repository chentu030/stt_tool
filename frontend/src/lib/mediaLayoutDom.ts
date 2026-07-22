/** Imperative layout chrome for TipTap DOM node views (embeds). */

import {
  MEDIA_WRAP_OPTIONS,
  applyLayoutToElement,
  clampOffset,
  clampWidthPct,
  normalizeAlign,
  normalizeWrap,
  readLayoutFromAttrs,
  type MediaLayout,
} from "@/lib/mediaLayout";

export type LayoutChromeControls = {
  root: HTMLDivElement;
  body: HTMLDivElement;
  sync: (attrs: Record<string, unknown>, selected: boolean, readOnly: boolean) => void;
  destroy: () => void;
};

export function mountLayoutChrome(opts: {
  updateAttributes: (patch: Partial<MediaLayout>) => void;
  getReadOnly?: () => boolean;
}): LayoutChromeControls {
  const root = document.createElement("div");
  root.className = "rich-media-frame";
  root.setAttribute("data-drag-handle", "");

  const toolbar = document.createElement("div");
  toolbar.className = "rich-media-toolbar";
  toolbar.contentEditable = "false";

  const body = document.createElement("div");
  body.className = "rich-media-frame-body";

  const resize = document.createElement("button");
  resize.type = "button";
  resize.className = "rich-media-resize";
  resize.title = "拖曳調整大小";
  resize.setAttribute("aria-label", "調整大小");

  root.appendChild(toolbar);
  root.appendChild(body);
  root.appendChild(resize);

  let layout: MediaLayout = readLayoutFromAttrs({});
  let selected = false;
  let readOnly = false;
  let menuOpen = false;
  let destroyed = false;

  const stop = (e: Event) => e.stopPropagation();
  toolbar.addEventListener("mousedown", stop);
  toolbar.addEventListener("pointerdown", stop);

  const rebuildToolbar = () => {
    toolbar.innerHTML = "";
    toolbar.hidden = !(selected && !readOnly);
    resize.hidden = !(selected && !readOnly);
    if (toolbar.hidden) return;

    const mkBtn = (label: string, title: string, on: boolean, onClick: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.title = title;
      if (on) b.classList.add("is-on");
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      return b;
    };

    (["left", "center", "right"] as const).forEach((a) => {
      toolbar.appendChild(
        mkBtn(a === "left" ? "左" : a === "right" ? "右" : "中", a, layout.align === a, () => {
          opts.updateAttributes({ align: normalizeAlign(a) });
        })
      );
    });

    const sep = document.createElement("span");
    sep.className = "rich-media-toolbar-sep";
    toolbar.appendChild(sep);

    const wrapWrap = document.createElement("div");
    wrapWrap.className = "rich-media-wrap-menu";
    const wrapBtn = mkBtn("環繞", "文字環繞", menuOpen, () => {
      menuOpen = !menuOpen;
      rebuildToolbar();
    });
    wrapWrap.appendChild(wrapBtn);
    if (menuOpen) {
      const pop = document.createElement("div");
      pop.className = "rich-media-wrap-pop";
      pop.setAttribute("role", "menu");
      MEDIA_WRAP_OPTIONS.forEach((o) => {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "menuitem");
        if (layout.wrap === o.id) b.classList.add("is-on");
        b.innerHTML = `<strong>${o.label}</strong><span>${o.hint}</span>`;
        b.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          menuOpen = false;
          opts.updateAttributes({ wrap: normalizeWrap(o.id) });
        });
        pop.appendChild(b);
      });
      wrapWrap.appendChild(pop);
    }
    toolbar.appendChild(wrapWrap);

    const pct = document.createElement("span");
    pct.className = "rich-media-toolbar-pct";
    pct.textContent = `${layout.widthPct}%`;
    toolbar.appendChild(pct);
  };

  let resizing = false;
  resize.addEventListener("pointerdown", (e) => {
    if (readOnly || opts.getReadOnly?.()) return;
    e.preventDefault();
    e.stopPropagation();
    const prose = root.closest(".rich-prose") as HTMLElement | null;
    if (!prose) return;
    resizing = true;
    const startX = e.clientX;
    const startW = layout.widthPct;
    const proseW = prose.getBoundingClientRect().width || 1;
    const onMove = (ev: PointerEvent) => {
      if (!resizing) return;
      const dx = ev.clientX - startX;
      const sign = layout.align === "right" ? -1 : 1;
      opts.updateAttributes({ widthPct: clampWidthPct(startW + sign * (dx / proseW) * 100) });
    };
    const onUp = () => {
      resizing = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  let floating = false;
  root.addEventListener("pointerdown", (e) => {
    if (readOnly || opts.getReadOnly?.()) return;
    if (layout.wrap !== "front" && layout.wrap !== "behind") return;
    const t = e.target as HTMLElement;
    if (t.closest(".rich-media-toolbar, .rich-media-resize, input, button, a, textarea")) return;
    e.preventDefault();
    e.stopPropagation();
    const prose = root.closest(".rich-prose") as HTMLElement | null;
    if (!prose) return;
    floating = true;
    const rect = prose.getBoundingClientRect();
    const onMove = (ev: PointerEvent) => {
      if (!floating) return;
      const x = ((ev.clientX - rect.left) / rect.width) * 100;
      const y = ((ev.clientY - rect.top) / Math.max(rect.height, 1)) * 100;
      opts.updateAttributes({
        offsetX: clampOffset(x - layout.widthPct / 2, layout.offsetX),
        offsetY: clampOffset(y - 4, layout.offsetY),
      });
    };
    const onUp = () => {
      floating = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  const sync = (attrs: Record<string, unknown>, isSelected: boolean, isReadOnly: boolean) => {
    if (destroyed) return;
    layout = readLayoutFromAttrs(attrs);
    selected = isSelected;
    readOnly = isReadOnly;
    applyLayoutToElement(root, layout);
    rebuildToolbar();
  };

  return {
    root,
    body,
    sync,
    destroy: () => {
      destroyed = true;
    },
  };
}
