export * from "./database";

export interface TechnicianWithScore {
  id: string;
  name: string;
  specializations: string[];
  experience_years: number;
  rating: number;
  availability: boolean;
  is_new: boolean;
  active_job_load: number;
  distance_km: number | null;
  score: number;
  breakdown: {
    ratingComponent: number;
    experienceComponent: number;
    availabilityComponent: number;
    distanceComponent: number;
    newTechBoost: number;
    starvationBoost: number;
  };
}

export interface ChatbotSuggestion {
  matched: boolean;
  applianceType: string | null;
  issueCategory: IssueCategory | null;
  confidence: number;
  matchedKeywords: string[];
  message: string;
  tips: string[];
  shouldEscalate: boolean;
  safetyWarning: boolean;
  needsClarification: boolean;
  issueOptions?: { value: IssueCategory; label: string }[];
}

export type IssueCategory =
  | "NOT_TURNING_ON"
  | "NOT_COOLING"
  | "MAKING_NOISE"
  | "LEAKING"
  | "NOT_DEFROSTING"
  | "WATER_LEAKING"
  | "WEAK_AIRFLOW"
  | "NOT_SPINNING"
  | "NOT_DRAINING"
  | "NO_DISPLAY"
  | "NO_SOUND"
  | "SCREEN_FLICKERING"
  | "SLOW_SPINNING"
  | "OTHER"
  | "SAFETY_HAZARD";
