// Build-time-only shim, never shipped to the browser as-is.
//
// @x8r/sapphire imports real values (ManagedPlugin, Frame, Controller) from
// "@mercuryworkshop/scramjet-controller" and extends ManagedPlugin. Nocturne
// already loads that exact package in the browser as a global script
// (/controller/controller.api.js -> self.$scramjetController) rather than as
// an ES module, so if esbuild resolved Sapphire's import normally it would
// bundle a SECOND, separate copy of scramjet-controller alongside the one
// already on the page - different class identities, wasted bytes, and any
// internal instanceof/dependency check in Sapphire's plugin system would
// silently fail against the live Controller's plugins array.
//
// esbuild's --alias flag points that import specifier at this file instead,
// so the bundle just re-exports the already-loaded global - one copy, same
// identity as what scramjet-engine.mjs's Controller instance actually uses.
const g = self.$scramjetController;
export const Controller = g.Controller;
export const ManagedPlugin = g.ManagedPlugin;
export const Frame = g.Frame;
export const Plugin = g.Plugin;
export const config = g.config;
