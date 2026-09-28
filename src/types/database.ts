// Hand-written types mirroring supabase/schema.sql.
// Once the project is running, you can replace this file with a generated
// version via:
//   npx supabase gen types typescript --project-id YOUR_PROJECT_REF > src/types/database.ts

export type UserRole = "customer" | "technician" | "admin" | "super_admin";
export type RequestStatus =
  | "open"
  | "quoted"
  | "booked"
  | "in_progress"
  | "completed"
  | "cancelled";
export type BookingStatus = "pending" | "in_progress" | "awaiting_inspection" | "completed" | "cancelled";
export type EstimateStatus = "pending" | "accepted" | "rejected";
export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
export type TicketType = "product_inquiry" | "billing_inquiry" | "technical_issue" | "other";
export type TicketPriority = "low" | "medium" | "high" | "critical";
export type VisitStatus = "upcoming" | "in_progress" | "completed";
export type PaymentStatus = "pending_verification" | "confirmed" | "rejected";
export type AssignmentStatus = "matching" | "offered" | "accepted" | "waiting";
export type OfferStatus = "offered" | "accepted" | "rejected";

/**
 * A technician's OPERATIONAL state — deliberately separate from queue
 * membership. A technician can be SCHEDULED (has a future appointment) and
 * still sit at position #2 in the rotation; only a real schedule conflict skips
 * them for a specific request. See QUEUE-SYSTEM.md.
 */
export type OperationalStatus =
  | "AVAILABLE"
  | "ON_JOB"
  | "SCHEDULED"
  | "TEMPORARILY_UNAVAILABLE"
  | "OFFLINE"
  | "SUSPENDED";

/** Every action the queue audit trail can record. */
export type QueueEventAction =
  | "JOINED_QUEUE"
  | "TURN_CONSUMED"
  | "MOVED_TO_END"
  | "POSITION_CHANGED"
  | "SKIPPED_DUE_TO_SCHEDULE"
  | "SKIPPED_DUE_TO_CAPACITY"
  | "SKIPPED_DUE_TO_UNAVAILABLE"
  | "SKIPPED_DUE_TO_SERVICE_AREA"
  | "SKIPPED_DUE_TO_ACTIVE_OFFER"
  | "OFFERED"
  | "ACCEPTED"
  | "DECLINED"
  | "EXPIRED"
  | "REMOVED"
  | "REACTIVATED"
  | "STATUS_CHANGED"
  | "WAITING_FOR_TECHNICIAN"
  | "ADMIN_OVERRIDE";

/** Machine-readable reason a technician was skipped for one request. */
export type EligibilityFailure =
  | "not_available"
  | "suspended"
  | "not_in_queue"
  | "holding_offer"
  | "service_area"
  | "temporarily_unavailable"
  | "outside_availability_window"
  | "schedule_conflict"
  | "capacity_concurrent_job"
  | "capacity_daily_jobs"
  | "capacity_daily_hours";


export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}

export interface UserRow {
  id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  middle_initial: string | null;
  email: string;
  role: UserRole;
  phone: string | null;
  location: string | null;
  address: string | null;
  avatar_url: string | null;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
  created_at: string;
}

export interface TechnicianRow {
  id: string;
  specializations: string[];
  experience_years: number;
  rating: number;
  availability: boolean;
  is_new: boolean;
  active_job_load: number;
  jobs_completed: number;
  approved: boolean;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  // Queue model v2 — operational state and workload limits (see QUEUE-SYSTEM.md)
  operational_status: OperationalStatus;
  status_updated_at: string;
  max_daily_hours: number;
  max_concurrent_jobs: number;
  max_jobs_per_day: number;
  default_job_minutes: number;
}

/** A technician's membership of one appliance type's rotation queue. */
export interface TechnicianQueueStateRow {
  id: string;
  technician_id: string;
  appliance_type: string;
  queue_position: number;
  is_active: boolean;
  turn_count: number;
  last_assigned_at: string | null;
  joined_at: string;
  updated_at: string;
}

/** One row of the audit trail: who was offered/skipped/moved, and why. */
export interface TechnicianQueueEventRow {
  id: string;
  technician_id: string | null;
  appliance_type: string | null;
  repair_request_id: string | null;
  action: QueueEventAction;
  old_position: number | null;
  new_position: number | null;
  reason: string | null;
  actor_id: string | null;
  created_at: string;
}

/** A weekly recurring availability window (0 = Sunday). */
export interface TechnicianAvailabilityRow {
  id: string;
  technician_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TechnicianTimeOffRow {
  id: string;
  technician_id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  created_at: string;
}

export interface TechnicianServiceAreaRow {
  id: string;
  technician_id: string;
  appliance_type: string | null;
  area: string;
  created_at: string;
}

/**
 * What technician_queue_snapshot() returns: the whole queue for an appliance
 * type, with only the fields a technician is allowed to see. No phone numbers,
 * addresses, customer data or documents.
 */
export interface TechnicianQueueSnapshotRow {
  appliance_type: string;
  queue_position: number;
  technician_id: string;
  technician_name: string;
  operational_status: OperationalStatus;
  is_self: boolean;
  is_member_active: boolean;
  is_next_in_queue: boolean;
  queue_status: "NEXT_TURN" | "IN_ROTATION" | "TEMPORARILY_REMOVED";
  next_booking_at: string | null;
  current_job_until: string | null;
  active_offer_request_id: string | null;
  offers_expires_at: string | null;
}

export interface ServiceRequestRow {
  id: string;
  customer_id: string;
  appliance_id: string | null;
  appliance_type: string;
  issue_category: string | null;
  problem_description: string;
  photos: string[];
  service_type: string;
  status: RequestStatus;
  chatbot_resolved: boolean;
  assigned_technician_id: string | null;
  assignment_status: AssignmentStatus;
  offers_expires_at: string | null;
  // The window the customer asked for. NULL means "no time preference", in
  // which case the queue engine cannot raise a schedule conflict.
  requested_window_start: string | null;
  requested_window_end: string | null;
  requested_duration_minutes: number | null;
  created_at: string;
  updated_at: string;
}

export interface TechnicianOfferRow {
  id: string;
  service_request_id: string;
  technician_id: string;
  status: OfferStatus;
  reason: string | null;
  created_at: string;
}

export interface EstimateRow {
  id: string;
  service_request_id: string;
  technician_id: string;
  estimated_cost: number;
  notes: string | null;
  status: EstimateStatus;
  created_at: string;
}

export interface BookingRow {
  id: string;
  service_request_id: string;
  estimate_id: string | null;
  customer_id: string;
  technician_id: string;
  scheduled_at: string;
  /** How long the appointment occupies the technician. Used by conflict and capacity checks. */
  duration_minutes: number;
  status: BookingStatus;
  final_cost: number | null;
  inspection_confirmed_at: string | null;
  inspection_note: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  booking_id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  read: boolean;
  created_at: string;
}

export interface RatingRow {
  id: string;
  booking_id: string;
  customer_id: string;
  technician_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface ServiceHistoryRow {
  id: string;
  booking_id: string;
  customer_id: string;
  technician_id: string;
  appliance_type: string;
  final_cost: number | null;
  completed_at: string;
  summary: string | null;
}

export interface ApplianceRow {
  id: string;
  customer_id: string;
  appliance_type: string;
  brand: string | null;
  model_number: string | null;
  serial_number: string | null;
  purchase_date: string | null;
  warranty_status: string;
  warranty_type: string | null;
  warranty_expiry_date: string | null;
  warranty_proof_url: string | null;
  notes: string | null;
  created_at: string;
}

export interface SupportTicketRow {
  id: string;
  user_id: string;
  subject: string;
  message: string;
  status: TicketStatus;
  type: TicketType;
  priority: TicketPriority;
  created_at: string;
  updated_at: string;
}

export interface VisitRow {
  id: string;
  booking_id: string;
  visit_number: number;
  title: string;
  description: string | null;
  status: VisitStatus;
  scheduled_at: string | null;
  technician_id: string;
  notes: string | null;
  photo_urls: string[];
  signed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentRow {
  id: string;
  booking_id: string;
  customer_id: string;
  payment_method: string;
  gcash_reference: string;
  amount: number;
  status: PaymentStatus;
  payment_date: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
}

export interface SystemSettingRow {
  key: string;
  value: string;
  updated_at: string;
  updated_by: string | null;
}

// Minimal Database type so `createClient<Database>()` type-checks.
// Extend with Insert/Update variants as the project grows.
export interface Database {
  public: {
    Tables: {
      users: { Row: UserRow; Insert: Partial<UserRow>; Update: Partial<UserRow> };
      technicians: {
        Row: TechnicianRow;
        Insert: Partial<TechnicianRow>;
        Update: Partial<TechnicianRow>;
      };
      service_requests: {
        Row: ServiceRequestRow;
        Insert: Partial<ServiceRequestRow>;
        Update: Partial<ServiceRequestRow>;
      };
      estimates: {
        Row: EstimateRow;
        Insert: Partial<EstimateRow>;
        Update: Partial<EstimateRow>;
      };
      technician_offer_history: {
        Row: TechnicianOfferRow;
        Insert: Partial<TechnicianOfferRow>;
        Update: Partial<TechnicianOfferRow>;
      };
      technician_queue_state: {
        Row: TechnicianQueueStateRow;
        Insert: Partial<TechnicianQueueStateRow>;
        Update: Partial<TechnicianQueueStateRow>;
      };
      technician_queue_events: {
        Row: TechnicianQueueEventRow;
        Insert: Partial<TechnicianQueueEventRow>;
        Update: Partial<TechnicianQueueEventRow>;
      };
      technician_availability: {
        Row: TechnicianAvailabilityRow;
        Insert: Partial<TechnicianAvailabilityRow>;
        Update: Partial<TechnicianAvailabilityRow>;
      };
      technician_time_off: {
        Row: TechnicianTimeOffRow;
        Insert: Partial<TechnicianTimeOffRow>;
        Update: Partial<TechnicianTimeOffRow>;
      };
      technician_service_areas: {
        Row: TechnicianServiceAreaRow;
        Insert: Partial<TechnicianServiceAreaRow>;
        Update: Partial<TechnicianServiceAreaRow>;
      };
      notifications: {
        Row: NotificationRow;
        Insert: Partial<NotificationRow>;
        Update: Partial<NotificationRow>;
      };
      push_subscriptions: {
        Row: PushSubscriptionRow;
        Insert: Partial<PushSubscriptionRow>;
        Update: Partial<PushSubscriptionRow>;
      };
      bookings: {
        Row: BookingRow;
        Insert: Partial<BookingRow>;
        Update: Partial<BookingRow>;
      };
      messages: {
        Row: MessageRow;
        Insert: Partial<MessageRow>;
        Update: Partial<MessageRow>;
      };
      ratings: {
        Row: RatingRow;
        Insert: Partial<RatingRow>;
        Update: Partial<RatingRow>;
      };
      service_history: {
        Row: ServiceHistoryRow;
        Insert: Partial<ServiceHistoryRow>;
        Update: Partial<ServiceHistoryRow>;
      };
      appliances: {
        Row: ApplianceRow;
        Insert: Partial<ApplianceRow>;
        Update: Partial<ApplianceRow>;
      };
      support_tickets: {
        Row: SupportTicketRow;
        Insert: Partial<SupportTicketRow>;
        Update: Partial<SupportTicketRow>;
      };
      visits: {
        Row: VisitRow;
        Insert: Partial<VisitRow>;
        Update: Partial<VisitRow>;
      };
      payments: {
        Row: PaymentRow;
        Insert: Partial<PaymentRow>;
        Update: Partial<PaymentRow>;
      };
      system_settings: {
        Row: SystemSettingRow;
        Insert: Partial<SystemSettingRow>;
        Update: Partial<SystemSettingRow>;
      };
    };
    Functions: {
      /**
       * Server-only: walks the appliance queue and offers the request to the
       * first technician who is eligible, available at the requested time and
       * within capacity. Skips never change a queue position.
       */
      assign_technician_to_request: {
        Args: { p_request_id: string };
        Returns: Json;
      };
      /** Server-only: accept (consumes the queue turn) or decline an offer. */
      respond_to_offer: {
        Args: { p_request_id: string; p_technician_id: string; p_action: string; p_reason?: string | null };
        Returns: Json;
      };
      /** Server-only: lapse every offer past its TTL and re-offer it. */
      expire_stale_offers: {
        Args: Record<string, never>;
        Returns: Json;
      };
      /** Server-only: consume a turn outside the offer flow (admin/manual path). */
      consume_queue_turn: {
        Args: {
          p_technician_id: string;
          p_appliance_type: string;
          p_request_id?: string | null;
          p_reason?: string | null;
        };
        Returns: number;
      };
      /** Admin-only (enforced in the function): reason is mandatory and audited. */
      admin_queue_override: {
        Args: { p_appliance_type: string; p_technician_id: string; p_action: string; p_reason: string };
        Returns: Json;
      };
      /** Server-only: recompute + cache a technician's operational status. */
      refresh_technician_operational_status: {
        Args: { p_technician_id: string };
        Returns: string;
      };
      /** Server-only: can this technician take this window? (null = yes) */
      technician_eligibility_failure: {
        Args: {
          p_technician_id: string;
          p_appliance_type: string;
          p_location: string | null;
          p_start: string | null;
          p_end: string | null;
          p_request_id?: string | null;
        };
        Returns: string | null;
      };
      /** Server-only: does this window overlap a real appointment or time off? */
      technician_schedule_conflict: {
        Args: { p_technician_id: string; p_start: string | null; p_end: string | null };
        Returns: boolean;
      };
      /**
       * The full queue for an appliance type (null = every queue the caller
       * belongs to). Callable by a signed-in technician or admin only —
       * customers are refused inside the function.
       */
      technician_queue_snapshot: {
        Args: { p_appliance_type?: string | null };
        Returns: TechnicianQueueSnapshotRow[];
      };
    };
  };
}

/** Postgres `jsonb` / `json` payloads come back as parsed JSON. */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/** Shape returned by assign_technician_to_request(). */
export type AssignmentOutcome = {
  outcome: "offered" | "waiting" | "unchanged";
  request_id: string;
  assigned_technician_id?: string | null;
  assignment_status?: AssignmentStatus;
  offers_expires_at?: string | null;
  queue_position?: number | null;
  skipped?: string[];
};

/** Shape returned by respond_to_offer(). */
export type OfferResponseOutcome = {
  outcome: "accepted" | "declined" | "expired" | "not_offered";
  request_id: string;
  assigned_technician_id?: string | null;
  assignment_status?: AssignmentStatus;
  queue_position?: number | null;
  decline_consumed_turn?: boolean;
  reassignment?: AssignmentOutcome;
};

/** Shape returned by expire_stale_offers(). */
export type ExpiredOffersOutcome = {
  count: number;
  expired: { request_id: string; technician_id: string | null; appliance_type: string }[];
};
