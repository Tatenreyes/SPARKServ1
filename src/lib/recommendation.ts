import type { TechnicianRow, UserRow } from "@/types/database";
import type { TechnicianWithScore } from "@/types";

/**
 * ============================================================
 * SPARKServ Technician Recommendation Engine
 * ============================================================
 * Score = (Weight_rating × rating)
 *       + (Weight_experience × experience)
 *       + (Weight_availability × availability)
 *       + (Weight_distance × (1 / distance))
 *       + NewTechBoost (if the technician is new)
 *       + StarvationBoost (inversely proportional to active job load)
 *
 * All weights are configurable constants below — tune them without
 * touching the scoring logic itself.
 * ============================================================
 */

export const RECOMMENDATION_WEIGHTS = {
  rating: 20, // rating is 0.0–5.0, so max contribution = 100
  experience: 4, // experience_years, soft-capped at 10 yrs below → max contribution = 40
  availability: 30, // flat bonus if currently available (0 or 1 × weight)
  distance: 50, // multiplied by (1 / distance_km); closer technicians score much higher
  newTechBoost: 15, // flat bonus for technicians flagged is_new
  starvation: {
    weight: 25, // max possible starvation boost
    jobThreshold: 5, // active_job_load at/above this receives ~0 starvation boost
  },
  experienceCap: 10, // years of experience beyond this stop adding score (diminishing returns)
  minDistanceKm: 0.5, // floor to avoid division blowing up for near-zero distances
} as const;

/**
 * Haversine distance between two lat/lng points, in kilometers.
 */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371; // Earth radius in km

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Anti-starvation boost: technicians sitting idle with few/no active jobs
 * get a bonus so the same top-rated techs don't monopolize every job.
 * Scales linearly from full weight at 0 active jobs down to ~0 at the
 * configured jobThreshold.
 */
function starvationBoost(activeJobLoad: number): number {
  const { weight, jobThreshold } = RECOMMENDATION_WEIGHTS.starvation;
  const ratio = Math.max(0, 1 - activeJobLoad / jobThreshold);
  return weight * ratio;
}

/**
 * Compute a single technician's score + component breakdown.
 * distanceKm = null means we couldn't compute distance (e.g. missing coords) —
 * in that case the distance component is simply omitted (scored as 0), it does
 * not disqualify the technician.
 */
export function scoreTechnician(
  technician: TechnicianRow,
  distanceKm: number | null
): TechnicianWithScore["breakdown"] & { total: number } {
  const w = RECOMMENDATION_WEIGHTS;

  const ratingComponent = w.rating * Math.min(technician.rating, 5);

  const cappedExperience = Math.min(technician.experience_years, w.experienceCap);
  const experienceComponent = w.experience * cappedExperience;

  const availabilityComponent = technician.availability ? w.availability : 0;

  let distanceComponent = 0;
  if (distanceKm !== null) {
    const safeDistance = Math.max(distanceKm, w.minDistanceKm);
    distanceComponent = w.distance * (1 / safeDistance);
  }

  const newTechBoost = technician.is_new ? w.newTechBoost : 0;
  const starvation = starvationBoost(technician.active_job_load);

  const total =
    ratingComponent +
    experienceComponent +
    availabilityComponent +
    distanceComponent +
    newTechBoost +
    starvation;

  return {
    ratingComponent,
    experienceComponent,
    availabilityComponent,
    distanceComponent,
    newTechBoost,
    starvationBoost: starvation,
    total,
  };
}

interface RankInput {
  technicians: TechnicianRow[];
  users: Pick<UserRow, "id" | "name" | "latitude" | "longitude">[];
  applianceType: string;
  requestLat: number | null;
  requestLng: number | null;
  /** Only rank technicians who are approved by an admin */
  requireApproved?: boolean;
}

/**
 * Rank a pool of technicians for a given service request.
 * 1. Filters to approved + (ideally) specialization-matching technicians.
 * 2. Scores each with scoreTechnician().
 * 3. Sorts descending by score.
 *
 * Falls back to the full technician pool if nobody's specializations
 * match exactly, so a request never comes back empty just because the
 * appliance_type string didn't match perfectly.
 */
export function rankTechnicians({
  technicians,
  users,
  applianceType,
  requestLat,
  requestLng,
  requireApproved = true,
}: RankInput): TechnicianWithScore[] {
  const userMap = new Map(users.map((u) => [u.id, u]));

  const pool = requireApproved
    ? technicians.filter((t) => t.approved)
    : technicians;

  const normalizedAppliance = applianceType.trim().toLowerCase();
  const specializationMatches = pool.filter((t) =>
    t.specializations.some(
      (s) => s.trim().toLowerCase() === normalizedAppliance
    )
  );
  const candidates = specializationMatches.length > 0 ? specializationMatches : pool;

  const ranked = candidates.map((technician) => {
    const user = userMap.get(technician.id);
    let distanceKm: number | null = null;

    if (
      requestLat !== null &&
      requestLng !== null &&
      user?.latitude != null &&
      user?.longitude != null
    ) {
      distanceKm = haversineDistanceKm(
        requestLat,
        requestLng,
        user.latitude,
        user.longitude
      );
    }

    const { total, ...breakdown } = scoreTechnician(technician, distanceKm);

    const result: TechnicianWithScore = {
      id: technician.id,
      name: user?.name ?? "Unknown technician",
      specializations: technician.specializations,
      experience_years: technician.experience_years,
      rating: technician.rating,
      availability: technician.availability,
      is_new: technician.is_new,
      active_job_load: technician.active_job_load,
      distance_km: distanceKm !== null ? Math.round(distanceKm * 10) / 10 : null,
      score: Math.round(total * 100) / 100,
      breakdown,
    };
    return result;
  });

  return ranked.sort((a, b) => b.score - a.score);
}
