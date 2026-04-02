import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cronToOnCalendar } from "../src/platform/linux.js";

describe("cronToOnCalendar", () => {
  it("converts hourly cron", () => {
    assert.equal(cronToOnCalendar("0 * * * *"), "*-*-* *:00:00");
  });

  it("converts daily cron", () => {
    assert.equal(cronToOnCalendar("30 9 * * *"), "*-*-* 09:30:00");
  });

  it("converts weekly Monday cron", () => {
    assert.equal(cronToOnCalendar("0 10 * * 1"), "Mon *-*-* 10:00:00");
  });

  it("converts weekly Sunday (day 0)", () => {
    assert.equal(cronToOnCalendar("0 8 * * 0"), "Sun *-*-* 08:00:00");
  });

  it("converts weekly Sunday (day 7)", () => {
    assert.equal(cronToOnCalendar("0 8 * * 7"), "Sun *-*-* 08:00:00");
  });

  it("converts monthly cron", () => {
    assert.equal(cronToOnCalendar("0 14 15 * *"), "*-*-15 14:00:00");
  });

  it("pads single-digit hours and minutes", () => {
    assert.equal(cronToOnCalendar("5 3 * * *"), "*-*-* 03:05:00");
  });

  it("throws on invalid cron expression", () => {
    assert.throws(() => cronToOnCalendar("bad"), /Invalid cron/);
  });

  it("throws on too few fields", () => {
    assert.throws(() => cronToOnCalendar("0 * *"), /Invalid cron/);
  });
});
