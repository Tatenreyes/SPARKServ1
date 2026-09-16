import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-2xl font-bold text-ink">Not authorized</h1>
      <p className="mt-2 text-ink/65">
        Your account doesn&apos;t have access to that section of SPARKServ.
      </p>
      <Link href="/" className="mt-6 inline-block text-brand-600 hover:underline">
        Back to home
      </Link>
    </div>
  );
}
