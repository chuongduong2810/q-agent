import { useEffect, useRef } from "react";
import * as THREE from "three";

interface Props {
  density?: number;
  glow?: boolean;
}

/**
 * Ambient neural-constellation background — a mouse-reactive point cloud with
 * connecting lines, plus soft radial glows. Ported from the approved design's
 * Three.js scene. Purely decorative and pointer-events:none.
 */
export function NeuralBackground({ density = 90, glow = true }: Props) {
  const mount = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mount.current;
    if (!el) return;

    const W = () => el.clientWidth || window.innerWidth;
    const H = () => el.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, W() / H(), 1, 4000);
    camera.position.z = 720;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W(), H());
    el.appendChild(renderer.domElement);

    const N = Math.max(30, Math.min(180, density));
    const pts: THREE.Vector3[] = [];
    const pos: number[] = [];
    for (let i = 0; i < N; i++) {
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 1500,
        (Math.random() - 0.5) * 950,
        (Math.random() - 0.5) * 720,
      );
      pts.push(v);
      pos.push(v.x, v.y, v.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const points = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        color: 0xa78bfa,
        size: 5.5,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );

    const lp: number[] = [];
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        if (pts[i].distanceTo(pts[j]) < 240) {
          lp.push(pts[i].x, pts[i].y, pts[i].z, pts[j].x, pts[j].y, pts[j].z);
        }
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
    const lines = new THREE.LineSegments(
      lg,
      new THREE.LineBasicMaterial({
        color: 0x6d5cff,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
      }),
    );

    const group = new THREE.Group();
    group.add(points);
    group.add(lines);
    scene.add(group);

    let mx = 0;
    let my = 0;
    const onMove = (e: MouseEvent) => {
      mx = e.clientX / window.innerWidth - 0.5;
      my = e.clientY / window.innerHeight - 0.5;
    };
    const onResize = () => {
      camera.aspect = W() / H();
      camera.updateProjectionMatrix();
      renderer.setSize(W(), H());
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("resize", onResize);

    const clock = new THREE.Clock();
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      group.rotation.y = t * 0.035 + mx * 0.45;
      group.rotation.x = my * 0.3 + Math.sin(t * 0.1) * 0.05;
      camera.position.x += (mx * 140 - camera.position.x) * 0.03;
      camera.position.y += (-my * 90 - camera.position.y) * 0.03;
      camera.lookAt(scene.position);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      el.innerHTML = "";
    };
  }, [density]);

  return (
    <>
      <div className="fixed inset-0 z-0" style={{ background: "#0a0a0f" }} />
      <div ref={mount} className="pointer-events-none fixed inset-0 z-[1]" />
      {glow && (
        <>
          <div
            className="pointer-events-none fixed z-[1] rounded-full"
            style={{
              top: "-15%",
              left: "-8%",
              width: 640,
              height: 640,
              background: "radial-gradient(circle,rgba(139,92,246,.28),transparent 62%)",
              filter: "blur(30px)",
              animation: "glowPulse 9s ease-in-out infinite",
            }}
          />
          <div
            className="pointer-events-none fixed z-[1] rounded-full"
            style={{
              bottom: "-20%",
              right: "-6%",
              width: 720,
              height: 720,
              background: "radial-gradient(circle,rgba(99,102,241,.26),transparent 62%)",
              filter: "blur(30px)",
              animation: "glowPulse 11s ease-in-out infinite 1s",
            }}
          />
        </>
      )}
    </>
  );
}
