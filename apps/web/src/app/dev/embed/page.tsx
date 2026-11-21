import { notFound } from "next/navigation";
import { isMemoryTestMode } from "@/lib/db";
import { EmbedHarness } from "./harness";

export const dynamic = "force-dynamic";

/** TEST ONLY (memory test mode): mounts @aevify/react for the browser test. 404 otherwise. */
export default function EmbedTestPage() {
  if (!isMemoryTestMode()) notFound();
  return <EmbedHarness />;
}
