import crypto from "node:crypto";

import { env } from "../config/env.js";

const uploadedUrlCache = new Map<string, string>();

const cloudinaryReady = (): boolean => {
  return Boolean(
    env.CLOUDINARY_CLOUD_NAME &&
      env.CLOUDINARY_API_KEY &&
      env.CLOUDINARY_API_SECRET,
  );
};

const isCloudinaryUrl = (value: string): boolean => {
  return value.includes("res.cloudinary.com");
};

const toBase64DataUri = async (
  imageUrl: string,
): Promise<{ dataUri: string; mimeType: string } | null> => {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    return null;
  }

  const contentTypeHeader = response.headers.get("content-type")?.toLowerCase();
  const mimeType =
    contentTypeHeader && contentTypeHeader.startsWith("image/")
      ? contentTypeHeader.split(";")[0]
      : "image/jpeg";
  if (!mimeType.startsWith("image/")) {
    return null;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    return null;
  }

  return {
    dataUri: `data:${mimeType};base64,${buffer.toString("base64")}`,
    mimeType,
  };
};

const buildCloudinarySignature = (
  params: Record<string, string | number>,
  apiSecret: string,
): string => {
  const toSign = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && `${value}`.length > 0)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  return crypto
    .createHash("sha1")
    .update(`${toSign}${apiSecret}`)
    .digest("hex");
};

export const uploadImageToCloudinary = async (
  imageUrl: string,
): Promise<string> => {
  if (!imageUrl || isCloudinaryUrl(imageUrl) || !cloudinaryReady()) {
    return imageUrl;
  }

  if (uploadedUrlCache.has(imageUrl)) {
    return uploadedUrlCache.get(imageUrl)!;
  }

  try {
    const imageData = await toBase64DataUri(imageUrl);
    if (!imageData) {
      return imageUrl;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const paramsToSign = {
      folder: env.CLOUDINARY_FOLDER,
      timestamp,
    };
    const signature = buildCloudinarySignature(
      paramsToSign,
      env.CLOUDINARY_API_SECRET!,
    );

    const form = new URLSearchParams();
    form.set("file", imageData.dataUri);
    form.set("api_key", env.CLOUDINARY_API_KEY!);
    form.set("timestamp", String(timestamp));
    form.set("signature", signature);
    form.set("folder", env.CLOUDINARY_FOLDER);

    const uploadResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
    );

    if (!uploadResponse.ok) {
      return imageUrl;
    }

    const data = (await uploadResponse.json()) as {
      secure_url?: string;
    };
    if (!data.secure_url) {
      return imageUrl;
    }

    uploadedUrlCache.set(imageUrl, data.secure_url);
    return data.secure_url;
  } catch {
    return imageUrl;
  }
};
