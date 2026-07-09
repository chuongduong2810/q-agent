import { NeuralBackground } from "@/components/background/NeuralBackground";
import { AmbientLayer } from "@/components/background/AmbientLayer";
import { useSettings } from "@/hooks/queries";

/**
 * Chooses the app backdrop based on the user's "3D background" setting. When on
 * (the default) it renders the animated WebGL {@link NeuralBackground} plus the
 * {@link AmbientLayer} atmospheric fog/cursor light; when off it renders a flat
 * dark fill so the shell keeps its solid backdrop without any GPU/animation
 * cost. Defaults to on while settings are still loading so the background
 * doesn't flash for the common case.
 */
export function AppBackground() {
  const { data: settings } = useSettings();
  const enabled = settings?.neuralBackground !== false;

  if (enabled) {
    return (
      <>
        <NeuralBackground />
        <AmbientLayer />
      </>
    );
  }
  return <div className="fixed inset-0 z-0" style={{ background: "#0a0a0f" }} />;
}
