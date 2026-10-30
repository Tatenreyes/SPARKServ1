/**
 * Unit tests for the appliance fields: model number, serial number, purchase date.
 *
 *   npm run test:appliance-fields
 *
 * These run the REAL module (`src/lib/appliance-fields.ts`) — Node 24 strips the
 * TypeScript types, so there is no build step and no duplicated copy of the rules
 * to drift. The two screens are also read as text, because the caps have to be
 * WIRED INTO the fields, not merely defined.
 *
 * What is NOT covered here: the rendered selects themselves (see TESTING.md for
 * the manual pass) and anything that needs the live database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  COUNTER_VISIBLE_WITHIN,
  MAX_MODEL_NUMBER_LENGTH,
  MAX_SERIAL_NUMBER_LENGTH,
  MAX_WARRANTY_YEARS,
  MIN_PURCHASE_YEAR,
  anyRange,
  cleanCode,
  daysInMonth,
  formatIsoDate,
  futureRange,
  monthPosition,
  parseIsoDate,
  pastRange,
  sanitiseCodeInput,
  selectableDayRange,
  showsCounter,
  startOfToday,
  toIsoDate,
  yearsInRange,
} from "../../src/lib/appliance-fields.ts";

const ROOT = new URL("../../", import.meta.url);
const WIZARD = "src/components/RequestRepairWizard.tsx";
const PAGE = "src/app/customer/appliances/page.tsx";
const DATE_SELECT = "src/components/DateSelect.tsx";
const wizard = readFileSync(new URL(WIZARD, ROOT), "utf8");
const page = readFileSync(new URL(PAGE, ROOT), "utf8");
const dateSelect = readFileSync(new URL(DATE_SELECT, ROOT), "utf8");

// -------------------------------------------------- 1. the caps

test("both identifiers are capped, and the caps are sane", () => {
  // Long enough for the longest real values (model numbers run 15-25 characters,
  // serials less), short enough that a pasted document cannot be stored.
  assert.equal(MAX_MODEL_NUMBER_LENGTH, 50);
  assert.equal(MAX_SERIAL_NUMBER_LENGTH, 50);
  assert.ok(MAX_MODEL_NUMBER_LENGTH > 25 && MAX_MODEL_NUMBER_LENGTH <= 64);
});

test("cleanCode trims, collapses whitespace, and caps", () => {
  assert.equal(cleanCode("  RT32K5530S8  ", 40), "RT32K5530S8");
  // A paste from a PDF arrives with newlines and tabs in it.
  assert.equal(cleanCode("RT32\nK5530\tS8", 40), "RT32 K5530 S8");
  assert.equal(cleanCode("x".repeat(120), 40).length, 40);
  assert.equal(cleanCode("   \n\t ", 40), "", "whitespace only is not a value");
  assert.equal(cleanCode("", 40), "");
  assert.equal(cleanCode("A1 B2", 3), "A1", "the cap applies after normalising");
});

test("an identifier may only hold letters, digits and a label separator", () => {
  // Real labels: "WF45R6100AP/A2" and "RT-32K". A strictly alphanumeric filter
  // would reject both, so the slash and hyphen survive.
  assert.equal(sanitiseCodeInput("WF45R6100AP/A2", 50), "WF45R6100AP/A2");
  assert.equal(sanitiseCodeInput("RT-32K", 50), "RT-32K");
  assert.equal(sanitiseCodeInput("A1;B2#C3", 50), "A1B2C3", "punctuation is dropped as it is typed");
  assert.equal(sanitiseCodeInput("RT32 K5530S8", 50), "RT32 K5530S8", "the space is part of the label");
  assert.equal(sanitiseCodeInput("sn. 123/2024, unit", 50), "sn 123/2024 unit");
  assert.equal(sanitiseCodeInput("x".repeat(80), 50).length, 50, "and it still caps");
});

test("the field and the payload agree on what an identifier is", () => {
  // If they disagreed, what the customer sees is not what gets stored.
  for (const value of ["WF45R6100AP/A2", "RT-32K", "RT32 K5530S8"]) {
    assert.equal(sanitiseCodeInput(value, 50), value);
    assert.equal(cleanCode(value, 50), value);
  }
  assert.equal(cleanCode("  A1;B2  ", 50), "A1B2");
  assert.equal(cleanCode("RT32  K5530", 50), "RT32 K5530", "runs of spaces collapse");
});

test("the counter appears only when the field is nearly full", () => {
  const short = "A".repeat(MAX_MODEL_NUMBER_LENGTH - COUNTER_VISIBLE_WITHIN - 1);
  const edge = "A".repeat(MAX_MODEL_NUMBER_LENGTH - COUNTER_VISIBLE_WITHIN);
  const full = "A".repeat(MAX_MODEL_NUMBER_LENGTH);

  assert.equal(showsCounter(short, MAX_MODEL_NUMBER_LENGTH), false);
  assert.equal(showsCounter(edge, MAX_MODEL_NUMBER_LENGTH), true);
  assert.equal(showsCounter(full, MAX_MODEL_NUMBER_LENGTH), true);
  assert.equal(showsCounter("", MAX_MODEL_NUMBER_LENGTH), false);
});

// -------------------------------------------------- 2. the date arithmetic

test("daysInMonth knows the short months and the leap years", () => {
  assert.equal(daysInMonth(2024, 2), 29, "2024 is a leap year");
  assert.equal(daysInMonth(2023, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29, "divisible by 400");
  assert.equal(daysInMonth(1900, 2), 28, "divisible by 100 but not 400");
  assert.equal(daysInMonth(2024, 4), 30);
  assert.equal(daysInMonth(2024, 12), 31);
  assert.equal(daysInMonth(2024, 1), 31);
});

test("toIsoDate pads, so the value always fits the column", () => {
  assert.equal(toIsoDate(2019, 3, 2), "2019-03-02");
  assert.equal(toIsoDate(2024, 12, 31), "2024-12-31");
  assert.equal(toIsoDate(1970, 1, 1), "1970-01-01");
});

test("parseIsoDate reads a calendar date locally, never as UTC", () => {
  // `new Date("2019-03-12")` is UTC midnight: west of UTC that renders as 11 March.
  // The components must survive the round trip in any timezone.
  const date = parseIsoDate("2019-03-12");
  assert.ok(date, "a plain ISO date parses");
  assert.equal(date.getFullYear(), 2019);
  assert.equal(date.getMonth(), 2, "March is 0-based");
  assert.equal(date.getDate(), 12, "and never the 11th");

  assert.equal(toIsoDate(2019, 3, 12), "2019-03-12", "round trip");
});

test("parseIsoDate refuses anything that is not a real calendar date", () => {
  assert.equal(parseIsoDate("2023-02-30"), null, "30 February must not roll into March");
  assert.equal(parseIsoDate("2023-13-01"), null);
  assert.equal(parseIsoDate("2019-3-12"), null, "unpadded is not the stored shape");
  assert.equal(parseIsoDate("12/03/2019"), null);
  assert.equal(parseIsoDate("2019-03-12T00:00:00Z"), null);
  assert.equal(parseIsoDate(""), null);
  assert.equal(parseIsoDate(null), null);
  assert.equal(parseIsoDate(undefined), null);
});

test("formatIsoDate shows the date the customer picked", () => {
  const shown = formatIsoDate("2019-03-12");
  assert.match(shown, /12/);
  assert.match(shown, /Mar/);
  assert.match(shown, /2019/);
  assert.equal(formatIsoDate(""), "");
  assert.equal(formatIsoDate(null), "");
  assert.equal(formatIsoDate("rubbish"), "");
});

test("a purchase date can never be in the future", () => {
  const range = pastRange(new Date(2024, 1, 20)); // 20 February 2024

  assert.deepEqual(selectableDayRange(2024, 2, range), [1, 20], "the current month stops at today");
  assert.deepEqual(selectableDayRange(2024, 1, range), [1, 31], "an earlier month is whole");
  assert.deepEqual(selectableDayRange(2023, 2, range), [1, 28], "a past February is not clamped");
  assert.equal(
    selectableDayRange(2024, 3, range),
    null,
    "a month that has not started offers no days at all"
  );
  assert.equal(selectableDayRange(2025, 1, range), null, "nor does a year that has not started");
  assert.equal(selectableDayRange(1969, 6, range), null, "and the floor holds too");
  assert.equal(selectableDayRange(1970, 1, range)[0], 1, "the first allowed day is 1 January 1970");

  assert.equal(monthPosition(2024, 3, range), "after");
  assert.equal(monthPosition(2024, 2, range), "inside");
  assert.equal(monthPosition(2024, 1, range), "inside");
  assert.equal(monthPosition(1969, 12, range), "before");
});

test("a service date can never be in the past", () => {
  // The same rule, on the other side of today — one clamp serves both fields.
  const range = futureRange(new Date(2024, 1, 20)); // 20 February 2024

  assert.deepEqual(selectableDayRange(2024, 2, range), [20, 29], "this month starts at today");
  assert.deepEqual(selectableDayRange(2024, 3, range), [1, 31], "next month is whole");
  assert.equal(selectableDayRange(2024, 1, range), null, "last month is gone");
  assert.deepEqual(
    selectableDayRange(2025, 2, range),
    [1, 20],
    "and the far end stops exactly a year out"
  );
  assert.equal(selectableDayRange(2025, 3, range), null, "past the horizon is out of range");

  assert.equal(monthPosition(2024, 1, range), "before");
  assert.equal(monthPosition(2024, 2, range), "inside");
  assert.equal(monthPosition(2025, 2, range), "inside");
  assert.equal(monthPosition(2025, 3, range), "after");
});

test("the year list spans the range, and keeps a stored oddity visible", () => {
  const today = new Date(2024, 1, 20);
  const past = yearsInRange(pastRange(today));

  assert.equal(past[0], 2024, "newest first");
  assert.equal(past[past.length - 1], MIN_PURCHASE_YEAR);
  assert.equal(past.includes(2025), false, "an appliance cannot be bought next year");
  assert.deepEqual([...past].sort((a, b) => b - a), past, "strictly descending");

  // A stored value outside the range still has to be visible, or editing that row
  // would silently rewrite its date.
  assert.equal(yearsInRange(pastRange(today), 2030)[0], 2030);

  const future = yearsInRange(futureRange(today));
  assert.deepEqual(future, [2025, 2024], "the service horizon crosses one year boundary");
});

test("a warranty expiry may be either side of today", () => {
  // The one date field that is not bounded by today: a warranty may already have run
  // out, which is exactly why the customer is being asked for it.
  const range = anyRange(new Date(2024, 1, 20));

  assert.equal(MAX_WARRANTY_YEARS, 10);
  assert.deepEqual(selectableDayRange(2024, 2, range), [1, 29], "today is not a boundary here");
  assert.deepEqual(selectableDayRange(2023, 2, range), [1, 28], "an expired warranty is fine");
  assert.deepEqual(selectableDayRange(2034, 2, range), [1, 20], "the ceiling is ten years, exactly");
  assert.equal(selectableDayRange(2034, 3, range), null, "and ten years out is not");
});

test("today is always a legal date for both fields", () => {
  // The boundary the two ranges meet at: today is the last purchase date and the first
  // service date, so neither field may exclude it.
  const today = startOfToday();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const day = today.getDate();

  const past = selectableDayRange(year, month, pastRange(today));
  assert.ok(past[0] <= day && past[1] >= day, "today is selectable as a purchase date");
  const future = selectableDayRange(year, month, futureRange(today));
  assert.ok(future[0] <= day && future[1] >= day, "today is selectable as a service date");
});

// -------------------------------------------------- 3. the caps are wired in

test("both screens cap the identifiers in the field", () => {
  for (const [name, source] of [
    [WIZARD, wizard],
    [PAGE, page],
  ]) {
    assert.match(
      source,
      /maxLength=\{MAX_MODEL_NUMBER_LENGTH\}/,
      `${name} must cap the model number`
    );
    assert.match(
      source,
      /maxLength=\{MAX_SERIAL_NUMBER_LENGTH\}/,
      `${name} must cap the serial number`
    );
    assert.match(
      source,
      /<FieldCounter value=\{.*\} max=\{MAX_\w+_LENGTH\} \/>/,
      `${name} must explain the cap rather than stop typing silently`
    );
    assert.match(
      source,
      /sanitiseCodeInput\(e\.target\.value, MAX_(MODEL|SERIAL)_NUMBER_LENGTH\)/,
      `${name} must drop characters that cannot appear on a rating label`
    );
  }
});

test("both screens clean the identifiers on the way into the payload", () => {
  assert.match(wizard, /model_number: cleanCode\(modelNumber, MAX_MODEL_NUMBER_LENGTH\) \|\| null/);
  assert.match(wizard, /serial_number: cleanCode\(serialNumber, MAX_SERIAL_NUMBER_LENGTH\) \|\| null/);
  assert.match(page, /model_number: cleanCode\(form\.model_number, MAX_MODEL_NUMBER_LENGTH\) \|\| null/);
  assert.match(page, /serial_number: cleanCode\(form\.serial_number, MAX_SERIAL_NUMBER_LENGTH\) \|\| null/);
});

test("every date field is picked, not typed", () => {
  for (const [name, source] of [
    [WIZARD, wizard],
    [PAGE, page],
  ]) {
    assert.match(
      source,
      /<DateSelect[\s\S]{0,140}id="appliance-purchase-date"/,
      `${name} must use the shared picker for the purchase date`
    );
    assert.match(
      source,
      /<DateSelect[\s\S]{0,140}id="warranty-expiry"/,
      `${name} must use it for the warranty expiry too`
    );
    assert.equal(
      [...source.matchAll(/id="appliance-purchase-date"/g)].length,
      1,
      `${name} must not also keep a native input with the same id`
    );
    assert.doesNotMatch(
      source,
      /type="date"/,
      `${name} still has a native date input: on Firefox that is spinner segments with no calendar at all`
    );
    assert.doesNotMatch(
      source,
      /label htmlFor="appliance-purchase-date"/,
      `${name} must let the picker own its own label, or the field is labelled twice`
    );
  }

  // The wizard's other date fields: the requested service date (today .. a year ahead)
  // and the warranty expiry (either side of today).
  assert.match(
    wizard,
    /<DateSelect[\s\S]{0,160}id="preferred-date"/,
    "the service date must use the shared picker too"
  );
  assert.match(wizard, /direction="future"/);
  assert.match(wizard, /direction="any"/);
  assert.match(wizard, /direction="past"/);

  // Three selects, in the order a date is spoken: month, day, year.
  assert.match(dateSelect, /id=\{`\$\{id\}-month`\}/);
  assert.match(dateSelect, /id=\{`\$\{id\}-day`\}/);
  assert.match(dateSelect, /id=\{`\$\{id\}-year`\}/);
  assert.match(dateSelect, /aria-label=\{`\$\{label\} month`\}/);
  assert.match(
    dateSelect,
    /onChange=\{\(e\) => chooseMonth\(Number\(e\.target\.value\)\)\}/,
    "changing the month re-clamps the day"
  );
  assert.match(
    dateSelect,
    /direction === "future"\) return futureRange\(today\)/,
    "all three directions take their bounds from the lib, so they cannot drift apart"
  );
  assert.match(
    dateSelect,
    /disabled=\{chosen && !bounds\}/,
    "a month that has not happened disables the day list"
  );
});

