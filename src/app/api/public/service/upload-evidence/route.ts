import { nanoid } from "nanoid";
import { NextRequest, NextResponse } from "next/server";

import { requireServiceAccess, PublicAccessError } from "@/lib/public-access";
import { generatePresignedUrl, handleR2Error, isAllowedImageType } from "@/lib/r2";
import { IMAGE_UPLOAD_CONSTRAINTS } from "@/types/r2";
import type { R2Env } from "@/types/r2";

// Get environment variables for R2
function getEnv(): R2Env {
  return {
    R2_BUCKET: undefined as any, // Not used in presigned URL generation
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID!,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY!,
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID!,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME!,
    PUBLIC_DOMAIN: process.env.PUBLIC_DOMAIN!,
    PRESIGNED_URL_EXPIRY: process.env.PRESIGNED_URL_EXPIRY || "3600",
  };
}

function buildPublicUrl(env: R2Env, key: string): string {
  const base = env.PUBLIC_DOMAIN.trim();
  if (!base) {
    throw new Error("PUBLIC_DOMAIN não está configurado");
  }

  const trimmed = base.replace(/\/$/, "");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return `${trimmed}/${key}`;
  }

  return `https://${trimmed}/${key}`;
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const serviceId = searchParams.get("serviceId")?.trim() ?? "";
    const token = searchParams.get("token")?.trim() ?? undefined;

    if (!serviceId) {
      return NextResponse.json({ ok: false, error: "serviceId obrigatório" }, { status: 400 });
    }

    await requireServiceAccess(token ?? "", serviceId);

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Arquivo não enviado" }, { status: 400 });
    }

    // Validate file type
    if (!isAllowedImageType(file.type)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Tipo de imagem inválido. Formatos permitidos: ${IMAGE_UPLOAD_CONSTRAINTS.allowedTypes.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > IMAGE_UPLOAD_CONSTRAINTS.maxSize) {
      return NextResponse.json(
        {
          ok: false,
          error: `Imagem deve ter até ${IMAGE_UPLOAD_CONSTRAINTS.maxSize / 1024 / 1024}MB`,
        },
        { status: 400 }
      );
    }

    // Build R2 key for service update evidence
    const ext = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() : "jpg";
    const filename = `${Date.now()}-${nanoid(8)}.${ext || "jpg"}`;
    const key = `services/${serviceId}/updates/${filename}`;

    // Get environment variables
    const env = getEnv();

    // Validate environment variables
    if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
      return NextResponse.json(
        { ok: false, error: "Storage de fotos ainda não configurado no ambiente" },
        { status: 500 }
      );
    }

    // Step 1: Generate presigned URL for upload
    const presignedUrl = await generatePresignedUrl(env, key, "put", {
      contentType: file.type,
      expirySeconds: 900, // 15 minutes to complete upload
    });

    // Step 2: Convert File to Buffer and upload via presigned URL
    const buffer = Buffer.from(await file.arrayBuffer());

    const uploadResponse = await fetch(presignedUrl.url, {
      method: "PUT",
      headers: {
        "Content-Type": file.type,
        "Content-Length": buffer.length.toString(),
        "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
      },
      body: buffer,
    });

    if (!uploadResponse.ok) {
      console.error(
        "[api/public/service/upload-evidence] R2 upload failed",
        await uploadResponse.text()
      );
      return NextResponse.json(
        {
          ok: false,
          error: `Falha ao salvar foto no R2: ${uploadResponse.statusText}`,
        },
        { status: 502 }
      );
    }

    // Step 3: Return success with public URL
    const publicUrl = buildPublicUrl(env, key);

    return NextResponse.json({
      ok: true,
      evidence: {
        url: publicUrl,
        label: file.name,
        key: key,
      },
    });
  } catch (error) {
    if (error instanceof PublicAccessError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    if (error instanceof Error && error.message.includes("Missing environment variables")) {
      console.error("[api/public/service/upload-evidence] erro", error);
      return NextResponse.json(
        { ok: false, error: "Storage de fotos ainda não configurado no ambiente" },
        { status: 500 }
      );
    }

    const { code, message } = handleR2Error(error);
    console.error("[api/public/service/upload-evidence] erro", error);
    return NextResponse.json(
      { ok: false, error: "Falha ao salvar foto no R2", code },
      { status: 500 }
    );
  }
}
