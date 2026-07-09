import { useEffect, useRef } from "react";

/** One spawned cursor-dust DOM particle, tracked so it can be cleaned up on unmount. */
interface DustParticle {
  el: HTMLDivElement;
  timer: ReturnType<typeof setTimeout>;
}

const DUST_COLORS = ["rgba(196,181,253,", "rgba(103,232,249,", "rgba(147,197,253,"];

/**
 * Ambient atmosphere layer — a faithful port of the design prototype's
 * `initAmbient`. Renders fixed, pointer-events-none atmospheric fog (three
 * blurred colour blobs + two sweeping wave gradients) and a 600px cursor light
 * that follows the pointer with `mix-blend-mode: screen`. Also spawns small
 * dust particles near the cursor as it moves, which drift outward and fade.
 * Honours `prefers-reduced-motion` by slowing the fog. Purely decorative;
 * cleans up all listeners, the light's RAF loop, and any in-flight dust DOM
 * nodes on unmount.
 */
export function AmbientLayer() {
  const lightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let tx = window.innerWidth / 2;
    let ty = window.innerHeight / 2;
    let lx = tx;
    let ly = ty;
    let lastDust = 0;
    const dustEls = new Set<DustParticle>();

    const spawnDust = (x: number, y: number) => {
      const now = performance.now();
      if (now - lastDust < 60) return;
      lastDust = now;
      const n = 1 + ((Math.random() * 2) | 0);
      for (let i = 0; i < n; i++) {
        const sz = 1.5 + Math.random() * 2.5;
        const ang = Math.random() * Math.PI * 2;
        const dist = 30 + Math.random() * 70;
        const dx = Math.cos(ang) * dist;
        const dy = Math.sin(ang) * dist - 12;
        const hue = DUST_COLORS[(Math.random() * DUST_COLORS.length) | 0];
        const d = document.createElement("div");
        d.style.cssText =
          `position:fixed;left:${x}px;top:${y}px;width:${sz}px;height:${sz}px;` +
          "border-radius:50%;pointer-events:none;z-index:2;" +
          `background:${hue}.95);box-shadow:0 0 7px ${hue}.8);` +
          "transform:translate(0,0);opacity:.85;" +
          "transition:transform 1.5s cubic-bezier(.1,.6,.2,1),opacity 1.5s ease";
        document.body.appendChild(d);
        requestAnimationFrame(() => {
          d.style.transform = `translate(${dx}px,${dy}px)`;
          d.style.opacity = "0";
        });
        const particle: DustParticle = {
          el: d,
          timer: setTimeout(() => {
            d.remove();
            dustEls.delete(particle);
          }, 1600),
        };
        dustEls.add(particle);
      }
    };

    const onMove = (e: MouseEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      if (lightRef.current) lightRef.current.style.opacity = "1";
      spawnDust(e.clientX, e.clientY);
    };
    const onLeave = () => {
      if (lightRef.current) lightRef.current.style.opacity = "0";
    };
    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      lx += (tx - lx) * 0.14;
      ly += (ty - ly) * 0.14;
      if (lightRef.current) {
        lightRef.current.style.transform = `translate3d(${lx}px, ${ly}px, 0)`;
      }
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      dustEls.forEach(({ el, timer }) => {
        clearTimeout(timer);
        el.remove();
      });
      dustEls.clear();
    };
  }, []);

  const reduce =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <>
      <div className="pointer-events-none fixed inset-[-10%] z-[1] overflow-hidden">
        <div
          className="absolute rounded-full"
          style={{
            top: "-10%",
            left: "-15%",
            width: "70vw",
            height: "70vw",
            background: "radial-gradient(circle,rgba(139,92,246,.18),transparent 62%)",
            filter: "blur(60px)",
            animation: `envFogA ${reduce ? "90s" : "46s"} ease-in-out infinite`,
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            bottom: "-20%",
            right: "-10%",
            width: "66vw",
            height: "66vw",
            background: "radial-gradient(circle,rgba(34,211,238,.14),transparent 62%)",
            filter: "blur(60px)",
            animation: `envFogB ${reduce ? "90s" : "58s"} ease-in-out infinite`,
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            top: "30%",
            left: "35%",
            width: "52vw",
            height: "52vw",
            background: "radial-gradient(circle,rgba(99,102,241,.13),transparent 62%)",
            filter: "blur(70px)",
            animation: `envFogC ${reduce ? "90s" : "52s"} ease-in-out infinite`,
          }}
        />
        <div
          className="absolute"
          style={{
            top: 0,
            left: "-40%",
            width: "40vw",
            height: "140vh",
            background: "linear-gradient(100deg,transparent,rgba(139,92,246,.09),transparent)",
            filter: "blur(30px)",
            animation: `envWave ${reduce ? "90s" : "40s"} linear infinite`,
          }}
        />
        <div
          className="absolute"
          style={{
            top: 0,
            left: "-40%",
            width: "36vw",
            height: "140vh",
            background: "linear-gradient(100deg,transparent,rgba(34,211,238,.08),transparent)",
            filter: "blur(30px)",
            animation: `envWave ${reduce ? "90s" : "61s"} linear infinite`,
            animationDelay: "-18s",
          }}
        />
      </div>
      <div
        ref={lightRef}
        className="pointer-events-none fixed top-0 left-0 z-[1] rounded-full"
        style={{
          width: 600,
          height: 600,
          margin: "-300px 0 0 -300px",
          opacity: 0,
          transition: "opacity .6s ease",
          background:
            "radial-gradient(circle,rgba(139,92,246,.22),rgba(99,102,241,.09) 42%,transparent 70%)",
          willChange: "transform",
          mixBlendMode: "screen",
        }}
      />
    </>
  );
}
