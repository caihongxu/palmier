import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cronToCalendarInterval,
  specificTimeToCalendarInterval,
  buildPlist,
} from "../src/platform/macos.js";

describe("cronToCalendarInterval", () => {
  it("converts hourly cron", () => {
    assert.deepEqual(cronToCalendarInterval("0 * * * *"), { Minute: 0 });
  });

  it("converts daily cron", () => {
    assert.deepEqual(cronToCalendarInterval("30 9 * * *"), { Minute: 30, Hour: 9 });
  });

  it("converts weekly Monday cron", () => {
    assert.deepEqual(cronToCalendarInterval("0 10 * * 1"), { Minute: 0, Hour: 10, Weekday: 1 });
  });

  it("converts weekly Sunday (day 0)", () => {
    assert.deepEqual(cronToCalendarInterval("0 8 * * 0"), { Minute: 0, Hour: 8, Weekday: 0 });
  });

  it("converts weekly Sunday (day 7 -> 0)", () => {
    assert.deepEqual(cronToCalendarInterval("0 8 * * 7"), { Minute: 0, Hour: 8, Weekday: 0 });
  });

  it("converts monthly cron", () => {
    assert.deepEqual(cronToCalendarInterval("0 14 15 * *"), { Minute: 0, Hour: 14, Day: 15 });
  });

  it("throws on invalid cron expression", () => {
    assert.throws(() => cronToCalendarInterval("bad"), /Invalid cron/);
  });

  it("throws on too few fields", () => {
    assert.throws(() => cronToCalendarInterval("0 * *"), /Invalid cron/);
  });
});

describe("specificTimeToCalendarInterval", () => {
  it("parses an ISO local datetime", () => {
    assert.deepEqual(
      specificTimeToCalendarInterval("2026-04-20T09:00"),
      { Month: 4, Day: 20, Hour: 9, Minute: 0 },
    );
  });

  it("parses an ISO datetime with seconds", () => {
    assert.deepEqual(
      specificTimeToCalendarInterval("2026-12-31T23:59:30"),
      { Month: 12, Day: 31, Hour: 23, Minute: 59 },
    );
  });

  it("throws on malformed input", () => {
    assert.throws(() => specificTimeToCalendarInterval("not-a-date"), /Invalid specific_times/);
  });
});

describe("buildPlist", () => {
  it("emits a valid plist envelope with ProgramArguments", () => {
    const xml = buildPlist({
      Label: "me.palmier.host",
      ProgramArguments: ["/usr/local/bin/node", "/opt/palmier/dist/index.js", "serve"],
      RunAtLoad: true,
    });

    assert.ok(xml.startsWith(`<?xml version="1.0" encoding="UTF-8"?>`), "xml header");
    assert.ok(xml.includes(`<!DOCTYPE plist PUBLIC`), "doctype");
    assert.ok(xml.includes(`<plist version="1.0">`), "plist tag");
    assert.ok(xml.includes(`<key>Label</key>`), "label key");
    assert.ok(xml.includes(`<string>me.palmier.host</string>`), "label value");
    assert.ok(xml.includes(`<key>ProgramArguments</key>`), "program args key");
    assert.ok(xml.includes(`<string>/usr/local/bin/node</string>`), "program args first");
    assert.ok(xml.includes(`<true/>`), "boolean");
  });

  it("serializes StartCalendarInterval as an array of dicts", () => {
    const xml = buildPlist({
      Label: "me.palmier.task.abc",
      StartCalendarInterval: [
        { Minute: 0, Hour: 9 },
        { Minute: 30, Hour: 14, Weekday: 1 },
      ],
    });

    assert.ok(xml.includes(`<key>StartCalendarInterval</key>`));
    assert.ok(xml.includes(`<array>`));
    assert.ok(xml.includes(`<key>Minute</key>`));
    assert.ok(xml.includes(`<integer>0</integer>`));
    assert.ok(xml.includes(`<integer>9</integer>`));
    assert.ok(xml.includes(`<key>Weekday</key>`));
    assert.ok(xml.includes(`<integer>1</integer>`));
  });

  it("nests dicts (EnvironmentVariables.PATH)", () => {
    const xml = buildPlist({
      EnvironmentVariables: { PATH: "/usr/local/bin:/usr/bin:/bin" },
    });
    assert.ok(xml.includes(`<key>EnvironmentVariables</key>`));
    assert.ok(xml.includes(`<key>PATH</key>`));
    assert.ok(xml.includes(`<string>/usr/local/bin:/usr/bin:/bin</string>`));
  });

  it("escapes XML special characters in strings", () => {
    const xml = buildPlist({ Label: "a & b <c>" });
    assert.ok(xml.includes(`<string>a &amp; b &lt;c&gt;</string>`));
  });
});
