// @vitest-environment node
import { describe, expect, test } from "vitest";
import { renderToString } from "react-dom/server";
import { PlayerAvatar, PlayerAvatarCircle, playerAvatarSrc } from "./player-avatar";

// Every player photo keeps the face in frame, at every size and in every list.
const CLOUD = "https://res.cloudinary.com/demo/image/upload/v1/cricket-auction/players/vk.jpg";
const DRIVE = "https://lh3.googleusercontent.com/d/vk";

describe("PlayerAvatar keeps the face visible", () => {
  test.each(["sm", "md", "lg", "xl", "2xl", "3xl"] as const)("%s: a Cloudinary photo is cropped around the face", (size) => {
    const html = renderToString(<PlayerAvatar name="Virat Kohli" photoUrl={CLOUD} size={size} />);
    expect(html).toContain("g_auto:faces");
  });

  test.each(["sm", "md", "lg"] as const)("%s: a Drive photo is anchored towards the top", (size) => {
    const html = renderToString(<PlayerAvatar name="Virat Kohli" photoUrl={DRIVE} size={size} />);
    expect(html).toContain("object-[50%_25%]");
    expect(html).not.toContain('data-photo-fit="whole"');
  });

  test.each(["xl", "2xl", "3xl"] as const)("%s: a Drive photo is shown whole over a blurred copy", (size) => {
    const html = renderToString(<PlayerAvatar name="Virat Kohli" photoUrl={DRIVE} size={size} />);
    expect(html).toContain('data-photo-fit="whole"');
    expect(html).toContain("object-contain");
  });

  test("the preload URL is the one the avatar shows", () => {
    expect(playerAvatarSrc(CLOUD, "2xl")).toContain("g_auto:faces,ar_1:1,w_384");
  });
});

describe("PlayerAvatarCircle keeps the face visible", () => {
  test("a Cloudinary photo is cropped around the face", () => {
    expect(renderToString(<PlayerAvatarCircle name="Virat Kohli" photoUrl={CLOUD} size="sm" />)).toContain("g_auto:faces");
  });

  test("a Drive photo is anchored towards the top", () => {
    expect(renderToString(<PlayerAvatarCircle name="Virat Kohli" photoUrl={DRIVE} size="md" />)).toContain("object-[50%_25%]");
  });
});
