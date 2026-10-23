import { Hono } from "hono";
import { monthSchema, yearSchema } from "../../shared/schemas";
import type { ClubWrapped, MonthlyRecap } from "../../shared/types";
import type { AppEnv } from "../env";
import { badRequest } from "../lib/errors";
import { parseWith } from "../lib/http";
import { clubMonthlyRecap, clubWrapped, currentMonth, userMonthlyRecap } from "../lib/recaps";

/** Club recaps (/api/clubs/:clubId/recaps): monthly recap and Club Wrapped. */
export const recapRoutes = new Hono<AppEnv>();
/** Personal recaps (/api/recaps). */
export const personalRecapRoutes = new Hono<AppEnv>();

function monthParam(raw: string | undefined): string {
  const month = raw ? parseWith(monthSchema, raw) : currentMonth();
  if (month > currentMonth()) throw badRequest("That month has not happened yet", { month: ["In the future"] });
  return month;
}

personalRecapRoutes.get("/monthly", async (c) => {
  const month = monthParam(c.req.query("month"));
  const recap = await userMonthlyRecap(c.env, c.get("user").id, month);
  c.header("Cache-Control", "private, max-age=300");
  return c.json(recap satisfies MonthlyRecap);
});

recapRoutes.get("/monthly", async (c) => {
  const month = monthParam(c.req.query("month"));
  const recap = await clubMonthlyRecap(c.env, c.get("club").id, month);
  c.header("Cache-Control", "private, max-age=300");
  return c.json(recap satisfies MonthlyRecap);
});

recapRoutes.get("/wrapped", async (c) => {
  const raw = c.req.query("year");
  const year = raw ? parseWith(yearSchema, raw) : new Date().getUTCFullYear();
  if (year > new Date().getUTCFullYear()) throw badRequest("That year has not happened yet", { year: ["In the future"] });
  const wrapped = await clubWrapped(c.env, c.get("club").id, year);
  c.header("Cache-Control", "private, max-age=300");
  return c.json(wrapped satisfies ClubWrapped);
});
