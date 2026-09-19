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
