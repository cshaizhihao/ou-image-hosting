import { PublicShareView } from "@/components/public-share";

export default async function SharePage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicShareView token={token} />;
}
