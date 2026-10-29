/**
 * Preliminary troubleshooting guides, keyed by canonical issue.
 *
 * These are **optional preliminary checks**, never a professional diagnosis and
 * never a repair instruction. Every step is deliberately conservative: look,
 * listen, check the obvious, and stop if anything looks unsafe.
 *
 * ## How a guide is found
 * `getTroubleshootingGuide(applianceType, issueId)` looks up
 *   1. `${applianceSlug}/${issueId}` — an appliance-specific override, then
 *   2. `issueId`                    — the shared guide for that issue.
 * It returns `null` when the issue has no guide (or does not belong to the
 * appliance), and the form then says so instead of inventing instructions.
 *
 * ## Safety rules for anyone adding a step
 *   * no opening cabinets, panels or covers;
 *   * no exposed wiring, no work on live parts, no refrigerant handling;
 *   * no bypassing safety interlocks, no component-level repair;
 *   * anything past "switch it off, plug it back in, clean the filter" ends with
 *     `STOP_AND_BOOK`.
 * `scripts/tests/troubleshooting-guides.test.mjs` fails the suite if a step
 * breaks these rules.
 */

import { applianceSlug, getIssueById, type ApplianceIssue } from "./appliance-issues.ts";

export interface TroubleshootingStep {
  title: string;
  detail: string;
}

/** Shown above every guide, so the framing can never drift per screen. */
export const TROUBLESHOOTING_DISCLAIMER =
  "These are optional preliminary checks, not a professional diagnosis. You can skip them at any time and continue with your repair request.";

/** Shown when the identified issue has no guide. */
export const NO_GUIDE_MESSAGE =
  "No troubleshooting guide is available for this issue. You can continue with your repair request.";

// ---------------------------------------------------------------- shared steps

const SAFETY_OFF: TroubleshootingStep = {
  title: "Switch it off first",
  detail:
    "Switch the unit off and unplug it (or switch off its breaker) before checking anything. If you smell burning or see damaged cables, stop and submit your request.",
};

const POWER_OUTLET: TroubleshootingStep = {
  title: "Confirm the power",
  detail:
    "Make sure the plug is fully seated and test the outlet with another device. Reset the breaker if it has tripped.",
};

const POWER_SWITCH: TroubleshootingStep = {
  title: "Check the unit's own switch",
  detail:
    "Some units have a power switch or child lock of their own — make sure it is on, then wait a few seconds for the display.",
};

const NO_OPEN: TroubleshootingStep = {
  title: "Keep to the outside",
  detail:
    "Everything below is done from outside the unit. Anything inside it — motors, wiring or gas lines — is a job for a qualified technician.",
};

const WATER_SHUTOFF: TroubleshootingStep = {
  title: "Stop the water and dry the area",
  detail:
    "Turn off the water supply and the power, then dry the floor so nobody slips before checking anything else.",
};

const HOSE_CHECK: TroubleshootingStep = {
  title: "Check the visible hoses and seals",
  detail:
    "Look for kinks, cracks or loose connections on the hoses and seals you can see from outside. Do not unscrew fittings to investigate further.",
};

const CAPTURE_CODE: TroubleshootingStep = {
  title: "Write down the error code",
  detail:
    "Note the exact code or flashing pattern on the display — it narrows the fault down quickly for the technician.",
};

const POWER_CYCLE: TroubleshootingStep = {
  title: "Power-cycle it once",
  detail:
    "Unplug the unit for a full minute, plug it back in and see whether the code clears on its own.",
};

const NOTE_NOISE: TroubleshootingStep = {
  title: "Note when the noise happens",
  detail:
    "Write down whether it starts on power-up, spinning, draining or cooling, and whether it is a rattle, grind or hum — it helps the technician a lot.",
};

const CLEAR_OBSTRUCTION: TroubleshootingStep = {
  title: "Clear anything in the way",
  detail:
    "With the unit switched off, move anything that touches or blocks it, and make sure it stands level on a firm surface.",
};

const TEMP_SETTING: TroubleshootingStep = {
  title: "Check the setting",
  detail:
    "Confirm the thermostat or mode is where you expect, then give the unit a few hours to recover before judging it.",
};

const DOOR_SEAL: TroubleshootingStep = {
  title: "Check the door seal",
  detail:
    "Close the door firmly and run a hand along the seal for gaps, cracks or food caught in it.",
};

const CLEAR_VENTS: TroubleshootingStep = {
  title: "Clear the vents and airflow",
  detail:
    "Make sure vents, filters and the space around the unit are not blocked by food, dust or furniture.",
};

const FILTER_CLEAN: TroubleshootingStep = {
  title: "Clean the filter",
  detail: "Remove, rinse and dry the filter, then refit it before running the unit again.",
};

const DRAIN_CHECK: TroubleshootingStep = {
  title: "Check the drain and filter",
  detail:
    "Look for a kinked or blocked drain hose, and clean the visible lint or debris filter if your machine has one.",
};

const LOAD_LID: TroubleshootingStep = {
  title: "Check the load and the lid",
  detail: "Reduce an overloaded drum and make sure the lid or door is fully latched.",
};

const INPUT_CHECK: TroubleshootingStep = {
  title: "Check the cables and source",
  detail:
    "Reseat the power and signal cables, then try another source, channel or input to see whether the fault follows the unit.",
};

const REMOTE_CHECK: TroubleshootingStep = {
  title: "Try the remote's basics",
  detail:
    "Fit fresh batteries, point the remote straight at the unit, and check whether the unit's own panel buttons still work.",
};

const STOP_AND_BOOK: TroubleshootingStep = {
  title: "If it is not fixed, stop there",
  detail:
    "Do not open the unit or attempt a repair. Submit your request and a qualified technician will take it from here.",
};

// ---------------------------------------------------------------------- guides

const GUIDES: Record<string, TroubleshootingStep[]> = {
  "not-cooling": [TEMP_SETTING, DOOR_SEAL, CLEAR_VENTS, NO_OPEN, STOP_AND_BOOK],
  // An air conditioner has no door, and its filter is the usual culprit.
  "air-conditioner/not-cooling": [
    { ...TEMP_SETTING, title: "Check the mode and setting" },
    FILTER_CLEAN,
    {
      title: "Give the outdoor unit room",
      detail:
        "Clear leaves, boxes or laundry away from the outdoor unit so air can move through it.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "not-turning-on": [POWER_OUTLET, POWER_SWITCH, NO_OPEN, STOP_AND_BOOK],
  "leaking-water": [SAFETY_OFF, WATER_SHUTOFF, HOSE_CHECK, NO_OPEN, STOP_AND_BOOK],
  leaking: [SAFETY_OFF, WATER_SHUTOFF, HOSE_CHECK, NO_OPEN, STOP_AND_BOOK],
  "making-unusual-noise": [NOTE_NOISE, CLEAR_OBSTRUCTION, NO_OPEN, STOP_AND_BOOK],
  "making-noise": [NOTE_NOISE, CLEAR_OBSTRUCTION, NO_OPEN, STOP_AND_BOOK],
  "error-code": [CAPTURE_CODE, POWER_CYCLE, NO_OPEN, STOP_AND_BOOK],
  "weak-airflow": [FILTER_CLEAN, CLEAR_VENTS, NO_OPEN, STOP_AND_BOOK],
  "not-spinning": [
    LOAD_LID,
    {
      title: "Check it stands level",
      detail: "A machine that rocks or leans can refuse to spin — check the feet and the floor.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "not-draining": [DRAIN_CHECK, NO_OPEN, STOP_AND_BOOK],
  "not-filling": [
    {
      title: "Check the tap and inlet hose",
      detail: "Confirm the water tap is fully open and the inlet hose is not kinked or squashed.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "not-heating": [POWER_OUTLET, TEMP_SETTING, NO_OPEN, STOP_AND_BOOK],
  "microwave-oven/not-heating": [
    {
      title: "Check the setting and the door",
      detail:
        "Confirm the power level and timer are set, and that the door latches fully. Never run a microwave empty or with the door open.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "water-heater/not-heating": [
    {
      title: "Check the breaker and the valve",
      detail:
        "Confirm the breaker is on and the water valve is open. Do not open the unit or drain it yourself.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "electric-kettle/not-heating": [
    {
      title: "Check the base and the lid",
      detail: "Make sure the kettle sits squarely on its base, the lid is closed and the base is dry.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "not-freezing": [TEMP_SETTING, DOOR_SEAL, CLEAR_VENTS, NO_OPEN, STOP_AND_BOOK],
  "freezer-not-freezing": [TEMP_SETTING, DOOR_SEAL, CLEAR_VENTS, NO_OPEN, STOP_AND_BOOK],
  "over-freezing": [
    { ...TEMP_SETTING, title: "Check the temperature dial" },
    {
      title: "Check the placement",
      detail: "Keep food away from the rear vents and off the coldest shelf while you wait.",
    },
    STOP_AND_BOOK,
  ],
  "not-defrosting": [
    DOOR_SEAL,
    {
      title: "Check the defrost drain",
      detail:
        "Look at the back of the fridge compartment for a blocked drain. Do not chip at the ice with a tool.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "not-making-ice": [
    {
      title: "Check the ice maker basics",
      detail:
        "Confirm the ice maker is switched on and the freezer has reached its normal temperature.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "ice-frost-formation": [
    {
      title: "Switch off and let it thaw",
      detail: "Switch the unit off and let the ice melt naturally. Never chip or pry at it.",
    },
    FILTER_CLEAN,
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "remote-not-working": [REMOTE_CHECK, NO_OPEN, STOP_AND_BOOK],
  "no-display": [INPUT_CHECK, POWER_OUTLET, NO_OPEN, STOP_AND_BOOK],
  "no-sound": [
    {
      title: "Check volume and mute",
      detail:
        "Confirm the volume is up, mute is off, and the audio output is set to the right speaker.",
    },
    INPUT_CHECK,
    STOP_AND_BOOK,
  ],
  "screen-flickering": [
    INPUT_CHECK,
    {
      title: "Check the outlet",
      detail:
        "If a heavy appliance shares the same outlet or extension lead, try a different outlet and see whether the flicker stops.",
    },
    STOP_AND_BOOK,
  ],
  "lines-on-screen": [INPUT_CHECK, NO_OPEN, STOP_AND_BOOK],
  "weak-suction": [
    {
      title: "Empty it and clean the filter",
      detail: "Empty the bin, clean the filter and look for a blockage in the hose.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "not-dispensing": [
    {
      title: "Check the water supply",
      detail: "Confirm the bottle or tank has water, the tap is not blocked and the unit is level.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "not-cooling-heating": [
    {
      title: "Check the mode switch",
      detail:
        "Confirm the cooling/heating switch is on the side you expect, then give it a few minutes to change over.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "not-cooking": [
    {
      title: "Check the pot and the plate",
      detail:
        "Confirm the inner pot sits flat, the heating plate is clean and dry, and the switch clicks down when you press it.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  // `other` deliberately has NO guide: SPARKServ does not know what the fault is,
  // so it says so instead of inventing instructions.
};


/**
 * The guide for an identified issue, or `null` when there is none.
 *
 * The issue must belong to the appliance — an issue id from another appliance's
 * catalogue returns `null`, so instructions can never appear under the wrong
 * appliance. There is deliberately NO appliance-only lookup: knowing the
 * appliance tells us nothing about what is wrong with it, which is exactly why
 * the old rail showed steps the moment an appliance was picked.
 */
export function getTroubleshootingGuide(
  applianceType: string,
  issueId: string | null | undefined
): TroubleshootingStep[] | null {
  const issue: ApplianceIssue | null = getIssueById(applianceType, issueId);
  if (!issue) return null;

  const specific = GUIDES[`${applianceSlug(applianceType)}/${issue.id}`];
  if (specific?.length) return specific;

  const shared = GUIDES[issue.id];
  return shared?.length ? shared : null;
}
