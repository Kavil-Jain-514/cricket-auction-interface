// components/ds/cloud-image.tsx - An optimised <img> without next/image's
// client runtime: getImageProps builds the srcset on the server, and
// Cloudinary URLs are resized by Cloudinary (cloudinaryLoader). Works in
// server and client components alike.
import { getImageProps, type ImageProps } from "next/image"

import { cloudinaryFaceLoader, cloudinaryLoader, isCloudinaryUrl } from "@/lib/cloudinary"

/** `face`: crop Cloudinary photos square around the face(s) (player photos). */
export function CloudImage({ alt, className, face, ...rest }: ImageProps & { face?: boolean }) {
  const cloud = typeof rest.src === "string" && isCloudinaryUrl(rest.src)
  const loader = cloud ? (face ? cloudinaryFaceLoader : cloudinaryLoader) : undefined
  const { props } = getImageProps({ ...rest, alt, loader })
  // eslint-disable-next-line @next/next/no-img-element -- props come from getImageProps
  return <img {...props} alt={alt} className={className} />
}
