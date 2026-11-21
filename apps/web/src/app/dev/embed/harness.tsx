"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
// The package source, so this test page works without building it first.
import { AevifyButton } from "../../../../../../packages/react/src/index.ts";

function Harness() {
  const params = useSearchParams();
  const [result, setResult] = useState("waiting");
  return (
    <main style={{ padding: 40, fontFamily: "system-ui" }}>
      <h1>@aevify/react test store</h1>
      <AevifyButton
        publishableKey={params.get("pk") ?? ""}
        baseUrl={typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"}
        paymentId={params.get("pid") ?? ""}
        mode="modal"
        onSuccess={({ paymentId }) => setResult(`paid ${paymentId}`)}
        onCancel={({ paymentId }) => setResult(`cancelled ${paymentId}`)}
        onError={(e) => setResult(`error ${e.message}`)}
      >
        Pay with Aevify
      </AevifyButton>
      <p data-testid="result">{result}</p>
    </main>
  );
}

export function EmbedHarness() {
  return (
    <Suspense>
      <Harness />
    </Suspense>
  );
}
