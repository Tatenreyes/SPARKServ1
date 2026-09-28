import type { UserRole } from "@/types/database";

/**
 * Role presentation used by the dashboard shell. Kept in one dependency-free
 * module so the topbar, the sidebar and `Navbar` can't drift into three
 * slightly different ideas of what a role is called or coloured.
 */

/** Landing route per role — the topbar's brand link, and post-login redirects. */
export const ROLE_HOME: Record<UserRole, string> = {
  customer: "/customer/dashboard",
  technician: "/technician/dashboard",
  admin: "/admin/dashboard",
  super_admin: "/superadmin/dashboard",
};

/** Sentence-case label, short enough to sit inside a pill. */
export const ROLE_LABEL: Record<UserRole, string> = {
  customer: "Customer",
  technician: "Technician",
  admin: "Administrator",
  super_admin: "Super Admin",
};

/**
 * Tailwind class for the role dot. Role identity is a single 6px accent next to
 * a label — deliberately not a whole recoloured chrome, which made the product
 * read as four different products.
 */
export const ROLE_DOT: Record<UserRole, string> = {
  customer: "bg-[#3B82F6]",
  technician: "bg-[#8B5CF6]",
  admin: "bg-[#10B981]",
  super_admin: "bg-[#F43F5E]",
};

/** Roles that have a self-service profile page. Admins have no profile route. */
export const ROLE_PROFILE_HREF: Partial<Record<UserRole, string>> = {
  customer: "/customer/profile",
  technician: "/technician/profile",
};
