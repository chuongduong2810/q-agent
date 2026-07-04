import { useEffect } from "react";
import { addNetRipple } from "@/lib/pointerFx";

/**
 * Click ripple — a faithful port of the design prototype's `_ambDown`. Every
 * pointerdown pulses the neural background (via lib/pointerFx) and drops a soft
 * filled violet disc at the click point, sized to the clicked control (×2.4, or
 * 120px on empty space), that scales up and fades over ~0.55s. Appended to
 * <body> at z-index 60 so it reads above content. Renders nothing itself.
 */
export function ClickRipples() {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      addNetRipple(e.clientX, e.clientY);
      const target =
        e.target instanceof Element ? e.target.closest("button, [onclick], a") : null;
      const size = target
        ? Math.max((target as HTMLElement).offsetWidth, (target as HTMLElement).offsetHeight) * 2.4
        : 120;
      const rip = document.createElement("div");
      rip.style.cssText =
        `position:fixed;left:${e.clientX}px;top:${e.clientY}px;width:${size}px;height:${size}px;` +
        `margin:${-size / 2}px 0 0 ${-size / 2}px;border-radius:50%;pointer-events:none;z-index:60;` +
        "background:radial-gradient(circle,rgba(167,139,250,.28),transparent 60%);" +
        "transform:scale(.2);opacity:.7;" +
        "transition:transform .55s cubic-bezier(.2,.7,.2,1),opacity .55s ease";
      document.body.appendChild(rip);
      requestAnimationFrame(() => {
        rip.style.transform = "scale(1)";
        rip.style.opacity = "0";
      });
      setTimeout(() => rip.remove(), 620);
    };

    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, []);

  return null;
}
