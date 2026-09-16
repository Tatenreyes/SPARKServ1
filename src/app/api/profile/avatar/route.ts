import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { AuthError, getCurrentUser } from "@/lib/auth";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const file = (await request.formData()).get("avatar");
    if (!(file instanceof File)) return NextResponse.json({ error: "Please select an image" }, { status: 400 });
    if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: "Use a JPG, PNG, or WebP image" }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "Image must be 5 MB or smaller" }, { status: 400 });

    const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
    const path = `${user.id}/avatar-${Date.now()}.${extension}`;
    const storage = createServiceRoleClient().storage.from("profile-photos");
    const upload = await storage.upload(path, file, { contentType: file.type, upsert: false });
    if (upload.error) throw upload.error;

    const { data: publicUrl } = storage.getPublicUrl(path);
    const supabase = createServiceRoleClient();
    const { error } = await supabase.from("users").update({ avatar_url: publicUrl.publicUrl }).eq("id", user.id);
    if (error) throw error;

    return NextResponse.json({ avatar_url: publicUrl.publicUrl });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Unable to upload profile picture" }, { status: 500 });
  }
}
