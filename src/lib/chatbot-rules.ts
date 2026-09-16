import type { ChatbotSuggestion, IssueCategory } from "@/types";

interface IssueRule {
  label: string;
  keywords: string[];
  steps: string[];
}

type ApplianceRules = Record<string, Partial<Record<IssueCategory, IssueRule>>>;

const commonPowerSteps = [
  "Check that the appliance is properly plugged into a working outlet.",
  "Check the circuit breaker or power source.",
  "Try another appliance in the same outlet to check if there is power.",
  "Inspect the power cord for visible damage without touching exposed wiring.",
  "If it still does not turn on, request professional technician assistance.",
];

const troubleshootingKnowledgeBase: ApplianceRules = {
  refrigerator: {
    NOT_TURNING_ON: { label: "Not Turning On", keywords: ["not turning on", "wont turn on", "won't turn on", "no power", "dead", "not starting", "doesn't start", "doesnt start", "walay power", "dili mo andar", "dili mo on", "dili mo-on", "dili moandar", "ref is not turning on"], steps: commonPowerSteps },
    NOT_COOLING: { label: "Not Cooling", keywords: ["not cooling", "not cold", "warm inside", "refrigerator is warm", "ref is warm", "freezer not freezing", "dili bugnaw", "dili na mobugnaw"], steps: ["Check if the temperature setting is set correctly.", "Make sure the refrigerator door is fully closed.", "Check if too much food is blocking the air vents.", "Check the condenser area for excessive dust, only if safely accessible.", "Allow time for cooling after changing the temperature setting.", "If the issue continues, request technician assistance."] },
    MAKING_NOISE: { label: "Making Unusual Noise", keywords: ["making noise", "loud noise", "buzzing", "rattling", "unusual sound", "saba", "kusog ug tingog", "naay tingog"], steps: ["Check that the refrigerator is level and stable.", "Make sure bottles or items inside are not vibrating against each other.", "Leave space around the refrigerator so it is not touching the wall or cabinets.", "Listen for whether the sound changes when the door opens, without removing any panels.", "If the noise is loud, sudden, or continues, request technician assistance."] },
    LEAKING: { label: "Leaking Water", keywords: ["leaking", "water leak", "water underneath", "dripping", "naay tubig", "nagatulo", "ga leak"], steps: ["Place a container or towel under the leak to protect the floor.", "Check that the refrigerator is level and the doors close fully.", "Check the drain pan and visible water line connections for an obvious leak.", "Do not remove panels or touch electrical parts near water.", "If the leak continues, request technician assistance."] },
    NOT_DEFROSTING: { label: "Not Defrosting", keywords: ["ice buildup", "too much ice", "not defrosting", "frozen over", "daghan yelo", "dili mag defrost"], steps: ["Check that the doors close fully and the door seals are clean.", "Avoid blocking the air vents with food.", "Do not chip away ice with sharp tools or pour hot water inside.", "If safe, follow the appliance manual's basic defrost setting.", "If ice quickly builds up again, request technician assistance."] },
  },
  aircon: {
    NOT_TURNING_ON: { label: "Not Turning On", keywords: ["not turning on", "wont turn on", "won't turn on", "no power", "dead", "dili mo andar", "dili mo on"], steps: commonPowerSteps },
    NOT_COOLING: { label: "Not Cooling", keywords: ["not cooling", "not cold", "warm air", "aircon not cold", "dili bugnaw", "dili mobugnaw"], steps: ["Check that the mode is set to Cool and the temperature is below room temperature.", "Clean the accessible air filter if it is dusty.", "Make sure the outdoor unit is not blocked by leaves, dust, or objects.", "Keep doors and windows closed while the unit is running.", "If it still does not cool, request technician assistance."] },
    WATER_LEAKING: { label: "Water Leaking", keywords: ["water leaking", "dripping water", "aircon leaking", "nagagas ang tubig", "nagatulo ang aircon", "ga leak ang aircon"], steps: ["Turn the air conditioner off if water is near electrical outlets or wiring.", "Place a container under the drip to protect the floor.", "Check that the accessible air filter is not heavily blocked.", "Do not open the unit or attempt to clear internal pipes.", "If the leak continues, request technician assistance."] },
    MAKING_NOISE: { label: "Making Unusual Noise", keywords: ["making noise", "loud noise", "buzzing", "rattling", "unusual sound", "saba", "kusog ug tingog"], steps: ["Check that the indoor unit cover and nearby objects are stable.", "Clean the accessible filter if it is dusty.", "Make sure the outdoor unit has clear space around it.", "If the sound is loud, sudden, or accompanied by vibration, turn it off and request help."] },
    WEAK_AIRFLOW: { label: "Weak Airflow", keywords: ["weak airflow", "weak air", "low airflow", "hinay ang hangin", "hinay ang buga"], steps: ["Clean the accessible air filter if it is dusty.", "Make sure the air outlet is not blocked by curtains or furniture.", "Check that the fan speed is not set to its lowest setting.", "If airflow remains weak, request technician assistance."] },
  },
  washing_machine: {
    NOT_TURNING_ON: { label: "Not Turning On", keywords: ["not turning on", "wont turn on", "won't turn on", "no power", "dead", "dili mo andar", "dili mo on"], steps: commonPowerSteps },
    NOT_SPINNING: { label: "Not Spinning", keywords: ["not spinning", "wont spin", "won't spin", "doesn't spin", "doesnt spin", "dili mo tuyok", "dili motuyok"], steps: ["Make sure the lid or door is fully closed.", "Redistribute clothes evenly if the load is unbalanced.", "Check that the selected cycle includes a spin step.", "Do not reach into the drum while it is moving.", "If it still will not spin, request technician assistance."] },
    NOT_DRAINING: { label: "Not Draining", keywords: ["not draining", "wont drain", "won't drain", "water not draining", "dili mo drain", "dili moawas ang tubig"], steps: ["Turn the machine off before checking anything around the drain.", "Check the visible drain hose for kinks.", "Make sure the drain hose is positioned correctly according to the manual.", "Do not remove internal panels or reach into the pump.", "If water remains, request technician assistance."] },
    WATER_LEAKING: { label: "Water Leaking", keywords: ["water leaking", "leaking water", "dripping", "nagatulo", "ga leak", "naay tubig"], steps: ["Stop the cycle and turn off the water supply if it is safe.", "Check the visible inlet hose connections for looseness.", "Check that the drain hose is not displaced or kinked.", "Do not use the machine if water is near electrical connections.", "If the leak continues, request technician assistance."] },
    MAKING_NOISE: { label: "Making Unusual Noise", keywords: ["making noise", "loud noise", "buzzing", "rattling", "unusual sound", "saba", "kusog ug tingog"], steps: ["Pause the cycle and check that the machine is level.", "Redistribute the load evenly inside the drum.", "Check pockets for loose objects when the machine is off.", "If the noise continues or the machine moves violently, stop using it and request help."] },
  },
  tv: {
    NOT_TURNING_ON: { label: "Not Turning On", keywords: ["not turning on", "wont turn on", "won't turn on", "no power", "dead", "dili mo andar", "dili mo on"], steps: commonPowerSteps },
    NO_DISPLAY: { label: "No Display", keywords: ["no display", "black screen", "no picture", "walay display", "itom ang screen"], steps: ["Confirm the TV is powered on and the status light responds.", "Press the Input or Source button and select the correct source.", "Check that the connected device and HDMI cable are seated properly.", "Try a different source or cable if available.", "If the screen remains blank, request technician assistance."] },
    NO_SOUND: { label: "No Sound", keywords: ["no sound", "no audio", "walay tingog", "dili mo tingog"], steps: ["Check that the TV is not muted and increase the volume.", "Confirm the correct audio output is selected.", "Try another channel or source.", "Reconnect any external speaker or HDMI cable.", "If there is still no sound, request technician assistance."] },
    SCREEN_FLICKERING: { label: "Screen Flickering", keywords: ["screen flickering", "flickering screen", "screen blinking", "nagakurap ang screen", "kurap"], steps: ["Check that the video cable is firmly connected.", "Try another input source to see whether the issue follows the source.", "Turn the TV off, unplug it, wait briefly, and reconnect it.", "Avoid opening the TV or pressing the screen.", "If flickering continues, request technician assistance."] },
  },
  electric_fan: {
    NOT_TURNING_ON: { label: "Not Turning On", keywords: ["not turning on", "wont turn on", "won't turn on", "no power", "dead", "dili mo andar", "dili mo on"], steps: commonPowerSteps },
    NOT_SPINNING: { label: "Not Spinning", keywords: ["not spinning", "wont spin", "won't spin", "dili motuyok", "dili mo tuyok"], steps: ["Switch the fan off and unplug it.", "Check that nothing is blocking the blades from outside the guard.", "Try a different speed setting after reconnecting it.", "Do not remove the guard or touch internal wiring.", "If it still will not spin, request technician assistance."] },
    SLOW_SPINNING: { label: "Spinning Slowly", keywords: ["slow spinning", "spinning slowly", "slow fan", "hinay motuyok", "hinay ang tuyok"], steps: ["Switch the fan off and unplug it before cleaning.", "Clean dust from the accessible guard and blades.", "Check that the speed setting is appropriate.", "Do not apply oil or open the motor unless directed by the manual.", "If it remains slow, request technician assistance."] },
    MAKING_NOISE: { label: "Making Unusual Noise", keywords: ["making noise", "loud noise", "buzzing", "rattling", "unusual sound", "saba", "kusog ug tingog"], steps: ["Switch the fan off and check that it is standing level.", "Check the guard and visible screws for looseness without disassembling it.", "Clean accessible dust after unplugging the fan.", "Stop using it if there is burning smell, smoke, or unusual heat.", "If the noise continues, request technician assistance."] },
  },
  other: {
    NOT_TURNING_ON: { label: "Not Turning On", keywords: ["not turning on", "wont turn on", "won't turn on", "no power", "dead", "dili mo andar", "dili mo on"], steps: commonPowerSteps },
    OTHER: { label: "Not Working Properly", keywords: ["not working properly", "not working", "dili mo andar", "dili sakto", "guba"], steps: ["Check that the appliance is connected to its power source correctly.", "Review the appliance manual for a basic reset or operating check.", "Check only visible controls, plugs, and connections for obvious issues.", "Do not open the appliance or touch internal components.", "If the problem continues, request technician assistance."] },
    MAKING_NOISE: { label: "Making Unusual Noise", keywords: ["making noise", "loud noise", "buzzing", "rattling", "unusual sound", "saba", "kusog ug tingog"], steps: ["Turn the appliance off and check that it is stable.", "Remove loose items around or on top of the appliance.", "Do not remove covers or inspect internal components.", "Stop using it if the sound is accompanied by heat, smoke, or a burning smell.", "If the noise continues, request technician assistance."] },
    WATER_LEAKING: { label: "Leaking Water", keywords: ["water leaking", "leaking water", "dripping", "nagatulo", "ga leak", "naay tubig"], steps: ["Turn the appliance off if water is near electrical connections.", "Place a towel or container under the leak.", "Check only visible hose connections for an obvious issue.", "Do not open panels or handle electrical parts near water.", "If the leak continues, request technician assistance."] },
  },
};

const SAFETY_KEYWORDS = ["burning smell", "smell burning", "something burning", "burning", "burnt smell", "smoke", "sparks", "spark", "exposed wire", "exposed wiring", "electrical shock", "got shocked", "nakuryente"];
const CLARIFY_THRESHOLD = 0.6;

function displayAppliance(applianceType: string | null) {
  return (applianceType ?? "appliance").replace("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function getChatbotResponse(rawMessage: string, applianceType?: string | null, forcedCategory?: IssueCategory | null): ChatbotSuggestion {
  const message = rawMessage.toLowerCase().trim();
  const appliance = applianceType ?? Object.keys(troubleshootingKnowledgeBase).find((type) => message.includes(type));

  const matchedSafety = SAFETY_KEYWORDS.filter((keyword) => message.includes(keyword));
  if (matchedSafety.length > 0) {
    return { matched: true, applianceType: appliance ?? null, issueCategory: "SAFETY_HAZARD", confidence: 1, matchedKeywords: matchedSafety, message: "Please unplug the appliance if it is safe to do so and avoid using it. Because you reported a possible electrical hazard, we recommend professional technician assistance immediately.", tips: [], shouldEscalate: true, safetyWarning: true, needsClarification: false };
  }

  const rules = appliance ? troubleshootingKnowledgeBase[appliance] : undefined;
  if (!rules) return clarificationResponse(appliance, "Please select your appliance first so I can identify the correct issue.");

  if (forcedCategory && rules[forcedCategory]) {
    const rule = rules[forcedCategory];
    return { matched: true, applianceType: appliance ?? null, issueCategory: forcedCategory, confidence: 1, matchedKeywords: [], message: `Detected Issue: ${displayAppliance(appliance ?? null)} - ${rule.label}`, tips: rule.steps, shouldEscalate: true, safetyWarning: false, needsClarification: false, issueOptions: [] };
  }

  const matches = Object.entries(rules)
    .map(([category, rule]) => ({ category: category as IssueCategory, rule, matchedKeywords: rule.keywords.filter((keyword) => message.includes(keyword)) }))
    .filter((result) => result.matchedKeywords.length > 0)
    .sort((a, b) => b.matchedKeywords.join("").length - a.matchedKeywords.join("").length);
  const best = matches[0];
  if (!best) return clarificationResponse(appliance, `I couldn't confidently identify the issue with your ${displayAppliance(appliance ?? null)}.`);

  const confidence = Math.min(0.98, 0.62 + Math.min(best.matchedKeywords.length, 3) * 0.1);
  if (confidence < CLARIFY_THRESHOLD) return clarificationResponse(appliance, "To provide the correct troubleshooting steps, please choose the problem that best describes the issue.");

  return { matched: true, applianceType: appliance ?? null, issueCategory: best.category, confidence, matchedKeywords: best.matchedKeywords, message: `Detected Issue: ${displayAppliance(appliance ?? null)} - ${best.rule.label}`, tips: best.rule.steps, shouldEscalate: true, safetyWarning: false, needsClarification: false, issueOptions: [] };
}

function clarificationResponse(applianceType: string | null | undefined, message: string): ChatbotSuggestion {
  const issueOptions = applianceType && troubleshootingKnowledgeBase[applianceType] ? Object.entries(troubleshootingKnowledgeBase[applianceType]).map(([value, rule]) => ({ value: value as IssueCategory, label: rule.label })) : [];
  return { matched: false, applianceType: applianceType ?? null, issueCategory: null, confidence: 0, matchedKeywords: [], message, tips: [], shouldEscalate: false, safetyWarning: false, needsClarification: true, issueOptions };
}
