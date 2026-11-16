import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { PolicyDetail } from "./policy-detail";

// The policy id is only known at request time, so the client view sits inside Suspense.
export default function PolicyPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <PolicyDetail />
    </Suspense>
  );
}
