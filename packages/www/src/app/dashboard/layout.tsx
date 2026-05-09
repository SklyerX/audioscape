import { buttonVariants } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { ChevronLeft } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import React from "react";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { data } = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
    },
  });

  if (!data?.session || !data.user) return redirect("/auth");

  return <div className="container max-w-3xl mx-auto mt-10">{children}</div>;
}
