import { redirect } from "next/navigation";

// The old single-page form has been replaced by the guided Service Inquiry
// wizard. Keeping this route (rather than deleting it) so old links/bookmarks
// still land somewhere useful. The /customer/service-request/[id] detail route
// is unaffected and still handles recommendations, estimates, and booking.
export default function NewServiceRequestPage() {
  redirect("/customer/inquiry");
}
