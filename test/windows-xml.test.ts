import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { triggerToXml, buildTaskXml } from "../src/platform/windows.js";

describe("triggerToXml", () => {
  it("converts a once trigger to TimeTrigger", () => {
    const xml = triggerToXml({ type: "once", value: "2026-03-28T09:00" });
    assert.equal(xml, "<TimeTrigger><StartBoundary>2026-03-28T09:00:00</StartBoundary></TimeTrigger>");
  });

  it("converts hourly cron to TimeTrigger with PT1H repetition", () => {
    const xml = triggerToXml({ type: "cron", value: "0 * * * *" });
    assert.ok(xml.includes("<Interval>PT1H</Interval>"), "should have hourly interval");
    assert.ok(xml.includes("<TimeTrigger>"), "should be a TimeTrigger");
  });

  it("converts daily cron to CalendarTrigger with DaysInterval", () => {
    const xml = triggerToXml({ type: "cron", value: "30 9 * * *" });
    assert.ok(xml.includes("<ScheduleByDay>"), "should use ScheduleByDay");
    assert.ok(xml.includes("<DaysInterval>1</DaysInterval>"), "should have interval 1");
    assert.ok(xml.includes("T09:30:00"), "should encode time as 09:30");
  });

  it("converts weekly cron to CalendarTrigger with DaysOfWeek", () => {
    const xml = triggerToXml({ type: "cron", value: "0 10 * * 1" });
    assert.ok(xml.includes("<ScheduleByWeek>"), "should use ScheduleByWeek");
    assert.ok(xml.includes("<Monday />"), "day 1 should be Monday");
    assert.ok(xml.includes("T10:00:00"), "should encode time as 10:00");
  });

  it("converts weekly cron for Sunday (day 0)", () => {
    const xml = triggerToXml({ type: "cron", value: "0 8 * * 0" });
    assert.ok(xml.includes("<Sunday />"), "day 0 should be Sunday");
  });

  it("converts weekly cron for Sunday (day 7)", () => {
    const xml = triggerToXml({ type: "cron", value: "0 8 * * 7" });
    assert.ok(xml.includes("<Sunday />"), "day 7 should also be Sunday");
  });

  it("converts monthly cron to CalendarTrigger with DaysOfMonth", () => {
    const xml = triggerToXml({ type: "cron", value: "0 14 15 * *" });
    assert.ok(xml.includes("<ScheduleByMonth>"), "should use ScheduleByMonth");
    assert.ok(xml.includes("<Day>15</Day>"), "should have day 15");
    assert.ok(xml.includes("T14:00:00"), "should encode time as 14:00");
    // All months should be listed
    assert.ok(xml.includes("<January />"), "should include January");
    assert.ok(xml.includes("<December />"), "should include December");
  });

  it("throws on invalid cron expression", () => {
    assert.throws(() => triggerToXml({ type: "cron", value: "bad" }), /Invalid cron/);
  });
});

describe("buildTaskXml", () => {
  it("produces valid XML structure with StopExisting policy", () => {
    const tr = '"C:\\Program Files\\nodejs\\node.exe" "C:\\palmier\\dist\\index.js" run abc123';
    const triggers = ['<TimeTrigger><StartBoundary>2000-01-01T00:00:00</StartBoundary></TimeTrigger>'];
    const xml = buildTaskXml(tr, triggers);

    assert.ok(xml.includes('<?xml version="1.0" encoding="UTF-16"?>'), "should have XML declaration");
    assert.ok(xml.includes("<MultipleInstancesPolicy>StopExisting</MultipleInstancesPolicy>"), "should set StopExisting");
    assert.ok(xml.includes("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>"), "should allow on battery");
    assert.ok(xml.includes("<Command>C:\\Program Files\\nodejs\\node.exe</Command>"), "should extract command");
    assert.ok(xml.includes("<Arguments>C:\\palmier\\dist\\index.js run abc123</Arguments>"), "should extract arguments");
  });

  it("handles multiple triggers", () => {
    const tr = '"node" "palmier" run test';
    const triggers = [
      '<TimeTrigger><StartBoundary>2000-01-01T09:00:00</StartBoundary></TimeTrigger>',
      '<CalendarTrigger><StartBoundary>2000-01-01T14:00:00</StartBoundary></CalendarTrigger>',
    ];
    const xml = buildTaskXml(tr, triggers);

    assert.ok(xml.includes("<Triggers><TimeTrigger>"), "should contain first trigger");
    assert.ok(xml.includes("</TimeTrigger><CalendarTrigger>"), "triggers should be concatenated");
  });

  it("parses command with spaces in path", () => {
    const tr = '"C:\\Program Files\\nodejs\\node.exe" "C:\\My Folder\\script.js" serve';
    const xml = buildTaskXml(tr, []);

    assert.ok(xml.includes("<Command>C:\\Program Files\\nodejs\\node.exe</Command>"));
    assert.ok(xml.includes("<Arguments>C:\\My Folder\\script.js serve</Arguments>"));
  });
});
