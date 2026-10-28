// components/ds/cloud-image.tsx - An optimised <img> without next/image's
// client runtime: getImageProps builds the srcset on the server, and
// Cloudinary URLs are resized by Cloudinary (cloudinaryLoader). Works in
// server and client components alike.
import { getImageProps, type ImageProps } from "next/image"

import { cloudinaryLoader, isCloudinaryUrl } from "@/lib/cloudinary"

export function CloudImage({ alt, className, ...rest }: ImageProps) {
  const cloud = typeof rest.src === "string" && isCloudinaryUrl(rest.src)
  const { props } = getImageProps({ ...rest, alt, loader: cloud ? cloudinaryLoader : undefined })
  // eslint-disable-next-line @next/next/no-img-element -- props come from getImageProps
  return <img {...props} alt={alt} className={className} />
}
