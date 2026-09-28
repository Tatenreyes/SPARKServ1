export * from "./database";

// `TechnicianWithScore` used to live here: a rating/experience/distance score
// with a boolean `availability` flag, produced by lib/recommendation.ts and
// served by POST /api/recommend. Both are gone. The queue is a fair rotation
// (QUEUE-SYSTEM.md), so nothing in this app ranks technicians, and availability
// is a per-request schedule check, never a stored boolean on a person.


