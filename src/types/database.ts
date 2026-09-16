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
  email: string;
  role: UserRole;
  phone: string | null;
  location: string | null;
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
}

export interface ServiceRequestRow {
  id: string;
  customer_id: string;
  appliance_type: string;
  issue_description: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  status: RequestStatus;
  chatbot_resolved: boolean;
  assigned_technician_id: string | null;
  assignment_status: AssignmentStatus;
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

export interface TechnicianQueueStateRow {
  technician_id: string;
  appliance_type: string;
  last_assigned_at: string | null;
  updated_at: string;
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
  status: BookingStatus;
  final_cost: number | null;
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
  name: string;
  appliance_type: string;
  brand: string | null;
  model: string | null;
  purchase_date: string | null;
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
  };
}
