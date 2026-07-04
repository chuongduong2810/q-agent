/**
 * Module-singleton bridge to the data router's imperative `navigate`.
 *
 * The Zustand store's legacy nav actions drive navigation by calling
 * `routerNavigate(...)`, but the store must not import `router.tsx` directly:
 * that would create an import cycle (router.tsx → App → store → router). Instead
 * `router.tsx` calls `bindRouter(router)` once at module load, and the store
 * calls `routerNavigate` — no import of the router required.
 *
 * This is temporary bridge scaffolding (see ADR 0003); the final cleanup slice
 * removes it once every screen navigates via native router hooks.
 */

/** Minimal shape we need from the data router — avoids importing its types. */
interface RouterLike {
  navigate: (to: string) => void | Promise<void>;
}

let _router: RouterLike | null = null;

/** Register the data router instance (called once from router.tsx). */
export const bindRouter = (router: RouterLike): void => {
  _router = router;
};

/** Imperatively navigate via the bound router. No-op until `bindRouter` runs. */
export const routerNavigate = (to: string): void => {
  void _router?.navigate(to);
};
