import { ImageDetailView } from "@/components/image-detail";

export default async function ImageDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ albumId?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const rawAlbumId = Array.isArray(query.albumId) ? query.albumId[0] : query.albumId;
  const albumId = rawAlbumId?.trim() ?? "";
  const fromAlbum = /^[a-zA-Z0-9_-]+$/.test(albumId);

  return (
    <ImageDetailView
      imageId={id}
      returnHref={fromAlbum ? `/albums/${encodeURIComponent(albumId)}` : "/library"}
      returnLabel={fromAlbum ? "返回相册" : "返回图片库"}
    />
  );
}
