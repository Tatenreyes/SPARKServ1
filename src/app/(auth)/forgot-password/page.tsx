import AuthShell from "@/components/AuthShell";
import ForgotPasswordForm from "@/components/ForgotPasswordForm";
import { recoveryLinkNotice } from "@/lib/auth/recovery";

export const metadata = {
  title: "Reset your password — SPARKServ",
  description: "Request a password reset link for your SPARKServ account.",
};

interface ForgotPasswordPageProps {
  searchParams: { error?: string };
}

/**
 * Public request page. The only thing it reads from the URL is the notice the
 * recovery callback leaves behind when a link is expired or already used
 * (`recoveryLinkNotice` maps known codes and ignores anything else, so the page
 * never renders text taken from the URL).
 */
export default function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  return (
    <AuthShell
      headline="Forgot your password?"
      subhead="Tell us the email you signed up with and we'll send you a link to choose a new password."
    >
      <ForgotPasswordForm notice={recoveryLinkNotice(searchParams.error)} />
    </AuthShell>
  );
}
