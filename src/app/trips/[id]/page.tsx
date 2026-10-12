import { Suspense } from "react";
import { Workspace } from "@/components/workspace";

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <Workspace id={id} />
    </Suspense>
  );
}
