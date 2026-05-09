"use client";

import { useState } from "react";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { testWebhook } from "@/actions/test-webhook";

export default function TestWebhook({ id }: { id: string }) {
  const [isLoading, setIsLoading] = useState(false);

  const onClick = async () => {
    setIsLoading(true);

    toast.loading("Sending request...", { id: "webhook-test" });

    try {
      await testWebhook(id);
      toast.success("Webhook sent", { id: "webhook-test" });
    } catch {
      toast.error("Something went wrong while testing webhook", {
        id: "webhook-test",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row space-y-4 md:space-y-0 md:items-center justify-between border-y border-white/10 py-5">
      <div>
        <h3 className="text-2xl font-medium">Test Webhook</h3>
        <p className="text-muted-foreground">
          Test your webhook with template data
        </p>
      </div>
      <Button onClick={onClick} disabled={isLoading}>
        Test webhook
      </Button>
    </div>
  );
}
