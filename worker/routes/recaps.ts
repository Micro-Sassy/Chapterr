import { Hono } from "hono";
import type { AppEnv } from "../env";

/** Feature wave 2 (W3). See docs/FEATURES-2.md. Routes are filled in by the owning work stream. */
export const recapRoutes = new Hono<AppEnv>();
/** Personal recaps (/api/recaps). */
export const personalRecapRoutes = new Hono<AppEnv>();
