export const dynamic = "force-dynamic";

import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest/client";
import { inngestFunctions } from "@/lib/inngest/functions";

export const runtime = "nodejs";

export const { GET, POST } = serve({
  client: inngest,
  functions: inngestFunctions
});
