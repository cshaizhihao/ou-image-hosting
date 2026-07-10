import { ImageDetailView } from "@/components/image-detail";

export default async function ImageDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ImageDetailView imageId={id} />;
}
