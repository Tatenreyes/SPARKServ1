import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { AuthError, getCurrentUser } from "@/lib/auth";

/**
 * Photo evidence for a repair request.
 *
 * Uploads land in Supabase Storage before the request row is created, so the
 * `service_requests.photos` array contains real, durable public URLs.
 *
 * This replaces the wizard's previous behaviour of storing
 * `URL.createObjectURL(file)` values — `blob:` URLs scoped to the page that
 * created them. Those were persisted to the database and were dead the moment
 * the customer closed the tab, so no technician could ever open the photo they
 * had been sent. The API contract is unchanged (`photos: string[]`); only the
 * strings became real.
 *
 * The bucket is created by `supabase/migration_service_request_photos_bucket.sql`.
 * If it has not been applied the upload fails loudly with a 502 naming the
 * migration — the alternative (accepting the request without its photos) would
 * silently lose the evidence again, which is the bug being fixed.
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 6;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const formData = await request.formData();
    const files = formData
      .getAll("photos")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    if (!files.length) {
      return NextResponse.json({ error: "No photos were uploaded" }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Please attach at most ${MAX_FILES} photos` },
        { status: 400 }
      );
    }
    for (const file of files) {
      if (!ALLOWED_TYPES.has(file.type)) {
        return NextResponse.json(
          { error: "Photos must be JPG, PNG, WebP or HEIC images" },
          { status: 400 }
        );
      }
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: "Each photo must be 10 MB or smaller" },
          { status: 400 }
        );
      }
    }

    const storage = createServiceRoleClient().storage.from("service-request-photos");
    const urls: string[] = [];

    for (const [index, file] of files.entries()) {
      const extension =
        file.type === "image/jpeg"
          ? "jpg"
          : (file.type.split("/")[1] ?? "jpg").replace("quicktime", "jpg");
      const path = `${user.id}/${Date.now()}-${index}-${crypto.randomUUID()}.${extension}`;

      const upload = await storage.upload(path, file, {
        contentType: file.type,
        upsert: false,
      });

      if (upload.error) {
        const message = upload.error.message ?? "";
        const bucketMissing = /bucket/i.test(message);
        return NextResponse.json(
          {
            error: bucketMissing
              ? "Photo uploads are not set up yet. Run supabase/migration_service_request_photos_bucket.sql, then try again."
              : "We could not save one of your photos. Please try again.",
          },
          { status: 502 }
        );
      }

      urls.push(storage.getPublicUrl(path).data.publicUrl);
    }

    return NextResponse.json({ urls });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "Unable to upload photos" }, { status: 500 });
  }
}
