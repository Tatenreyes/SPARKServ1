import AuthForm from "@/components/AuthForm";
import AuthShell from "@/components/AuthShell";

export default function RegisterPage() {
  return (
    <AuthShell
      headline="Your fridge won't wait. Neither should you."
      subhead="Create an account to get instant troubleshooting tips and matched with an approved technician near you."
    >
      <AuthForm mode="register" />
    </AuthShell>
  );
}
